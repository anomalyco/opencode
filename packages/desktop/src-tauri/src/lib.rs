mod cli;
mod constants;
#[cfg(windows)]
mod job_object;
#[cfg(target_os = "linux")]
pub mod linux_display;
mod logging;
mod markdown;
mod server;
mod window_customizer;
mod windows;

use futures::{
    FutureExt, TryFutureExt,
    future::{self, Shared},
};
#[cfg(windows)]
use job_object::*;
use std::{
    env,
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, State, ipc::Channel};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_shell::process::CommandChild;
use tokio::{
    sync::{oneshot, watch},
    time::{sleep, timeout},
};

use crate::cli::sync_cli;
use crate::constants::*;
use crate::server::get_saved_server_url;
use crate::windows::{LoadingWindow, MainWindow};

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    password: Option<String>,
}

#[derive(Clone, Copy, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    SqliteWaiting,
    Done,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: future::Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
    ) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
            status,
        }
    }

    pub fn set_child(&self, child: Option<CommandChild>) {
        *self.child.lock().unwrap() = child;
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

    tracing::info!("Killed server");
}

fn get_logs() -> String {
    logging::tail()
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, ServerState>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    let events = async {
        let e = (*rx.borrow()).clone();
        let _ = events.send(e).unwrap();

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();

            let _ = events.send(step);

            if matches!(step, InitStep::Done) {
                break;
            }
        }
    };

    future::join(state.status.clone(), events)
        .await
        .0
        .map_err(|_| "Failed to get server status".to_string())?
}

#[tauri::command]
#[specta::specta]
fn check_app_exists(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        check_windows_app(app_name)
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

#[cfg(target_os = "windows")]
fn check_windows_app(app_name: &str) -> bool {
    resolve_windows_app_path(app_name).is_some()
}

#[cfg(target_os = "windows")]
fn resolve_windows_app_path(app_name: &str) -> Option<String> {
    use std::path::{Path, PathBuf};

    fn expand_env(value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        let mut index = 0;

        while let Some(start) = value[index..].find('%') {
            let start = index + start;
            out.push_str(&value[index..start]);

            let Some(end_rel) = value[start + 1..].find('%') else {
                out.push_str(&value[start..]);
                return out;
            };

            let end = start + 1 + end_rel;
            let key = &value[start + 1..end];
            if key.is_empty() {
                out.push('%');
                index = end + 1;
                continue;
            }

            if let Ok(v) = std::env::var(key) {
                out.push_str(&v);
                index = end + 1;
                continue;
            }

            out.push_str(&value[start..=end]);
            index = end + 1;
        }

        out.push_str(&value[index..]);
        out
    }

    fn extract_exe(value: &str) -> Option<String> {
        let value = value.trim();
        if value.is_empty() {
            return None;
        }

        if let Some(rest) = value.strip_prefix('"') {
            if let Some(end) = rest.find('"') {
                let inner = rest[..end].trim();
                if inner.to_ascii_lowercase().contains(".exe") {
                    return Some(inner.to_string());
                }
            }
        }

        let lower = value.to_ascii_lowercase();
        let end = lower.find(".exe")?;
        Some(value[..end + 4].trim().trim_matches('"').to_string())
    }

    fn candidates(app_name: &str) -> Vec<String> {
        let app_name = app_name.trim().trim_matches('"');
        if app_name.is_empty() {
            return vec![];
        }

        let mut out = Vec::<String>::new();
        let mut push = |value: String| {
            let value = value.trim().trim_matches('"').to_string();
            if value.is_empty() {
                return;
            }
            if out.iter().any(|v| v.eq_ignore_ascii_case(&value)) {
                return;
            }
            out.push(value);
        };

        push(app_name.to_string());

        let lower = app_name.to_ascii_lowercase();
        if !lower.ends_with(".exe") {
            push(format!("{app_name}.exe"));
        }

        let snake = {
            let mut s = String::new();
            let mut underscore = false;
            for c in lower.chars() {
                if c.is_ascii_alphanumeric() {
                    s.push(c);
                    underscore = false;
                    continue;
                }
                if underscore {
                    continue;
                }
                s.push('_');
                underscore = true;
            }
            s.trim_matches('_').to_string()
        };

        if !snake.is_empty() {
            push(snake.clone());
            if !snake.ends_with(".exe") {
                push(format!("{snake}.exe"));
            }
        }

        let alnum = lower
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>();

        if !alnum.is_empty() {
            push(alnum.clone());
            push(format!("{alnum}.exe"));
        }

        match lower.as_str() {
            "sublime text" | "sublime-text" | "sublime_text" | "sublime text.exe" => {
                push("subl".to_string());
                push("subl.exe".to_string());
                push("sublime_text".to_string());
                push("sublime_text.exe".to_string());
            }
            _ => {}
        }

        out
    }

    fn reg_app_path(exe: &str) -> Option<String> {
        let exe = exe.trim().trim_matches('"');
        if exe.is_empty() {
            return None;
        }

        let keys = [
            format!(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
            ),
            format!(
                r"HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
            ),
            format!(
                r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
            ),
        ];

        for key in keys {
            let Some(output) = Command::new("reg")
                .args(["query", &key, "/ve"])
                .output()
                .ok()
            else {
                continue;
            };

            if !output.status.success() {
                continue;
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let tokens = line.split_whitespace().collect::<Vec<_>>();
                let Some(index) = tokens.iter().position(|v| v.starts_with("REG_")) else {
                    continue;
                };

                let value = tokens[index + 1..].join(" ");
                let Some(exe) = extract_exe(&value) else {
                    continue;
                };

                let exe = expand_env(&exe);
                let path = Path::new(exe.trim().trim_matches('"'));
                if path.exists() {
                    return Some(path.to_string_lossy().to_string());
                }
            }
        }

        None
    }

    let app_name = app_name.trim().trim_matches('"');
    if app_name.is_empty() {
        return None;
    }

    let direct = Path::new(app_name);
    if direct.is_absolute() && direct.exists() {
        return Some(direct.to_string_lossy().to_string());
    }

    let key = app_name
        .chars()
        .filter(|v| v.is_ascii_alphanumeric())
        .flat_map(|v| v.to_lowercase())
        .collect::<String>();

    let has_ext = |path: &Path, ext: &str| {
        path.extension()
            .and_then(|v| v.to_str())
            .map(|v| v.eq_ignore_ascii_case(ext))
            .unwrap_or(false)
    };

    let resolve_cmd = |path: &Path| -> Option<String> {
        let bytes = std::fs::read(path).ok()?;
        let content = String::from_utf8_lossy(&bytes);

        for token in content.split('"') {
            let Some(exe) = extract_exe(token) else {
                continue;
            };

            let lower = exe.to_ascii_lowercase();
            if let Some(index) = lower.find("%~dp0") {
                let base = path.parent()?;
                let suffix = &exe[index + 5..];
                let mut resolved = PathBuf::from(base);

                for part in suffix.replace('/', "\\").split('\\') {
                    if part.is_empty() || part == "." {
                        continue;
                    }
                    if part == ".." {
                        let _ = resolved.pop();
                        continue;
                    }
                    resolved.push(part);
                }

                if resolved.exists() {
                    return Some(resolved.to_string_lossy().to_string());
                }

                continue;
            }

            let resolved = PathBuf::from(expand_env(&exe));
            if resolved.exists() {
                return Some(resolved.to_string_lossy().to_string());
            }
        }

        None
    };

    let resolve_where = |query: &str| -> Option<String> {
        let output = Command::new("where").arg(query).output().ok()?;
        if !output.status.success() {
            return None;
        }

        let paths = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(PathBuf::from)
            .collect::<Vec<_>>();

        if paths.is_empty() {
            return None;
        }

        if let Some(path) = paths.iter().find(|path| has_ext(path, "exe")) {
            return Some(path.to_string_lossy().to_string());
        }

        for path in &paths {
            if has_ext(path, "cmd") || has_ext(path, "bat") {
                if let Some(resolved) = resolve_cmd(path) {
                    return Some(resolved);
                }
            }

            if path.extension().is_none() {
                let cmd = path.with_extension("cmd");
                if cmd.exists() {
                    if let Some(resolved) = resolve_cmd(&cmd) {
                        return Some(resolved);
                    }
                }

                let bat = path.with_extension("bat");
                if bat.exists() {
                    if let Some(resolved) = resolve_cmd(&bat) {
                        return Some(resolved);
                    }
                }
            }
        }

        if !key.is_empty() {
            for path in &paths {
                let dirs = [
                    path.parent(),
                    path.parent().and_then(|dir| dir.parent()),
                    path.parent()
                        .and_then(|dir| dir.parent())
                        .and_then(|dir| dir.parent()),
                ];

                for dir in dirs.into_iter().flatten() {
                    if let Ok(entries) = std::fs::read_dir(dir) {
                        for entry in entries.flatten() {
                            let candidate = entry.path();
                            if !has_ext(&candidate, "exe") {
                                continue;
                            }

                            let Some(stem) = candidate.file_stem().and_then(|v| v.to_str()) else {
                                continue;
                            };

                            let name = stem
                                .chars()
                                .filter(|v| v.is_ascii_alphanumeric())
                                .flat_map(|v| v.to_lowercase())
                                .collect::<String>();

                            if name.contains(&key) || key.contains(&name) {
                                return Some(candidate.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }

        paths.first().map(|path| path.to_string_lossy().to_string())
    };

    let list = candidates(app_name);
    for query in &list {
        if let Some(path) = resolve_where(query) {
            return Some(path);
        }
    }

    let mut exes = Vec::<String>::new();
    for query in &list {
        let query = query.trim().trim_matches('"');
        if query.is_empty() {
            continue;
        }

        let name = Path::new(query)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or(query);

        let exe = if name.to_ascii_lowercase().ends_with(".exe") {
            name.to_string()
        } else {
            format!("{name}.exe")
        };

        if exes.iter().any(|v| v.eq_ignore_ascii_case(&exe)) {
            continue;
        }

        exes.push(exe);
    }

    for exe in exes {
        if let Some(path) = reg_app_path(&exe) {
            return Some(path);
        }
    }

    None
}

#[tauri::command]
#[specta::specta]
fn resolve_app_path(app_name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        resolve_windows_app_path(app_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, just return the app_name as-is since
        // the opener plugin handles them correctly
        Some(app_name.to_string())
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri_specta::Builder::<tauri::Wry>::new()
        // Then register them (separated by a comma)
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            cli::install_cli,
            await_initialization,
            server::get_default_server_url,
            server::set_default_server_url,
            get_display_backend,
            set_display_backend,
            markdown::parse_markdown_command,
            check_app_exists,
            resolve_app_path
        ])
        .events(tauri_specta::collect_events![LoadingWindowComplete])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw);

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    #[cfg(all(target_os = "macos", not(debug_assertions)))]
    let _ = std::process::Command::new("killall")
        .arg("opencode-cli")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                let _ = window.set_focus();
                let _ = window.unminimize();
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

#[derive(tauri_specta::Event, serde::Deserialize, specta::Type)]
struct LoadingWindowComplete;

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing app");

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);

    setup_app(&app, init_rx);
    spawn_cli_sync_task(app.clone());

    let (server_ready_tx, server_ready_rx) = oneshot::channel();
    let server_ready_rx = server_ready_rx.shared();
    app.manage(ServerState::new(None, server_ready_rx.clone()));

    let loading_window_complete = event_once_fut::<LoadingWindowComplete>(&app);

    tracing::info!("Main and loading windows created");

    let sqlite_enabled = option_env!("OPENCODE_SQLITE").is_some();

    let loading_task = tokio::spawn({
        let init_tx = init_tx.clone();
        let app = app.clone();

        async move {
            let mut sqlite_exists = sqlite_file_exists();

            tracing::info!("Setting up server connection");
            let server_connection = setup_server_connection(app.clone()).await;

            // we delay spawning this future so that the timeout is created lazily
            let cli_health_check = match server_connection {
                ServerConnection::CLI {
                    child,
                    health_check,
                    url,
                    password,
                } => {
                    let app = app.clone();
                    Some(
                        async move {
                            let res = timeout(Duration::from_secs(30), health_check.0).await;
                            let err = match res {
                                Ok(Ok(Ok(()))) => None,
                                Ok(Ok(Err(e))) => Some(e),
                                Ok(Err(e)) => Some(format!("Health check task failed: {e}")),
                                Err(_) => Some("Health check timed out".to_string()),
                            };

                            if let Some(err) = err {
                                let _ = child.kill();

                                return Err(format!(
                                    "Failed to spawn OpenCode Server ({err}). Logs:\n{}",
                                    get_logs()
                                ));
                            }

                            tracing::info!("CLI health check OK");

                            #[cfg(windows)]
                            {
                                let job_state = app.state::<JobObjectState>();
                                job_state.assign_pid(child.pid());
                            }

                            app.state::<ServerState>().set_child(Some(child));

                            Ok(ServerReadyData { url, password })
                        }
                        .map(move |res| {
                            let _ = server_ready_tx.send(res);
                        }),
                    )
                }
                ServerConnection::Existing { url } => {
                    let _ = server_ready_tx.send(Ok(ServerReadyData {
                        url: url.to_string(),
                        password: None,
                    }));
                    None
                }
            };

            if let Some(cli_health_check) = cli_health_check {
                if sqlite_enabled {
                    tracing::debug!(sqlite_exists, "Checking sqlite file existence");
                    if !sqlite_exists {
                        tracing::info!(
                            path = %opencode_db_path().expect("failed to get db path").display(),
                            "Sqlite file not found, waiting for it to be generated"
                        );
                        let _ = init_tx.send(InitStep::SqliteWaiting);

                        while !sqlite_exists {
                            sleep(Duration::from_secs(1)).await;
                            sqlite_exists = sqlite_file_exists();
                        }
                    }
                }

                tokio::spawn(cli_health_check);
            }

            let _ = server_ready_rx.await;
        }
    })
    .map_err(|_| ())
    .shared();

    let loading_window = if sqlite_enabled
        && timeout(Duration::from_secs(1), loading_task.clone())
            .await
            .is_err()
    {
        tracing::debug!("Loading task timed out, showing loading window");
        let app = app.clone();
        let loading_window = LoadingWindow::create(&app).expect("Failed to create loading window");
        sleep(Duration::from_secs(1)).await;
        Some(loading_window)
    } else {
        MainWindow::create(&app).expect("Failed to create main window");

        None
    };

    let _ = loading_task.await;

    tracing::info!("Loading done, completing initialisation");

    let _ = init_tx.send(InitStep::Done);

    if loading_window.is_some() {
        loading_window_complete.await;

        tracing::info!("Loading window completed");
    }

    MainWindow::create(&app).expect("Failed to create main window");

    if let Some(loading_window) = loading_window {
        let _ = loading_window.close();
    }
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all().ok();

    #[cfg(windows)]
    app.manage(JobObjectState::new());

    app.manage(InitState { current: init_rx });
}

fn spawn_cli_sync_task(app: AppHandle) {
    tokio::spawn(async move {
        if let Err(e) = sync_cli(app) {
            tracing::error!("Failed to sync CLI: {e}");
        }
    });
}

enum ServerConnection {
    Existing {
        url: String,
    },
    CLI {
        url: String,
        password: Option<String>,
        child: CommandChild,
        health_check: server::HealthCheck,
    },
}

async fn setup_server_connection(app: AppHandle) -> ServerConnection {
    let custom_url = get_saved_server_url(&app).await;

    tracing::info!(?custom_url, "Attempting server connection");

    if let Some(url) = custom_url
        && server::check_health_or_ask_retry(&app, &url).await
    {
        tracing::info!(%url, "Connected to custom server");
        return ServerConnection::Existing { url: url.clone() };
    }

    let local_port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let local_url = format!("http://{hostname}:{local_port}");

    tracing::debug!(url = %local_url, "Checking health of local server");
    if server::check_health(&local_url, None).await {
        tracing::info!(url = %local_url, "Health check OK, using existing server");
        return ServerConnection::Existing { url: local_url };
    }

    let password = uuid::Uuid::new_v4().to_string();

    tracing::info!("Spawning new local server");
    let (child, health_check) =
        server::spawn_local_server(app, hostname.to_string(), local_port, password.clone());

    ServerConnection::CLI {
        url: local_url,
        password: Some(password),
        child,
        health_check,
    }
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
