use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::manifest::{LoadedTemplate, SlotSource};

/// Resolved media source — either a local file path or downloaded temp file
pub enum ResolvedSource {
    LocalFile(PathBuf),
    /// No source resolved
    None,
}

impl ResolvedSource {
    pub fn path(&self) -> Option<&Path> {
        match self {
            ResolvedSource::LocalFile(p) => Some(p),
            ResolvedSource::None => None,
        }
    }
}

/// Resolve a slot's media source through the priority chain:
/// variable → local → remote (download) → fallback
pub async fn resolve_source(
    source: &SlotSource,
    variables: &HashMap<String, Option<String>>,
    template: &LoadedTemplate,
    timeout_ms: Option<u64>,
) -> Result<ResolvedSource> {
    // 1. Check variable binding
    if let Some(var_name) = &source.variable {
        if let Some(Some(value)) = variables.get(var_name) {
            if !value.is_empty() {
                // Variable value could be a URL or a file path
                if value.starts_with("http://") || value.starts_with("https://") {
                    if let Ok(path) = download_remote(value, timeout_ms).await {
                        return Ok(ResolvedSource::LocalFile(path));
                    }
                } else {
                    let path = template.base_dir.join(value);
                    if path.exists() {
                        return Ok(ResolvedSource::LocalFile(path));
                    }
                }
            }
        }
    }

    // 2. Local file path
    if let Some(local) = &source.local {
        // Check extracted bundle files first
        if let Some(extracted) = template.extracted_files.get(local) {
            if extracted.exists() {
                return Ok(ResolvedSource::LocalFile(extracted.clone()));
            }
        }
        // Then check relative to base directory
        let path = template.base_dir.join(local.trim_start_matches("./").trim_start_matches('/'));
        if path.exists() {
            return Ok(ResolvedSource::LocalFile(path));
        }
    }

    // 3. Remote URL — HTTPS-only enforcement
    if let Some(remote) = &source.remote {
        if remote.starts_with("http://") {
            bail!("HTTP sources are not allowed — CMCG enforces HTTPS-only: {}", remote);
        }
        if remote.starts_with("https://") {
            match download_remote(remote, timeout_ms).await {
                Ok(path) => return Ok(ResolvedSource::LocalFile(path)),
                Err(e) => {
                    eprintln!("[CMCG] Remote fetch failed for {}: {}", remote, e);
                    // Fall through to fallback
                }
            }
        }
    }

    // 4. Fallback
    if let Some(fallback) = &source.fallback {
        if let Some(extracted) = template.extracted_files.get(fallback) {
            if extracted.exists() {
                return Ok(ResolvedSource::LocalFile(extracted.clone()));
            }
        }
        let path = template.base_dir.join(fallback.trim_start_matches("./").trim_start_matches('/'));
        if path.exists() {
            return Ok(ResolvedSource::LocalFile(path));
        }
    }

    Ok(ResolvedSource::None)
}

/// Download a remote URL to a temporary file
async fn download_remote(url: &str, timeout_ms: Option<u64>) -> Result<PathBuf> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .context("Failed to create HTTP client")?;

    let response = client
        .get(url)
        .send()
        .await
        .context("HTTP request failed")?
        .error_for_status()
        .context("HTTP error response")?;

    let bytes = response.bytes().await.context("Failed to read response")?;

    // Determine file extension from URL
    let ext = url
        .rsplit('/')
        .next()
        .and_then(|s| s.rsplit('.').next())
        .unwrap_or("bin");

    let temp_file = tempfile::Builder::new()
        .suffix(&format!(".{}", ext))
        .tempfile()
        .context("Failed to create temp file")?;

    let path = temp_file.path().to_path_buf();
    std::fs::write(&path, &bytes)?;

    // Keep the file alive by leaking the handle (cleaned up when process exits)
    let _ = temp_file.into_temp_path();

    Ok(path)
}
