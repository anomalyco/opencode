mod cli;
mod constants;
// FORK: 本地资源自定义 protocol(.md 图 / 音视频 / HTML 预览 iframe 共用)2026-05-05
mod local_asset;
// FORK: DeskFox system tray + 主进程常驻骨架 [feat: feishu-bridge] 2026-05-08
mod system_tray;
// FORK: 飞书 adapter 主进程接入(spawn + Tauri commands)[feat: feishu-bridge] 2026-05-08
mod feishu_adapter;
// FORK: 把 installer 资源里的飞书 plugin 路径注入 user opencode 配置 [feat: feishu-bridge-ship-packaging] 2026-05-09
mod feishu_plugin_install;
#[cfg(target_os = "linux")]
pub mod linux_display;
#[cfg(target_os = "linux")]
pub mod linux_windowing;
mod logging;
mod markdown;
mod os;
mod server;
mod text_file;
mod window_customizer;
mod windows;

use crate::cli::CommandChild;
use futures::{FutureExt, TryFutureExt};
use std::{
    env,
    future::Future,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Listener, Manager, RunEvent, State, ipc::Channel};
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
}

/// Resolves with sidecar credentials as soon as the sidecar is spawned (before health check).
struct SidecarReady(futures::future::Shared<oneshot::Receiver<ServerReadyData>>);

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

#[tauri::command]
#[specta::specta]
fn reveal_in_folder(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path)
        .map_err(|e| format!("Failed to reveal path: {e}"))
}

#[tauri::command]
#[specta::specta]
fn create_directory(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("already_exists: {}", path));
    }
    std::fs::create_dir_all(p).map_err(|e| format!("create_dir failed: {}: {}", path, e))
}

#[tauri::command]
#[specta::specta]
fn create_empty_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("already_exists: {}", path));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_parent failed: {}: {}", parent.display(), e))?;
    }
    std::fs::write(p, "").map_err(|e| format!("create_file failed: {}: {}", path, e))
}

#[tauri::command]
#[specta::specta]
fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_path = std::path::Path::new(&to);
    if to_path.exists() {
        return Err(format!("already_exists: {}", to));
    }
    std::fs::rename(&from, &to).map_err(|e| format!("rename failed: {} -> {}: {}", from, to, e))
}

#[tauri::command]
#[specta::specta]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("trash failed: {}: {}", path, e))
}

// FORK: 用于文件树拖放冲突检测,前端 computeAvailableTarget 循环试探 base-1 / base-2 ... 时调 2026-04-27
#[tauri::command]
#[specta::specta]
fn exists_path(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

// FORK-BEGIN: next_available_path — 一次 Tauri 调用算出不冲突的目标路径(避免前端多次往返 + path 分隔符问题)2026-04-27
fn split_name_ext(name: &str) -> (&str, &str) {
    // 与 JS splitNameExt 同语义:仅在最后一个 `.` 之后切;开头 `.` 不算扩展名(.gitignore)
    if let Some(idx) = name.rfind('.') {
        if idx > 0 && idx < name.len() - 1 {
            return (&name[..idx], &name[idx..]);
        }
    }
    (name, "")
}

#[tauri::command]
#[specta::specta]
fn next_available_path(dir: String, name: String) -> String {
    let dir_path = std::path::Path::new(&dir);
    let initial = dir_path.join(&name);
    if !initial.exists() {
        return initial.to_string_lossy().into_owned();
    }
    let (base, ext) = split_name_ext(&name);
    for i in 1..=1000 {
        let candidate = dir_path.join(format!("{}-{}{}", base, i, ext));
        if !candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    // give up — 返回 initial,让上层 copy/rename 自己报 already_exists
    initial.to_string_lossy().into_owned()
}
// FORK-END

// FORK-BEGIN: 文件树复制粘贴 — copy_path 命令(commit #3 of file-tree-dnd)2026-04-27
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if file_type.is_symlink() {
            // 跨平台 symlink 处理略显复杂,v1 直接 fail 让上层报错。后续可补
            return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                format!("symlink copy not supported: {}", src_path.display()),
            ));
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn copy_path(from: String, to: String) -> Result<(), String> {
    let from_path = std::path::Path::new(&from);
    let to_path = std::path::Path::new(&to);
    if to_path.exists() {
        return Err(format!("already_exists: {}", to));
    }
    if from_path.is_dir() {
        copy_dir_recursive(from_path, to_path)
            .map_err(|e| format!("copy dir failed: {} -> {}: {}", from, to, e))
    } else {
        std::fs::copy(&from, &to)
            .map(|_| ())
            .map_err(|e| format!("copy file failed: {} -> {}: {}", from, to, e))
    }
}
// FORK-END

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
        // FORK: 注册本地资源 protocol — .md 图 / 音视频 / HTML 预览 iframe 共用,Rust 端 canonicalize + sdk 越权防护 2026-05-05
        .register_uri_scheme_protocol(local_asset::SCHEME, local_asset::handler)
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

            // FORK: 注册 system tray(C0.5.1 scaffold,菜单 / 命令 C0.5.3 加)[feat: feishu-bridge]
            if let Err(err) = system_tray::build_tray(app.handle()) {
                tracing::warn!("failed to build system tray: {err}");
            }

            // FORK: 飞书 adapter 状态初始化(C1.3,Phase 2+ 真 spawn)[feat: feishu-bridge]
            feishu_adapter::init(app.handle());

            // FORK: installer 资源里的 feishu plugin 注入 user opencode 配置(idempotent)
            // [feat: feishu-bridge-ship-packaging] 2026-05-09
            feishu_plugin_install::ensure_feishu_plugin_in_config(app.handle());

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            match &event {
                RunEvent::Exit => {
                    tracing::info!("Received Exit");
                    kill_sidecar(app.clone());
                }
                // FORK: 关 GUI ≠ 退主进程(C0.5.2)— 飞书 adapter 长驻 [feat: feishu-bridge]
                // FORK: 加 dirty flush event 发给前端,前端 listener flush 后再真 hide/exit
                //   [feat: auto-save-debounce-flush] 2026-05-21
                //   说明:不阻塞 close — 发 event 后立即继续 hide 流程;前端 listener 同步触发
                //   debounce flush,save 本身 async 但本地 IO <50ms,跟 hide 窗口几乎并发;
                //   real exit(is_quitting=true)由 RunEvent::Exit 处理,sidecar kill 前事件
                //   总线已停,故 Exit 路径靠前端 listener 在 Window CloseRequested 时已 flush 兜底。
                RunEvent::WindowEvent { label, event: window_event, .. }
                    if label == MainWindow::LABEL =>
                {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = window_event {
                        // 先发 flush event,前端有 listener 时立即触发 silent save
                        let _ = app.emit("deskfox-flush-before-close", ());
                        if !system_tray::is_quitting() {
                            api.prevent_close();
                            if let Some(w) = app.get_webview_window(MainWindow::LABEL) {
                                let _ = w.hide();
                            }
                            tracing::debug!("close requested → flush + hidden(主进程仍跑)");
                        }
                    }
                }
                _ => {}
            }
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // Then register them (separated by a comma)
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
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
            wsl_path,
            resolve_app_path,
            open_path,
            reveal_in_folder,
            create_directory,
            create_empty_file,
            rename_path,
            trash_path,
            exists_path,         // FORK: 文件树拖放冲突检测 2026-04-27
            next_available_path, // FORK: 后端一次性算出不冲突目标 2026-04-27
            copy_path,           // FORK: 文件树复制粘贴 2026-04-27
            text_file::write_text_file,
            text_file::get_file_mtime,
            text_file::get_file_size, // FORK: 大文件预览统一防护 L1 size pre-check [feat: large-file-preview-guard] 2026-05-21
            text_file::read_binary_file_base64,
            text_file::write_binary_file_absolute_base64, // FORK: 文件树外部 OS 文件拖入 2026-04-28
            text_file::fetch_url_base64, // FORK: MD 导出 Word — 远端图片 fetch 绕 WebView2 CORS 2026-05-08
            // FORK: tray 状态切换 + 主窗口控制 + 退出 [feat: feishu-bridge] 2026-05-08
            system_tray::set_tray_status_cmd,
            system_tray::show_main_window_cmd,
            system_tray::quit_app_cmd,
            // FORK: 飞书 adapter OAuth 接入 [feat: feishu-bridge] 2026-05-08
            feishu_adapter::feishu_oauth_start,
            feishu_adapter::feishu_oauth_poll,
            feishu_adapter::feishu_adapter_status,
            // FORK: 飞书账户 CRUD(C1.6 写盘)[feat: feishu-bridge] 2026-05-08
            feishu_adapter::feishu_save_account,
            feishu_adapter::feishu_list_accounts,
            feishu_adapter::feishu_delete_account,
            // FORK: per-account model 选择 [feat: feishu-bridge] 2026-05-09
            feishu_adapter::feishu_update_account_model,
            // FORK: per-account partial settings [feat: feishu-create-group-toggle-gui] 2026-05-24
            feishu_adapter::feishu_update_account_settings,
            feishu_adapter::feishu_list_providers
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

    // FORK: feishu-pipeline-401-fix(2026-05-23)
    // build-deskfox.{sh,ps1} 锁了 sidecar baked CHANNEL=prod 规避上游 effect-httpapi 两个 bug。
    // 副作用是 sidecar 读 DB 路径从 opencode-dev.db / opencode-<branch>.db 切到 opencode.db
    // (见 packages/opencode/src/storage/db.ts:30 getChannelPath 逻辑)。
    // 现役 prod 1.14.33(channel=dev)用户升级后会发现 GUI session list 空(数据在另一个 DB)。
    // 一次性幂等迁移:opencode.db 不存 + opencode-dev.db 存 → cp 过去(WAL/SHM 同步)。
    // 仅 cp,不删旧文件 — 用户感知零损失,旧 DB 保留作回退兜底。
    migrate_pre_prod_db();

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

    // Make sidecar credentials available immediately (before health check completes)
    let (ready_tx, ready_rx) = oneshot::channel();
    let _ = ready_tx.send(ServerReadyData {
        url: url.clone(),
        username: Some("opencode".to_string()),
        password: Some(password),
    });
    app.manage(SidecarReady(ready_rx.shared()));
    app.manage(ServerState {
        child: Arc::new(Mutex::new(Some(child))),
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
        None
    };

    // Create main window immediately - the web app handles its own loading/health gate
    MainWindow::create(&app).expect("Failed to create main window");

    let _ = loading_task.await;

    tracing::info!("Loading done, completing initialisation");
    let _ = init_tx.send(InitStep::Done);

    if loading_window.is_some() {
        loading_window_complete.await;
        tracing::info!("Loading window completed");
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

// FORK-BEGIN: feishu-pipeline-401-fix(2026-05-23)
// 一次性幂等 DB 迁移:把 pre-fix channel=dev 时代的 opencode-dev.db cp 成 opencode.db。
// 完整背景见 build-deskfox.sh 顶部 FORK marker 段。
// 触发条件(全部满足才迁移):
//   1) 目标 opencode.db 不存在
//   2) 源 opencode-dev.db 存在
// 满足 → cp 3 个文件:.db / .db-wal / .db-shm(SQLite WAL 模式),旧文件保留不删。
// 不满足任一 → skip(可能已迁过 / 全新用户 / 啥都没有)。
// 日志通过 tracing 抛 INFO 级,失败抛 WARN 不阻断启动。
fn migrate_pre_prod_db() {
    let target = match opencode_db_path() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("[fork-db-migrate] cannot resolve opencode.db path: {e}");
            return;
        }
    };
    let Some(parent) = target.parent() else {
        tracing::warn!("[fork-db-migrate] target has no parent dir, skip");
        return;
    };
    let source = parent.join("opencode-dev.db");
    migrate_db_files(&source, &target);
}

// 抽出文件复制核心逻辑给单测调用,跟 opencode_db_path() / tracing 解耦。
// 单测见 #[cfg(test)] mod fork_db_migrate_tests。
fn migrate_db_files(source: &Path, target: &Path) {
    if target.exists() {
        tracing::debug!("[fork-db-migrate] {} already exists, skip", target.display());
        return;
    }
    if !source.exists() {
        tracing::debug!(
            "[fork-db-migrate] {} not found, skip (fresh install or already migrated)",
            source.display()
        );
        return;
    }
    tracing::info!(
        "[fork-db-migrate] migrating {} → {} (one-time, idempotent)",
        source.display(),
        target.display()
    );
    // SQLite WAL 模式有 3 个文件:.db 主库 / .db-wal write-ahead log / .db-shm shared memory
    // 同时存在时全部 cp,任一缺失视为该副文件不在(SQLite 启动会自动重建)。
    let source_name = source.file_name().and_then(|s| s.to_str()).unwrap_or("opencode-dev.db");
    let target_name = target.file_name().and_then(|s| s.to_str()).unwrap_or("opencode.db");
    let suffixes = ["", "-wal", "-shm"];
    let mut copied = 0u8;
    for suffix in suffixes {
        let src_path = source.with_file_name(format!("{source_name}{suffix}"));
        if !src_path.exists() {
            continue;
        }
        let dst_path = target.with_file_name(format!("{target_name}{suffix}"));
        match std::fs::copy(&src_path, &dst_path) {
            Ok(bytes) => {
                copied += 1;
                tracing::info!(
                    "[fork-db-migrate] cp {} → {} ({} bytes)",
                    src_path.display(),
                    dst_path.display(),
                    bytes
                );
            }
            Err(e) => {
                tracing::warn!(
                    "[fork-db-migrate] failed to cp {}: {e} — startup continues, sidecar 会建空 DB",
                    src_path.display()
                );
                // 不 break — 继续试其他副文件
            }
        }
    }
    if copied == 0 {
        tracing::warn!("[fork-db-migrate] nothing copied; source detected but cp 全失败,sidecar 会建空 DB");
    } else {
        tracing::info!("[fork-db-migrate] done, {copied} file(s) migrated");
    }
}

#[cfg(test)]
mod fork_db_migrate_tests {
    use super::migrate_db_files;
    use std::fs;
    use std::path::PathBuf;

    fn tmpdir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("deskfox-fork-db-migrate-{name}-{}", std::process::id()));
        if base.exists() {
            let _ = fs::remove_dir_all(&base);
        }
        fs::create_dir_all(&base).expect("create tmpdir");
        base
    }

    fn write(p: &PathBuf, content: &[u8]) {
        fs::write(p, content).expect("write file");
    }

    #[test]
    fn skips_when_target_already_exists() {
        let dir = tmpdir("target-exists");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        write(&source, b"old-data");
        write(&target, b"existing-target");
        migrate_db_files(&source, &target);
        // target 不应被覆盖
        assert_eq!(fs::read(&target).unwrap(), b"existing-target");
    }

    #[test]
    fn skips_when_source_missing() {
        let dir = tmpdir("source-missing");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        migrate_db_files(&source, &target);
        // target 不应被创建
        assert!(!target.exists());
    }

    #[test]
    fn copies_main_only() {
        let dir = tmpdir("main-only");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        write(&source, b"main-db-bytes");
        migrate_db_files(&source, &target);
        assert_eq!(fs::read(&target).unwrap(), b"main-db-bytes");
        // 没有 wal/shm 副文件就不创建
        assert!(!dir.join("opencode.db-wal").exists());
        assert!(!dir.join("opencode.db-shm").exists());
    }

    #[test]
    fn copies_main_wal_shm_all() {
        let dir = tmpdir("all-three");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        write(&source, b"main");
        write(&dir.join("opencode-dev.db-wal"), b"wal-content");
        write(&dir.join("opencode-dev.db-shm"), b"shm-content");
        migrate_db_files(&source, &target);
        assert_eq!(fs::read(&target).unwrap(), b"main");
        assert_eq!(fs::read(&dir.join("opencode.db-wal")).unwrap(), b"wal-content");
        assert_eq!(fs::read(&dir.join("opencode.db-shm")).unwrap(), b"shm-content");
    }

    #[test]
    fn idempotent_second_run_is_noop() {
        let dir = tmpdir("idempotent");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        write(&source, b"main");
        migrate_db_files(&source, &target);
        // 修改源,再跑一次 — target 不应被刷新
        write(&source, b"main-mutated");
        migrate_db_files(&source, &target);
        assert_eq!(fs::read(&target).unwrap(), b"main");
    }

    #[test]
    fn preserves_source_after_migration() {
        let dir = tmpdir("preserve-source");
        let source = dir.join("opencode-dev.db");
        let target = dir.join("opencode.db");
        write(&source, b"main");
        migrate_db_files(&source, &target);
        // 源文件应保留(cp 不 move)
        assert!(source.exists());
        assert_eq!(fs::read(&source).unwrap(), b"main");
    }
}
// FORK-END

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
