use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_store::StoreExt;
use tokio::task::JoinHandle;

use crate::{
    cli,
    constants::{DEFAULT_SERVER_URL_KEY, SETTINGS_STORE, WSL_ENABLED_KEY},
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug)]
pub struct WslConfig {
    pub enabled: bool,
}

impl Default for WslConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
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
pub fn get_wsl_config(app: AppHandle) -> Result<WslConfig, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let enabled = store
        .get(WSL_ENABLED_KEY)
        .as_ref()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    Ok(WslConfig { enabled })
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

pub async fn get_saved_server_url(app: &tauri::AppHandle) -> Option<String> {
    if let Some(url) = get_default_server_url(app.clone()).ok().flatten() {
        tracing::info!(%url, "Using desktop-specific custom URL");
        return Some(url);
    }

    if let Some(cli_config) = cli::get_config(app).await
        && let Some(url) = get_server_url_from_config(&cli_config)
    {
        tracing::info!(%url, "Using custom server URL from config");
        return Some(url);
    }

    None
}

pub fn spawn_local_server(
    app: AppHandle,
    hostname: String,
    port: u32,
    password: String,
) -> (CommandChild, HealthCheck) {
    let (child, exit) = cli::serve(&app, &hostname, port, &password);

    let health_check = HealthCheck(tokio::spawn(async move {
        let url = format!("http://{hostname}:{port}");
        let timestamp = Instant::now();

        let ready = async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;

                if check_health(&url, Some(&password)).await {
                    tracing::info!(elapsed = ?timestamp.elapsed(), "Server ready");
                    return Ok(());
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

pub async fn check_health(url: &str, password: Option<&str>) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(3));

    if url_is_localhost(&url) {
        // Some environments set proxy variables (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY) without
        // excluding loopback. reqwest respects these by default, which can prevent the desktop
        // app from reaching its own local sidecar server.
        builder = builder.no_proxy();
    };

    let Ok(client) = builder.build() else {
        return false;
    };
    let Ok(health_url) = url.join("/global/health") else {
        return false;
    };

    let mut req = client.get(health_url);

    if let Some(password) = password {
        req = req.basic_auth("opencode", Some(password));
    }

    req.send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn url_is_localhost(url: &reqwest::Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    })
}

/// Converts a bind address hostname to a valid URL hostname for connection.
/// - `0.0.0.0` and `::` are wildcard bind addresses, not valid connect targets
/// - IPv6 addresses need brackets in URLs (e.g., `::1` -> `[::1]`)
fn normalize_hostname_for_url(hostname: &str) -> String {
    // Wildcard bind addresses -> localhost equivalents
    if hostname == "0.0.0.0" {
        return "127.0.0.1".to_string();
    }
    if hostname == "::" {
        return "[::1]".to_string();
    }

    // IPv6 addresses need brackets in URLs
    if hostname.contains(':') && !hostname.starts_with('[') {
        return format!("[{}]", hostname);
    }

    hostname.to_string()
}

fn get_server_url_from_config(config: &cli::Config) -> Option<String> {
    let server = config.server.as_ref()?;
    let port = server.port?;
    tracing::debug!(port, "server.port found in OC config");
    let hostname = server
        .hostname
        .as_ref()
        .map(|v| normalize_hostname_for_url(v))
        .unwrap_or_else(|| "127.0.0.1".to_string());

    Some(format!("http://{}:{}", hostname, port))
}

pub async fn check_health_or_ask_retry(app: &AppHandle, url: &str) -> bool {
    tracing::debug!(%url, "Checking health");
    loop {
        if check_health(url, None).await {
            return true;
        }

        const RETRY: &str = "Retry";

        let res = app.dialog()
    		  .message(format!("Could not connect to configured server:\n{}\n\nWould you like to retry or start a local server instead?", url))
    		  .title("Connection Failed")
    		  .buttons(MessageDialogButtons::OkCancelCustom(RETRY.to_string(), "Start Local".to_string()))
    		  .blocking_show_with_result();

        match res {
            MessageDialogResult::Custom(name) if name == RETRY => {
                continue;
            }
            _ => {
                break;
            }
        }
    }

    false
}
