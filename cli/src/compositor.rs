use anyhow::Result;
use image::{DynamicImage, Rgba, RgbaImage};
use std::collections::HashMap;
use std::path::Path;

use crate::manifest::{Slot, SlotType, TextStyle};

/// A resolved slot with its loaded asset ready for compositing
pub struct PreparedSlot {
    pub slot: Slot,
    pub asset: SlotAsset,
}

pub enum SlotAsset {
    Image(DynamicImage),
    Text {
        content: String,
        style: TextStyle,
    },
    /// Video and audio slots are handled by the render pipeline directly
    VideoPath(std::path::PathBuf),
    AudioPath(std::path::PathBuf),
    None,
}

/// Load an image from a file path for compositing (supports SVG via resvg)
pub fn load_image_asset(path: &Path) -> Result<DynamicImage> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if ext.eq_ignore_ascii_case("svg") {
        load_svg(path)
    } else {
        let img = image::open(path)?;
        Ok(img)
    }
}

/// Render an SVG file to a DynamicImage using resvg
fn load_svg(path: &Path) -> Result<DynamicImage> {
    let svg_data = std::fs::read(path)?;
    let tree = resvg::usvg::Tree::from_data(&svg_data, &resvg::usvg::Options::default())?;
    let size = tree.size();
    let width = size.width().ceil() as u32;
    let height = size.height().ceil() as u32;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| anyhow::anyhow!("Failed to create pixmap for SVG"))?;

    resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());

    // Convert from premultiplied RGBA to straight RGBA
    let pixels = pixmap.data();
    let img = RgbaImage::from_raw(width, height, pixels.to_vec())
        .ok_or_else(|| anyhow::anyhow!("Failed to create image from SVG pixels"))?;

    Ok(DynamicImage::ImageRgba8(img))
}

/// Composite all active slots onto a base frame at the given timestamp
pub fn composite_frame(
    base: &mut RgbaImage,
    slots: &[PreparedSlot],
    time: f64,
    variables: &HashMap<String, Option<String>>,
) {
    for prepared in slots {
        let slot = &prepared.slot;
        let slot_end = slot.start + slot.duration;

        // Only draw slots that are active at this timestamp
        if time < slot.start || time >= slot_end {
            continue;
        }

        match &prepared.asset {
            SlotAsset::Image(img) => {
                draw_image(base, img, &slot.position);
            }
            SlotAsset::Text { content, style } => {
                draw_text(base, content, style, &slot.position, variables);
            }
            _ => {
                // Video/audio slots handled separately in the render pipeline
            }
        }
    }
}

/// Draw an image onto the base frame at the specified position
fn draw_image(
    base: &mut RgbaImage,
    img: &DynamicImage,
    pos: &crate::manifest::SlotPosition,
) {
    let resized = img.resize_exact(pos.w, pos.h, image::imageops::FilterType::Lanczos3);
    let rgba = resized.to_rgba8();

    for (px, py, pixel) in rgba.enumerate_pixels() {
        let bx = pos.x + px;
        let by = pos.y + py;

        if bx < base.width() && by < base.height() {
            let src = pixel;
            if src[3] == 0 {
                continue; // fully transparent
            }

            if src[3] == 255 {
                base.put_pixel(bx, by, *src);
            } else {
                // Alpha blend
                let dst = base.get_pixel(bx, by);
                let alpha = src[3] as f32 / 255.0;
                let inv = 1.0 - alpha;
                let blended = Rgba([
                    (src[0] as f32 * alpha + dst[0] as f32 * inv) as u8,
                    (src[1] as f32 * alpha + dst[1] as f32 * inv) as u8,
                    (src[2] as f32 * alpha + dst[2] as f32 * inv) as u8,
                    255,
                ]);
                base.put_pixel(bx, by, blended);
            }
        }
    }
}

/// Draw text onto the base frame
fn draw_text(
    base: &mut RgbaImage,
    content: &str,
    style: &TextStyle,
    pos: &crate::manifest::SlotPosition,
    variables: &HashMap<String, Option<String>>,
) {
    // Resolve any remaining variable references in the text
    let mut text = content.to_string();
    for (key, val) in variables {
        if let Some(v) = val {
            text = text.replace(key, v);
        }
    }

    // Draw background if specified
    if let Some(bg) = &style.background {
        if let Some(color) = parse_color(bg) {
            let pad = style.padding.unwrap_or(0);
            let x1 = pos.x.saturating_sub(pad);
            let y1 = pos.y.saturating_sub(pad);
            let x2 = (pos.x + pos.w + pad).min(base.width());
            let y2 = (pos.y + pos.h + pad).min(base.height());

            for by in y1..y2 {
                for bx in x1..x2 {
                    if color[3] == 255 {
                        base.put_pixel(bx, by, color);
                    } else {
                        let dst = base.get_pixel(bx, by);
                        let alpha = color[3] as f32 / 255.0;
                        let inv = 1.0 - alpha;
                        base.put_pixel(bx, by, Rgba([
                            (color[0] as f32 * alpha + dst[0] as f32 * inv) as u8,
                            (color[1] as f32 * alpha + dst[1] as f32 * inv) as u8,
                            (color[2] as f32 * alpha + dst[2] as f32 * inv) as u8,
                            255,
                        ]));
                    }
                }
            }
        }
    }

    // For text rendering, we use rusttype with a built-in font
    let font_data = include_bytes!("../assets/DejaVuSans.ttf");
    let font = match rusttype::Font::try_from_bytes(font_data) {
        Some(f) => f,
        None => return,
    };

    let font_size = style.font_size.unwrap_or(24.0);
    let scale = rusttype::Scale::uniform(font_size);
    let color = parse_color(style.color.as_deref().unwrap_or("#ffffff"))
        .unwrap_or(Rgba([255, 255, 255, 255]));

    let v_metrics = font.v_metrics(scale);
    let line_height = style.line_height.unwrap_or(font_size * 1.4);

    // Simple word wrapping
    let lines = wrap_text(&font, scale, &text, pos.w as f32);

    for (i, line) in lines.iter().enumerate() {
        let y_offset = pos.y as f32 + i as f32 * line_height + v_metrics.ascent;

        if y_offset + font_size > (pos.y + pos.h) as f32 {
            break; // clip to slot height
        }

        let glyphs: Vec<_> = font.layout(line, scale, rusttype::point(0.0, 0.0)).collect();

        // Calculate x position based on alignment
        let text_width: f32 = glyphs
            .last()
            .map(|g| g.position().x + g.unpositioned().h_metrics().advance_width)
            .unwrap_or(0.0);

        let x_offset = match style.align.as_deref().unwrap_or("left") {
            "center" => pos.x as f32 + (pos.w as f32 - text_width) / 2.0,
            "right" => pos.x as f32 + pos.w as f32 - text_width,
            _ => pos.x as f32,
        };

        for glyph in &glyphs {
            let positioned = glyph.clone().into_unpositioned().positioned(
                rusttype::point(x_offset + glyph.position().x, y_offset),
            );

            if let Some(bb) = positioned.pixel_bounding_box() {
                positioned.draw(|px, py, v| {
                    let bx = (bb.min.x + px as i32) as u32;
                    let by = (bb.min.y + py as i32) as u32;

                    if bx < base.width() && by < base.height() && v > 0.01 {
                        let dst = base.get_pixel(bx, by);
                        let alpha = v;
                        let inv = 1.0 - alpha;
                        base.put_pixel(bx, by, Rgba([
                            (color[0] as f32 * alpha + dst[0] as f32 * inv) as u8,
                            (color[1] as f32 * alpha + dst[1] as f32 * inv) as u8,
                            (color[2] as f32 * alpha + dst[2] as f32 * inv) as u8,
                            255,
                        ]));
                    }
                });
            }
        }
    }
}

fn wrap_text(font: &rusttype::Font, scale: rusttype::Scale, text: &str, max_width: f32) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in words {
        let test = if current.is_empty() {
            word.to_string()
        } else {
            format!("{} {}", current, word)
        };

        let width = font
            .layout(&test, scale, rusttype::point(0.0, 0.0))
            .last()
            .map(|g| g.position().x + g.unpositioned().h_metrics().advance_width)
            .unwrap_or(0.0);

        if width > max_width && !current.is_empty() {
            lines.push(current);
            current = word.to_string();
        } else {
            current = test;
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

/// Parse a CSS color string (#rgb, #rrggbb, rgba(...))
fn parse_color(s: &str) -> Option<Rgba<u8>> {
    let s = s.trim();

    if let Some(hex) = s.strip_prefix('#') {
        let bytes: Vec<u8> = match hex.len() {
            3 => {
                let chars: Vec<char> = hex.chars().collect();
                vec![
                    u8::from_str_radix(&format!("{}{}", chars[0], chars[0]), 16).ok()?,
                    u8::from_str_radix(&format!("{}{}", chars[1], chars[1]), 16).ok()?,
                    u8::from_str_radix(&format!("{}{}", chars[2], chars[2]), 16).ok()?,
                ]
            }
            6 => vec![
                u8::from_str_radix(&hex[0..2], 16).ok()?,
                u8::from_str_radix(&hex[2..4], 16).ok()?,
                u8::from_str_radix(&hex[4..6], 16).ok()?,
            ],
            _ => return None,
        };
        return Some(Rgba([bytes[0], bytes[1], bytes[2], 255]));
    }

    if s.starts_with("rgba(") && s.ends_with(')') {
        let inner = &s[5..s.len() - 1];
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 4 {
            let r = parts[0].trim().parse::<u8>().ok()?;
            let g = parts[1].trim().parse::<u8>().ok()?;
            let b = parts[2].trim().parse::<u8>().ok()?;
            let a = parts[3].trim().parse::<f32>().ok()?;
            return Some(Rgba([r, g, b, (a * 255.0) as u8]));
        }
    }

    None
}
