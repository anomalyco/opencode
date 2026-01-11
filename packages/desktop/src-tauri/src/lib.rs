mod cli;
mod window_customizer;

use cli::{get_sidecar_path, install_cli, sync_cli};
use futures::FutureExt;
use std::{
    collections::VecDeque,
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    path::BaseDirectory, AppHandle, LogicalSize, Manager, RunEvent, State, WebviewUrl,
    WebviewWindow,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use tokio::net::TcpSocket;

use crate::window_customizer::PinchZoomDisablePlugin;

const SETTINGS_STORE: &str = "opencode.settings.dat";
const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: futures::future::Shared<tokio::sync::oneshot::Receiver<Result<(), String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: tokio::sync::oneshot::Receiver<Result<(), String>>,
    ) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
            status: status.shared(),
        }
    }

    pub fn set_child(&self, child: Option<CommandChild>) {
        *self.child.lock().unwrap() = child;
    }
}

#[derive(Clone)]
struct LogState(Arc<Mutex<VecDeque<String>>>);

const MAX_LOG_ENTRIES: usize = 200;

#[tauri::command]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        println!("Server not running");
        return;
    };

    let Some(server_state) = server_state
        .child
        .lock()
        .expect("Failed to acquire mutex lock")
        .take()
    else {
        println!("Server state missing");
        return;
    };

    let _ = server_state.kill();

    println!("Killed server");
}

async fn get_logs(app: AppHandle) -> Result<String, String> {
    let log_state = app.try_state::<LogState>().ok_or("Log state not found")?;

    let logs = log_state
        .0
        .lock()
        .map_err(|_| "Failed to acquire log lock")?;

    Ok(logs.iter().cloned().collect::<Vec<_>>().join(""))
}

#[tauri::command]
async fn ensure_server_started(state: State<'_, ServerState>) -> Result<(), String> {
    state
        .status
        .clone()
        .await
        .map_err(|_| "Failed to get server status".to_string())?
}

#[tauri::command]
async fn get_default_server_url(app: AppHandle) -> Result<Option<String>, String> {
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
async fn set_default_server_url(app: AppHandle, url: Option<String>) -> Result<(), String> {
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

fn get_sidecar_port() -> u32 {
    option_env!("OPENCODE_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCODE_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free port")
                .local_addr()
                .expect("Failed to get local address")
                .port()
        }) as u32
}

fn get_user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

fn spawn_sidecar(app: &AppHandle, port: u32) -> CommandChild {
    let log_state = app.state::<LogState>();
    let log_state_clone = log_state.inner().clone();

    let state_dir = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .expect("Failed to resolve app local data dir");

    #[cfg(target_os = "windows")]
    let (mut rx, child) = app
        .shell()
        .sidecar("opencode-cli")
        .unwrap()
        .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
        .env("OPENCODE_CLIENT", "desktop")
        .env("XDG_STATE_HOME", &state_dir)
        .args(["serve", &format!("--port={port}")])
        .spawn()
        .expect("Failed to spawn opencode");

    #[cfg(not(target_os = "windows"))]
    let (mut rx, child) = {
        let sidecar = get_sidecar_path(app);
        let shell = get_user_shell();
        app.shell()
            .command(&shell)
            .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
            .env("OPENCODE_CLIENT", "desktop")
            .env("XDG_STATE_HOME", &state_dir)
            .args([
                "-il",
                "-c",
                &format!("\"{}\" serve --port={}", sidecar.display(), port),
            ])
            .spawn()
            .expect("Failed to spawn opencode")
    };

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    print!("{line}");

                    // Store log in shared state
                    if let Ok(mut logs) = log_state_clone.0.lock() {
                        logs.push_back(format!("[STDOUT] {}", line));
                        // Keep only the last MAX_LOG_ENTRIES
                        while logs.len() > MAX_LOG_ENTRIES {
                            logs.pop_front();
                        }
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprint!("{line}");

                    // Store log in shared state
                    if let Ok(mut logs) = log_state_clone.0.lock() {
                        logs.push_back(format!("[STDERR] {}", line));
                        // Keep only the last MAX_LOG_ENTRIES
                        while logs.len() > MAX_LOG_ENTRIES {
                            logs.pop_front();
                        }
                    }
                }
                _ => {}
            }
        }
    });

    child
}

async fn is_server_running(port: u32) -> bool {
    TcpSocket::new_v4()
        .unwrap()
        .connect(SocketAddr::new(
            "127.0.0.1".parse().expect("Failed to parse IP"),
            port as u16,
        ))
        .await
        .is_ok()
}

async fn check_server_health(url: &str) -> bool {
    let health_url = format!("{}/health", url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build();

    let Ok(client) = client else {
        return false;
    };

    client
        .get(&health_url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn get_configured_server_url(app: &AppHandle) -> Option<String> {
    let store = app.store(SETTINGS_STORE).ok()?;
    let value = store.get(DEFAULT_SERVER_URL_KEY)?;
    value.as_str().map(String::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let updater_enabled = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(PinchZoomDisablePlugin)
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            install_cli,
            ensure_server_started,
            get_default_server_url,
            set_default_server_url
        ])
        .setup(move |app| {
            let app = app.handle().clone();

            // Initialize log state
            app.manage(LogState(Arc::new(Mutex::new(VecDeque::new()))));

            // Get port and create window immediately for faster perceived startup
            let port = get_sidecar_port();

            let primary_monitor = app.primary_monitor().ok().flatten();
            let size = primary_monitor
                .map(|m| m.size().to_logical(m.scale_factor()))
                .unwrap_or(LogicalSize::new(1920, 1080));

            // Create window immediately with serverReady = false
            #[allow(unused_mut)]
            let mut window_builder =
                WebviewWindow::builder(&app, "main", WebviewUrl::App("/".into()))
                    .title("OpenCode")
                    .inner_size(size.width as f64, size.height as f64)
                    .decorations(true)
                    .zoom_hotkeys_enabled(true)
                    .disable_drag_drop_handler()
                    .initialization_script(format!(
                        r#"
                      window.__OPENCODE__ ??= {{}};
                      window.__OPENCODE__.updaterEnabled = {updater_enabled};
                      window.__OPENCODE__.port = {port};
                    "#
                    ));

            #[cfg(target_os = "macos")]
            {
                window_builder = window_builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            let window = window_builder.build().expect("Failed to create window");

            let (tx, rx) = tokio::sync::oneshot::channel();
            app.manage(ServerState::new(None, rx));

            {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    // Check for configured default server URL
                    let configured_url = get_configured_server_url(&app);

                    let (child, res, server_url) = if let Some(ref url) = configured_url {
                        println!("Configured default server URL: {}", url);

                        // Try to connect to the configured server
                        let mut healthy = false;
                        let mut should_fallback = false;

                        loop {
                            if check_server_health(url).await {
                                healthy = true;
                                println!("Connected to configured server: {}", url);
                                break;
                            }

                            let res = app.dialog()
                                .message(format!("Could not connect to configured server:\n{}\n\nWould you like to retry or start a local server instead?", url))
                                .title("Connection Failed")
                                .buttons(MessageDialogButtons::OkCancelCustom("Retry".to_string(), "Start Local".to_string()))
                                .blocking_show_with_result();

                            match res {
                                MessageDialogResult::Custom(name) if name == "Retry" => {
                                    continue;
                                },
                                _ => {
                                    should_fallback = true;
                                    break;
                                }
                            }
                        }

                        if healthy {
                            (None, Ok(()), Some(url.clone()))
                        } else if should_fallback {
                            // Fall back to spawning local sidecar
                            let child = spawn_sidecar(&app, port);

                            let timestamp = Instant::now();
                            let res = loop {
                                if timestamp.elapsed() > Duration::from_secs(7) {
                                    break Err(format!(
                                        "Failed to spawn OpenCode Server. Logs:\n{}",
                                        get_logs(app.clone()).await.unwrap()
                                    ));
                                }

                                tokio::time::sleep(Duration::from_millis(10)).await;

                                if is_server_running(port).await {
                                    tokio::time::sleep(Duration::from_millis(10)).await;
                                    break Ok(());
                                }
                            };

                            println!("Server ready after {:?}", timestamp.elapsed());
                            (Some(child), res, None)
                        } else {
                            (None, Err("User cancelled".to_string()), None)
                        }
                    } else {
                        // No configured URL, spawn local sidecar as before
                        let should_spawn_sidecar = !is_server_running(port).await;

                        let (child, res) = if should_spawn_sidecar {
                            let child = spawn_sidecar(&app, port);

                            let timestamp = Instant::now();
                            let res = loop {
                                if timestamp.elapsed() > Duration::from_secs(7) {
                                    break Err(format!(
                                        "Failed to spawn OpenCode Server. Logs:\n{}",
                                        get_logs(app.clone()).await.unwrap()
                                    ));
                                }

                                tokio::time::sleep(Duration::from_millis(10)).await;

                                if is_server_running(port).await {
                                    tokio::time::sleep(Duration::from_millis(10)).await;
                                    break Ok(());
                                }
                            };

                            println!("Server ready after {:?}", timestamp.elapsed());

                            (Some(child), res)
                        } else {
                            (None, Ok(()))
                        };

                        (child, res, None)
                    };

                    app.state::<ServerState>().set_child(child);

                    if res.is_ok() {
                        let _ = window.eval("window.__OPENCODE__.serverReady = true;");

                        // If using a configured server URL, inject it
                        if let Some(url) = server_url {
                            let escaped_url = url.replace('\\', "\\\\").replace('"', "\\\"");
                            let _ = window.eval(format!(
                                "window.__OPENCODE__.serverUrl = \"{escaped_url}\";",
                            ));
                        }
                    }

                    let _ = tx.send(res);
                });
            }

            {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = sync_cli(app) {
                        eprintln!("Failed to sync CLI: {e}");
                    }
                });
            }

            Ok(())
        });

    if updater_enabled {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                println!("Received Exit");

                kill_sidecar(app.clone());
            }
        });
}
