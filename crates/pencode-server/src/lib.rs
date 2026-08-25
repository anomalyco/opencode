//! HTTP API server exposing pencode sessions and config.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use pencode_core::App;
use pencode_protocol::{Message, Part, Role, Session};
use std::sync::Arc;

pub struct AppState {
    pub app: App,
}

pub type SharedState = Arc<AppState>;

pub fn router(app: App) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/config", get(get_config))
        .route("/session", post(create_session).get(list_sessions))
        .route(
            "/session/{id}",
            get(get_session).delete(delete_session),
        )
        .route("/session/{id}/message", post(add_message))
        .with_state(Arc::new(AppState { app }))
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn get_config(State(state): State<SharedState>) -> impl IntoResponse {
    Json(state.app.config().clone())
}

async fn create_session(
    State(state): State<SharedState>,
    body: Option<Json<serde_json::Value>>,
) -> Result<impl IntoResponse, ApiError> {
    let directory = body
        .and_then(|Json(v)| v.get("directory").and_then(|d| d.as_str()).map(String::from))
        .unwrap_or_else(|| ".".to_string());
    let session = state.app.store().create(&directory)?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn list_sessions(State(state): State<SharedState>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.app.store().list()?))
}

async fn get_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.app.store().get(&id)?))
}

async fn delete_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let store = state.app.store().clone();
    tokio::task::spawn_blocking(move || store.remove(&id))
        .await
        .map_err(|err| ApiError(anyhow::anyhow!(err)))??;
    Ok(StatusCode::NO_CONTENT)
}

async fn add_message(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<MessageBody>,
) -> Result<impl IntoResponse, ApiError> {
    let message = Message::new(Role::User, vec![Part::text(body.text)]);
    let session = state.app.store().append(&id, message)?;
    Ok(Json(session))
}

#[derive(Debug, serde::Deserialize)]
pub struct MessageBody {
    pub text: String,
}

struct ApiError(anyhow::Error);

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": self.0.to_string() })),
        )
            .into_response()
    }
}

/// Runs the API server until shutdown.
pub async fn serve(app: App, port: u16) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    println!("pencode server listening on http://127.0.0.1:{port}");
    axum::serve(listener, router(app)).await?;
    Ok(())
}

/// Silence unused warnings for types kept for future SSE/event support.
#[allow(dead_code)]
fn _assert_types(s: Session) -> Session {
    s
}
