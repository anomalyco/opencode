use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::thread;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Port range for dev servers
const PORT_MIN: u16 = 3000;
const PORT_MAX: u16 = 4000;

/// Workspace Runner: 管理 dev server 进程
pub struct WorkspaceRunner {
    processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
    port_allocator: Arc<Mutex<PortAllocator>>,
}

#[derive(Clone, Serialize)]
pub struct ProcessHandle {
    pub workspace_id: String,
    #[serde(skip)]
    pub child: Option<Child>,
    pub port: u16,
    pub status: ProcessStatus,
    pub logs: Vec<LogEntry>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "message")]
pub enum ProcessStatus {
    Starting,
    Running,
    Stopped,
    Error(String),
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: i64,
    pub level: LogLevel,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Serialize)]
pub struct DevServerInfo {
    pub url: String,
    pub port: u16,
    pub status: ProcessStatus,
}

#[derive(Serialize)]
pub struct BuildResult {
    pub dist_path: String,
    pub success: bool,
}

/// Port allocator for dev servers
pub struct PortAllocator {
    allocated_ports: Vec<u16>,
}

impl PortAllocator {
    pub fn new() -> Self {
        Self {
            allocated_ports: Vec::new(),
        }
    }

    /// Allocate a port in the range PORT_MIN..PORT_MAX
    pub fn allocate(&mut self) -> Result<u16, String> {
        for port in PORT_MIN..=PORT_MAX {
            if !self.allocated_ports.contains(&port) && is_port_available(port) {
                self.allocated_ports.push(port);
                return Ok(port);
            }
        }
        Err("No available ports in range".to_string())
    }

    /// Release a port back to the pool
    pub fn release(&mut self, port: u16) {
        self.allocated_ports.retain(|&p| p != port);
    }
}

/// Check if a port is available
fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

impl WorkspaceRunner {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            port_allocator: Arc::new(Mutex::new(PortAllocator::new())),
        }
    }
}

#[tauri::command]
pub fn open_workspace_dialog() -> Result<String, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;

    FileDialogBuilder::new()
        .set_title("Select Workspace Folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "No folder selected".into())
}

#[tauri::command]
pub async fn workspace_dev_start(
    workspace_id: String,
    root_path: String,
    runner: tauri::State<'_, WorkspaceRunner>,
    app_handle: AppHandle,
) -> Result<DevServerInfo, String> {
    // 1. Check if already running
    {
        let processes = runner.processes.lock().unwrap();
        if let Some(handle) = processes.get(&workspace_id) {
            if handle.status == ProcessStatus::Running {
                return Ok(DevServerInfo {
                    url: format!("http://localhost:{}", handle.port),
                    port: handle.port,
                    status: ProcessStatus::Running,
                });
            }
        }
    }

    // 2. Allocate port
    let port = runner
        .port_allocator
        .lock()
        .unwrap()
        .allocate()
        .map_err(|e| format!("Port allocation failed: {}", e))?;

    // 3. Check package.json exists
    let pkg_json_path = format!("{}/package.json", root_path);
    if !std::path::Path::new(&pkg_json_path).exists() {
        runner.port_allocator.lock().unwrap().release(port);
        return Err("package.json not found in workspace".to_string());
    }

    // 4. Check if node_modules exists
    let node_modules_path = format!("{}/node_modules", root_path);
    if !std::path::Path::new(&node_modules_path).exists() {
        runner.port_allocator.lock().unwrap().release(port);
        return Err("node_modules not found. Please run 'pnpm install' first".to_string());
    }

    // 5. Start dev server
    let mut child = Command::new("pnpm")
        .args(&["run", "dev", "--", "--port", &port.to_string()])
        .current_dir(&root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            runner.port_allocator.lock().unwrap().release(port);
            format!("Failed to start dev server: {}", e)
        })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 6. Store process handle
    let handle = ProcessHandle {
        workspace_id: workspace_id.clone(),
        child: Some(child),
        port,
        status: ProcessStatus::Starting,
        logs: vec![],
    };

    runner
        .processes
        .lock()
        .unwrap()
        .insert(workspace_id.clone(), handle);

    // 7. Spawn log readers
    if let Some(stdout) = stdout {
        let workspace_id_clone = workspace_id.clone();
        let app_handle_clone = app_handle.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let log = LogEntry {
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        level: LogLevel::Info,
                        message: line,
                    };
                    let _ = app_handle_clone.emit(&format!("dev-log:{}", workspace_id_clone), &log);
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        let workspace_id_clone = workspace_id.clone();
        let app_handle_clone = app_handle.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let log = LogEntry {
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        level: LogLevel::Error,
                        message: line,
                    };
                    let _ = app_handle_clone.emit(&format!("dev-log:{}", workspace_id_clone), &log);
                }
            }
        });
    }

    // 8. Update status to Running after a short delay (simulate startup)
    let processes_clone = runner.processes.clone();
    let workspace_id_clone = workspace_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        if let Some(handle) = processes_clone.lock().unwrap().get_mut(&workspace_id_clone) {
            handle.status = ProcessStatus::Running;
        }
    });

    Ok(DevServerInfo {
        url: format!("http://localhost:{}", port),
        port,
        status: ProcessStatus::Starting,
    })
}

#[tauri::command]
pub async fn workspace_dev_stop(
    workspace_id: String,
    runner: tauri::State<'_, WorkspaceRunner>,
) -> Result<(), String> {
    let mut processes = runner.processes.lock().unwrap();
    if let Some(mut handle) = processes.remove(&workspace_id) {
        if let Some(mut child) = handle.child.take() {
            child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
        }
        runner.port_allocator.lock().unwrap().release(handle.port);
        Ok(())
    } else {
        Err("Process not found".to_string())
    }
}

#[tauri::command]
pub async fn workspace_run_build(
    workspace_id: String,
    root_path: String,
) -> Result<BuildResult, String> {
    // Check package.json exists
    let pkg_json_path = format!("{}/package.json", root_path);
    if !std::path::Path::new(&pkg_json_path).exists() {
        return Err("package.json not found in workspace".to_string());
    }

    // Run pnpm build
    let output = Command::new("pnpm")
        .args(&["run", "build"])
        .current_dir(&root_path)
        .output()
        .map_err(|e| format!("Build execution failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Build failed:\n{}", stderr));
    }

    let dist_path = format!("{}/dist", root_path);
    Ok(BuildResult {
        dist_path,
        success: true,
    })
}

#[tauri::command]
pub async fn get_dev_server_status(
    workspace_id: String,
    runner: tauri::State<'_, WorkspaceRunner>,
) -> Result<Option<DevServerInfo>, String> {
    let processes = runner.processes.lock().unwrap();
    if let Some(handle) = processes.get(&workspace_id) {
        Ok(Some(DevServerInfo {
            url: format!("http://localhost:{}", handle.port),
            port: handle.port,
            status: handle.status.clone(),
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn request_dev_permission(
    workspace_id: String,
    root_path: String,
) -> Result<bool, String> {
    use tauri::api::dialog::{MessageDialogBuilder, MessageDialogKind, MessageDialogButtons};

    let message = format!(
        "Build Studio will run code from:\n{}\n\n\
        This may execute arbitrary commands. Only proceed if you trust this workspace.",
        root_path
    );

    let result = MessageDialogBuilder::new("Security Warning", message)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();

    Ok(result)
}
