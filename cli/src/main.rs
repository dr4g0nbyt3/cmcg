mod compositor;
mod manifest;
mod renderer;
mod resolver;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "cmcg",
    about = "CMCG CLI — Connected Media Container & Generator",
    long_about = "Render .cmcg dynamic video templates to MP4.\n\nA .cmcg file is a video template where media slots resolve from variables, local files, or remote URLs at render time.",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Render a .cmcg template to MP4
    Render {
        /// Path to .cmcg bundle or manifest.json
        input: PathBuf,

        /// Output MP4 file path
        #[arg(short, long, default_value = "output.mp4")]
        output: PathBuf,

        /// Variable overrides (key=value, can be repeated)
        #[arg(short, long = "var", value_parser = parse_var)]
        vars: Vec<(String, String)>,

        /// Render quality: low, medium, high, lossless
        #[arg(short, long, default_value = "high")]
        quality: String,

        /// Output resolution (WIDTHxHEIGHT), defaults to manifest resolution
        #[arg(short, long, value_parser = parse_resolution)]
        resolution: Option<(u32, u32)>,
    },

    /// Inspect a .cmcg template without rendering
    Inspect {
        /// Path to .cmcg bundle or manifest.json
        input: PathBuf,
    },
}

fn parse_var(s: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = s.splitn(2, '=').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid variable format: '{}'. Expected key=value", s));
    }
    let key = if parts[0].starts_with('$') {
        parts[0].to_string()
    } else {
        format!("${}", parts[0])
    };
    Ok((key, parts[1].to_string()))
}

fn parse_resolution(s: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = s.split('x').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid resolution: '{}'. Expected WIDTHxHEIGHT", s));
    }
    let w = parts[0].parse::<u32>().map_err(|e| e.to_string())?;
    let h = parts[1].parse::<u32>().map_err(|e| e.to_string())?;
    Ok((w, h))
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Render {
            input,
            output,
            vars,
            quality,
            resolution,
        } => {
            let template = manifest::load_template(&input)?;

            // Merge manifest variables with CLI overrides
            let mut variables = template.manifest.variables.clone();
            for (key, value) in vars {
                variables.insert(key, Some(value));
            }

            renderer::render(&template, &variables, &output, &quality, resolution).await?;
        }

        Commands::Inspect { input } => {
            let template = manifest::load_template(&input)?;
            let m = &template.manifest;

            println!("CMCG Template: {}", m.meta.name);
            println!("  Version:    {}", m.cmcg_version);
            println!("  Resolution: {}x{}", m.meta.resolution.0, m.meta.resolution.1);
            println!("  FPS:        {}", m.meta.fps);
            println!("  Duration:   {}s", m.meta.duration);
            println!("  Base Video: {}", m.base_video);
            println!();

            println!("Variables ({}):", m.variables.len());
            for (key, val) in &m.variables {
                println!("  {} = {}",
                    key,
                    val.as_deref().unwrap_or("null (unset)")
                );
            }
            println!();

            println!("Slots ({}):", m.slots.len());
            for slot in &m.slots {
                println!("  [{}] {:?} @ {:.1}s—{:.1}s ({}x{} at {},{}){}",
                    slot.id,
                    slot.slot_type,
                    slot.start,
                    slot.start + slot.duration,
                    slot.position.w,
                    slot.position.h,
                    slot.position.x,
                    slot.position.y,
                    if slot.text.is_some() {
                        format!(" text: \"{}\"",
                            slot.text.as_ref().unwrap().content.chars().take(30).collect::<String>())
                    } else {
                        String::new()
                    }
                );
            }
        }
    }

    Ok(())
}
