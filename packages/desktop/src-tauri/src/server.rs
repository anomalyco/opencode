use futures::FutureExt;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::{
    cli,
    cli::CommandChild,
    constants::{
        DEFAULT_SERVER_URL_KEY, GENERICAGENT_DIR_KEY, GENERICAGENT_ENABLED_KEY,
        GENERICAGENT_PYTHON_KEY, HERMES_DIR_KEY, HERMES_ENABLED_KEY, HERMES_HOME_KEY,
        HERMES_PYTHON_KEY, OPENCLAW_ENABLED_KEY, OPENCLAW_TOKEN_KEY, OPENCLAW_URL_KEY,
        SETTINGS_STORE, WSL_ENABLED_KEY,
    },
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default)]
pub struct WslConfig {
    pub enabled: bool,
}

#[derive(
    Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default, PartialEq, Eq,
)]
pub struct OpenclawConfig {
    pub enabled: bool,
    pub url: Option<String>,
    pub token: Option<String>,
}

#[derive(
    Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default, PartialEq, Eq,
)]
#[serde(rename_all = "camelCase")]
pub struct GenericagentConfig {
    pub enabled: bool,
    pub python_executable: Option<String>,
    pub generic_agent_dir: Option<String>,
}

#[derive(
    Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default, PartialEq, Eq,
)]
#[serde(rename_all = "camelCase")]
pub struct HermesConfig {
    pub enabled: bool,
    pub python_executable: Option<String>,
    pub hermes_dir: Option<String>,
    pub hermes_home: Option<String>,
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
    let store = _app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    Ok(WslConfig {
        enabled: store
            .get(WSL_ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
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

#[tauri::command]
#[specta::specta]
pub fn get_openclaw_config(app: AppHandle) -> Result<OpenclawConfig, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    Ok(OpenclawConfig {
        enabled: store
            .get(OPENCLAW_ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        url: store
            .get(OPENCLAW_URL_KEY)
            .and_then(|v| v.as_str().map(String::from)),
        token: store
            .get(OPENCLAW_TOKEN_KEY)
            .and_then(|v| v.as_str().map(String::from)),
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_openclaw_config(app: AppHandle, config: OpenclawConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(
        OPENCLAW_ENABLED_KEY,
        serde_json::Value::Bool(config.enabled),
    );

    match config.url {
        Some(u) => {
            store.set(OPENCLAW_URL_KEY, serde_json::Value::String(u));
        }
        None => {
            store.delete(OPENCLAW_URL_KEY);
        }
    }

    match config.token {
        Some(t) => {
            store.set(OPENCLAW_TOKEN_KEY, serde_json::Value::String(t));
        }
        None => {
            store.delete(OPENCLAW_TOKEN_KEY);
        }
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_genericagent_config(app: AppHandle) -> Result<GenericagentConfig, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    Ok(GenericagentConfig {
        enabled: store
            .get(GENERICAGENT_ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        python_executable: store
            .get(GENERICAGENT_PYTHON_KEY)
            .and_then(|v| v.as_str().map(String::from)),
        generic_agent_dir: store
            .get(GENERICAGENT_DIR_KEY)
            .and_then(|v| v.as_str().map(String::from)),
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_genericagent_config(
    app: AppHandle,
    config: GenericagentConfig,
) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(
        GENERICAGENT_ENABLED_KEY,
        serde_json::Value::Bool(config.enabled),
    );

    match config.python_executable {
        Some(v) => {
            store.set(GENERICAGENT_PYTHON_KEY, serde_json::Value::String(v));
        }
        None => {
            store.delete(GENERICAGENT_PYTHON_KEY);
        }
    }

    match config.generic_agent_dir {
        Some(v) => {
            store.set(GENERICAGENT_DIR_KEY, serde_json::Value::String(v));
        }
        None => {
            store.delete(GENERICAGENT_DIR_KEY);
        }
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_hermes_config(app: AppHandle) -> Result<HermesConfig, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    Ok(HermesConfig {
        enabled: store
            .get(HERMES_ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        python_executable: store
            .get(HERMES_PYTHON_KEY)
            .and_then(|v| v.as_str().map(String::from)),
        hermes_dir: store
            .get(HERMES_DIR_KEY)
            .and_then(|v| v.as_str().map(String::from)),
        hermes_home: store
            .get(HERMES_HOME_KEY)
            .and_then(|v| v.as_str().map(String::from)),
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_hermes_config(app: AppHandle, config: HermesConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(HERMES_ENABLED_KEY, serde_json::Value::Bool(config.enabled));

    match config.python_executable {
        Some(v) => {
            store.set(HERMES_PYTHON_KEY, serde_json::Value::String(v));
        }
        None => {
            store.delete(HERMES_PYTHON_KEY);
        }
    }

    match config.hermes_dir {
        Some(v) => {
            store.set(HERMES_DIR_KEY, serde_json::Value::String(v));
        }
        None => {
            store.delete(HERMES_DIR_KEY);
        }
    }

    match config.hermes_home {
        Some(v) => {
            store.set(HERMES_HOME_KEY, serde_json::Value::String(v));
        }
        None => {
            store.delete(HERMES_HOME_KEY);
        }
    }

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
) -> Result<(CommandChild, HealthCheck), String> {
    let (child, exit) = cli::serve(&app, &hostname, port, &password)?;
    // Startup gating and the later final health wait both need the same readiness result.
    // Keep this shared so either caller can observe the outcome without racing or hanging
    // on a second await of a consumed task.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    tokio::spawn(async move {
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

        let result = tokio::select! {
            res = ready => res,
            res = terminated => res,
        };

        let _ = tx.send(result);
    });

    Ok((child, HealthCheck(rx.shared())))
}

#[derive(Clone)]
pub struct HealthCheck(
    pub futures::future::Shared<tokio::sync::oneshot::Receiver<Result<(), String>>>,
);

pub(crate) async fn check_health(url: &str, password: Option<&str>) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(7));

    if url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    }) {
        // Some environments set proxy variables (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY) without
        // excluding loopback. reqwest respects these by default, which can prevent the desktop
        // app from reaching its own local sidecar server.
        builder = builder.no_proxy();
    }

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
