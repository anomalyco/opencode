//! XDG roots and `OPENCODE_CONFIG_DIR` (F.4).
//!
//! Ports `packages/util/src/global-roots.ts` and `packages/util/src/global.ts`. Every path is
//! computed from an environment lookup, so tests pass their own variables instead of touching the
//! user's directories.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

/// The application directory name under each XDG root.
pub const APP: &str = "opencode";

/// The global paths of the TypeScript `Global.Service`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Paths {
    pub home: PathBuf,
    pub data: PathBuf,
    pub cache: PathBuf,
    pub config: PathBuf,
    pub state: PathBuf,
    pub tmp: PathBuf,
    pub bin: PathBuf,
    pub log: PathBuf,
    pub repos: PathBuf,
}

impl Paths {
    /// Paths from the process environment.
    pub fn from_env() -> io::Result<Self> {
        Self::from_vars(|name| std::env::var_os(name))
    }

    /// Paths from an environment lookup. Empty XDG values count as unset, as the TypeScript `||`
    /// does. `OPENCODE_CONFIG_DIR` replaces the config directory, as the CLI's `Global` layer does
    /// (`packages/cli/src/index.ts:136-142`); it does not move state, so locks and the service
    /// registration stay where other clients look for them.
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>) -> io::Result<Self> {
        let set = |name: &str| {
            var(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        let home = set("HOME").or_else(|| set("USERPROFILE")).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "cannot find the home directory: HOME is not set",
            )
        })?;
        let root = |name: &str, fallback: &[&str]| {
            set(name)
                .unwrap_or_else(|| {
                    fallback
                        .iter()
                        .fold(home.clone(), |path, part| path.join(part))
                })
                .join(APP)
        };
        let data = root("XDG_DATA_HOME", &[".local", "share"]);
        let cache = root("XDG_CACHE_HOME", &[".cache"]);
        let state = root("XDG_STATE_HOME", &[".local", "state"]);
        let config =
            set("OPENCODE_CONFIG_DIR").unwrap_or_else(|| root("XDG_CONFIG_HOME", &[".config"]));
        Ok(Self {
            // `OPENCODE_TEST_HOME` moves only `home`, as in `global.ts:16-18`.
            home: var("OPENCODE_TEST_HOME").map(PathBuf::from).unwrap_or(home),
            bin: cache.join("bin"),
            log: data.join("log"),
            repos: data.join("repos"),
            tmp: tmpdir(&var).join(APP),
            data,
            cache,
            config,
            state,
        })
    }

    /// The default lock directory, `<state>/locks` (`packages/util/src/flock.ts:18-21`).
    pub fn locks(&self) -> PathBuf {
        self.state.join("locks")
    }
}

// Node's `os.tmpdir()` on POSIX: TMPDIR, TMP, TEMP, else /tmp, without a trailing slash.
fn tmpdir(var: &impl Fn(&str) -> Option<OsString>) -> PathBuf {
    if cfg!(windows) {
        return std::env::temp_dir();
    }
    let value = ["TMPDIR", "TMP", "TEMP"]
        .iter()
        .find_map(|name| var(name).filter(|value| !value.is_empty()))
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/tmp".to_string());
    let trimmed = value.trim_end_matches('/');
    PathBuf::from(if trimmed.is_empty() { "/" } else { trimmed })
}

/// The directory a command starts in (row G18). Like `localDirectory` in
/// `packages/cli/src/run/run.ts:184-191` and `packages/cli/src/mini.ts:204-212`: change to `PWD`
/// when it is set, else stay, and return the working directory the kernel reports. `PWD` wins over
/// an inherited working directory that differs from it; the result has symlinks resolved, as in
/// TypeScript.
pub fn start_directory() -> io::Result<PathBuf> {
    let root = std::env::var_os("PWD")
        .map(PathBuf::from)
        .map_or_else(std::env::current_dir, Ok)?;
    enter(&root)
}

/// Changes the process working directory to `root` and returns the resolved working directory.
/// The error says "Failed to change directory to <root>", the TypeScript message.
pub fn enter(root: &Path) -> io::Result<PathBuf> {
    std::env::set_current_dir(root)
        .and_then(|()| std::env::current_dir())
        .map_err(|err| {
            io::Error::new(
                err.kind(),
                format!("Failed to change directory to {}", root.display()),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn paths(vars: &[(&str, &str)]) -> Paths {
        let vars: HashMap<String, OsString> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        Paths::from_vars(|name| vars.get(name).cloned()).unwrap()
    }

    #[test]
    fn defaults_follow_home() {
        let p = paths(&[("HOME", "/h")]);
        assert_eq!(p.data, PathBuf::from("/h/.local/share/opencode"));
        assert_eq!(p.cache, PathBuf::from("/h/.cache/opencode"));
        assert_eq!(p.config, PathBuf::from("/h/.config/opencode"));
        assert_eq!(p.state, PathBuf::from("/h/.local/state/opencode"));
        assert_eq!(p.bin, PathBuf::from("/h/.cache/opencode/bin"));
        assert_eq!(p.log, PathBuf::from("/h/.local/share/opencode/log"));
        assert_eq!(p.repos, PathBuf::from("/h/.local/share/opencode/repos"));
        assert_eq!(p.locks(), PathBuf::from("/h/.local/state/opencode/locks"));
        assert_eq!(p.home, PathBuf::from("/h"));
    }

    #[test]
    fn xdg_roots_and_config_dir() {
        let p = paths(&[
            ("HOME", "/h"),
            ("XDG_DATA_HOME", "/d"),
            ("XDG_CACHE_HOME", "/c"),
            ("XDG_CONFIG_HOME", "/x"),
            ("XDG_STATE_HOME", ""),
            ("OPENCODE_CONFIG_DIR", "/custom"),
            ("OPENCODE_TEST_HOME", "/t"),
            ("TMPDIR", "/var/tmp/"),
        ]);
        assert_eq!(p.data, PathBuf::from("/d/opencode"));
        assert_eq!(p.cache, PathBuf::from("/c/opencode"));
        assert_eq!(p.config, PathBuf::from("/custom"));
        // An empty XDG value is unset.
        assert_eq!(p.state, PathBuf::from("/h/.local/state/opencode"));
        assert_eq!(p.home, PathBuf::from("/t"));
        assert_eq!(p.tmp, PathBuf::from("/var/tmp/opencode"));
    }

    #[test]
    fn empty_config_dir_is_unset() {
        let p = paths(&[
            ("HOME", "/h"),
            ("XDG_CONFIG_HOME", "/x"),
            ("OPENCODE_CONFIG_DIR", ""),
        ]);
        assert_eq!(p.config, PathBuf::from("/x/opencode"));
    }

    #[test]
    fn enter_resolves_symlinks_and_reports_failures() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        #[cfg(unix)]
        {
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(&real, &link).unwrap();
            let before = std::env::current_dir().unwrap();
            let entered = enter(&link).unwrap();
            std::env::set_current_dir(before).unwrap();
            assert_eq!(entered, real.canonicalize().unwrap());
        }
        let missing = dir.path().join("missing");
        let err = enter(&missing).unwrap_err();
        assert_eq!(
            err.to_string(),
            format!("Failed to change directory to {}", missing.display())
        );
    }
}
