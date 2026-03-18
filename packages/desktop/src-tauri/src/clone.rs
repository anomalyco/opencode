use std::{path::PathBuf, process::Command};

use tauri::AppHandle;

use crate::clone_settings::get_default_clone_directory;
#[cfg(target_os = "windows")]
use crate::server::get_wsl_config;

fn repo_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "repository".to_string();
    }

    let tail = trimmed.rsplit(['/', ':']).next().unwrap_or("repository");
    let name = tail.strip_suffix(".git").unwrap_or(tail).trim();
    if name.is_empty() {
        return "repository".to_string();
    }

    name.to_string()
}

fn clone_with_git(url: &str, target: &str) -> Result<(), String> {
    tracing::info!(%url, %target, "Running git clone");
    let output = Command::new("git")
        .args(["clone", "--", url, target])
        .output()
        .map_err(|e| format!("Failed to run git clone: {e}"))?;

    if output.status.success() {
        tracing::info!(%target, "git clone completed");
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        tracing::warn!(%url, %target, stderr = %stderr, "git clone failed");
        return Err(stderr);
    }

    tracing::warn!(%url, %target, "git clone failed without stderr");
    Err("git clone failed".to_string())
}

#[cfg(target_os = "windows")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "windows")]
fn wsl_run(command: &str) -> Result<std::process::Output, String> {
    Command::new("wsl")
        .args(["-e", "sh", "-lc", command])
        .output()
        .map_err(|e| format!("Failed to run WSL command: {e}"))
}

#[cfg(target_os = "windows")]
fn clone_with_wsl(url: &str, base: Option<&str>) -> Result<String, String> {
    let root = if let Some(base) = base.filter(|v| !v.trim().is_empty()) {
        base.trim().to_string()
    } else {
        let output = wsl_run("printf %s \"$HOME\"")?;
        if !output.status.success() {
            return Err("Failed to resolve WSL home directory".to_string());
        }

        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if root.is_empty() {
            return Err("Failed to resolve WSL home directory".to_string());
        }

        root
    };

    let output = wsl_run(&format!("mkdir -p {}", shell_quote(&root)))?;
    if !output.status.success() {
        return Err("Failed to create clone destination directory".to_string());
    }

    let name = repo_name(url);
    let mut index = 1usize;
    let target = loop {
        let dir = if index == 1 {
            format!("{root}/{name}")
        } else {
            format!("{root}/{name}-{index}")
        };

        let output = wsl_run(&format!("[ -d {} ]", shell_quote(&dir)))?;
        if !output.status.success() {
            break dir;
        }

        index += 1;
    };

    let output = wsl_run(&format!(
        "git clone -- {} {}",
        shell_quote(url),
        shell_quote(&target)
    ))?;
    if output.status.success() {
        return Ok(target);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }

    Err("git clone failed".to_string())
}

fn pick_target(root: PathBuf, name: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create clone destination directory: {e}"))?;

    let mut index = 1usize;
    loop {
        let path = if index == 1 {
            root.join(name)
        } else {
            root.join(format!("{name}-{index}"))
        };

        if !path.exists() {
            return Ok(path);
        }

        index += 1;
    }
}

fn pick_directory(
    app: &AppHandle,
    url: &str,
    directory: Option<String>,
) -> Result<PathBuf, String> {
    let name = repo_name(url);

    if let Some(dir) = directory.filter(|v| !v.trim().is_empty()) {
        let path = PathBuf::from(dir.trim());
        if path.exists() {
            return pick_target(path, &name);
        }

        if let Some(parent) = path.parent().filter(|v| !v.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create clone destination directory: {e}"))?;
        }

        return Ok(path);
    }

    pick_target(
        PathBuf::from(get_default_clone_directory(app.clone())?),
        &name,
    )
}

#[tauri::command]
#[specta::specta]
pub fn clone_git_repository(
    app: AppHandle,
    url: String,
    directory: Option<String>,
) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Repository URL cannot be empty".to_string());
    }

    tracing::info!(%url, ?directory, "clone_git_repository requested");

    #[cfg(target_os = "windows")]
    {
        if get_wsl_config(app.clone()).is_ok_and(|v| v.enabled) {
            return clone_with_wsl(&url, directory.as_deref());
        }
    }

    let target = pick_directory(&app, &url, directory)?;
    let target = target.to_string_lossy().to_string();
    tracing::info!(%target, "Selected clone destination");
    clone_with_git(&url, &target)?;
    tracing::info!(%target, "clone_git_repository succeeded");
    Ok(target)
}

#[cfg(test)]
#[test]
fn test_clone_with_git_real_repository() {
    let root = std::env::temp_dir().join(format!(
        "opencode-desktop-clone-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("failed to create temporary clone directory");

    let target = root.join("opencode");
    let target = target.to_string_lossy().to_string();
    clone_with_git("https://github.com/anomalyco/opencode.git", &target)
        .expect("failed to clone https://github.com/anomalyco/opencode.git");
    assert!(
        root.join("opencode").join(".git").exists(),
        "expected cloned repository to contain .git"
    );

    if let Err(err) = std::fs::remove_dir_all(&root) {
        tracing::warn!(path = %root.display(), %err, "failed to remove clone test directory");
    }
}
