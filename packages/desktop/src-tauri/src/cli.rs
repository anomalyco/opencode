use tauri::{AppHandle, Manager, path::BaseDirectory};
use tauri_plugin_shell::{
    ShellExt,
    process::{Command, CommandChild, CommandEvent, TerminatedPayload},
};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

use crate::constants::{SETTINGS_STORE, WSL_ENABLED_KEY};

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
    create_command(app, "debug config", &[])
        .output()
        .await
        .inspect_err(|e| tracing::warn!("Failed to read OC config: {e}"))
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
#[specta::specta]
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
        tracing::debug!("Skipping CLI sync for debug build");
        return Ok(());
    }

    if !is_cli_installed() {
        tracing::info!("No CLI installation found, skipping sync");
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
        tracing::info!(
            %cli_version, %app_version,
            "CLI is up to date, skipping sync"
        );
        return Ok(());
    }

    tracing::info!(
        %cli_version, %app_version,
        "CLI is older than app version, syncing"
    );

    install_cli(app)?;

    tracing::info!("Synced installed CLI");

    Ok(())
}

fn get_user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

fn is_wsl_enabled(app: &tauri::AppHandle) -> bool {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return false;
    };

    store
        .get(WSL_ENABLED_KEY)
        .as_ref()
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }

    let mut escaped = String::from("'");
    escaped.push_str(&input.replace("'", "'\"'\"'"));
    escaped.push('\'');
    escaped
}

pub fn create_command(app: &tauri::AppHandle, args: &str, extra_env: &[(&str, String)]) -> Command {
    let state_dir = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .expect("Failed to resolve app local data dir");

    let mut envs = vec![
        (
            "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY".to_string(),
            "true".to_string(),
        ),
        (
            "OPENCODE_EXPERIMENTAL_FILEWATCHER".to_string(),
            "true".to_string(),
        ),
        ("OPENCODE_CLIENT".to_string(), "desktop".to_string()),
        (
            "XDG_STATE_HOME".to_string(),
            state_dir.to_string_lossy().to_string(),
        ),
    ];
    envs.extend(
        extra_env
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone())),
    );

    if cfg!(windows) {
        if is_wsl_enabled(app) {
            tracing::info!("WSL is enabled, spawning CLI server in WSL");
            let version = app.package_info().version.to_string();
            let mut script = vec![
                "set -e".to_string(),
                "BIN=\"$HOME/.opencode/bin/opencode\"".to_string(),
                "if [ ! -x \"$BIN\" ]; then".to_string(),
                format!(
                    "  curl -fsSL https://opencode.ai/install | bash -s -- --version {} --no-modify-path",
                    shell_escape(&version)
                ),
                "fi".to_string(),
            ];

            let mut env_prefix = vec![
                "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY=true".to_string(),
                "OPENCODE_EXPERIMENTAL_FILEWATCHER=true".to_string(),
                "OPENCODE_CLIENT=desktop".to_string(),
                "XDG_STATE_HOME=\"$HOME/.local/state\"".to_string(),
            ];
            env_prefix.extend(
                envs.iter()
                    .filter(|(key, _)| key != "OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")
                    .filter(|(key, _)| key != "OPENCODE_EXPERIMENTAL_FILEWATCHER")
                    .filter(|(key, _)| key != "OPENCODE_CLIENT")
                    .filter(|(key, _)| key != "XDG_STATE_HOME")
                    .map(|(key, value)| format!("{}={}", key, shell_escape(value))),
            );

            script.push(format!("{} exec \"$BIN\" {}", env_prefix.join(" "), args));

            return app
                .shell()
                .command("wsl")
                .args(["-e", "bash", "-lc", &script.join("\n")]);
        } else {
            let mut cmd = app
                .shell()
                .sidecar("opencode-cli")
                .unwrap()
                .args(args.split_whitespace());

            for (key, value) in envs {
                cmd = cmd.env(key, value);
            }

            return cmd;
        }
    } else {
        let sidecar = get_sidecar_path(app);
        let shell = get_user_shell();

        let cmd = if shell.ends_with("/nu") {
            format!("^\"{}\" {}", sidecar.display(), args)
        } else {
            format!("\"{}\" {}", sidecar.display(), args)
        };

        let mut cmd = app.shell().command(&shell).args(["-il", "-c", &cmd]);

        for (key, value) in envs {
            cmd = cmd.env(key, value);
        }

        cmd
    }
}

pub fn serve(
    app: &AppHandle,
    hostname: &str,
    port: u32,
    password: &str,
) -> (CommandChild, oneshot::Receiver<TerminatedPayload>) {
    let (exit_tx, exit_rx) = oneshot::channel::<TerminatedPayload>();

    tracing::info!(port, "Spawning sidecar");

    let envs = [
        ("OPENCODE_SERVER_USERNAME", "opencode".to_string()),
        ("OPENCODE_SERVER_PASSWORD", password.to_string()),
    ];

    let (mut rx, child) = create_command(
        app,
        format!("--print-logs --log-level WARN serve --hostname {hostname} --port {port}").as_str(),
        &envs,
    )
    .spawn()
    .expect("Failed to spawn opencode");

    tokio::spawn(async move {
        let mut exit_tx = Some(exit_tx);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    tracing::info!(target: "sidecar", "{line}");
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    tracing::info!(target: "sidecar", "{line}");
                }
                CommandEvent::Error(err) => {
                    tracing::error!(target: "sidecar", "{err}");
                }
                CommandEvent::Terminated(payload) => {
                    tracing::info!(
                        target: "sidecar",
                        code = ?payload.code,
                        signal = ?payload.signal,
                        "Sidecar terminated"
                    );

                    if let Some(tx) = exit_tx.take() {
                        let _ = tx.send(payload);
                    }
                }
                _ => {}
            }
        }
    });

    (child, exit_rx)
}
