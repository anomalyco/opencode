use tauri::{Manager, AppHandle, Emitter};
use std::process::{Command, Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Clone)]
struct ServerState {
    process: Arc<Mutex<Option<Child>>>,
    port: Arc<Mutex<u16>>,
}

async fn check_server_health(port: u16) -> bool {
    match reqwest::get(format!("http://localhost:{}/health", port)).await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn wait_for_server(port: u16, max_attempts: u32) -> bool {
    for attempt in 1..=max_attempts {
        if check_server_health(port).await {
            println!("✓ OpenCode server ready on port {} (attempt {})", port, attempt);
            return true;
        }
        sleep(Duration::from_millis(300)).await;
    }
    false
}

fn find_available_port(preferred: u16) -> u16 {
    use std::net::TcpListener;
    
    // Try preferred port first
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    
    // Try nearby ports
    for port in (preferred + 1)..=(preferred + 10) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    
    preferred // Fallback to preferred even if taken (might be our server)
}

async fn start_server(app_handle: AppHandle, port: u16) {
    println!("→ Checking if OpenCode server is running on port {}...", port);
    
    // Check if server is already running
    if check_server_health(port).await {
        println!("✓ OpenCode server already running on port {}", port);
        app_handle.emit("server-ready", port).ok();
        return;
    }
    
    println!("→ Starting OpenCode server on port {}...", port);
    
    // Start the server
    match Command::new("opencode")
        .arg("server")
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => {
            println!("✓ Spawned OpenCode server process (PID: {:?})", child.id());
            
            // Store process handle
            if let Some(state) = app_handle.try_state::<ServerState>() {
                *state.process.lock().unwrap() = Some(child);
                *state.port.lock().unwrap() = port;
            }
            
            // Wait for server to be ready
            if wait_for_server(port, 30).await {
                app_handle.emit("server-ready", port).ok();
            } else {
                eprintln!("✗ Server failed to become ready after 30 attempts");
                app_handle.emit("server-error", "Server failed to start").ok();
            }
        }
        Err(e) => {
            eprintln!("✗ Failed to start OpenCode server: {}", e);
            eprintln!("  Please ensure 'opencode' is installed and in your PATH");
            eprintln!("  Try running: opencode server --port {}", port);
            app_handle.emit("server-error", format!("Failed to start: {}", e)).ok();
        }
    }
}

#[tauri::command]
async fn get_server_port(state: tauri::State<'_, ServerState>) -> Result<u16, String> {
    Ok(*state.port.lock().unwrap())
}

#[tauri::command]
async fn check_server_status(state: tauri::State<'_, ServerState>) -> Result<bool, String> {
    let port = *state.port.lock().unwrap();
    Ok(check_server_health(port).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let preferred_port = 4096;
            let port = find_available_port(preferred_port);
            
            if port != preferred_port {
                println!("⚠ Port {} is in use, trying port {}", preferred_port, port);
            }
            
            // Start server in background
            tauri::async_runtime::spawn(async move {
                sleep(Duration::from_millis(500)).await;
                start_server(app_handle, port).await;
            });
            
            Ok(())
        })
        .manage(ServerState {
            process: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(4096)),
        })
        .invoke_handler(tauri::generate_handler![get_server_port, check_server_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
