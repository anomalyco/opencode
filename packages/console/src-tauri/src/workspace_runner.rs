use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::thread;
use std::fs;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

/// Port range for dev servers
const PORT_MIN: u16 = 3000;
const PORT_MAX: u16 = 4000;

/// Trusted workspaces file name
const TRUSTED_WORKSPACES_FILE: &str = "trusted_workspaces.json";

/// Trusted workspaces storage
#[derive(Clone, Debug, Serialize, Deserialize)]
struct TrustedWorkspaces {
    trusted_paths: Vec<String>,
}

impl TrustedWorkspaces {
    fn new() -> Self {
        Self {
            trusted_paths: Vec::new(),
        }
    }

    fn is_trusted(&self, path: &str) -> bool {
        self.trusted_paths.iter().any(|p| p == path)
    }

    fn add_trusted(&mut self, path: String) {
        if !self.is_trusted(&path) {
            self.trusted_paths.push(path);
        }
    }
}

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
    trusted_workspaces: Arc<Mutex<TrustedWorkspaces>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
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

/// Parse port number from dev server output
/// Supports formats like:
/// - "Local:   http://localhost:5173/"
/// - "listening on http://localhost:3000"
/// - "started server on 0.0.0.0:3000"
/// - "Server running at http://127.0.0.1:8080"
fn parse_port_from_output(line: &str) -> Option<u16> {
    // Try to find a URL pattern first
    if let Some(url_start) = line.find("http://") {
        let url_part = &line[url_start..];
        // Find the port after the host
        if let Some(colon_pos) = url_part[7..].find(':') {
            let port_start = 7 + colon_pos + 1;
            let port_str: String = url_part[port_start..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = port_str.parse::<u16>() {
                return Some(port);
            }
        }
    }
    
    // Try to find https:// pattern
    if let Some(url_start) = line.find("https://") {
        let url_part = &line[url_start..];
        if let Some(colon_pos) = url_part[8..].find(':') {
            let port_start = 8 + colon_pos + 1;
            let port_str: String = url_part[port_start..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = port_str.parse::<u16>() {
                return Some(port);
            }
        }
    }
    
    // Try pattern like "0.0.0.0:3000" or "127.0.0.1:8080"
    for pattern in ["0.0.0.0:", "127.0.0.1:", "localhost:"] {
        if let Some(pos) = line.find(pattern) {
            let port_start = pos + pattern.len();
            let port_str: String = line[port_start..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = port_str.parse::<u16>() {
                return Some(port);
            }
        }
    }
    
    None
}

/// Load trusted workspaces from file
fn load_trusted_workspaces(app_handle: &AppHandle) -> TrustedWorkspaces {
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return TrustedWorkspaces::new(),
    };

    let trusted_file_path = app_data_dir.join(TRUSTED_WORKSPACES_FILE);
    
    if !trusted_file_path.exists() {
        return TrustedWorkspaces::new();
    }

    match fs::read_to_string(&trusted_file_path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_else(|_| TrustedWorkspaces::new())
        }
        Err(_) => TrustedWorkspaces::new(),
    }
}

/// Save trusted workspaces to file
fn save_trusted_workspaces(app_handle: &AppHandle, trusted: &TrustedWorkspaces) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure the directory exists
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }

    let trusted_file_path = app_data_dir.join(TRUSTED_WORKSPACES_FILE);
    
    let json = serde_json::to_string_pretty(trusted)
        .map_err(|e| format!("Failed to serialize trusted workspaces: {}", e))?;

    fs::write(&trusted_file_path, json)
        .map_err(|e| format!("Failed to write trusted workspaces file: {}", e))?;

    Ok(())
}

impl WorkspaceRunner {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            port_allocator: Arc::new(Mutex::new(PortAllocator::new())),
            trusted_workspaces: Arc::new(Mutex::new(TrustedWorkspaces::new())),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Initialize the runner with app handle and load trusted workspaces
    pub fn init(&self, app_handle: AppHandle) {
        // Store app handle
        *self.app_handle.lock().unwrap() = Some(app_handle.clone());
        
        // Load trusted workspaces
        let trusted = load_trusted_workspaces(&app_handle);
        *self.trusted_workspaces.lock().unwrap() = trusted;
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
        // Force unbuffered/colored output - many CLI tools buffer output when not in a TTY
        .env("FORCE_COLOR", "1")           // Force colored output (triggers streaming in many tools)
        .env("CI", "false")                 // Not in CI mode
        .env("NO_COLOR", "")                // Clear NO_COLOR if set
        .env("TERM", "xterm-256color")      // Emulate terminal
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

    // 8. Spawn log readers that also detect server ready state
    let server_ready = Arc::new(Mutex::new(false));
    
    if let Some(stdout) = stdout {
        let workspace_id_clone = workspace_id.clone();
        let app_handle_clone = app_handle.clone();
        let processes_clone = runner.processes.clone();
        let server_ready_clone = server_ready.clone();
        let allocated_port = port;
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Try to parse the actual URL/port from the server output
                    // Common formats:
                    // - "Local:   http://localhost:5173/"
                    // - "listening on http://localhost:3000"
                    // - "started server on 0.0.0.0:3000"
                    let actual_port = parse_port_from_output(&line).unwrap_or(allocated_port);
                    
                    // Check if the server is ready (common patterns from dev servers)
                    let is_ready = line.contains("Local:") 
                        || line.contains("ready in")
                        || line.contains("listening on")
                        || line.contains("started server on")
                        || line.contains("Server running");
                    
                    if is_ready && !*server_ready_clone.lock().unwrap() {
                        *server_ready_clone.lock().unwrap() = true;
                        
                        // Update status and port to Running
                        {
                            let mut processes = processes_clone.lock().unwrap();
                            if let Some(handle) = processes.get_mut(&workspace_id_clone) {
                                handle.status = ProcessStatus::Running;
                                // Update port if we detected a different one
                                if actual_port != allocated_port {
                                    handle.port = actual_port;
                                }
                            }
                        }
                        
                        // Get the updated port
                        let final_port = processes_clone.lock().unwrap()
                            .get(&workspace_id_clone)
                            .map(|h| h.port)
                            .unwrap_or(actual_port);
                        
                        // Emit status change event with correct port
                        let status_info = DevServerInfo {
                            url: format!("http://localhost:{}", final_port),
                            port: final_port,
                            status: ProcessStatus::Running,
                        };
                        let _ = app_handle_clone.emit(&format!("dev-status:{}", workspace_id_clone), &status_info);
                    }
                    
                    // Detect runtime errors (errors that happen after server starts)
                    // These often appear in stdout, not stderr
                    let is_error = line.contains("Internal server error") 
                        || line.contains("[vite] Internal server error")
                        || line.contains("error:")
                        || line.contains("Error:");
                    
                    let log = LogEntry {
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        level: if is_error { LogLevel::Error } else { LogLevel::Info },
                        message: line,
                    };
                    let _ = app_handle_clone.emit(&format!("dev-log:{}", workspace_id_clone), &log);
                }
            }
        });
    }

    // Channel to collect stderr lines for error reporting
    let (error_tx, error_rx) = std::sync::mpsc::channel::<String>();
    
    if let Some(stderr) = stderr {
        let workspace_id_clone = workspace_id.clone();
        let app_handle_clone = app_handle.clone();
        let error_tx_clone = error_tx.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Send error line to the error collector
                    let _ = error_tx_clone.send(line.clone());
                    
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
    
    // Drop the original sender so the receiver knows when stderr is closed
    drop(error_tx);

    // 9. Spawn process monitor to detect crashes/exits
    let processes_clone = runner.processes.clone();
    let port_allocator_clone = runner.port_allocator.clone();
    let workspace_id_clone = workspace_id.clone();
    let app_handle_clone = app_handle.clone();
    let child_arc = runner.processes.lock().unwrap()
        .get(&workspace_id)
        .map(|h| h.child.clone())
        .unwrap();
    
    thread::spawn(move || {
        // Collect stderr lines for error message
        let mut error_lines: Vec<String> = Vec::new();
        while let Ok(line) = error_rx.recv() {
            error_lines.push(line);
            // Keep only last 20 lines to avoid memory issues
            if error_lines.len() > 20 {
                error_lines.remove(0);
            }
        }
        
        // Wait for the process to exit
        if let Some(mut child) = child_arc.lock().unwrap().take() {
            match child.wait() {
                Ok(exit_status) => {
                    let mut processes = processes_clone.lock().unwrap();
                    if let Some(handle) = processes.get_mut(&workspace_id_clone) {
                        // Only update if not already stopped (e.g., by user)
                        if handle.status != ProcessStatus::Stopped {
                            let error_msg = if error_lines.is_empty() {
                                format!("Process exited with status: {}", exit_status)
                            } else {
                                error_lines.join("\n")
                            };
                            
                            handle.status = ProcessStatus::Error(error_msg.clone());
                            
                            // Emit status change event
                            let status_info = DevServerInfo {
                                url: format!("http://localhost:{}", handle.port),
                                port: handle.port,
                                status: ProcessStatus::Error(error_msg),
                            };
                            let _ = app_handle_clone.emit(&format!("dev-status:{}", workspace_id_clone), &status_info);
                        }
                    }
                    // Release port
                    if let Some(handle) = processes.get(&workspace_id_clone) {
                        port_allocator_clone.lock().unwrap().release(handle.port);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to wait for process: {}", e);
                }
            }
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
    runner: tauri::State<'_, WorkspaceRunner>,
    app: AppHandle,
) -> Result<bool, String> {
    // Check if workspace is already trusted
    {
        let trusted = runner.trusted_workspaces.lock().unwrap();
        if trusted.is_trusted(&root_path) {
            return Ok(true);
        }
    }

    // Show security warning dialog
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

    let granted = matches!(result, MessageDialogResult::Ok);

    // If user granted permission, add to trusted list and save
    if granted {
        {
            let mut trusted = runner.trusted_workspaces.lock().unwrap();
            trusted.add_trusted(root_path.clone());
            
            // Save to file
            if let Err(e) = save_trusted_workspaces(&app, &trusted) {
                eprintln!("Warning: Failed to save trusted workspaces: {}", e);
                // Don't fail the operation, just log the warning
            }
        }
    }

    Ok(granted)
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
