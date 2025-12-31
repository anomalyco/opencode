mod window_customizer;

use std::{
    collections::VecDeque,
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, LogicalSize, Manager, RunEvent, WebviewUrl, WebviewWindow, path::BaseDirectory};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::net::TcpSocket;

use crate::window_customizer::PinchZoomDisablePlugin;

const CLI_INSTALL_DIR: &str = ".opencode/bin";
const CLI_BINARY_NAME: &str = "opencode";

#[derive(Clone)]
struct ServerState(Arc<Mutex<Option<CommandChild>>>);

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
        .0
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

#[tauri::command]
async fn copy_logs_to_clipboard(app: AppHandle) -> Result<(), String> {
    let log_state = app.try_state::<LogState>().ok_or("Log state not found")?;

    let logs = log_state
        .0
        .lock()
        .map_err(|_| "Failed to acquire log lock")?;

    let log_text = logs.iter().cloned().collect::<Vec<_>>().join("");

    app.clipboard()
        .write_text(log_text)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_logs(app: AppHandle) -> Result<String, String> {
    let log_state = app.try_state::<LogState>().ok_or("Log state not found")?;

    let logs = log_state
        .0
        .lock()
        .map_err(|_| "Failed to acquire log lock")?;

    Ok(logs.iter().cloned().collect::<Vec<_>>().join(""))
}

fn get_cli_install_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        std::path::PathBuf::from(home)
            .join(CLI_INSTALL_DIR)
            .join(CLI_BINARY_NAME)
    })
}

fn get_sidecar_path() -> std::path::PathBuf {
    tauri::utils::platform::current_exe()
        .expect("Failed to get current exe")
        .parent()
        .expect("Failed to get parent dir")
        .join("opencode-cli")
}

#[tauri::command]
fn is_cli_installed() -> bool {
    get_cli_install_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[tauri::command]
fn get_installed_cli_path() -> Option<String> {
    get_cli_install_path()
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
}

const INSTALL_SCRIPT: &str = include_str!("../../../../install");

#[tauri::command]
fn install_cli() -> Result<String, String> {
    let sidecar = get_sidecar_path();
    if !sidecar.exists() {
        return Err("Sidecar binary not found".to_string());
    }

    let temp_script = std::env::temp_dir().join("opencode-install.sh");
    std::fs::write(&temp_script, INSTALL_SCRIPT)
        .map_err(|e| format!("Failed to write install script: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp_script, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set script permissions: {}", e))?;
    }

    let output = std::process::Command::new(&temp_script)
        .arg("--binary")
        .arg(&sidecar)
        .output()
        .map_err(|e| format!("Failed to run install script: {}", e))?;

    let _ = std::fs::remove_file(&temp_script);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Install script failed: {}", stderr));
    }

    let install_path = get_cli_install_path()
        .ok_or_else(|| "Could not determine install path".to_string())?;

    Ok(install_path.to_string_lossy().to_string())
}

#[tauri::command]
fn sync_cli() -> Result<(), String> {
    if !is_cli_installed() {
        return Ok(());
    }

    let sidecar = get_sidecar_path();
    if !sidecar.exists() {
        return Err("Sidecar binary not found".to_string());
    }

    let install_path = get_cli_install_path()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    std::fs::copy(&sidecar, &install_path)
        .map_err(|e| format!("Failed to sync CLI binary: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&install_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

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
        let sidecar = get_sidecar_path();
        let shell = get_user_shell();
        app.shell()
            .command(&shell)
            .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
            .env("OPENCODE_CLIENT", "desktop")
            .env("XDG_STATE_HOME", &state_dir)
            .args([
                "-il",
                "-c",
                &format!("{} serve --port={}", sidecar.display(), port),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let updater_enabled = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(PinchZoomDisablePlugin)
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            copy_logs_to_clipboard,
            get_logs,
            is_cli_installed,
            get_installed_cli_path,
            install_cli,
            sync_cli
        ])
        .setup(move |app| {
            let app = app.handle().clone();

            // Initialize log state
            app.manage(LogState(Arc::new(Mutex::new(VecDeque::new()))));

            tauri::async_runtime::spawn(async move {
                let port = get_sidecar_port();

                let should_spawn_sidecar = !is_server_running(port).await;

                let child = if should_spawn_sidecar {
                    let child = spawn_sidecar(&app, port);

                    let timestamp = Instant::now();
                    loop {
                        if timestamp.elapsed() > Duration::from_secs(7) {
                            let res = app.dialog()
                              .message("Failed to spawn OpenCode Server. Copy logs using the button below and send them to the team for assistance.")
                              .title("Startup Failed")
                              .buttons(MessageDialogButtons::OkCancelCustom("Copy Logs And Exit".to_string(), "Exit".to_string()))
                              .blocking_show_with_result();

                            if matches!(&res, MessageDialogResult::Custom(name) if name == "Copy Logs And Exit") {
                                match copy_logs_to_clipboard(app.clone()).await {
                                    Ok(()) => println!("Logs copied to clipboard successfully"),
                                    Err(e) => println!("Failed to copy logs to clipboard: {}", e),
                                }
                            }

                            app.exit(1);

                            return;
                        }

                        tokio::time::sleep(Duration::from_millis(10)).await;

                        if is_server_running(port).await {
                            // give the server a little bit more time to warm up
                            tokio::time::sleep(Duration::from_millis(10)).await;

                            break;
                        }
                    }

                    println!("Server ready after {:?}", timestamp.elapsed());

                    Some(child)
                } else {
                    None
                };

                let primary_monitor = app.primary_monitor().ok().flatten();
                let size = primary_monitor
                    .map(|m| m.size().to_logical(m.scale_factor()))
                    .unwrap_or(LogicalSize::new(1920, 1080));

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

                window_builder.build().expect("Failed to create window");

                app.manage(ServerState(Arc::new(Mutex::new(child))));
            });

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
