mod cli;
#[cfg(windows)]
mod job_object;
mod markdown;
mod window_customizer;

use cli::{install_cli, sync_cli};
use futures::FutureExt;
use futures::future;
#[cfg(windows)]
use job_object::*;
use std::{
    collections::VecDeque,
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, LogicalSize, Manager, RunEvent, State, WebviewWindowBuilder};
#[cfg(windows)]
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

use crate::window_customizer::PinchZoomDisablePlugin;

const SETTINGS_STORE: &str = "opencode.settings.dat";
const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
struct ServerReadyData {
    url: String,
    password: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSystemEntry {
    name: String,
    path: String,
    is_directory: bool,
}

fn is_text_file(path: &std::path::Path) -> bool {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let text_extensions = [
        "txt", "md", "js", "ts", "jsx", "tsx", "json", "html", "css", "scss", "py", "rs", "go", "java",
        "c", "cpp", "h", "hpp", "cs", "php", "rb", "swift", "kt", "scala", "sh", "bash", "zsh",
        "fish", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "sql", "graphql", "gql",
        "vue", "svelte", "astro", "liquid", "mustache", "hbs", "handlebars", "twig", "erb",
    ];
    text_extensions.contains(&extension) || extension.is_empty()
}

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: future::Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: oneshot::Receiver<Result<ServerReadyData, String>>,
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
async fn ensure_server_ready(state: State<'_, ServerState>) -> Result<ServerReadyData, String> {
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

#[tauri::command]
fn get_project_root(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?
        .to_str()
        .ok_or_else(|| "Invalid path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileSystemEntry>, String> {
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() || !path_obj.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let mut entries = Vec::new();
    let entries_iter = std::fs::read_dir(&path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries_iter {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let name = entry.file_name()
            .to_str()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string();
        let is_directory = entry_path.is_dir();

        entries.push(FileSystemEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
        });
    }

    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !path_obj.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    if !is_text_file(path_obj) {
        return Err("Binary files are not supported".to_string());
    }

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    if metadata.len() > MAX_FILE_SIZE as u64 {
        return Err("File is too large".to_string());
    }

    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    let path_obj = std::path::Path::new(&path);

    if !path_obj.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !path_obj.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    if !is_text_file(path_obj) {
        return Err("Binary files are not supported".to_string());
    }

    std::fs::write(&path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = std::path::Path::new(&old_path);
    let new = std::path::Path::new(&new_path);

    if !old.exists() {
        return Err(format!("Path does not exist: {}", old_path));
    }

    if new.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }

    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename: {}", e))
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let path_obj = std::path::Path::new(&path);

    if !path_obj.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if path_obj.is_dir() {
        std::fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
fn copy_path(source: String, destination: String) -> Result<(), String> {
    let src = std::path::Path::new(&source);
    let dest = std::path::Path::new(&destination);

    if !src.exists() {
        return Err(format!("Source does not exist: {}", source));
    }

    if dest.exists() {
        return Err(format!("Destination already exists: {}", destination));
    }

    if src.is_dir() {
        copy_dir_recursive(src, dest)
    } else {
        std::fs::copy(&source, &destination)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy file: {}", e))
    }
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory: {}", e))? 
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path)?;
        } else {
            std::fs::copy(&entry_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    let path_obj = std::path::Path::new(&path);

    if path_obj.exists() {
        return Err(format!("File already exists: {}", path));
    }

    // Create parent directories if they don't exist
    if let Some(parent) = path_obj.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    std::fs::File::create(&path)
        .map(|_| ())
        .map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let path_obj = std::path::Path::new(&path);

    if path_obj.exists() {
        return Err(format!("Directory already exists: {}", path));
    }

    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory: {}", e))
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

fn spawn_sidecar(app: &AppHandle, hostname: &str, port: u32, password: &str) -> CommandChild {
    let log_state = app.state::<LogState>();
    let log_state_clone = log_state.inner().clone();

    println!("spawning sidecar on port {port}");

    let (mut rx, child) = cli::create_command(
        app,
        format!("serve --hostname {hostname} --port {port}").as_str(),
    )
    .env("OPENCODE_SERVER_USERNAME", "opencode")
    .env("OPENCODE_SERVER_PASSWORD", password)
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

fn url_is_localhost(url: &reqwest::Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    })
}

async fn check_server_health(url: &str, password: Option<&str>) -> bool {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let updater_enabled = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    let _ = std::process::Command::new("killall")
        .arg("opencode-cli")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(PinchZoomDisablePlugin)
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            install_cli,
            ensure_server_ready,
            get_default_server_url,
            set_default_server_url,
            markdown::parse_markdown_command,
            get_project_root,
            read_directory,
            read_file,
            write_file,
            rename_path,
            delete_path,
            copy_path,
            create_file,
            create_directory
        ])
        .setup(move |app| {
            let app = app.handle().clone();

            // Initialize log state
            app.manage(LogState(Arc::new(Mutex::new(VecDeque::new()))));

            #[cfg(windows)]
            app.manage(JobObjectState::new());

            let primary_monitor = app.primary_monitor().ok().flatten();
            let size = primary_monitor
                .map(|m| m.size().to_logical(m.scale_factor()))
                .unwrap_or(LogicalSize::new(1920, 1080));

            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("main window config missing");

            let window_builder = WebviewWindowBuilder::from_config(&app, config)
                .expect("Failed to create window builder from config")
                .inner_size(size.width as f64, size.height as f64)
                .initialization_script(format!(
                    r#"
                      window.__OPENCODE__ ??= {{}};
                      window.__OPENCODE__.updaterEnabled = {updater_enabled};
                    "#
                ));

            #[cfg(target_os = "macos")]
            let window_builder = window_builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);

            #[cfg(windows)]
            let window_builder = window_builder.decorations(false);

            let window = window_builder.build().expect("Failed to create window");

            #[cfg(windows)]
            let _ = window.create_overlay_titlebar();

            let (tx, rx) = oneshot::channel();
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
                            #[cfg(windows)]
                            if let Some(child) = &child {
                                let job_state = app.state::<JobObjectState>();
                                job_state.assign_pid(child.pid());
                            }

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
    println!("server.port found in OC config: {port}");
    let hostname = server
        .hostname
        .as_ref()
        .map(|v| normalize_hostname_for_url(v))
        .unwrap_or_else(|| "127.0.0.1".to_string());

    Some(format!("http://{}:{}", hostname, port))
}

async fn setup_server_connection(
    app: &AppHandle,
    custom_url: Option<String>,
) -> Result<(Option<CommandChild>, ServerReadyData), String> {
    if let Some(url) = custom_url {
        loop {
            if check_server_health(&url, None).await {
                println!("Connected to custom server: {}", url);
                return Ok((
                    None,
                    ServerReadyData {
                        url: url.clone(),
                        password: None,
                    },
                ));
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
    let hostname = "127.0.0.1";
    let local_url = format!("http://{hostname}:{local_port}");

    if !check_server_health(&local_url, None).await {
        let password = uuid::Uuid::new_v4().to_string();

        match spawn_local_server(app, hostname, local_port, &password).await {
            Ok(child) => Ok((
                Some(child),
                ServerReadyData {
                    url: local_url,
                    password: Some(password),
                },
            )),
            Err(err) => Err(err),
        }
    } else {
        Ok((
            None,
            ServerReadyData {
                url: local_url,
                password: None,
            },
        ))
    }
}

async fn spawn_local_server(
    app: &AppHandle,
    hostname: &str,
    port: u32,
    password: &str,
) -> Result<CommandChild, String> {
    let child = spawn_sidecar(app, hostname, port, password);
    let url = format!("http://{hostname}:{port}");

    let timestamp = Instant::now();
    loop {
        if timestamp.elapsed() > Duration::from_secs(30) {
            break Err(format!(
                "Failed to spawn OpenCode Server. Logs:\n{}",
                get_logs(app.clone()).await.unwrap()
            ));
        }

        tokio::time::sleep(Duration::from_millis(10)).await;

        if check_server_health(&url, Some(password)).await {
            println!("Server ready after {:?}", timestamp.elapsed());
            break Ok(child);
        }
    }
}