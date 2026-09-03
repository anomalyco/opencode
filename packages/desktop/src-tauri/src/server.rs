use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::task::JoinHandle;

use crate::{
    cli,
    cli::CommandChild,
    constants::{DEFAULT_SERVER_URL_KEY, SETTINGS_STORE, WSL_ENABLED_KEY},
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default)]
pub struct WslConfig {
    pub enabled: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_default_server_url(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let value = store.get(DEFAULT_SERVER_URL_KEY);
    match value {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_default_server_url(app: AppHandle, url: Option<String>) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    match url {
        Some(u) => {
            store.set(DEFAULT_SERVER_URL_KEY, serde_json::Value::String(u));
        }
        None => {
            store.delete(DEFAULT_SERVER_URL_KEY);
        }
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_wsl_config(_app: AppHandle) -> Result<WslConfig, String> {
    // let store = app
    //     .store(SETTINGS_STORE)
    //     .map_err(|e| format!("Failed to open settings store: {}", e))?;

    // let enabled = store
    //     .get(WSL_ENABLED_KEY)
    //     .as_ref()
    //     .and_then(|v| v.as_bool())
    //     .unwrap_or(false);

    Ok(WslConfig { enabled: false })
}

#[tauri::command]
#[specta::specta]
pub fn set_wsl_config(app: AppHandle, config: WslConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(WSL_ENABLED_KEY, serde_json::Value::Bool(config.enabled));

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

pub fn spawn_local_server(
    app: AppHandle,
    hostname: String,
    port: u32,
    password: String,
) -> (CommandChild, HealthCheck) {
    let (child, exit) = cli::serve(&app, &hostname, port, &password);

    tracing::info!(
        hostname = %hostname,
        port = %port,
        "Sidecar process spawned, waiting for server to become healthy"
    );

    let health_check = HealthCheck(tokio::spawn(async move {
        let url = format!("http://{hostname}:{port}");
        let timestamp = Instant::now();

        tracing::debug!("Health check loop starting");

        let ready = async {
            tracing::info!("Starting health check loop for server at {}", url);

            match check_health_with_retry(&url, Some(&password)).await {
                Ok(()) => {
                    tracing::info!(elapsed = ?timestamp.elapsed(), "Server ready after health checks");
                    Ok(())
                }
                Err(e) => {
                    tracing::error!(error = %e, "Server failed health checks");
                    Err(e)
                }
            }
        };

        let terminated = async {
            match exit.await {
                Ok(payload) => Err(format!(
                    "Sidecar terminated before becoming healthy (code={:?} signal={:?})",
                    payload.code, payload.signal
                )),
                Err(_) => Err("Sidecar terminated before becoming healthy".to_string()),
            }
        };

        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    }));

    (child, health_check)
}

pub struct HealthCheck(pub JoinHandle<Result<(), String>>);

// Configuration for health check retries with exponential backoff.
// Total max duration: 500+1000+2000+4000+4000=11.5s delays + 6*2000ms=12s timeouts = ~23.5s
// This fits within the caller's 30s timeout and allows retries on transient failures.
const HEALTH_CHECK_BASE_INTERVAL_MS: u64 = 500;
const HEALTH_CHECK_MAX_INTERVAL_MS: u64 = 4000;
const HEALTH_CHECK_MAX_ATTEMPTS: u32 = 6;

#[inline]
fn backoff_interval(attempt: u32) -> u64 {
    HEALTH_CHECK_BASE_INTERVAL_MS
        .saturating_mul(2_u64.saturating_pow(attempt.min(3)))
        .min(HEALTH_CHECK_MAX_INTERVAL_MS)
}

async fn check_health_with_retry(url: &str, password: Option<&str>) -> Result<(), String> {
    let url_owned = url.to_string();
    let password_owned = password.map(|p| p.to_string());

    let health_url = reqwest::Url::parse(&url_owned)
        .and_then(|u| u.join("/global/health"))
        .map_err(|_| "Invalid health check URL".to_string())?;

    let client = {
        let builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(7))
            .no_proxy(); // always skip proxy for localhost health checks
        builder.build().map_err(|e| format!("Failed to build HTTP client: {}", e))?
    };

    for attempt in 0..HEALTH_CHECK_MAX_ATTEMPTS {
        if attempt > 0 {
            let wait_ms = backoff_interval(attempt - 1);
            tracing::debug!(
                attempt,
                wait_ms,
                "Health check failed, retrying after backoff"
            );
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
        }

        let mut req = client.get(health_url.clone());
        if let Some(ref pw) = password_owned {
            req = req.basic_auth("opencode", Some(pw));
        }

        let result = tokio::time::timeout(Duration::from_millis(2000), req.send()).await;

        let success = match result {
            Ok(Ok(resp)) => resp.status().is_success(),
            Ok(Err(e)) => {
                tracing::debug!(error = %e, attempt, "Request failed, will retry");
                false
            }
            Err(_) => {
                tracing::debug!(attempt, "Request timed out, will retry");
                false
            }
        };

        if success {
            return Ok(());
        }

        // If this is the last attempt, return the failure error
        if attempt + 1 >= HEALTH_CHECK_MAX_ATTEMPTS {
            return Err("Health check failed after all retries".to_string());
        }
    }
}
