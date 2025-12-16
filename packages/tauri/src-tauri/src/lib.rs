use std::{
    net::{SocketAddr, TcpListener},
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{AppHandle, LogicalSize, Manager, Monitor, RunEvent, WebviewUrl, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::net::TcpSocket;

#[derive(Clone)]
struct ServerState(Arc<Mutex<Option<CommandChild>>>);

fn get_sidecar_port() -> u16 {
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
        })
}

fn find_and_kill_process_on_port(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    // Find all listeners on the specified port
    let listeners = listeners::get_processes_by_port(port)?;

    if listeners.is_empty() {
        println!("No processes found listening on port {}", port);
        return Ok(());
    }

    for listener in listeners {
        let pid = listener.pid;
        println!("Found process {} listening on port {}", pid, port);

        // Kill the process using platform-appropriate command
        #[cfg(target_os = "windows")]
        {
            Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output()?;
        }

        #[cfg(not(target_os = "windows"))]
        {
            Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output()?;
        }

        println!("Killed process {}", pid);
    }

    Ok(())
}

fn spawn_sidecar(app: &AppHandle, port: u16) -> CommandChild {
    let (mut rx, child) = app
        .shell()
        .sidecar("opencode-cli")
        .unwrap()
        .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
        .env("OPENCODE_CLIENT", "desktop")
        .args(["serve", &format!("--port={port}")])
        .spawn()
        .expect("Failed to spawn opencode");

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    print!("{line}");
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprint!("{line}");
                }
                _ => {}
            }
        }
    });

    child
}

async fn is_server_running(port: u16) -> bool {
    TcpSocket::new_v4()
        .unwrap()
        .connect(SocketAddr::new(
            "127.0.0.1".parse().expect("Failed to parse IP"),
            port,
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
        .setup(move |app| {
            let app = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let port = get_sidecar_port();

                let should_spawn_sidecar = !is_server_running(port).await;

                // if server_running {
                //     let res = app
                //         .dialog()
                //         .message(
                //             "OpenCode Server is already running, would you like to restart it?",
                //         )
                //         .buttons(MessageDialogButtons::YesNo)
                //         .blocking_show_with_result();

                //     match res {
                //         MessageDialogResult::Yes => {
                //             if let Err(e) = find_and_kill_process_on_port(port) {
                //                 eprintln!("Failed to kill process on port {}: {}", port, e);
                //             }
                //             true
                //         }
                //         _ => false,
                //     }
                // } else {
                //     true
                // };

                let child = if should_spawn_sidecar {
                    let child = spawn_sidecar(&app, port);

                    let timestamp = Instant::now();
                    loop {
                        if timestamp.elapsed() > Duration::from_secs(7) {
                            todo!("Handle server spawn timeout");
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
                        .title_bar_style(TitleBarStyle::Overlay)
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
        });
}
