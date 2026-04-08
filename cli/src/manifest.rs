use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

// ── Manifest Types ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct CMCGManifest {
    pub cmcg_version: String,
    pub meta: ManifestMeta,
    #[serde(default)]
    pub variables: HashMap<String, Option<String>>,
    pub base_video: String,
    pub slots: Vec<Slot>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ManifestMeta {
    pub name: String,
    pub resolution: (u32, u32),
    pub fps: u32,
    pub duration: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Slot {
    pub id: String,
    #[serde(rename = "type")]
    pub slot_type: SlotType,
    pub start: f64,
    pub duration: f64,
    pub position: SlotPosition,
    #[serde(default)]
    pub source: SlotSource,
    pub text: Option<TextStyle>,
    pub volume: Option<f32>,
    #[serde(rename = "loop")]
    pub loop_slot: Option<bool>,
    pub cache: Option<String>,
    #[serde(rename = "fetchTimeout")]
    pub fetch_timeout: Option<u64>,
}

#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SlotType {
    Image,
    Video,
    Text,
    Audio,
    Overlay,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SlotPosition {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct SlotSource {
    pub variable: Option<String>,
    pub local: Option<String>,
    pub remote: Option<String>,
    pub fallback: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct TextStyle {
    pub content: String,
    #[serde(rename = "fontFamily")]
    pub font_family: Option<String>,
    #[serde(rename = "fontSize")]
    pub font_size: Option<f32>,
    #[serde(rename = "fontWeight")]
    pub font_weight: Option<String>,
    pub color: Option<String>,
    pub align: Option<String>,
    #[serde(rename = "lineHeight")]
    pub line_height: Option<f32>,
    pub background: Option<String>,
    pub padding: Option<u32>,
}

// ── Bundle Loading ─────────────────────────────────────────────

/// Result of loading a .cmcg bundle or standalone manifest
pub struct LoadedTemplate {
    pub manifest: CMCGManifest,
    /// Base directory for resolving relative paths
    pub base_dir: PathBuf,
    /// Extracted files from ZIP bundle (path → temp file path)
    pub extracted_files: HashMap<String, PathBuf>,
    /// Temp directory (kept alive so files aren't deleted)
    _temp_dir: Option<tempfile::TempDir>,
}

/// Load a .cmcg file (ZIP bundle) or a standalone manifest.json
pub fn load_template(path: &Path) -> Result<LoadedTemplate> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    match ext {
        "cmcg" | "zip" => load_bundle(path),
        "json" => load_standalone(path),
        _ => {
            // Try as JSON first, then as ZIP
            if let Ok(t) = load_standalone(path) {
                Ok(t)
            } else {
                load_bundle(path)
            }
        }
    }
}

fn load_standalone(path: &Path) -> Result<LoadedTemplate> {
    let content = fs::read_to_string(path).context("Failed to read manifest file")?;
    let manifest: CMCGManifest =
        serde_json::from_str(&content).context("Failed to parse manifest JSON")?;

    let base_dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();

    Ok(LoadedTemplate {
        manifest,
        base_dir,
        extracted_files: HashMap::new(),
        _temp_dir: None,
    })
}

fn load_bundle(path: &Path) -> Result<LoadedTemplate> {
    let file = fs::File::open(path).context("Failed to open .cmcg bundle")?;
    let mut archive = zip::ZipArchive::new(file).context("Failed to read ZIP archive")?;

    // Create temp directory for extracted files
    let temp_dir = tempfile::tempdir().context("Failed to create temp directory")?;
    let mut extracted_files = HashMap::new();

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();

        if entry.is_dir() {
            continue;
        }

        let out_path = temp_dir.path().join(&name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        fs::write(&out_path, &buf)?;

        // Store with multiple path variants for flexible lookup
        extracted_files.insert(name.clone(), out_path.clone());
        if !name.starts_with("./") {
            extracted_files.insert(format!("./{}", name), out_path.clone());
        }
        if !name.starts_with('/') {
            extracted_files.insert(format!("/{}", name), out_path);
        }
    }

    // Parse manifest.json from extracted files
    let manifest_path = extracted_files
        .get("manifest.json")
        .context("Bundle missing manifest.json")?;
    let content = fs::read_to_string(manifest_path)?;
    let manifest: CMCGManifest = serde_json::from_str(&content)?;

    Ok(LoadedTemplate {
        manifest,
        base_dir: temp_dir.path().to_path_buf(),
        extracted_files,
        _temp_dir: Some(temp_dir),
    })
}
