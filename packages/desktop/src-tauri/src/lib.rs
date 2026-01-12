mod cli;
mod window_customizer;

use cli::{install_cli, sync_cli};
use futures::FutureExt;
use std::{
    collections::VecDeque,
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_store::StoreExt;

use crate::window_customizer::PinchZoomDisablePlugin;

const SETTINGS_STORE: &str = "opencode.settings.dat";
const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: futures::future::Shared<tokio::sync::oneshot::Receiver<Result<String, String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: tokio::sync::oneshot::Receiver<Result<String, String>>,
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
async fn ensure_server_ready(state: State<'_, ServerState>) -> Result<String, String> {
    state
        .status
        .clone()
        .await
        .map_err(|_| "Failed to get server status".to_string())?
}

#[tauri::command]
fn get_default_server_url(app: AppHandle) -> Result<Option<String>, String> {
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

fn spawn_sidecar(app: &AppHandle, port: u32) -> CommandChild {
    let log_state = app.state::<LogState>();
    let log_state_clone = log_state.inner().clone();

    println!("spawning sidecar on port {port}");

    let (mut rx, child) = cli::create_command(app, format!("serve --port {port}").as_str())
        .spawn()
        .expect("Failed to spawn opencode");

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
            ensure_server_ready,
            get_default_server_url,
            set_default_server_url
        ])
        .setup(move |app| {
            let app = app.handle().clone();

            // Initialize log state
            app.manage(LogState(Arc::new(Mutex::new(VecDeque::new()))));

            let primary_monitor = app.primary_monitor().ok().flatten();
            let size = primary_monitor
                .map(|m| m.size().to_logical(m.scale_factor()))
                .unwrap_or(LogicalSize::new(1920, 1080));

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
                    "#
                    ));

            #[cfg(target_os = "macos")]
            {
                window_builder = window_builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            window_builder.build().expect("Failed to create window");

            let (tx, rx) = tokio::sync::oneshot::channel();
            app.manage(ServerState::new(None, rx));

            {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let mut custom_url = None;

                    if let Some(url) = get_default_server_url(app.clone()).ok().flatten() {
                        println!("Using desktop-specific custom URL: {url}");
                        custom_url = Some(url);
                    }

                    if custom_url.is_none()
                        && let Some(cli_config) = cli::get_config(&app).await
                        && let Some(url) = get_server_url_from_config(&cli_config)
                    {
                        println!("Using custom server URL from config: {url}");
                        custom_url = Some(url);
                    }

                    let res = match setup_server_connection(&app, custom_url).await {
                        Ok((child, url)) => {
                            app.state::<ServerState>().set_child(child);
                            Ok(url)
                        }
                        Err(e) => Err(e),
                    };

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

fn get_server_url_from_config(config: &cli::Config) -> Option<String> {
    let server = config.server.as_ref()?;
    let port = server.port?;
    println!("server.port found in OC config: {port}");
    let hostname = server.hostname.as_ref();

    Some(format!(
        "http://{}:{}",
        hostname.map(|v| v.as_str()).unwrap_or("127.0.0.1"),
        port
    ))
}

async fn setup_server_connection(
    app: &AppHandle,
    custom_url: Option<String>,
) -> Result<(Option<CommandChild>, String), String> {
    if let Some(url) = custom_url {
        loop {
            if check_server_health(&url).await {
                println!("Connected to custom server: {}", url);
                return Ok((None, url.clone()));
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
    }

    let local_port = get_sidecar_port();
    let local_url = format!("http://127.0.0.1:{local_port}");

    if !check_server_health(&local_url).await {
        match spawn_local_server(app, local_port).await {
            Ok(child) => Ok(Some(child)),
            Err(err) => Err(err),
        }
    } else {
        Ok(None)
    }
    .map(|child| (child, local_url))
}

async fn spawn_local_server(app: &AppHandle, port: u32) -> Result<CommandChild, String> {
    let child = spawn_sidecar(app, port);
    let url = format!("http://127.0.0.1:{port}");

    let timestamp = Instant::now();
    loop {
        if timestamp.elapsed() > Duration::from_secs(7) {
            break Err(format!(
                "Failed to spawn OpenCode Server. Logs:\n{}",
                get_logs(app.clone()).await.unwrap()
            ));
        }

        tokio::time::sleep(Duration::from_millis(10)).await;

        if check_server_health(&url).await {
            println!("Server ready after {:?}", timestamp.elapsed());
            break Ok(child);
        }
    }
}
