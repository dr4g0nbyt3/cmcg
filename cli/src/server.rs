mod compositor;
mod manifest;
mod renderer;
mod resolver;

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tower_http::cors::CorsLayer;

// ── Config ─────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    output_dir: PathBuf,
    render_semaphore: Arc<Semaphore>,
}

// ── Request/Response Types ─────────────────────────────────────

#[derive(Deserialize)]
struct RenderRequest {
    /// Path to .cmcg file or manifest.json on the server
    template: String,
    /// Variable overrides
    #[serde(default)]
    variables: HashMap<String, String>,
    /// Quality: low, medium, high, lossless
    #[serde(default = "default_quality")]
    quality: String,
    /// Resolution override (e.g. "1920x1080")
    resolution: Option<String>,
}

fn default_quality() -> String {
    "high".to_string()
}

#[derive(Serialize)]
struct RenderResponse {
    status: String,
    job_id: String,
    output_url: String,
    file_size_bytes: u64,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

#[derive(Serialize)]
struct InspectResponse {
    name: String,
    version: String,
    resolution: (u32, u32),
    fps: u32,
    duration: f64,
    variables: HashMap<String, Option<String>>,
    slots: Vec<SlotInfo>,
}

#[derive(Serialize)]
struct SlotInfo {
    id: String,
    #[serde(rename = "type")]
    slot_type: String,
    start: f64,
    duration: f64,
}

type ApiError = (StatusCode, Json<ErrorResponse>);

// ── Routes ─────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let output_dir = PathBuf::from(
        std::env::var("CMCG_OUTPUT_DIR").unwrap_or_else(|_| "./renders".to_string()),
    );
    std::fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    let max_concurrent = std::env::var("CMCG_MAX_CONCURRENT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4usize);

    let state = AppState {
        output_dir,
        render_semaphore: Arc::new(Semaphore::new(max_concurrent)),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/inspect", post(inspect))
        .route("/api/render", post(render_template))
        .route("/api/render/upload", post(render_upload))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3100".to_string());
    let addr = format!("0.0.0.0:{}", port);

    println!("[CMCG Server] Starting on http://{}", addr);
    println!("[CMCG Server] Max concurrent renders: {}", max_concurrent);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Handlers ───────────────────────────────────────────────────

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn inspect(
    Json(req): Json<RenderRequest>,
) -> Result<Json<InspectResponse>, ApiError> {
    let path = PathBuf::from(&req.template);
    let template = manifest::load_template(&path).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
    })?;

    let m = &template.manifest;
    Ok(Json(InspectResponse {
        name: m.meta.name.clone(),
        version: m.cmcg_version.clone(),
        resolution: m.meta.resolution,
        fps: m.meta.fps,
        duration: m.meta.duration,
        variables: m.variables.clone(),
        slots: m.slots.iter().map(|s| SlotInfo {
            id: s.id.clone(),
            slot_type: format!("{:?}", s.slot_type).to_lowercase(),
            start: s.start,
            duration: s.duration,
        }).collect(),
    }))
}

async fn render_template(
    State(state): State<AppState>,
    Json(req): Json<RenderRequest>,
) -> Result<Json<RenderResponse>, ApiError> {
    let _permit = state.render_semaphore.acquire().await.unwrap();

    let path = PathBuf::from(&req.template);
    let template = manifest::load_template(&path).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
    })?;

    let job_id = uuid::Uuid::new_v4().to_string();
    let output_filename = format!("{}.mp4", job_id);
    let output_path = state.output_dir.join(&output_filename);

    let mut variables = template.manifest.variables.clone();
    for (key, value) in &req.variables {
        let var_key = if key.starts_with('$') { key.clone() } else { format!("${}", key) };
        variables.insert(var_key, Some(value.clone()));
    }

    let resolution = req.resolution.as_ref().and_then(|r| {
        let parts: Vec<&str> = r.split('x').collect();
        if parts.len() == 2 {
            Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
        } else {
            None
        }
    });

    renderer::render(&template, &variables, &output_path, &req.quality, resolution)
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() }))
        })?;

    let file_size = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);

    Ok(Json(RenderResponse {
        status: "completed".to_string(),
        job_id,
        output_url: format!("/renders/{}", output_filename),
        file_size_bytes: file_size,
    }))
}

async fn render_upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<RenderResponse>, ApiError> {
    let _permit = state.render_semaphore.acquire().await.unwrap();

    let mut template_data: Option<Vec<u8>> = None;
    let mut variables: HashMap<String, String> = HashMap::new();
    let mut quality = "high".to_string();
    let mut resolution: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "template" => {
                template_data = Some(field.bytes().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
                })?.to_vec());
            }
            "variables" => {
                let text = field.text().await.map_err(|e| {
                    (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
                })?;
                variables = serde_json::from_str(&text).unwrap_or_default();
            }
            "quality" => {
                quality = field.text().await.unwrap_or_else(|_| "high".to_string());
            }
            "resolution" => {
                resolution = Some(field.text().await.unwrap_or_default());
            }
            _ => {}
        }
    }

    let data = template_data.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "Missing 'template' field".to_string() }))
    })?;

    // Save to temp file and load
    let tmp = tempfile::Builder::new()
        .suffix(".cmcg")
        .tempfile()
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() }))
        })?;
    std::fs::write(tmp.path(), &data).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() }))
    })?;

    let template = manifest::load_template(tmp.path()).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e.to_string() }))
    })?;

    let job_id = uuid::Uuid::new_v4().to_string();
    let output_filename = format!("{}.mp4", job_id);
    let output_path = state.output_dir.join(&output_filename);

    let mut merged_vars = template.manifest.variables.clone();
    for (key, value) in &variables {
        let var_key = if key.starts_with('$') { key.clone() } else { format!("${}", key) };
        merged_vars.insert(var_key, Some(value.clone()));
    }

    let res = resolution.as_ref().and_then(|r| {
        let parts: Vec<&str> = r.split('x').collect();
        if parts.len() == 2 {
            Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
        } else {
            None
        }
    });

    renderer::render(&template, &merged_vars, &output_path, &quality, res)
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() }))
        })?;

    let file_size = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);

    Ok(Json(RenderResponse {
        status: "completed".to_string(),
        job_id,
        output_url: format!("/renders/{}", output_filename),
        file_size_bytes: file_size,
    }))
}
