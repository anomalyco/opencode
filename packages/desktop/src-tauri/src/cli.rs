const CLI_INSTALL_DIR: &str = ".opencode/bin";
const CLI_BINARY_NAME: &str = "opencode";

fn get_cli_install_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        std::path::PathBuf::from(home)
            .join(CLI_INSTALL_DIR)
            .join(CLI_BINARY_NAME)
    })
}

pub fn get_sidecar_path() -> std::path::PathBuf {
    tauri::utils::platform::current_exe()
        .expect("Failed to get current exe")
        .parent()
        .expect("Failed to get parent dir")
        .join("opencode-cli")
}

fn is_cli_installed() -> bool {
    get_cli_install_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

const INSTALL_SCRIPT: &str = include_str!("../../../../install");

#[tauri::command]
pub fn install_cli() -> Result<String, String> {
    if cfg!(not(unix)) {
        return Err("CLI installation is only supported on macOS & Linux".to_string());
    }

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

    let install_path =
        get_cli_install_path().ok_or_else(|| "Could not determine install path".to_string())?;

    Ok(install_path.to_string_lossy().to_string())
}

pub fn sync_cli() -> Result<(), String> {
    if cfg!(debug_assertions) {
        println!("Skipping CLI sync for debug build");
        return Ok(());
    }

    if !is_cli_installed() {
        println!("No CLI installation found, skipping sync");
        return Ok(());
    }

    install_cli()?;

    println!("Synced installed CLI");

    Ok(())
}
