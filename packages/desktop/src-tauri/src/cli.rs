use tauri::{path::BaseDirectory, AppHandle, Manager};
use tauri_plugin_shell::{process::Command, ShellExt};

const CLI_INSTALL_DIR: &str = ".opencode/bin";
const CLI_BINARY_NAME: &str = "opencode";

#[derive(serde::Deserialize)]
pub struct ServerConfig {
    pub hostname: Option<String>,
    pub port: Option<u32>,
}

#[derive(serde::Deserialize)]
pub struct Config {
    pub server: Option<ServerConfig>,
}

pub async fn get_config(app: &AppHandle) -> Option<Config> {
    create_command(app, "debug config")
        .output()
        .await
        .inspect_err(|e| eprintln!("Failed to read OC config: {e}"))
        .ok()
        .and_then(|out| String::from_utf8(out.stdout.to_vec()).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
}

fn get_cli_install_path() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        std::path::PathBuf::from(home)
            .join(CLI_INSTALL_DIR)
            .join(CLI_BINARY_NAME)
    })
}

pub fn get_sidecar_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    // Get binary with symlinks support
    tauri::process::current_binary(&app.env())
        .expect("Failed to get current binary")
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
pub fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    if cfg!(not(unix)) {
        return Err("CLI installation is only supported on macOS & Linux".to_string());
    }

    let sidecar = get_sidecar_path(&app);
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

pub fn sync_cli(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        println!("Skipping CLI sync for debug build");
        return Ok(());
    }

    if !is_cli_installed() {
        println!("No CLI installation found, skipping sync");
        return Ok(());
    }

    let cli_path =
        get_cli_install_path().ok_or_else(|| "Could not determine CLI install path".to_string())?;

    let output = std::process::Command::new(&cli_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to get CLI version: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get CLI version".to_string());
    }

    let cli_version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let cli_version = semver::Version::parse(&cli_version_str)
        .map_err(|e| format!("Failed to parse CLI version '{}': {}", cli_version_str, e))?;

    let app_version = app.package_info().version.clone();

    if cli_version >= app_version {
        println!(
            "CLI version {} is up to date (app version: {}), skipping sync",
            cli_version, app_version
        );
        return Ok(());
    }

    println!(
        "CLI version {} is older than app version {}, syncing",
        cli_version, app_version
    );

    install_cli(app)?;

    println!("Synced installed CLI");

    Ok(())
}

fn get_user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

pub fn create_command(app: &tauri::AppHandle, args: &str) -> Command {
    let state_dir = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .expect("Failed to resolve app local data dir");

    #[cfg(target_os = "windows")]
    return app
        .shell()
        .sidecar("opencode-cli")
        .unwrap()
        .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
        .env("OPENCODE_CLIENT", "desktop")
        .env("XDG_STATE_HOME", &state_dir);

    #[cfg(not(target_os = "windows"))]
    return {
        let sidecar = get_sidecar_path(app);
        let shell = get_user_shell();
        app.shell()
            .command(&shell)
            .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
            .env("OPENCODE_CLIENT", "desktop")
            .env("XDG_STATE_HOME", &state_dir)
            .args(["-il", "-c", &format!("\"{}\" {}", sidecar.display(), args)])
    };
}
