use anyhow::{Context, Result};
use image::RgbaImage;
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::compositor::{self, PreparedSlot, SlotAsset};
use crate::manifest::{LoadedTemplate, SlotType};
use crate::resolver::{self, ResolvedSource};

/// Quality preset mapping to CRF values
fn quality_to_crf(quality: &str) -> &str {
    match quality {
        "low" => "28",
        "medium" => "23",
        "high" => "18",
        "lossless" => "0",
        _ => "23",
    }
}

/// The full render pipeline:
/// 1. Decode base video frames via `ffmpeg` subprocess → raw RGBA frames
/// 2. Composite slots onto each frame in Rust
/// 3. Pipe composited frames to `ffmpeg` subprocess → encode MP4
pub async fn render(
    template: &LoadedTemplate,
    variables: &HashMap<String, Option<String>>,
    output_path: &Path,
    quality: &str,
    resolution: Option<(u32, u32)>,
) -> Result<()> {
    let manifest = &template.manifest;
    let (width, height) = resolution.unwrap_or(manifest.meta.resolution);
    let fps = manifest.meta.fps;
    let duration = manifest.meta.duration;
    let total_frames = (duration * fps as f64).ceil() as u64;

    // Verify ffmpeg is available
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("ffmpeg not found in PATH. Install FFmpeg to use the render command.")?;

    println!("[CMCG] Rendering: {} ({}x{} @ {}fps, {} frames)",
        manifest.meta.name, width, height, fps, total_frames);
    println!("[CMCG] Quality: {} (CRF {})", quality, quality_to_crf(quality));

    // ── Resolve all slot sources ───────────────────────────────

    let mut prepared_slots = Vec::new();
    for slot in &manifest.slots {
        let asset = match slot.slot_type {
            SlotType::Image | SlotType::Overlay => {
                let resolved = resolver::resolve_source(
                    &slot.source, variables, template, slot.fetch_timeout,
                ).await?;
                match resolved {
                    ResolvedSource::LocalFile(path) => {
                        match compositor::load_image_asset(&path) {
                            Ok(img) => {
                                println!("[CMCG]   Image slot '{}' loaded: {}",
                                    slot.id, path.display());
                                SlotAsset::Image(img)
                            }
                            Err(e) => {
                                eprintln!("[CMCG]   Warning: Failed to load image '{}': {}",
                                    slot.id, e);
                                SlotAsset::None
                            }
                        }
                    }
                    ResolvedSource::None => {
                        eprintln!("[CMCG]   Warning: No source for slot '{}'", slot.id);
                        SlotAsset::None
                    }
                }
            }
            SlotType::Text => {
                if let Some(text_style) = &slot.text {
                    let mut content = text_style.content.clone();
                    for (key, val) in variables {
                        if let Some(v) = val {
                            content = content.replace(key, v);
                        }
                    }
                    println!("[CMCG]   Text slot '{}': \"{}\"",
                        slot.id, &content[..content.len().min(50)]);
                    SlotAsset::Text {
                        content,
                        style: text_style.clone(),
                    }
                } else {
                    SlotAsset::None
                }
            }
            SlotType::Video => {
                let resolved = resolver::resolve_source(
                    &slot.source, variables, template, slot.fetch_timeout,
                ).await?;
                match resolved {
                    ResolvedSource::LocalFile(path) => {
                        println!("[CMCG]   Video slot '{}': {}", slot.id, path.display());
                        SlotAsset::VideoPath(path)
                    }
                    ResolvedSource::None => SlotAsset::None,
                }
            }
            SlotType::Audio => {
                let resolved = resolver::resolve_source(
                    &slot.source, variables, template, slot.fetch_timeout,
                ).await?;
                match resolved {
                    ResolvedSource::LocalFile(path) => {
                        println!("[CMCG]   Audio slot '{}': {}", slot.id, path.display());
                        SlotAsset::AudioPath(path)
                    }
                    ResolvedSource::None => SlotAsset::None,
                }
            }
        };

        prepared_slots.push(PreparedSlot {
            slot: slot.clone(),
            asset,
        });
    }

    // ── Resolve base video path ────────────────────────────────

    let base_video_path = resolve_base_video(template)?;
    println!("[CMCG] Base video: {}", base_video_path.display());

    // ── Pipeline: decode → composite → encode ──────────────────

    let frame_size = (width * height * 4) as usize; // RGBA

    // Spawn decoder: ffmpeg → raw RGBA frames to stdout
    let mut decoder = Command::new("ffmpeg")
        .args([
            "-i", base_video_path.to_str().unwrap(),
            "-vf", &format!("scale={}:{},fps={}", width, height, fps),
            "-pix_fmt", "rgba",
            "-f", "rawvideo",
            "-v", "quiet",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to start ffmpeg decoder")?;

    // Spawn encoder: raw RGBA frames from stdin → MP4
    let crf = quality_to_crf(quality);
    let mut encoder = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", &format!("{}x{}", width, height),
            "-r", &fps.to_string(),
            "-i", "-",                          // video from stdin
            "-i", base_video_path.to_str().unwrap(), // audio from base video
            "-map", "0:v",                      // video from pipe
            "-map", "1:a?",                     // audio from base (optional)
            "-c:v", "libx264",
            "-crf", crf,
            "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "aac",
            "-shortest",
            "-v", "quiet",
            output_path.to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to start ffmpeg encoder")?;

    let decoder_stdout = decoder.stdout.take().unwrap();
    let encoder_stdin = encoder.stdin.take().unwrap();

    // Progress bar
    let progress = ProgressBar::new(total_frames);
    progress.set_style(
        ProgressStyle::with_template(
            "[CMCG] {bar:40.green/dark_gray} {pos}/{len} frames ({percent}%) [{elapsed}<{eta}]"
        )
        .unwrap()
        .progress_chars("━━─"),
    );

    // Read frames, composite, write
    let mut reader = std::io::BufReader::new(decoder_stdout);
    let mut writer = std::io::BufWriter::new(encoder_stdin);
    let mut frame_buf = vec![0u8; frame_size];
    let mut frame_count: u64 = 0;

    loop {
        use std::io::Read;

        // Read one full RGBA frame from the decoder
        match reader.read_exact(&mut frame_buf) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e).context("Failed to read frame from decoder"),
        }

        if frame_count >= total_frames {
            break;
        }

        // Convert to RgbaImage
        let mut img = RgbaImage::from_raw(width, height, frame_buf.clone())
            .context("Failed to create image from frame data")?;

        // Composite slots onto this frame
        let time = frame_count as f64 / fps as f64;
        compositor::composite_frame(&mut img, &prepared_slots, time, variables);

        // Write composited frame to encoder
        writer.write_all(&img.into_raw())
            .context("Failed to write frame to encoder")?;

        frame_count += 1;
        progress.set_position(frame_count);
    }

    // Close stdin to signal EOF to encoder
    drop(writer);
    drop(reader);

    // Wait for both processes
    let decoder_status = decoder.wait()?;
    let encoder_status = encoder.wait()?;

    progress.finish_with_message("Done");

    if !encoder_status.success() {
        anyhow::bail!("FFmpeg encoder exited with status: {}", encoder_status);
    }
    if !decoder_status.success() {
        // Decoder may exit non-zero if we stopped reading early, that's ok
    }

    let file_size = std::fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);
    println!("\n[CMCG] Output: {} ({:.1} MB)",
        output_path.display(),
        file_size as f64 / 1_048_576.0);

    Ok(())
}

fn resolve_base_video(template: &LoadedTemplate) -> Result<std::path::PathBuf> {
    let base = &template.manifest.base_video;

    if let Some(path) = template.extracted_files.get(base) {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Strip leading ./ or / for relative path resolution
    let stripped = base.trim_start_matches("./").trim_start_matches('/');
    let path = template.base_dir.join(stripped);
    if path.exists() {
        return Ok(path);
    }

    anyhow::bail!("Base video not found: {} (tried: {})", base, path.display());
}
