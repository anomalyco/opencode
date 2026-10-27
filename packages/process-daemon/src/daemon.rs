use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

pub const REGISTRATION_FILE: &str = "service.json";
pub const LOCK_FILE: &str = "service.lock";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Registration {
    pub instance_id: String,
    pub pid: u32,
    pub protocol: u32,
    /// Opaque local transport endpoint, not necessarily a filesystem entry.
    pub socket: PathBuf,
    pub token: String,
}

/// Shared parent of runtime directories, inside OpenCode's state directory.
/// Registration files must not live in temporary directories, which macOS purges
/// while daemons run.
pub fn default_runtime_root() -> PathBuf {
    resolve_runtime_root(
        std::env::var_os("XDG_STATE_HOME").map(PathBuf::from),
        std::env::home_dir(),
    )
}

fn resolve_runtime_root(state: Option<PathBuf>, home: Option<PathBuf>) -> PathBuf {
    state
        .filter(|path| path.is_absolute())
        .or_else(|| home.map(|home| home.join(".local").join("state")))
        .unwrap_or_else(std::env::temp_dir)
        .join("opencode")
        .join("pty")
}

/// Resolves `<root>/<name>`, where the name is a single plain path component.
pub fn runtime_dir(root: Option<&Path>, name: &str) -> Result<PathBuf> {
    let valid = !name.is_empty()
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !valid {
        bail!("invalid runtime name {name:?}; use letters, digits, '.', '_', or '-'");
    }
    Ok(root
        .map(Path::to_path_buf)
        .unwrap_or_else(default_runtime_root)
        .join(name))
}

pub fn registration_path(directory: &Path) -> PathBuf {
    directory.join(REGISTRATION_FILE)
}

pub fn read_registration(directory: &Path) -> Result<Registration> {
    // Windows also verifies the file's owner and private ACL before trusting it.
    #[cfg(windows)]
    return platform::read_registration(directory);
    #[cfg(not(windows))]
    {
        use anyhow::Context;
        let data = std::fs::read(registration_path(directory))
            .context("opencode-pty registration is unavailable")?;
        serde_json::from_slice(&data).context("invalid opencode-pty registration")
    }
}

#[cfg(unix)]
#[path = "daemon/unix.rs"]
mod platform;
#[cfg(windows)]
#[path = "daemon/windows.rs"]
mod platform;
#[cfg(any(unix, windows))]
mod server;
#[cfg(any(unix, windows))]
mod sweep;

#[cfg(any(unix, windows))]
pub use server::run;

/// Minimal Windows byte-stream client for integrations using protocol framing.
/// This does not start a daemon or implement the interactive TerminalClient CLI.
#[cfg(windows)]
pub use crate::transport::windows::Connection as PipeConnection;

#[cfg(not(any(unix, windows)))]
pub fn run(_directory: &Path) -> Result<()> {
    anyhow::bail!("persistent opencode-pty transport is not implemented on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn runtime_root_avoids_temporary_directories() {
        let home = Some(PathBuf::from("/home/user"));
        assert_eq!(
            resolve_runtime_root(Some("/state".into()), home.clone()),
            PathBuf::from("/state/opencode/pty")
        );
        assert_eq!(
            resolve_runtime_root(Some("relative".into()), home.clone()),
            PathBuf::from("/home/user/.local/state/opencode/pty")
        );
        assert_eq!(
            resolve_runtime_root(None, home),
            PathBuf::from("/home/user/.local/state/opencode/pty")
        );
    }

    #[test]
    fn runtime_names_are_single_components() {
        let root = Path::new("/state");
        assert_eq!(
            runtime_dir(Some(root), "ee7511b8-7db0.x_1").unwrap(),
            root.join("ee7511b8-7db0.x_1")
        );
        for name in ["", ".", "..", "a/b", "../x", "with space"] {
            assert!(runtime_dir(Some(root), name).is_err(), "{name:?}");
        }
    }
}
