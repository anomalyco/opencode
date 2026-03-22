mod cli;
mod constants;
#[cfg(target_os = "linux")]
pub mod linux_display;
#[cfg(target_os = "linux")]
pub mod linux_windowing;
mod logging;
mod markdown;
mod os;
mod server;
mod window_customizer;
mod windows;

use crate::cli::CommandChild;
use futures::{FutureExt, TryFutureExt};
use serde_json::json;
use std::{
    collections::VecDeque,
    env,
    fs,
    future::Future,
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, Listener, Manager, RunEvent, State, ipc::Channel, path::BaseDirectory,
};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_specta::Event;
use tokio::{
    sync::{oneshot, watch},
    time::{sleep, timeout},
};

use crate::cli::{sqlite_migration::SqliteMigrationProgress, sync_cli};
use crate::constants::*;
use crate::windows::{LoadingWindow, MainWindow};

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    id: String,
    label: String,
    path: String,
    exists: bool,
    scope: String,
    kind: String,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Clone, Copy, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum WslPathMode {
    Windows,
    Linux,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    hostname: String,
    port: u32,
    password: Arc<Mutex<String>>,
}

/// Resolves with sidecar credentials as soon as the sidecar is spawned (before health check).
struct SidecarReady(futures::future::Shared<oneshot::Receiver<ServerReadyData>>);

#[derive(Clone)]
struct LogState(Arc<Mutex<VecDeque<String>>>);

#[derive(Clone, Default)]
struct InitialPathState(Arc<Mutex<Option<String>>>);

const BRIDGE_FILE: &str = "openclaw-bridge.json";

fn config_root() -> Option<PathBuf> {
    if let Ok(dir) = env::var("XDG_CONFIG_HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("opencode"));
        }
    }

    env::var("HOME")
        .ok()
        .map(|dir| PathBuf::from(dir).join(".config").join("opencode"))
}

fn push_config_file(list: &mut Vec<ConfigFile>, id: &str, label: &str, path: PathBuf, scope: &str, kind: &str) {
    let exists = path.is_file();
    list.push(ConfigFile {
        id: id.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        exists,
        scope: scope.to_string(),
        kind: kind.to_string(),
    });
}

#[tauri::command]
#[specta::specta]
fn list_config_files(directory: Option<String>) -> Vec<ConfigFile> {
    let mut list = Vec::new();

    if let Some(root) = config_root() {
        push_config_file(
            &mut list,
            "global-opencode-jsonc",
            "Global opencode.jsonc",
            root.join("opencode.jsonc"),
            "global",
            "config",
        );
        push_config_file(
            &mut list,
            "global-opencode-json",
            "Global opencode.json",
            root.join("opencode.json"),
            "global",
            "config",
        );
        push_config_file(
            &mut list,
            "global-tui-jsonc",
            "Global tui.jsonc",
            root.join("tui.jsonc"),
            "global",
            "tui",
        );
        push_config_file(
            &mut list,
            "global-tui-json",
            "Global tui.json",
            root.join("tui.json"),
            "global",
            "tui",
        );
    }

    if let Some(dir) = directory {
        let root = PathBuf::from(dir);
        push_config_file(
            &mut list,
            "project-opencode-jsonc",
            "Project opencode.jsonc",
            root.join("opencode.jsonc"),
            "project",
            "config",
        );
        push_config_file(
            &mut list,
            "project-opencode-json",
            "Project opencode.json",
            root.join("opencode.json"),
            "project",
            "config",
        );
        push_config_file(
            &mut list,
            "project-tui-jsonc",
            "Project tui.jsonc",
            root.join("tui.jsonc"),
            "project",
            "tui",
        );
        push_config_file(
            &mut list,
            "project-tui-json",
            "Project tui.json",
            root.join("tui.json"),
            "project",
            "tui",
        );
        push_config_file(
            &mut list,
            "project-dir-opencode-jsonc",
            ".opencode/opencode.jsonc",
            root.join(".opencode").join("opencode.jsonc"),
            "project",
            "config_dir",
        );
        push_config_file(
            &mut list,
            "project-dir-opencode-json",
            ".opencode/opencode.json",
            root.join(".opencode").join("opencode.json"),
            "project",
            "config_dir",
        );
    }

    list
}

#[tauri::command]
#[specta::specta]
fn read_config_file(path: String) -> Result<Option<String>, String> {
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Failed to read file: {err}")),
    }
}

#[tauri::command]
#[specta::specta]
fn write_config_file(path: String, content: String) -> Result<(), String> {
    let Some(parent) = PathBuf::from(&path).parent().map(PathBuf::from) else {
        return Err("Failed to resolve parent directory".to_string());
    };

    fs::create_dir_all(&parent).map_err(|err| format!("Failed to create parent directory: {err}"))?;
    fs::write(path, content).map_err(|err| format!("Failed to write file: {err}"))
}

fn resolve_path_from_args(args: &[String], cwd: &str) -> Option<String> {
    let path_arg = args.get(1)?;
    if path_arg.starts_with('-') {
        return None;
    }
    
    let path = PathBuf::from(path_arg);
    let absolute = if path.is_absolute() {
        path
    } else {
        PathBuf::from(cwd).join(path)
    };
    
    if absolute.is_dir() {
        absolute.canonicalize().ok()?.to_str().map(String::from)
    } else {
        None
    }
}

fn bridge_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BRIDGE_FILE, BaseDirectory::AppLocalData)
        .map_err(|e| format!("Failed to resolve bridge path: {e}"))
}

fn publish_bridge(app: &AppHandle, server: &ServerReadyData) -> Result<(), String> {
    let file = bridge_path(app)?;
    let dir = file
        .parent()
        .ok_or_else(|| "Failed to resolve bridge parent directory".to_string())?;

    fs::create_dir_all(dir).map_err(|e| format!("Failed to create bridge directory: {e}"))?;

    let body = serde_json::to_vec_pretty(&json!({
        "version": 1,
        "app": {
            "name": app.package_info().name,
            "version": app.package_info().version.to_string(),
            "pid": std::process::id(),
        },
        "server": {
            "url": server.url,
            "username": server.username,
            "password": server.password,
        },
        "time": chrono::Utc::now().timestamp_millis(),
    }))
    .map_err(|e| format!("Failed to serialize bridge file: {e}"))?;

    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("Failed to write bridge file: {e}"))?;
    fs::rename(&tmp, &file).map_err(|e| format!("Failed to publish bridge file: {e}"))?;
    tracing::info!(path = %file.display(), "Published bridge file");
    Ok(())
}

fn clear_bridge(app: &AppHandle) {
    let Ok(file) = bridge_path(app) else {
        return;
    };

    match fs::remove_file(&file) {
        Ok(()) => tracing::info!(path = %file.display(), "Cleared bridge file"),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => tracing::warn!(path = %file.display(), "Failed to clear bridge file: {err}"),
    }
}


#[tauri::command]
#[specta::specta]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    let Some(server_state) = server_state
        .child
        .lock()
        .expect("Failed to acquire mutex lock")
        .take()
    else {
        tracing::info!("Server state missing");
        return;
    };

    let _ = server_state.kill();
    clear_bridge(&app);

    tracing::info!("Killed server");
}

#[tauri::command]
#[specta::specta]
async fn reload_sidecar(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    let Some(server_state) = handle.try_state::<ServerState>() else {
        return Err("Server not running".to_string());
    };

    let hostname = server_state.hostname.clone();
    let port = server_state.port;
    let password = server_state
        .password
        .lock()
        .map_err(|_| "Failed to acquire server password".to_string())?
        .clone();

    if let Some(child) = server_state
        .child
        .lock()
        .map_err(|_| "Failed to acquire server state".to_string())?
        .take()
    {
        let _ = child.kill();
    }

    let data = ServerReadyData {
        url: format!("http://{hostname}:{port}"),
        username: Some("opencode".to_string()),
        password: Some(password.clone()),
    };

    let (child, health_check) = server::spawn_local_server(app.clone(), hostname, port, password);
    publish_bridge(&app, &data)?;

    {
        let mut state = server_state
            .child
            .lock()
            .map_err(|_| "Failed to acquire server state".to_string())?;
        *state = Some(child);
    }

    match timeout(Duration::from_secs(30), health_check.0).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(err))) => Err(err),
        Ok(Err(err)) => Err(err.to_string()),
        Err(_) => Err("Timed out waiting for backend to restart".to_string()),
    }
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, SidecarReady>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    let stream = async {
        let e = *rx.borrow();
        let _ = events.send(e);

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();
            let _ = events.send(step);

            if matches!(step, InitStep::Done) {
                break;
            }
        }
    };

    // Wait for sidecar credentials (available immediately after spawn, before health check)
    let data = async {
        state
            .inner()
            .0
            .clone()
            .await
            .map_err(|_| "Failed to get sidecar data".to_string())
    };

    let (result, _) = futures::future::join(data, stream).await;
    result
}

#[tauri::command]
#[specta::specta]
fn filter_directories(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| PathBuf::from(p).is_dir())
        .collect()
}

#[tauri::command]
#[specta::specta]
fn check_app_exists(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        os::windows::check_windows_app(app_name)
    }

    #[cfg(target_os = "macos")]
    {
        check_macos_app(app_name)
    }

    #[cfg(target_os = "linux")]
    {
        check_linux_app(app_name)
    }
}

#[tauri::command]
#[specta::specta]
fn resolve_app_path(app_name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        os::windows::resolve_windows_app_path(app_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, just return the app_name as-is since
        // the opener plugin handles them correctly
        Some(app_name.to_string())
    }
}

#[tauri::command]
#[specta::specta]
fn open_path(_app: AppHandle, path: String, app_name: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let app_name = app_name.map(|v| os::windows::resolve_windows_app_path(&v).unwrap_or(v));
        let is_powershell = app_name.as_ref().is_some_and(|v| {
            std::path::Path::new(v)
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case("powershell")
                        || name.eq_ignore_ascii_case("powershell.exe")
                })
        });

        if is_powershell {
            return os::windows::open_in_powershell(path);
        }

        return tauri_plugin_opener::open_path(path, app_name.as_deref())
            .map_err(|e| format!("Failed to open path: {e}"));
    }

    #[cfg(not(target_os = "windows"))]
    tauri_plugin_opener::open_path(path, app_name.as_deref())
        .map_err(|e| format!("Failed to open path: {e}"))
}

#[cfg(target_os = "macos")]
fn check_macos_app(app_name: &str) -> bool {
    // Check common installation locations
    let mut app_locations = vec![
        format!("/Applications/{}.app", app_name),
        format!("/System/Applications/{}.app", app_name),
    ];

    if let Ok(home) = std::env::var("HOME") {
        app_locations.push(format!("{}/Applications/{}.app", home, app_name));
    }

    for location in app_locations {
        if std::path::Path::new(&location).exists() {
            return true;
        }
    }

    // Also check if command exists in PATH
    Command::new("which")
        .arg(app_name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LinuxDisplayBackend {
    Wayland,
    Auto,
}

#[tauri::command]
#[specta::specta]
fn get_display_backend() -> Option<LinuxDisplayBackend> {
    #[cfg(target_os = "linux")]
    {
        let prefer = linux_display::read_wayland().unwrap_or(false);
        return Some(if prefer {
            LinuxDisplayBackend::Wayland
        } else {
            LinuxDisplayBackend::Auto
        });
    }

    #[cfg(not(target_os = "linux"))]
    None
}

#[tauri::command]
#[specta::specta]
fn set_display_backend(_app: AppHandle, _backend: LinuxDisplayBackend) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let prefer = matches!(_backend, LinuxDisplayBackend::Wayland);
        return linux_display::write_wayland(&_app, prefer);
    }

    #[cfg(not(target_os = "linux"))]
    Ok(())
}

#[cfg(target_os = "linux")]
fn check_linux_app(app_name: &str) -> bool {
    return true;
}

#[cfg(target_os = "macos")]
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace("'", "'\\''"))
}

#[tauri::command]
#[specta::specta]
fn open_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Finder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in file manager: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("open")
            .arg("-a")
            .arg("Visual Studio Code")
            .arg(&path)
            .spawn();

        if result.is_ok() {
            return Ok(());
        }

        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in VSCode: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open in VSCode: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn open_in_editor(editor: String, path: String, custom_path: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(custom) = custom_path {
            return std::process::Command::new(&custom)
                .arg(&path)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open with custom editor '{}': {}", custom, e));
        }

        if editor == "WezTerm" {
            let script = format!(
                r#"
                tell application "System Events"
                    set weztermRunning to (name of processes) contains "wezterm-gui"
                end tell

                if not weztermRunning then
                    tell application "WezTerm" to launch
                    delay 2
                end if

                tell application "WezTerm" to activate

                do shell script "/Applications/WezTerm.app/Contents/MacOS/wezterm cli spawn --cwd {}"
                "#,
                shell_escape(&path)
            );
            return std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open in WezTerm: {}", e));
        }

        let app_name = match editor.as_str() {
            "vscode" => "Visual Studio Code",
            "cursor" => "Cursor",
            "sublime" => "Sublime Text",
            "zed" => "Zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        let result = std::process::Command::new("open")
            .arg("-a")
            .arg(app_name)
            .arg(&path)
            .spawn();

        if result.is_ok() {
            return Ok(());
        }

        let cli_command = match editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "sublime" => "subl",
            "zed" => "zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        std::process::Command::new(cli_command)
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open in {}: {}", editor, e))
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(custom) = custom_path {
            return std::process::Command::new(&custom)
                .arg(&path)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Failed to open with custom editor '{}': {}", custom, e));
        }

        let cli_command = match editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "sublime" => "subl",
            "zed" => "zed",
            _ => return Err(format!("Unknown editor: {}", editor)),
        };

        std::process::Command::new(cli_command)
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open in {}: {}", editor, e))
    }
}

#[tauri::command]
#[specta::specta]
fn get_custom_editor_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match store.get(CUSTOM_EDITOR_PATH_KEY) {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
async fn set_custom_editor_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match path {
        Some(p) => { store.set(CUSTOM_EDITOR_PATH_KEY, serde_json::Value::String(p)); }
        None => { store.delete(CUSTOM_EDITOR_PATH_KEY); }
    }
    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn get_default_editor(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match store.get(DEFAULT_EDITOR_KEY) {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
async fn set_default_editor(app: AppHandle, editor: Option<String>) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    match editor {
        Some(e) => { store.set(DEFAULT_EDITOR_KEY, serde_json::Value::String(e)); }
        None => { store.delete(DEFAULT_EDITOR_KEY); }
    }
    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn wsl_path(path: String, mode: Option<WslPathMode>) -> Result<String, String> {
    if !cfg!(windows) {
        return Ok(path);
    }

    let flag = match mode.unwrap_or(WslPathMode::Linux) {
        WslPathMode::Windows => "-w",
        WslPathMode::Linux => "-u",
    };

    let output = if path.starts_with('~') {
        let suffix = path.strip_prefix('~').unwrap_or("");
        let escaped = suffix.replace('"', "\\\"");
        let cmd = format!("wslpath {flag} \"$HOME{escaped}\"");
        Command::new("wsl")
            .args(["-e", "sh", "-lc", &cmd])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    } else {
        Command::new("wsl")
            .args(["-e", "wslpath", flag, &path])
            .output()
            .map_err(|e| format!("Failed to run wslpath: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("wslpath failed".to_string());
        }
        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_specta_builder();

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    export_types(&builder);

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    let _ = std::process::Command::new("killall")
        .arg("opencode-cli")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let path = resolve_path_from_args(&args, &cwd);
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                if let Some(ref p) = path {
                    let _ = window.emit("opencode:open-path", p);
                }
                let _ = window.set_focus();
                let _ = window.unminimize();
            } else if let Some(p) = path {
                if let Some(state) = app.try_state::<InitialPathState>() {
                    *state.0.lock().unwrap() = Some(p);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .with_denylist(&[LoadingWindow::LABEL])
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
        .plugin(crate::window_customizer::PinchZoomDisablePlugin)
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let handle = app.handle().clone();

            let initial_path = resolve_path_from_args(
                &std::env::args().collect::<Vec<_>>(),
                &std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
            handle.manage(InitialPathState(Arc::new(Mutex::new(initial_path))));

            let log_dir = app
                .path()
                .app_log_dir()
                .expect("failed to resolve app log dir");
            // Hold the guard in managed state so it lives for the app's lifetime,
            // ensuring all buffered logs are flushed on shutdown.
            handle.manage(logging::init(&log_dir));


            builder.mount_events(&handle);
            tauri::async_runtime::spawn(initialize(handle));

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("Received Exit");

                kill_sidecar(app.clone());
            }
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // Then register them (separated by a comma)
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            reload_sidecar,
            cli::install_cli,
            await_initialization,
            server::get_default_server_url,
            server::set_default_server_url,
            server::get_wsl_config,
            server::set_wsl_config,
            get_display_backend,
            set_display_backend,
            markdown::parse_markdown_command,
            check_app_exists,
            filter_directories,
            open_in_finder,
            open_in_vscode,
            open_in_editor,
            get_custom_editor_path,
            set_custom_editor_path,
            get_default_editor,
            set_default_editor,
            list_config_files,
            read_config_file,
            write_config_file,
            wsl_path,
            resolve_app_path,
            open_path
        ])
        .events(tauri_specta::collect_events![
            LoadingWindowComplete,
            SqliteMigrationProgress
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
}

fn export_types(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");
}

#[cfg(test)]
#[test]
fn test_export_types() {
    let builder = make_specta_builder();
    export_types(&builder);
}

#[derive(tauri_specta::Event, serde::Deserialize, specta::Type)]
struct LoadingWindowComplete;

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing app");

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);

    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    // Spawn sidecar immediately - credentials are known before health check
    let port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let url = format!("http://{hostname}:{port}");
    let password = uuid::Uuid::new_v4().to_string();

    tracing::info!("Spawning sidecar on {url}");
    let (child, health_check) =
        server::spawn_local_server(app.clone(), hostname.to_string(), port, password.clone());

    publish_bridge(
        &app,
        &ServerReadyData {
            url: url.clone(),
            username: Some("opencode".to_string()),
            password: Some(password.clone()),
        },
    )
    .expect("Failed to publish bridge file");

    // Make sidecar credentials available immediately (before health check completes)
    let (ready_tx, ready_rx) = oneshot::channel();
    let _ = ready_tx.send(ServerReadyData {
        url: url.clone(),
        username: Some("opencode".to_string()),
        password: Some(password.clone()),
    });
    app.manage(SidecarReady(ready_rx.shared()));
    app.manage(ServerState {
        child: Arc::new(Mutex::new(Some(child))),
        hostname: hostname.to_string(),
        port,
        password: Arc::new(Mutex::new(password.clone())),
    });

    let loading_window_complete = event_once_fut::<LoadingWindowComplete>(&app);

    // SQLite migration handling:
    // We only do this if the sqlite db doesn't exist, and we're expecting the sidecar to create it.
    // A separate loading window is shown for long migrations.
    let needs_migration = !sqlite_file_exists();
    let sqlite_done = needs_migration.then(|| {
        tracing::info!(
            path = %opencode_db_path().expect("failed to get db path").display(),
            "Sqlite file not found, waiting for it to be generated"
        );

        let (done_tx, done_rx) = oneshot::channel::<()>();
        let done_tx = Arc::new(Mutex::new(Some(done_tx)));

        let init_tx = init_tx.clone();
        let id = SqliteMigrationProgress::listen(&app, move |e| {
            let _ = init_tx.send(InitStep::SqliteWaiting);

            if matches!(e.payload, SqliteMigrationProgress::Done)
                && let Some(done_tx) = done_tx.lock().unwrap().take()
            {
                let _ = done_tx.send(());
            }
        });

        let app = app.clone();
        tokio::spawn(done_rx.map(async move |_| {
            app.unlisten(id);
        }))
    });

    // The loading task waits for SQLite migration (if needed) then for the sidecar health check.
    // This is only used to drive the loading window progress - the main window is shown immediately.
    let loading_task = tokio::spawn({
        async move {
            if let Some(sqlite_done_rx) = sqlite_done {
                let _ = sqlite_done_rx.await;
            }

            // Wait for sidecar to become healthy (for loading window progress)
            let res = timeout(Duration::from_secs(30), health_check.0).await;
            match res {
                Ok(Ok(Ok(()))) => tracing::info!("Sidecar health check OK"),
                Ok(Ok(Err(e))) => tracing::error!("Sidecar health check failed: {e}"),
                Ok(Err(e)) => tracing::error!("Sidecar health check task failed: {e}"),
                Err(_) => tracing::error!("Sidecar health check timed out"),
            }

            tracing::info!("Loading task finished");
        }
    })
    .map_err(|_| ())
    .shared();

    // Show loading window for SQLite migrations if they take >1s
    let loading_window = if needs_migration
        && timeout(Duration::from_secs(1), loading_task.clone())
            .await
            .is_err()
    {
        tracing::debug!("Loading task timed out, showing loading window");
        let loading_window = LoadingWindow::create(&app).expect("Failed to create loading window");
        sleep(Duration::from_secs(1)).await;
        Some(loading_window)
    } else {
        tracing::debug!("Showing main window without loading window");
        let initial_path = app
            .try_state::<InitialPathState>()
            .and_then(|s| s.0.lock().ok()?.take());
        MainWindow::create_with_path(&app, initial_path.as_deref())
            .expect("Failed to create main window");
        None
    };

    if loading_window.is_none() {
        let initial_path = app
            .try_state::<InitialPathState>()
            .and_then(|s| s.0.lock().ok()?.take());
        MainWindow::create_with_path(&app, initial_path.as_deref())
            .expect("Failed to create main window");
    }

    let _ = loading_task.await;

    tracing::info!("Loading done, completing initialisation");
    let _ = init_tx.send(InitStep::Done);

    if loading_window.is_some() {
        loading_window_complete.await;
        tracing::info!("Loading window completed");

        let initial_path = app
            .try_state::<InitialPathState>()
            .and_then(|s| s.0.lock().ok()?.take());
        MainWindow::create_with_path(&app, initial_path.as_deref())
            .expect("Failed to create main window");
    }
    if let Some(loading_window) = loading_window {
        let _ = loading_window.close();
    }
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all().ok();

    app.manage(InitState { current: init_rx });
}

fn spawn_cli_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(e) = sync_cli(app) {
            tracing::error!("Failed to sync CLI: {e}");
        }
    });
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

fn sqlite_file_exists() -> bool {
    let Ok(path) = opencode_db_path() else {
        return true;
    };

    path.exists()
}

fn opencode_db_path() -> Result<PathBuf, &'static str> {
    let xdg_data_home = env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty());

    let data_home = match xdg_data_home {
        Some(v) => PathBuf::from(v),
        None => {
            let home = dirs::home_dir().ok_or("cannot determine home directory")?;
            home.join(".local").join("share")
        }
    };

    Ok(data_home.join("opencode").join("opencode.db"))
}

// Creates a `once` listener for the specified event and returns a future that resolves
// when the listener is fired.
// Since the future creation and awaiting can be done separately, it's possible to create the listener
// synchronously before doing something, then awaiting afterwards.
fn event_once_fut<T: tauri_specta::Event + serde::de::DeserializeOwned>(
    app: &AppHandle,
) -> impl Future<Output = ()> {
    let (tx, rx) = oneshot::channel();
    T::once(app, |_| {
        let _ = tx.send(());
    });
    async {
        let _ = rx.await;
    }
}
