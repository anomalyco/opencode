use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::thread;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

/// Port range for dev servers
const PORT_MIN: u16 = 3000;
const PORT_MAX: u16 = 4000;

/// Package manager detection
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Bun,
    Pnpm,
    Yarn,
    Npm,
}

impl PackageManager {
    /// Detect package manager from lock file in workspace
    pub fn detect(root_path: &str) -> Self {
        if Path::new(&format!("{}/bun.lock", root_path)).exists() 
            || Path::new(&format!("{}/bun.lockb", root_path)).exists() {
            PackageManager::Bun
        } else if Path::new(&format!("{}/pnpm-lock.yaml", root_path)).exists() {
            PackageManager::Pnpm
        } else if Path::new(&format!("{}/yarn.lock", root_path)).exists() {
            PackageManager::Yarn
        } else {
            PackageManager::Npm
        }
    }

    /// Get the install command
    pub fn install_command(&self) -> &str {
        match self {
            PackageManager::Bun => "bun",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Yarn => "yarn",
            PackageManager::Npm => "npm",
        }
    }

    /// Get the install arguments
    pub fn install_args(&self) -> Vec<&str> {
        match self {
            PackageManager::Bun => vec!["install"],
            PackageManager::Pnpm => vec!["install"],
            PackageManager::Yarn => vec!["install"],
            PackageManager::Npm => vec!["install"],
        }
    }

    /// Get the dev run command args
    pub fn dev_args(&self, port: u16) -> Vec<String> {
        match self {
            PackageManager::Bun => vec!["run".to_string(), "dev".to_string(), "--".to_string(), "--port".to_string(), port.to_string()],
            PackageManager::Pnpm => vec!["run".to_string(), "dev".to_string(), "--".to_string(), "--port".to_string(), port.to_string()],
            PackageManager::Yarn => vec!["run".to_string(), "dev".to_string(), "--port".to_string(), port.to_string()],
            PackageManager::Npm => vec!["run".to_string(), "dev".to_string(), "--".to_string(), "--port".to_string(), port.to_string()],
        }
    }
}

/// Install progress status
#[derive(Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub status: InstallStatus,
    pub package_manager: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InstallStatus {
    Pending,
    Installing,
    Completed,
    Error,
}

/// Workspace Runner: 管理 dev server 进程
pub struct WorkspaceRunner {
    processes: Arc<Mutex<HashMap<String, ProcessHandle>>>,
    port_allocator: Arc<Mutex<PortAllocator>>,
}

#[derive(Clone, Serialize)]
pub struct ProcessHandle {
    pub workspace_id: String,
    #[serde(skip)]
    pub child: Arc<Mutex<Option<Child>>>,
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

/// Install dependencies in the workspace
fn install_dependencies(
    root_path: &str,
    pkg_manager: &PackageManager,
    app_handle: &AppHandle,
    workspace_id: &str,
) -> Result<(), String> {
    // Emit install started event
    let progress = InstallProgress {
        status: InstallStatus::Installing,
        package_manager: pkg_manager.install_command().to_string(),
        message: format!("Installing dependencies with {}...", pkg_manager.install_command()),
    };
    let _ = app_handle.emit(&format!("install-progress:{}", workspace_id), &progress);

    // Run install command
    let output = Command::new(pkg_manager.install_command())
        .args(pkg_manager.install_args())
        .current_dir(root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run {}: {}", pkg_manager.install_command(), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let progress = InstallProgress {
            status: InstallStatus::Error,
            package_manager: pkg_manager.install_command().to_string(),
            message: format!("Install failed: {}", stderr),
        };
        let _ = app_handle.emit(&format!("install-progress:{}", workspace_id), &progress);
        return Err(format!("Install failed: {}", stderr));
    }

    // Emit install completed event
    let progress = InstallProgress {
        status: InstallStatus::Completed,
        package_manager: pkg_manager.install_command().to_string(),
        message: "Dependencies installed successfully".to_string(),
    };
    let _ = app_handle.emit(&format!("install-progress:{}", workspace_id), &progress);

    Ok(())
}

#[tauri::command]
pub async fn open_workspace_dialog(app: AppHandle) -> Result<String, String> {
    let folder = app.dialog()
        .file()
        .set_title("Select Workspace Folder")
        .blocking_pick_folder();
    
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("No folder selected".into()),
    }
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
    if !Path::new(&pkg_json_path).exists() {
        runner.port_allocator.lock().unwrap().release(port);
        return Err("package.json not found in workspace".to_string());
    }

    // 4. Detect package manager
    let pkg_manager = PackageManager::detect(&root_path);

    // 5. Check if node_modules exists, auto-install if missing
    let node_modules_path = format!("{}/node_modules", root_path);
    if !Path::new(&node_modules_path).exists() {
        // Auto-install dependencies
        if let Err(e) = install_dependencies(&root_path, &pkg_manager, &app_handle, &workspace_id) {
            runner.port_allocator.lock().unwrap().release(port);
            return Err(e);
        }
    }

    // 6. Start dev server using detected package manager
    let dev_args = pkg_manager.dev_args(port);
    let mut child = Command::new(pkg_manager.install_command())
        .args(&dev_args)
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

    // 7. Store process handle
    let handle = ProcessHandle {
        workspace_id: workspace_id.clone(),
        child: Arc::new(Mutex::new(Some(child))),
        port,
        status: ProcessStatus::Starting,
        logs: vec![],
    };

    runner
        .processes
        .lock()
        .unwrap()
        .insert(workspace_id.clone(), handle);

    // 8. Spawn log readers
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

    // 9. Update status to Running after a short delay (simulate startup)
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
    if let Some(handle) = processes.remove(&workspace_id) {
        if let Some(mut child) = handle.child.lock().unwrap().take() {
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
    _workspace_id: String,
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
    _workspace_id: String,
    root_path: String,
    app: AppHandle,
) -> Result<bool, String> {
    let message = format!(
        "Build Studio will run code from:\n{}\n\n\
        This may execute arbitrary commands. Only proceed if you trust this workspace.",
        root_path
    );

    let result = app.dialog()
        .message(message)
        .title("Security Warning")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show_with_result();

    Ok(matches!(result, MessageDialogResult::Ok))
}

/// Explicitly install dependencies in a workspace
#[tauri::command]
pub async fn workspace_install_deps(
    workspace_id: String,
    root_path: String,
    app_handle: AppHandle,
) -> Result<InstallProgress, String> {
    // Check package.json exists
    let pkg_json_path = format!("{}/package.json", root_path);
    if !Path::new(&pkg_json_path).exists() {
        return Err("package.json not found in workspace".to_string());
    }

    // Detect package manager
    let pkg_manager = PackageManager::detect(&root_path);

    // Emit install started
    let progress = InstallProgress {
        status: InstallStatus::Installing,
        package_manager: pkg_manager.install_command().to_string(),
        message: format!("Installing dependencies with {}...", pkg_manager.install_command()),
    };
    let _ = app_handle.emit(&format!("install-progress:{}", workspace_id), &progress);

    // Run install
    install_dependencies(&root_path, &pkg_manager, &app_handle, &workspace_id)?;

    Ok(InstallProgress {
        status: InstallStatus::Completed,
        package_manager: pkg_manager.install_command().to_string(),
        message: "Dependencies installed successfully".to_string(),
    })
}

/// Detect the package manager used in a workspace
#[tauri::command]
pub async fn detect_package_manager(root_path: String) -> Result<String, String> {
    let pkg_manager = PackageManager::detect(&root_path);
    Ok(pkg_manager.install_command().to_string())
}

/// Check if dependencies are installed in a workspace
#[tauri::command]
pub async fn check_deps_installed(root_path: String) -> Result<bool, String> {
    let node_modules_path = format!("{}/node_modules", root_path);
    Ok(Path::new(&node_modules_path).exists())
}
