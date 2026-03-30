mod cli;
mod constants;
mod server;

use tauri::Manager;

/// Kill the sidecar (athena CLI) process.
#[tauri::command]
async fn kill_sidecar(state: tauri::State<'_, cli::SidecarState>) -> Result<(), String> {
    cli::kill_sidecar(&state).await.map_err(|e| e.to_string())
}

/// Wait for the athena CLI server to be ready.
#[tauri::command]
async fn await_initialization(
    hostname: String,
    port: u16,
    password: String,
) -> Result<bool, String> {
    server::await_health_check(&hostname, port, &password)
        .await
        .map_err(|e| e.to_string())
}

/// Get the browser live view WebSocket URL.
/// agent-browser streams viewport to ws://localhost:9223 by default.
#[tauri::command]
async fn get_browser_ws_url() -> Result<String, String> {
    Ok(format!("ws://localhost:9223"))
}

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window if another instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(cli::SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            kill_sidecar,
            await_initialization,
            get_browser_ws_url,
        ])
        .setup(|app| {
            // Create main window
            let _window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Athena Browser")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running athena desktop");
}
