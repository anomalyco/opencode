use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(not(target_os = "windows"))]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::path::BaseDirectory;
use tauri::{
    AppHandle, Manager, State,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const DEFAULT_BOOTSTRAP_PORT: u16 = 4096;
const INSTALL_WAIT_SECONDS: u64 = 2;
const HEALTH_CHECK_MAX_ATTEMPTS: u32 = 10;
const HEALTH_CHECK_DELAY_MS: u64 = 500;
const BOOTSTRAP_RETRY_PORT_OFFSET_MAX: u16 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfigHost {
    pub name: String,
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_config_mode: Option<String>,
    pub remote_server_ports: Vec<u16>,
    pub remote_host: String,
    pub bootstrap_enabled: bool,
    pub auto_reconnect: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<String>,
}

fn get_profiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .resolve("ssh-profiles", BaseDirectory::AppLocalData)
        .map_err(|e| format!("Failed to resolve profiles directory: {}", e))?;
    Ok(base)
}

struct SshCommandBuilder {
    args: Vec<String>,
    host_string: String,
    password: Option<String>,
}

impl SshCommandBuilder {
    fn new(profile: &ConnectionProfile, password: Option<&str>) -> Self {
        let mut args = Vec::new();
        let is_isolation = profile.ssh_config_mode.as_deref() == Some("isolation");
        
        if let Some(pwd) = password {
            args.push("sshpass".to_string());
            args.push("-p".to_string());
            args.push(pwd.to_string());
            args.push("ssh".to_string());
        }
        
        if is_isolation {
            #[cfg(target_os = "windows")]
            {
                args.push("-F".to_string());
                args.push("NUL".to_string());
            }
            #[cfg(not(target_os = "windows"))]
            {
                args.push("-F".to_string());
                args.push("/dev/null".to_string());
            }
        }
        
        if is_isolation && password.is_none() {
            args.push("-o".to_string());
            args.push("BatchMode=yes".to_string());
        }
        
        if is_isolation || !profile.id.starts_with("ssh-config-") {
            args.push("-o".to_string());
            args.push("StrictHostKeyChecking=yes".to_string());
        }
        
        if is_isolation || !profile.id.starts_with("ssh-config-") {
            if let Some(port) = profile.port {
                if port != 22 {
                    args.push("-p".to_string());
                    args.push(port.to_string());
                }
            }
            
            if let Some(ref identity_file) = profile.identity_file {
                args.push("-i".to_string());
                args.push(identity_file.clone());
            }
            
            if let Some(ref proxy_jump) = profile.proxy_jump {
                args.push("-J".to_string());
                args.push(proxy_jump.clone());
            }
        }
        
        let host_string = if is_isolation {
            if let Some(ref user) = profile.user {
                format!("{}@{}", user, profile.host)
            } else {
                profile.host.clone()
            }
        } else {
            if profile.id.starts_with("ssh-config-") {
                let ssh_config_alias = profile.id.strip_prefix("ssh-config-").unwrap_or(&profile.id);
                ssh_config_alias.to_string()
            } else {
                if let Some(ref user) = profile.user {
                    format!("{}@{}", user, profile.host)
                } else {
                    profile.host.clone()
                }
            }
        };
        
        Self {
            args,
            host_string,
            password: password.map(|s| s.to_string()),
        }
    }
    
    fn build_tunnel_command(mut self, local_port: u16, remote_port: u16) -> Vec<String> {
        self.args.push("-N".to_string());
        self.args.push("-T".to_string());
        self.args.push("-o".to_string());
        self.args.push("ExitOnForwardFailure=yes".to_string());
        self.args.push("-L".to_string());
        self.args.push(format!("127.0.0.1:{}:127.0.0.1:{}", local_port, remote_port));
        self.args.push(self.host_string);
        self.args
    }
    
    fn build_exec_command(mut self, command: &str) -> Vec<String> {
        self.args.push("-T".to_string());
        self.args.push(self.host_string);
        self.args.push("bash".to_string());
        self.args.push("-c".to_string());
        self.args.push(command.to_string());
        self.args
    }
    
    fn get_command_tool(&self) -> &str {
        if self.password.is_some() {
            "sshpass"
        } else {
            "ssh"
        }
    }
}

#[tauri::command]
pub async fn ssh_list_profiles(app: AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let profiles_dir = get_profiles_dir(&app)?;

    if !profiles_dir.exists() {
        fs::create_dir_all(&profiles_dir).map_err(|e| format!("Failed to create profiles directory: {}", e))?;
    }

    let mut profiles = Vec::new();

    for entry in fs::read_dir(&profiles_dir).map_err(|e| format!("Failed to read profiles directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(profile) = serde_json::from_str::<ConnectionProfile>(&content) {
                    profiles.push(profile);
                }
            }
        }
    }

    profiles.sort_by(|a, b| {
        let a_time = a
            .last_used
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&a.created_at);
        let b_time = b
            .last_used
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or(&b.created_at);
        b_time.cmp(a_time)
    });

    Ok(profiles)
}

#[tauri::command]
pub async fn ssh_get_profile(app: AppHandle, id: String) -> Result<Option<ConnectionProfile>, String> {
    let profiles_dir = get_profiles_dir(&app)?;
    let profile_path = profiles_dir.join(format!("{}.json", id));

    if !profile_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read profile file: {}", e))?;

    let profile: ConnectionProfile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse profile: {}", e))?;

    Ok(Some(profile))
}

#[tauri::command]
pub async fn ssh_save_profile(app: AppHandle, profile: ConnectionProfile) -> Result<(), String> {
    if profile.id.is_empty() {
        return Err("Profile ID cannot be empty".to_string());
    }
    if profile.name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }
    if profile.host.is_empty() {
        return Err("Profile host cannot be empty".to_string());
    }

    let profiles_dir = get_profiles_dir(&app)?;

    if !profiles_dir.exists() {
        fs::create_dir_all(&profiles_dir).map_err(|e| format!("Failed to create profiles directory: {}", e))?;
    }

    let profile_path = profiles_dir.join(format!("{}.json", profile.id));
    let content = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Failed to serialize profile: {}", e))?;

    fs::write(&profile_path, content).map_err(|e| format!("Failed to write profile file: {}", e))?;
    
    #[cfg(not(target_os = "windows"))]
    {
        let mut perms = fs::metadata(&profile_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&profile_path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_delete_profile(app: AppHandle, id: String) -> Result<(), String> {
    let profiles_dir = get_profiles_dir(&app)?;
    let profile_path = profiles_dir.join(format!("{}.json", id));

    if !profile_path.exists() {
        return Err("Profile not found".to_string());
    }

    fs::remove_file(&profile_path).map_err(|e| format!("Failed to delete profile: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_get_profiles_dir(app: AppHandle) -> Result<String, String> {
    let profiles_dir = get_profiles_dir(&app)?;
    Ok(profiles_dir.to_string_lossy().to_string())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub profile_id: String,
    pub state: String,
    pub local_endpoint: Option<serde_json::Value>,
    pub server_info: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub created_at: String,
    pub connected_at: Option<String>,
}

pub struct SshConnectionState {
    pub connections: Arc<Mutex<HashMap<String, (Connection, Option<CommandChild>)>>>,
}

impl SshConnectionState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn allocate_local_port() -> Result<u16, String> {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind to port: {}", e))?;
    let addr = listener.local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;
    Ok(addr.port())
}

fn build_ssh_command(profile: &ConnectionProfile, local_port: u16, remote_port: u16, password: Option<&str>) -> Vec<String> {
    let builder = SshCommandBuilder::new(profile, password);
    builder.build_tunnel_command(local_port, remote_port)
}

async fn discover_remote_port(app: &AppHandle, profile: &ConnectionProfile, password: Option<&str>) -> Option<u16> {
    let discovery_commands = vec![
        r#"ps aux | grep -E '[o]pencode.*serve|[b]un.*serve|[o]pencode.*start' | grep -oE '--port=[0-9]+|--port [0-9]+' | head -1 | grep -oE '[0-9]+'"#,
        r#"pgrep -fl 'opencode.*serve|bun.*serve|opencode.*start' | grep -oE '--port=[0-9]+|--port [0-9]+' | head -1 | grep -oE '[0-9]+'"#,
        r#"ss -tlnp 2>/dev/null | grep -E 'opencode|bun' | awk '{print $4}' | cut -d: -f2 | head -1"#,
        r#"lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E 'opencode|bun' | awk '{print $9}' | cut -d: -f2 | head -1"#,
        r#"netstat -tlnp 2>/dev/null | grep -E 'opencode|bun' | awk '{print $4}' | cut -d: -f2 | head -1"#,
    ];
    
    for cmd in discovery_commands {
        let builder = SshCommandBuilder::new(profile, password);
        let cmd_tool = builder.get_command_tool().to_string();
        let ssh_args = builder.build_exec_command(cmd);
        
        let output = app
            .shell()
            .command(cmd_tool)
            .args(&ssh_args)
            .output()
            .await;
        
        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let port_str = stdout.trim();
                if let Ok(port) = port_str.parse::<u16>() {
                    if port > 0 {
                        return Some(port);
                    }
                }
            }
        }
    }
    
    None
}

#[tauri::command]
pub async fn ssh_check_sshpass_available(app: AppHandle) -> Result<bool, String> {
    let output = app
        .shell()
        .command("which")
        .args(&["sshpass"])
        .output()
        .await
        .map_err(|e| format!("Failed to check for sshpass: {}", e))?;
    
    Ok(output.status.success())
}

async fn test_ssh_connectivity(
    app: &AppHandle,
    profile: &ConnectionProfile,
    password: Option<&str>,
) -> Result<(), String> {
    eprintln!("[SSH Bootstrap] Testing SSH connectivity to {}@{}", 
        profile.user.as_ref().unwrap_or(&"".to_string()), profile.host);
    
    let builder = SshCommandBuilder::new(profile, password);
    let cmd = builder.get_command_tool().to_string();
    let mut ssh_args = builder.args.clone();
    ssh_args.push("-T".to_string());
    ssh_args.push(builder.host_string.clone());
    ssh_args.push("echo".to_string());
    ssh_args.push("test".to_string());
    
    let ssh_cmd_display: String = ssh_args.iter().map(|s| {
        if s.starts_with("-i") || s.starts_with("-J") || s == "-i" || s == "-J" || s == "sshpass" || (s == "-p" && password.is_some()) {
            "[redacted]"
        } else if s == &builder.host_string {
            &builder.host_string
        } else {
            s.as_str()
        }
    }).collect::<Vec<_>>().join(" ");
    eprintln!("[SSH Bootstrap] SSH connectivity test command: {} {}", cmd, ssh_cmd_display);
    
    let output = app
        .shell()
        .command(cmd)
        .args(&ssh_args)
        .output()
        .await
        .map_err(|e| format!("Failed to test SSH connectivity: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_trimmed = stderr.trim();
        
        if stderr_trimmed.contains("Connection closed") || stderr_trimmed.contains("kex_exchange_identification") {
            let config_mode = profile.ssh_config_mode.as_deref().unwrap_or("pass-through");
            let auth_hint = if config_mode == "pass-through" {
                " For SSH config profiles with passphrase-protected keys, load the key into SSH agent first: 'ssh-add ~/.ssh/id_rsa' (or your key file). Alternatively, (1) Add IdentityFile to SSH config, or (2) If password auth is needed, install sshpass."
            } else {
                " Ensure key-based authentication is configured. If using passphrase-protected keys, load them into SSH agent with 'ssh-add'."
            };
            return Err(format!("SSH connectivity test failed: Connection closed. This may indicate a passphrase-protected key that needs to be loaded into SSH agent.{auth_hint} Verify SSH config, ProxyJump, identity file, or remote server settings. Status: {:?}, Stderr: {}", 
                output.status.code(), stderr_trimmed));
        }
        if stderr_trimmed.contains("Permission denied") || stderr_trimmed.contains("password") || stderr_trimmed.contains("Authentication failed") {
            if password.is_none() {
                return Err(format!("SSH_PASSWORD_REQUIRED:SSH authentication failed. Password may be required. Stderr: {}", stderr_trimmed));
            }
            return Err(format!("SSH authentication failed even with password. Verify credentials. Stderr: {}", stderr_trimmed));
        }
        let _stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("SSH connectivity test failed: {}", stderr_trimmed));
    }
    
    eprintln!("[SSH Bootstrap] SSH connectivity test passed");
    Ok(())
}

async fn install_opencode(
    app: &AppHandle,
    profile: &ConnectionProfile,
    password: Option<&str>,
) -> Result<(), String> {
    eprintln!("[SSH Bootstrap] Installing opencode on {}@{}", 
        profile.user.as_ref().unwrap_or(&"".to_string()), profile.host);
    
    test_ssh_connectivity(app, profile, password).await?;
    
    let install_cmd = format!(
        r#"set +x; set -e; \
           TMPFILE=$(mktemp) || {{ echo 'Failed to create temp file' >&2; exit 1; }}; \
           trap 'rm -f "$TMPFILE"' EXIT; \
           curl -fsSL https://opencode.ai/install -o "$TMPFILE" || {{ echo 'Failed to download install script' >&2; exit 1; }}; \
           bash "$TMPFILE" || {{ echo 'Install script execution failed' >&2; exit 1; }}"#
    );
    
    let builder = SshCommandBuilder::new(profile, password);
    let host_string = builder.host_string.clone();
    let cmd = builder.get_command_tool().to_string();
    let ssh_args = builder.build_exec_command(&install_cmd);
    
    let config_mode = profile.ssh_config_mode.as_deref().unwrap_or("pass-through");
    let has_proxy_jump = profile.proxy_jump.is_some();
    let has_identity = profile.identity_file.is_some();
    let port = profile.port.unwrap_or(22);
    
    eprintln!("[SSH Bootstrap] SSH config mode: {}, ProxyJump: {}, IdentityFile: {}, Port: {}", 
        config_mode, has_proxy_jump, has_identity, port);
    
    let ssh_cmd_display: String = ssh_args.iter().map(|s| {
        if s.starts_with("-i") || s.starts_with("-J") || s == "-i" || s == "-J" || s == "sshpass" || (s == "-p" && password.is_some()) {
            "[redacted]"
        } else if s == &host_string {
            &host_string
        } else {
            s.as_str()
        }
    }).collect::<Vec<_>>().join(" ");
    eprintln!("[SSH Bootstrap] Full SSH command: {}", ssh_cmd_display);
    eprintln!("[SSH Bootstrap] Debug: ssh_args count={}, last arg length={}", 
        ssh_args.len(), 
        ssh_args.last().map(|s| s.len()).unwrap_or(0));
    let output = app
        .shell()
        .command(cmd)
        .args(&ssh_args)
        .output()
        .await
        .map_err(|e| format!("Failed to install opencode: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    eprintln!("[SSH Bootstrap] Install command completed: status={:?}, stdout length={}, stderr length={}", 
        output.status.code(), stdout.len(), stderr.len());
    if !stdout.trim().is_empty() {
        eprintln!("[SSH Bootstrap] Install stdout: {}", stdout);
    }
    if !stderr.trim().is_empty() {
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.len() > 200 {
            eprintln!("[SSH Bootstrap] Install stderr (first 200 chars): {}", &stderr_trimmed[..200]);
            eprintln!("[SSH Bootstrap] Install stderr (last 200 chars): {}", &stderr_trimmed[stderr_trimmed.len().saturating_sub(200)..]);
        } else {
            eprintln!("[SSH Bootstrap] Install stderr: {}", stderr_trimmed);
        }
    }
    
    if !output.status.success() {
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.contains("Connection closed") {
            return Err(format!("SSH session closed unexpectedly (transport/session failure). Check SSH config, ProxyJump, identity file, or remote ForceCommand. Status: {:?}, Stderr: {}", 
                output.status.code(), stderr_trimmed));
        }
        if stderr_trimmed.contains("Permission denied") || stderr_trimmed.contains("password") || stderr_trimmed.contains("Authentication failed") {
            if password.is_none() {
                return Err(format!("SSH_PASSWORD_REQUIRED:SSH authentication failed during installation. Password may be required. Stderr: {}", stderr_trimmed));
            }
            return Err(format!("SSH authentication failed even with password. Verify credentials. Stderr: {}", stderr_trimmed));
        }
        eprintln!("[SSH Bootstrap] Installation failed: stdout={:?}, stderr={:?}", stdout, stderr);
        return Err(format!("Installation failed with status {:?}: {}", output.status.code(), stderr_trimmed));
    }
    
    eprintln!("[SSH Bootstrap] Installation command succeeded, waiting {} seconds for installation to complete...", INSTALL_WAIT_SECONDS);
    tokio::time::sleep(tokio::time::Duration::from_secs(INSTALL_WAIT_SECONDS)).await;
    
    let verify_cmd = format!(
        "set +x; export PATH=\"$HOME/.opencode/bin:$PATH\" 2>/dev/null; \
         if [ -f \"$HOME/.opencode/bin/opencode\" ] && [ -x \"$HOME/.opencode/bin/opencode\" ]; then \
           \"$HOME/.opencode/bin/opencode\" --version >/dev/null 2>&1 && echo 'found:$HOME/.opencode/bin/opencode'; \
         elif command -v opencode >/dev/null 2>&1; then \
           opencode --version >/dev/null 2>&1 && echo 'found:opencode'; \
         else \
           echo 'not_found' >&2; \
           if [ -d \"$HOME/.opencode/bin\" ]; then \
             ls -la \"$HOME/.opencode/bin/\" >&2; \
           else \
             echo 'Directory $HOME/.opencode/bin does not exist' >&2; \
           fi; \
           exit 1; \
         fi"
    );
    
    let verify_builder = SshCommandBuilder::new(profile, password);
    let verify_cmd_tool = verify_builder.get_command_tool().to_string();
    let verify_ssh_args = verify_builder.build_exec_command(&verify_cmd);
    let verify_output = app
        .shell()
        .command(verify_cmd_tool)
        .args(&verify_ssh_args)
        .output()
        .await;
    
    if let Ok(verify) = verify_output {
        let stdout = String::from_utf8_lossy(&verify.stdout);
        let stderr = String::from_utf8_lossy(&verify.stderr);
        if verify.status.success() {
            if stdout.contains("found:") {
                let location = stdout
                    .lines()
                    .find(|line| line.contains("found:"))
                    .map(|line| line.trim())
                    .unwrap_or_else(|| stdout.trim());
                eprintln!("[SSH Bootstrap] Verified: opencode binary found at {}", location);
                eprintln!("[SSH Bootstrap] Note: Binary is installed but not in PATH. Use full path: {}", 
                    location.replace("found:", "").trim());
            } else {
                eprintln!("[SSH Bootstrap] Verified: opencode binary exists and is executable");
            }
        } else {
            eprintln!("[SSH Bootstrap] Warning: opencode binary not found or not executable after installation");
            if !stderr.is_empty() {
                eprintln!("[SSH Bootstrap] Verification stderr: {}", stderr);
            }
            if !stdout.is_empty() {
                eprintln!("[SSH Bootstrap] Verification stdout: {}", stdout);
            }
            eprintln!("[SSH Bootstrap] This may indicate the installation failed silently or the binary is in an unexpected location");
        }
    } else {
        eprintln!("[SSH Bootstrap] Warning: Failed to verify opencode installation");
    }
    
    Ok(())
}

async fn ensure_opencode_installed(
    app: &AppHandle,
    profile: &ConnectionProfile,
    password: Option<&str>,
) -> Result<(), String> {
    eprintln!("[SSH Bootstrap] Ensuring opencode is installed on {}@{}", 
        profile.user.as_ref().unwrap_or(&"".to_string()), profile.host);
    
    eprintln!("[SSH Bootstrap] Running install script (it will skip if already installed)...");
    install_opencode(app, profile, password).await?;
    eprintln!("[SSH Bootstrap] Install script completed");
    
    Ok(())
}

async fn bootstrap_server(
    app: &AppHandle,
    profile: &ConnectionProfile,
    port: u16,
    password: Option<&str>,
) -> Result<serde_json::Value, String> {
    eprintln!("[SSH Bootstrap] Starting bootstrap for profile {}@{} on port {}", 
        profile.user.as_ref().unwrap_or(&"".to_string()), profile.host, port);
    
    ensure_opencode_installed(app, profile, password).await?;
    
    let log_file = format!("/tmp/opencode-bootstrap-{}.log", port);
    let pid_file = format!("/tmp/opencode-bootstrap-{}.pid", port);
    let bootstrap_cmd = format!(
        "set +x; export PATH=\"$HOME/.opencode/bin:$PATH\"; \
         if ! command -v \"$HOME/.opencode/bin/opencode\" >/dev/null 2>&1 && ! command -v opencode >/dev/null 2>&1; then \
           DIAG=\"Binary check failed. PATH=$PATH. \"; \
           if [ -d \"$HOME/.opencode/bin\" ]; then \
             DIAG=\"$DIAG Directory exists: $(ls -la $HOME/.opencode/bin/ 2>&1 | head -5). \"; \
           else \
             DIAG=\"$DIAG Directory $HOME/.opencode/bin does not exist. \"; \
           fi; \
           if command -v which >/dev/null 2>&1; then \
             DIAG=\"$DIAG which opencode: $(which opencode 2>&1). \"; \
           fi; \
           echo '{{\"status\":\"error\",\"message\":\"opencode binary not found\",\"diagnostics\":\"'\"$DIAG\"'\"}}' >&2; \
           exit 1; \
         fi; \
         OPENCODE_BIN=\"$HOME/.opencode/bin/opencode\"; \
         if ! command -v \"$OPENCODE_BIN\" >/dev/null 2>&1; then \
           OPENCODE_BIN=\"opencode\"; \
         fi; \
         rm -f {} {}; \
         nohup \"$OPENCODE_BIN\" serve --port={} > {} 2>&1 & echo $! > {}; \
         sleep 4; \
         if [ ! -f {} ]; then \
           echo '{{\"status\":\"error\",\"message\":\"Server process not started\"}}' >&2; exit 1; \
         fi; \
         PID=$(cat {} 2>/dev/null || echo ''); \
         if [ -z \"$PID\" ] || ! kill -0 \"$PID\" 2>/dev/null; then \
           if [ -f {} ]; then \
             LOG_TAIL=$(tail -20 {} 2>/dev/null || echo 'log file not readable'); \
             echo '{{\"status\":\"error\",\"message\":\"Server process died\",\"log\":\"'\"$LOG_TAIL\"'\"}}' >&2; \
           else \
             echo '{{\"status\":\"error\",\"message\":\"Server process died\"}}' >&2; \
           fi; \
           exit 1; \
         fi; \
         if [ -f {} ]; then \
           LISTEN_LINE=$(grep -i 'listening on' {} 2>/dev/null | head -n 1); \
           if echo \"$LISTEN_LINE\" | grep -qE ':(0|[1-9][0-9]{{0,4}}|[1-5][0-9]{{4}}|6[0-4][0-9]{{3}}|65[0-4][0-9]{{2}}|655[0-2][0-9]|6553[0-5])'; then \
             DETECTED_PORT=$(echo \"$LISTEN_LINE\" | grep -oE ':(0|[1-9][0-9]{{0,4}}|[1-5][0-9]{{4}}|6[0-4][0-9]{{3}}|65[0-4][0-9]{{2}}|655[0-2][0-9]|6553[0-5])' | cut -d: -f2 | head -n 1); \
             echo '{{\"status\":\"ok\",\"port\":'\"$DETECTED_PORT\"'}}'; \
           else \
             echo '{{\"status\":\"ok\",\"port\":{}}}'; \
           fi; \
         else \
           echo '{{\"status\":\"ok\",\"port\":{}}}'; \
         fi",
        log_file, pid_file, port, log_file, pid_file, pid_file, pid_file, log_file, log_file, log_file, log_file, port, port
    );
    
    let builder = SshCommandBuilder::new(profile, password);
    let cmd = builder.get_command_tool().to_string();
    let ssh_args = builder.build_exec_command(&bootstrap_cmd);
    
    eprintln!("[SSH Bootstrap] Starting server with command: {}", bootstrap_cmd);
    let bootstrap_cmd_display: String = ssh_args.iter()
        .take(ssh_args.len().saturating_sub(3))
        .map(|s| {
            if s.starts_with("-i") || s.starts_with("-J") || s == "-i" || s == "-J" || s == "sshpass" || (s == "-p" && password.is_some()) {
                "[redacted]"
            } else {
                s.as_str()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    eprintln!("[SSH Bootstrap] Full SSH command: {} {} '{}'", cmd, bootstrap_cmd_display, bootstrap_cmd);
    let output = app
        .shell()
        .command(cmd)
        .args(&ssh_args)
        .output()
        .await
        .map_err(|e| {
            eprintln!("[SSH Bootstrap] Failed to execute bootstrap command: {}", e);
            format!("Failed to execute bootstrap command: {}", e)
        })?;
    
    eprintln!("[SSH Bootstrap] Server start command completed: status={:?}, stdout length={}, stderr length={}", 
        output.status.code(), output.stdout.len(), output.stderr.len());
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr_trimmed = stderr.trim();
        
        if stderr_trimmed.contains("Connection closed") {
            return Err(format!("SSH session closed unexpectedly during server bootstrap (transport/session failure). Check SSH config, ProxyJump, identity file, or remote ForceCommand. Status: {:?}, Stderr: {}", 
                output.status.code(), stderr_trimmed));
        }
        
        let error_msg = if let Ok(json) = serde_json::from_str::<serde_json::Value>(stderr_trimmed) {
            let message = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
            let diagnostics = json.get("diagnostics").and_then(|d| d.as_str());
            let log = json.get("log").and_then(|l| l.as_str());
            
            let mut full_msg = format!("Bootstrap failed: {}", message);
            if let Some(diag) = diagnostics {
                eprintln!("[SSH Bootstrap] Diagnostics: {}", diag);
                full_msg.push_str(&format!("\nDiagnostics: {}", diag));
            }
            if let Some(log_content) = log {
                eprintln!("[SSH Bootstrap] Server log: {}", log_content);
                full_msg.push_str(&format!("\nServer log: {}", log_content));
            }
            full_msg
        } else {
            format!("Bootstrap command failed: {}", stderr_trimmed)
        };
        
        eprintln!("[SSH Bootstrap] Server start failed: stdout={:?}, stderr={:?}", stdout, stderr_trimmed);
        return Err(error_msg);
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    eprintln!("[SSH Bootstrap] Server start stdout: {:?}", stdout);
    
    let stdout_trimmed = stdout.trim();
    let json_str = if stdout_trimmed.starts_with('{') {
        stdout_trimmed.to_string()
    } else if stdout_trimmed.contains("declare -x") || stdout_trimmed.contains("declare ") {
        eprintln!("[SSH Bootstrap] Output contains environment variables, extracting JSON from log file");
        let log_file = format!("/tmp/opencode-bootstrap-{}.log", port);
        let read_log_cmd = format!("if [ -f {} ]; then grep -i 'listening on' {} 2>/dev/null | head -n 1 | grep -oE ':(0|[1-9][0-9]{{0,4}}|[1-5][0-9]{{4}}|6[0-4][0-9]{{3}}|65[0-4][0-9]{{2}}|655[0-2][0-9]|6553[0-5])' | cut -d: -f2 | head -n 1 | xargs -I PORT echo '{{\"status\":\"ok\",\"port\":PORT}}' || echo '{{\"status\":\"ok\",\"port\":{}}}'; else echo '{{\"status\":\"ok\",\"port\":{}}}'; fi", log_file, log_file, port, port);
        
        let read_log_builder = SshCommandBuilder::new(profile, password);
        let read_cmd = read_log_builder.get_command_tool().to_string();
        let read_log_args = read_log_builder.build_exec_command(&read_log_cmd);
        if let Ok(read_output) = app
            .shell()
            .command(read_cmd)
            .args(&read_log_args)
            .output()
            .await
        {
            let log_content = String::from_utf8_lossy(&read_output.stdout).trim().to_string();
            if log_content.starts_with('{') {
                log_content
            } else {
                format!("{{\"status\":\"ok\",\"port\":{}}}", port)
            }
        } else {
            format!("{{\"status\":\"ok\",\"port\":{}}}", port)
        }
    } else {
        eprintln!("[SSH Bootstrap] Output doesn't contain JSON, extracting port from log file");
        let log_file = format!("/tmp/opencode-bootstrap-{}.log", port);
        let read_log_cmd = format!("if [ -f {} ]; then grep -i 'listening on' {} 2>/dev/null | head -n 1 | grep -oE ':(0|[1-9][0-9]{{0,4}}|[1-5][0-9]{{4}}|6[0-4][0-9]{{3}}|65[0-4][0-9]{{2}}|655[0-2][0-9]|6553[0-5])' | cut -d: -f2 | head -n 1 | xargs -I PORT echo '{{\"status\":\"ok\",\"port\":PORT}}' || echo '{{\"status\":\"ok\",\"port\":{}}}'; else echo '{{\"status\":\"ok\",\"port\":{}}}'; fi", log_file, log_file, port, port);
        
        let read_log_builder = SshCommandBuilder::new(profile, password);
        let read_cmd = read_log_builder.get_command_tool().to_string();
        let read_log_args = read_log_builder.build_exec_command(&read_log_cmd);
        if let Ok(read_output) = app
            .shell()
            .command(read_cmd)
            .args(&read_log_args)
            .output()
            .await
        {
            let log_content = String::from_utf8_lossy(&read_output.stdout).trim().to_string();
            if log_content.starts_with('{') {
                log_content
            } else {
                format!("{{\"status\":\"ok\",\"port\":{}}}", port)
            }
        } else {
            format!("{{\"status\":\"ok\",\"port\":{}}}", port)
        }
    };
    
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .unwrap_or_else(|e| {
            eprintln!("[SSH Bootstrap] Failed to parse JSON: {}, json_str was: {:?}, using fallback", e, json_str);
            serde_json::json!({
                "status": "ok",
                "port": port
            })
        });
    
    eprintln!("[SSH Bootstrap] Parsed JSON: {:?}", json);
    
    if !json.is_object() {
        return Err("Bootstrap output is not a JSON object".to_string());
    }
    
    let bootstrap_status = json.get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("unknown");
    
    if bootstrap_status != "ok" {
        let error_msg = json.get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        eprintln!("[SSH Bootstrap] Bootstrap returned non-ok status: {} - {}", bootstrap_status, error_msg);
        return Err(format!("Bootstrap failed: {}", error_msg));
    }
    
    let bootstrap_port = json.get("port")
        .and_then(|p| p.as_u64())
        .map(|p| p as u16)
        .ok_or_else(|| "Bootstrap output missing required 'port' field".to_string())?;
    
    eprintln!("[SSH Bootstrap] Bootstrap command succeeded, verifying server is running on port {}...", bootstrap_port);
    
    let verify_health_cmd = format!("curl -sf http://127.0.0.1:{}/global/health 2>/dev/null | grep -q '\"healthy\"' && echo 'healthy' || echo 'unhealthy'", bootstrap_port);
    
    let verify_builder = SshCommandBuilder::new(profile, password);
    let verify_cmd = verify_builder.get_command_tool().to_string();
    let verify_ssh_args = verify_builder.build_exec_command(&verify_health_cmd);
    let mut server_healthy = false;
    for attempt in 0..HEALTH_CHECK_MAX_ATTEMPTS {
        if let Ok(verify_output) = app
            .shell()
            .command(&verify_cmd)
            .args(&verify_ssh_args)
            .output()
            .await
        {
            let verify_stdout_raw = String::from_utf8_lossy(&verify_output.stdout);
            let verify_stdout = verify_stdout_raw.trim();
            if verify_stdout == "healthy" {
                server_healthy = true;
                eprintln!("[SSH Bootstrap] Server health check passed on port {}", bootstrap_port);
                break;
            }
        }
        if attempt < (HEALTH_CHECK_MAX_ATTEMPTS - 1) {
            tokio::time::sleep(tokio::time::Duration::from_millis(HEALTH_CHECK_DELAY_MS)).await;
        }
    }
    
    if !server_healthy {
        return Err(format!("Bootstrap reported success but server health check failed on port {}. Server may not have started correctly.", bootstrap_port));
    }
    
    eprintln!("[SSH Bootstrap] Bootstrap succeeded and verified! Server running on port {}", bootstrap_port);
    
    Ok(json)
}

struct SuccessfulConnection {
    local_port: u16,
    remote_port: u16,
    child: tauri_plugin_shell::process::CommandChild,
    rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
}

async fn handle_bootstrap_connection(
    app: &AppHandle,
    profile: &mut ConnectionProfile,
    remote_port: Option<u16>,
    password: Option<&str>,
) -> Result<(Option<u16>, Option<SuccessfulConnection>), String> {
    eprintln!("[SSH] Bootstrap enabled, ensuring opencode is installed and server is running");
    ensure_opencode_installed(app, profile, password).await
        .map_err(|e| {
            eprintln!("[SSH] Installation failed: {}", e);
            if e.starts_with("SSH_PASSWORD_REQUIRED:") {
                e
            } else {
                format!("Installation failed: {}. Connection attempt aborted.", e)
            }
        })?;
    
    if remote_port.is_none() {
        eprintln!("[SSH] No configured port, attempting to bootstrap server...");
        let requested_port = DEFAULT_BOOTSTRAP_PORT;
        match bootstrap_server(app, profile, requested_port, password).await {
            Ok(bootstrap_result) => {
                let bootstrap_port = bootstrap_result.get("port")
                    .and_then(|p| p.as_u64())
                    .map(|p| p as u16)
                    .ok_or_else(|| "Bootstrap result missing port field".to_string())?;
                
                let bootstrap_status = bootstrap_result.get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("unknown");
                
                if bootstrap_status != "ok" {
                    return Err(format!("Bootstrap returned non-ok status: {}", bootstrap_status));
                }
                
                eprintln!("[SSH] Bootstrap succeeded, server confirmed running on port {}", bootstrap_port);
                
                if !profile.remote_server_ports.contains(&bootstrap_port) {
                    profile.remote_server_ports = vec![bootstrap_port];
                    ssh_save_profile(app.clone(), profile.clone()).await?;
                }
                
                Ok((Some(bootstrap_port), None))
            }
            Err(e) => {
                eprintln!("[SSH] Bootstrap failed: {}", e);
                Err(format!("Failed to bootstrap server: {}", e))
            }
        }
    } else {
        let configured_port = remote_port.ok_or_else(|| "No remote port configured".to_string())?;
        eprintln!("[SSH] Using configured port {}, verifying server is running...", configured_port);
        match try_port_with_health_check(app, profile, configured_port, password).await {
            Ok(conn) => {
                eprintln!("[SSH] Server verified running on configured port {}", configured_port);
                Ok((Some(configured_port), Some(conn)))
            }
            Err(e) => {
                eprintln!("[SSH] Configured port {} not responding: {}", configured_port, e);
                eprintln!("[SSH] Attempting to bootstrap server on port {}...", configured_port);
                
                let mut ports_to_try = vec![configured_port];
                for port_offset in 1..=BOOTSTRAP_RETRY_PORT_OFFSET_MAX {
                    ports_to_try.push(configured_port.wrapping_add(port_offset));
                }
                
                for try_port in ports_to_try {
                    eprintln!("[SSH] Trying to bootstrap on port {}...", try_port);
                    match bootstrap_server(app, profile, try_port, password).await {
                        Ok(bootstrap_result) => {
                            let bootstrap_port = bootstrap_result.get("port")
                                .and_then(|p| p.as_u64())
                                .map(|p| p as u16)
                                .ok_or_else(|| "Bootstrap result missing port field".to_string())?;
                            
                            let bootstrap_status = bootstrap_result.get("status")
                                .and_then(|s| s.as_str())
                                .unwrap_or("unknown");
                            
                            if bootstrap_status != "ok" {
                                eprintln!("[SSH] Bootstrap on port {} returned non-ok status: {}", try_port, bootstrap_status);
                                continue;
                            }
                            
                            eprintln!("[SSH] Bootstrap succeeded, server confirmed running on port {}", bootstrap_port);
                            
                            if !profile.remote_server_ports.contains(&bootstrap_port) {
                                profile.remote_server_ports = vec![bootstrap_port];
                                ssh_save_profile(app.clone(), profile.clone()).await?;
                            }
                            
                            return Ok((Some(bootstrap_port), None));
                        }
                        Err(bootstrap_err) => {
                            eprintln!("[SSH] Bootstrap failed on port {}: {}", try_port, bootstrap_err);
                            continue;
                        }
                    }
                }
                
                Err(format!("Server not running on configured port {} and bootstrap failed on all attempted ports", configured_port))
            }
        }
    }
}

async fn handle_port_discovery(
    app: &AppHandle,
    profile: &ConnectionProfile,
    remote_port: Option<u16>,
    password: Option<&str>,
) -> Result<u16, String> {
    if let Some(port) = remote_port {
        Ok(port)
    } else {
        eprintln!("[SSH] No configured port and bootstrap disabled, attempting port discovery...");
        if let Some(discovered) = discover_remote_port(app, profile, password).await {
            eprintln!("[SSH] Discovered remote port: {}", discovered);
            Ok(discovered)
        } else {
            Err("No port configured and port discovery failed. Enable bootstrap to automatically start the server.".to_string())
        }
    }
}

async fn fetch_server_info(local_port: u16) -> Option<serde_json::Value> {
    let health_url = format!("http://127.0.0.1:{}/global/health", local_port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    
    match client.get(&health_url).send().await {
        Ok(response) => {
            eprintln!("[SSH] Health check response status: {}", response.status());
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(health_data) => {
                        eprintln!("[SSH] Health check succeeded, server info: {:?}", health_data);
                        Some(health_data)
                    }
                    Err(e) => {
                        eprintln!("[SSH] Failed to parse health check response: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[SSH] Health check failed with status: {}", response.status());
                None
            }
        }
        Err(e) => {
            eprintln!("[SSH] Health check request failed: {}", e);
            None
        }
    }
}

fn setup_connection_monitoring(
    state: State<'_, SshConnectionState>,
    connection_id: String,
    mut rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    let state_clone = state.connections.clone();
    let connection_id_clone = connection_id.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Some(tauri_plugin_shell::process::CommandEvent::Terminated(payload)) => {
                    eprintln!("[SSH] Tunnel terminated for connection {}", connection_id_clone);
                    let mut connections = match state_clone.lock() {
                        Ok(conns) => conns,
                        Err(e) => {
                            eprintln!("[SSH] Failed to lock connections: {}", e);
                            break;
                        }
                    };
                    if let Some((conn, child)) = connections.remove(&connection_id_clone) {
                        if let Some(process) = child {
                            eprintln!("[SSH] Ensuring process is killed for connection {}", connection_id_clone);
                            let _ = process.kill();
                        }
                        if payload.code != Some(0) {
                            let mut updated = conn.clone();
                            updated.state = "failed".to_string();
                            let error_message = match payload.code {
                                Some(255) => "Connection refused by remote host".to_string(),
                                Some(1) => "Connection failed".to_string(),
                                Some(code) if code < 0 => "Connection lost".to_string(),
                                Some(_) => "Connection terminated".to_string(),
                                None => "Connection lost".to_string(),
                            };
                            updated.error = Some(serde_json::json!({
                                "type": "tunnel_error",
                                "message": error_message,
                                "timestamp": chrono::Utc::now().to_rfc3339()
                            }));
                            connections.insert(connection_id_clone.clone(), (updated, None));
                        }
                    }
                    break;
                }
                Some(tauri_plugin_shell::process::CommandEvent::Error(err)) => {
                    eprintln!("[SSH] Connection error for {}: {}", connection_id_clone, err);
                    let mut connections = match state_clone.lock() {
                        Ok(conns) => conns,
                        Err(e) => {
                            eprintln!("[SSH] Failed to lock connections: {}", e);
                            break;
                        }
                    };
                    if let Some((conn, child)) = connections.remove(&connection_id_clone) {
                        if let Some(process) = child {
                            eprintln!("[SSH] Ensuring process is killed after error for connection {}", connection_id_clone);
                            let _ = process.kill();
                        }
                        let mut updated = conn.clone();
                        updated.state = "failed".to_string();
                        let error_message = if err.contains("Connection refused") || err.contains("refused") {
                            "Connection refused by remote host".to_string()
                        } else if err.contains("timeout") || err.contains("Timeout") {
                            "Connection timed out".to_string()
                        } else if err.contains("Host key verification failed") {
                            "Host key verification failed".to_string()
                        } else {
                            "Connection error".to_string()
                        };
                        updated.error = Some(serde_json::json!({
                            "type": "tunnel_error",
                            "message": error_message,
                            "timestamp": chrono::Utc::now().to_rfc3339()
                        }));
                        connections.insert(connection_id_clone.clone(), (updated, None));
                    }
                    break;
                }
                None => {
                    eprintln!("[SSH] Connection receiver closed for {}", connection_id_clone);
                    break;
                }
                _ => {}
            }
        }
    });
}

async fn try_port_with_health_check(
    app: &AppHandle,
    profile: &ConnectionProfile,
    remote_port: u16,
    password: Option<&str>,
) -> Result<SuccessfulConnection, String> {
    let local_port = allocate_local_port()
        .map_err(|e| format!("Failed to allocate local port: {}", e))?;
    
    let ssh_args = build_ssh_command(profile, local_port, remote_port, password);
    
    let cmd = if password.is_some() { "sshpass" } else { "ssh" };
    let (rx, child) = app
        .shell()
        .command(cmd)
        .args(&ssh_args)
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH process: {}", e))?;
    
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    
    let base_url = format!("http://127.0.0.1:{}", local_port);
    let health_url = format!("{}/global/health", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let mut healthy = false;
    for _ in 0..5 {
        if let Ok(response) = client.get(&health_url).send().await {
            if response.status().is_success() {
                if let Ok(health_data) = response.json::<serde_json::Value>().await {
                    if health_data.get("healthy") == Some(&serde_json::Value::Bool(true)) {
                        healthy = true;
                        break;
                    }
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
    
    if healthy {
        Ok(SuccessfulConnection {
            local_port,
            remote_port,
            child,
            rx,
        })
    } else {
        let _ = child.kill();
        Err(format!("Server not responding on port {}", remote_port))
    }
}

#[tauri::command]
pub async fn ssh_connect_profile(
    app: AppHandle,
    profile_id: String,
    connection_id: String,
    password: Option<String>,
) -> Result<serde_json::Value, String> {
    eprintln!("[SSH] ssh_connect_profile called: profile_id={}, connection_id={}", profile_id, connection_id);
    
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| {
            eprintln!("[SSH] ERROR: Connection state not initialized");
            "Connection state not initialized".to_string()
        })?;
    
    let mut profile = ssh_get_profile(app.clone(), profile_id.clone())
        .await?
        .ok_or_else(|| format!("Profile {} not found", profile_id))?;
    
    {
        let connections = state.connections.lock()
            .map_err(|e| format!("Failed to lock connections: {}", e))?;
        if let Some((existing_conn, _)) = connections.values().find(|(conn, _)| {
            conn.profile_id == profile_id && conn.state == "connected"
        }) {
            return serde_json::to_value(existing_conn)
                .map_err(|e| format!("Failed to serialize connection: {}", e));
        }
    }
    
    let password_ref = password.as_deref();
    let initial_remote_port = profile.remote_server_ports.first().copied();
    
    let (remote_port, mut successful_connection) = if profile.bootstrap_enabled {
        handle_bootstrap_connection(&app, &mut profile, initial_remote_port, password_ref).await?
    } else {
        let port = handle_port_discovery(&app, &profile, initial_remote_port, password_ref).await?;
        (Some(port), None)
    };
    
    if successful_connection.is_none() {
        let final_port = remote_port.ok_or_else(|| "No remote port available".to_string())?;
        eprintln!("[SSH] Connecting to server on port {}", final_port);
        match try_port_with_health_check(&app, &profile, final_port, password_ref).await {
            Ok(conn) => {
                eprintln!("[SSH] Successfully connected on port {}", final_port);
                successful_connection = Some(conn);
            }
            Err(e) => {
                return Err(format!("Failed to connect to server on port {}: {}", final_port, e));
            }
        }
    }
    
    
    let (local_port, remote_port, child, rx) = match successful_connection.take() {
        Some(SuccessfulConnection {
            local_port,
            remote_port,
            child,
            rx,
        }) => {
            if !profile.remote_server_ports.contains(&remote_port) {
                profile.remote_server_ports = vec![remote_port];
                ssh_save_profile(app.clone(), profile.clone()).await?;
            }
            (local_port, remote_port, child, rx)
        }
        None => {
            return Err("Internal error: successful_connection was None".to_string());
        }
    };
    
    let server_info = fetch_server_info(local_port).await;
    
    eprintln!("[SSH] Connection successful! Local port: {}, Remote port: {}, Server info available: {}", local_port, remote_port, server_info.is_some());
    
    let connection = Connection {
        id: connection_id.clone(),
        profile_id: profile_id.clone(),
        state: "connected".to_string(),
        local_endpoint: Some(serde_json::json!({
            "host": "127.0.0.1",
            "port": local_port
        })),
        server_info: server_info.clone(),
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        connected_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    
    {
        let mut connections = state.connections.lock()
            .map_err(|e| format!("Failed to lock connections: {}", e))?;
        connections.insert(connection_id.clone(), (connection.clone(), Some(child)));
    }
    
    eprintln!("[SSH] Connection stored in state with ID: {}", connection_id);
    
    setup_connection_monitoring(state, connection_id.clone(), rx);
    
    eprintln!("[SSH] Returning connection result for {}", connection_id);
    serde_json::to_value(connection)
        .map_err(|e| format!("Failed to serialize connection: {}", e))
}

#[tauri::command]
pub async fn ssh_disconnect_profile(
    app: AppHandle,
    connection_id: String,
) -> Result<(), String> {
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| "Connection state not initialized".to_string())?;
    
    let mut connections = state.connections.lock()
        .map_err(|e| format!("Failed to lock connections: {}", e))?;
    if let Some((_conn, child)) = connections.remove(&connection_id) {
        if let Some(process) = child {
            eprintln!("[SSH] Killing process for connection {}", connection_id);
            let _ = process.kill();
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn ssh_get_connection_state(
    app: AppHandle,
    connection_id: String,
) -> Result<String, String> {
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| "Connection state not initialized".to_string())?;
    
    let connections = state.connections.lock()
        .map_err(|e| format!("Failed to lock connections: {}", e))?;
    if let Some((conn, _)) = connections.get(&connection_id) {
        Ok(conn.state.clone())
    } else {
        Ok("idle".to_string())
    }
}

#[tauri::command]
pub async fn ssh_get_connection(
    app: AppHandle,
    connection_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| "Connection state not initialized".to_string())?;
    
    let connections = state.connections.lock()
        .map_err(|e| format!("Failed to lock connections: {}", e))?;
    if let Some((conn, _)) = connections.get(&connection_id) {
        serde_json::to_value(conn)
            .map_err(|e| format!("Failed to serialize connection: {}", e))
            .map(Some)
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn ssh_list_connections(
    app: AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| "Connection state not initialized".to_string())?;
    
    let connections = state.connections.lock()
        .map_err(|e| format!("Failed to lock connections: {}", e))?;
    let mut result = Vec::new();
    for (_, (conn, _)) in connections.iter() {
        let serialized = serde_json::to_value(conn)
            .map_err(|e| format!("Failed to serialize connection: {}", e))?;
        result.push(serialized);
    }
    Ok(result)
}

#[tauri::command]
pub async fn ssh_cleanup_all_connections(app: AppHandle) -> Result<(), String> {
    let state: State<'_, SshConnectionState> = app
        .try_state()
        .ok_or_else(|| "Connection state not initialized".to_string())?;
    
    let mut connections = state.connections.lock()
        .map_err(|e| format!("Failed to lock connections: {}", e))?;
    let connection_ids: Vec<String> = connections.keys().cloned().collect();
    
    eprintln!("[SSH] Cleaning up {} connections on app exit", connection_ids.len());
    
    for connection_id in connection_ids {
        if let Some((_conn, child)) = connections.remove(&connection_id) {
            if let Some(process) = child {
                eprintln!("[SSH] Killing process for connection {} on app exit", connection_id);
                let _ = process.kill();
            }
        }
    }
    
    eprintln!("[SSH] All connections cleaned up");
    Ok(())
}

#[tauri::command]
pub async fn ssh_list_config_hosts() -> Result<Vec<SshConfigHost>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
    let config_path = PathBuf::from(home).join(".ssh").join("config");

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let metadata = fs::metadata(&config_path)
            .map_err(|e| format!("Failed to get SSH config metadata: {}", e))?;
        let perms = metadata.permissions();
        let mode = perms.mode();
        if (mode & 0o077) != 0 {
            eprintln!("[SSH] Warning: SSH config file has overly permissive permissions (mode: {:o})", mode);
        }
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read SSH config: {}", e))?;

    let mut hosts = Vec::new();
    let mut current_host: Option<SshConfigHost> = None;

    for line in content.lines() {
        let line = line.trim();
        
        if line.is_empty() || line.starts_with('#') {
            if let Some(host) = current_host.take() {
                hosts.push(host);
            }
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let key = parts[0].to_lowercase();
        let value = parts.get(1).map(|s| s.to_string());

        match key.as_str() {
            "host" => {
                if let Some(host) = current_host.take() {
                    hosts.push(host);
                }
                if let Some(hostname) = value {
                    current_host = Some(SshConfigHost {
                        name: hostname.clone(),
                        host: hostname,
                        user: None,
                        port: None,
                        identity_file: None,
                        proxy_jump: None,
                    });
                }
            }
            "hostname" => {
                if let Some(ref mut host) = current_host {
                    if let Some(hostname) = value {
                        host.host = hostname;
                    }
                }
            }
            "user" => {
                if let Some(ref mut host) = current_host {
                    host.user = value;
                }
            }
            "port" => {
                if let Some(ref mut host) = current_host {
                    if let Some(port_str) = value {
                        if let Ok(port) = port_str.parse::<u16>() {
                            host.port = Some(port);
                        }
                    }
                }
            }
            "identityfile" => {
                if let Some(ref mut host) = current_host {
                    host.identity_file = value;
                }
            }
            "proxyjump" => {
                if let Some(ref mut host) = current_host {
                    host.proxy_jump = value;
                }
            }
            _ => {}
        }
    }

    if let Some(host) = current_host {
        hosts.push(host);
    }

    hosts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(hosts)
}
