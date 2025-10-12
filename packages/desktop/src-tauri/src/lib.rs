use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::net::TcpListener;
use tauri::Manager;

struct ServerState {
  child: Option<std::process::Child>,
  port: Option<u16>,
}

fn find_available_port() -> Option<u16> {
  (49152..=65535).find(|port| {
    TcpListener::bind(("127.0.0.1", *port)).is_ok()
  })
}

fn get_opencode_path() -> Option<String> {
  let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
  
  let output = Command::new(&shell)
    .arg("-l")
    .arg("-c")
    .arg("which opencode")
    .output()
    .ok()?;

  if output.status.success() {
    String::from_utf8(output.stdout)
      .ok()
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
  } else {
    None
  }
}

#[tauri::command]
fn check_opencode_installed() -> bool {
  get_opencode_path().is_some()
}

#[tauri::command]
fn start_opencode_server(state: tauri::State<Mutex<ServerState>>) -> Result<u16, String> {
  let mut server_state = state.lock().unwrap();
  
  if let Some(port) = server_state.port {
    return Ok(port);
  }

  let opencode_path = get_opencode_path()
    .ok_or_else(|| "OpenCode CLI not found in PATH".to_string())?;

  eprintln!("Found opencode at: {}", opencode_path);

  let port: u16 = 56849;

  eprintln!("Starting server on port: {}", port);

  let home_dir = std::env::var("HOME")
    .map_err(|e| format!("Failed to get HOME: {}", e))?;

  let child = Command::new(&opencode_path)
    .arg("serve")
    .arg("--port")
    .arg(port.to_string())
    .current_dir(&home_dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| {
      eprintln!("Failed to spawn: {}", e);
      format!("Failed to start server: {}", e)
    })?;

  eprintln!("Server process started with PID: {:?}", child.id());
  
  server_state.child = Some(child);
  server_state.port = Some(port);
  
  Ok(port)
}

#[tauri::command]
fn get_git_branch(path: String) -> Result<String, String> {
  let output = Command::new("git")
    .arg("-C")
    .arg(&path)
    .arg("rev-parse")
    .arg("--abbrev-ref")
    .arg("HEAD")
    .output()
    .map_err(|e| format!("Failed to get git branch: {}", e))?;

  if output.status.success() {
    String::from_utf8(output.stdout)
      .ok()
      .map(|s| s.trim().to_string())
      .filter(|s| !s.is_empty())
      .ok_or_else(|| "No branch found".to_string())
  } else {
    Err("Not a git repository".to_string())
  }
}

#[tauri::command]
fn select_folder(state: tauri::State<Mutex<ServerState>>) -> Result<String, String> {
  use rfd::FileDialog;
  
  let folder_path = FileDialog::new()
    .set_title("Select Project Folder")
    .pick_folder()
    .ok_or_else(|| "No folder selected".to_string())?
    .to_string_lossy()
    .to_string();

  eprintln!("Folder selected: {}", folder_path);

  let mut server_state = state.lock().unwrap();
  
  if let Some(mut child) = server_state.child.take() {
    eprintln!("Killing existing server process");
    let _ = child.kill();
  }

  let opencode_path = get_opencode_path()
    .ok_or_else(|| "OpenCode CLI not found in PATH".to_string())?;

  let port: u16 = 56849;

  eprintln!("Starting server with path: {}", folder_path);

  let child = Command::new(&opencode_path)
    .arg("serve")
    .arg("--port")
    .arg(port.to_string())
    .current_dir(&folder_path)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("Failed to start server: {}", e))?;

  eprintln!("Server restarted with PID: {:?}", child.id());
  
  server_state.child = Some(child);
  server_state.port = Some(port);
  
  Ok(folder_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(Mutex::new(ServerState { child: None, port: None }))
    .invoke_handler(tauri::generate_handler![
      check_opencode_installed,
      start_opencode_server,
      select_folder,
      get_git_branch
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      let state = app.state::<Mutex<ServerState>>();
      if let Err(e) = start_opencode_server(state) {
        eprintln!("Warning: Failed to auto-start server: {}", e);
      }
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
