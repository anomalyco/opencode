//! Resolves client directories from the XDG environment.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use opencode_util::path::Flavor;

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

    /// Empty XDG values are unset. `OPENCODE_CONFIG_DIR` replaces only config; locks and registration stay in state.
    /// Roots are joined and normalized as `path.join` does, because the lock of a file is keyed by its path text.
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>) -> io::Result<Self> {
        let set = |name: &str| var(name).filter(|value| !value.is_empty()).map(PathBuf::from);
        let home = home_dir(Flavor::NATIVE, &var).ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "cannot find the home directory: HOME is not set")
        })?;
        let root = |name: &str, fallback: &[&str]| {
            join(&set(name).unwrap_or_else(|| fallback.iter().fold(home.clone(), |path, part| path.join(part))), APP)
        };
        let data = root("XDG_DATA_HOME", &[".local", "share"]);
        let cache = root("XDG_CACHE_HOME", &[".cache"]);
        let state = root("XDG_STATE_HOME", &[".local", "state"]);
        let config = set("OPENCODE_CONFIG_DIR").unwrap_or_else(|| root("XDG_CONFIG_HOME", &[".config"]));
        Ok(Self {
            // `OPENCODE_TEST_HOME` overrides only the home directory.
            home: var("OPENCODE_TEST_HOME").map(PathBuf::from).unwrap_or(home),
            bin: cache.join("bin"),
            log: data.join("log"),
            repos: data.join("repos"),
            tmp: join(&tmpdir(Flavor::NATIVE, &var), APP),
            data,
            cache,
            config,
            state,
        })
    }

    pub fn locks(&self) -> PathBuf {
        self.state.join("locks")
    }
}

/// `path.join(base, part)`. A path that is not Unicode is only joined, rather than becoming another directory.
pub(crate) fn join(base: &Path, part: &str) -> PathBuf {
    match base.to_str() {
        Some(text) => PathBuf::from(Flavor::NATIVE.join(&[text, part])),
        None => base.join(part),
    }
}

/// The user's home directory, `os.homedir()`: `USERPROFILE`, then `HOME` on Windows, the reverse elsewhere. Empty
/// values count as unset. Empty when neither is set.
pub fn home() -> String {
    home_dir(Flavor::NATIVE, &|name| std::env::var_os(name))
        .map(|home| home.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The system's temporary directory, Node's `os.tmpdir()`.
pub fn temp() -> PathBuf {
    tmpdir(Flavor::NATIVE, &|name| std::env::var_os(name))
}

// Git Bash and MSYS set `HOME` on Windows, sometimes to another directory; libuv reads `USERPROFILE` first there.
fn home_dir(flavor: Flavor, var: &impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    let order = match flavor {
        Flavor::Posix => ["HOME", "USERPROFILE"],
        Flavor::Windows => ["USERPROFILE", "HOME"],
    };
    order.iter().find_map(|name| var(name).filter(|value| !value.is_empty())).map(PathBuf::from)
}

// Node's `os.tmpdir()`. POSIX: TMPDIR, TMP, TEMP, else /tmp, without a trailing slash. Windows: TEMP, TMP, else
// `%SystemRoot%\temp` or `%windir%\temp`, without one trailing `\` unless the path is a drive root.
fn tmpdir(flavor: Flavor, var: &impl Fn(&str) -> Option<OsString>) -> PathBuf {
    let set =
        |name: &&str| var(name).filter(|value| !value.is_empty()).map(|value| value.to_string_lossy().into_owned());
    if flavor == Flavor::Windows {
        let value = ["TEMP", "TMP"].iter().find_map(set).unwrap_or_else(|| {
            // Node appends to `undefined` when both are unset; Windows always sets `SystemRoot`.
            let system = ["SystemRoot", "windir"].iter().find_map(set).unwrap_or_else(|| "C:\\Windows".to_owned());
            format!("{system}\\temp")
        });
        let trim = value.len() > 1 && value.ends_with('\\') && !value.ends_with(":\\");
        return PathBuf::from(if trim { &value[..value.len() - 1] } else { &value });
    }
    let value = ["TMPDIR", "TMP", "TEMP"]
        .iter()
        .find_map(|name| var(name).filter(|value| !value.is_empty()))
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/tmp".to_string());
    let trimmed = value.trim_end_matches('/');
    PathBuf::from(if trimmed.is_empty() { "/" } else { trimmed })
}

/// Prefer `PWD` to the inherited working directory, then return the directory resolved by the kernel.
pub fn start_directory() -> io::Result<PathBuf> {
    let root = std::env::var_os("PWD").map(PathBuf::from).map_or_else(std::env::current_dir, Ok)?;
    enter(&root)
}

/// Changes the process working directory to `root` and returns the resolved working directory.
/// The error says "Failed to change directory to <root>", the TypeScript message.
pub fn enter(root: &Path) -> io::Result<PathBuf> {
    std::env::set_current_dir(root)
        .and_then(|()| current_dir())
        .map_err(|err| io::Error::new(err.kind(), format!("Failed to change directory to {}", root.display())))
}

/// The process working directory as Unix's `getcwd` gives it: the real path. Windows keeps the spelling it was entered
/// by (another letter case, a `\\?\` prefix; an 8.3 name it expands), which made one directory several locations,
/// each with its own sessions and plugin approvals (win11-runs D3). So the working directory becomes its canonical path
/// without the verbatim prefix, which names it as the file system does; one that cannot become that stays as it is.
pub fn current_dir() -> io::Result<PathBuf> {
    let dir = std::env::current_dir()?;
    let real = std::fs::canonicalize(&dir).ok().and_then(|real| {
        real.to_str().map(|text| PathBuf::from(opencode_util::path::strip_verbatim(text).into_owned()))
    });
    match real.filter(|real| *real == dir || std::env::set_current_dir(real).is_ok()) {
        Some(real) => Ok(real),
        None => Ok(dir),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn paths(vars: &[(&str, &str)]) -> Paths {
        let vars: HashMap<String, OsString> = vars.iter().map(|(k, v)| (k.to_string(), OsString::from(v))).collect();
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
        // Node reads `TMPDIR` on POSIX only and `TEMP` first on Windows.
        let (tmp, expected_tmp) = if cfg!(windows) {
            (("TEMP", "C:\\Temp\\"), "C:\\Temp\\opencode")
        } else {
            (("TMPDIR", "/var/tmp/"), "/var/tmp/opencode")
        };
        let p = paths(&[
            ("HOME", "/h"),
            // Normalized as `path.join` does, as TS keys file locks by these paths.
            ("XDG_DATA_HOME", "/x/..//d/./"),
            ("XDG_CACHE_HOME", "/c"),
            ("XDG_CONFIG_HOME", "/x"),
            ("XDG_STATE_HOME", ""),
            ("OPENCODE_CONFIG_DIR", "/custom"),
            ("OPENCODE_TEST_HOME", "/t"),
            tmp,
        ]);
        assert_eq!(p.data, PathBuf::from("/d/opencode"));
        assert_eq!(p.cache, PathBuf::from("/c/opencode"));
        assert_eq!(p.config, PathBuf::from("/custom"));
        // An empty XDG value is unset.
        assert_eq!(p.state, PathBuf::from("/h/.local/state/opencode"));
        assert_eq!(p.home, PathBuf::from("/t"));
        assert_eq!(p.tmp, PathBuf::from(expected_tmp));
    }

    #[test]
    fn home_and_tmpdir_follow_node_per_platform() {
        let lookup = |vars: &'static [(&'static str, &'static str)]| {
            move |name: &str| vars.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value))
        };
        let both = lookup(&[("HOME", "/c/Users/git-bash"), ("USERPROFILE", "C:\\Users\\u")]);
        assert_eq!(home_dir(Flavor::Windows, &both), Some(PathBuf::from("C:\\Users\\u")));
        assert_eq!(home_dir(Flavor::Posix, &both), Some(PathBuf::from("/c/Users/git-bash")));
        let empty = lookup(&[("USERPROFILE", ""), ("HOME", "/h")]);
        assert_eq!(home_dir(Flavor::Windows, &empty), Some(PathBuf::from("/h")));
        assert_eq!(home_dir(Flavor::Windows, &lookup(&[])), None);
        for (vars, expected) in [
            (&[("TMP", "C:\\tmp"), ("TEMP", "C:\\Temp\\")][..], "C:\\Temp"),
            (&[("TMP", "C:\\tmp\\"), ("TMPDIR", "/tmp")][..], "C:\\tmp"),
            (&[("TEMP", "D:\\")][..], "D:\\"),
            (&[("TEMP", "\\")][..], "\\"),
            (&[("SystemRoot", "C:\\Windows"), ("windir", "C:\\W")][..], "C:\\Windows\\temp"),
            (&[("windir", "C:\\W")][..], "C:\\W\\temp"),
        ] {
            assert_eq!(tmpdir(Flavor::Windows, &lookup(vars)), PathBuf::from(expected), "{vars:?}");
        }
        assert_eq!(tmpdir(Flavor::Posix, &lookup(&[("TEMP", "C:\\Temp")])), PathBuf::from("C:\\Temp"));
        assert_eq!(tmpdir(Flavor::Posix, &lookup(&[])), PathBuf::from("/tmp"));
    }

    #[test]
    fn empty_config_dir_is_unset() {
        let p = paths(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "/x"), ("OPENCODE_CONFIG_DIR", "")]);
        assert_eq!(p.config, PathBuf::from("/x/opencode"));
    }

    #[test]
    fn enter_resolves_symlinks_and_reports_failures() {
        let dir = opencode_util::temp::tempdir().unwrap();
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
        // Expected (win11-runs D3): another letter case and the verbatim spelling enter the same directory, named as the
        // file system names it; a sibling stays another directory.
        #[cfg(windows)]
        {
            let sibling = dir.path().join("Real2");
            std::fs::create_dir(&sibling).unwrap();
            let named =
                opencode_util::path::strip_verbatim(real.canonicalize().unwrap().to_str().unwrap()).into_owned();
            let before = std::env::current_dir().unwrap();
            let spellings = [named.clone(), named.to_uppercase(), named.to_lowercase(), format!(r"\\?\{named}")];
            let entered: Vec<PathBuf> = spellings.iter().map(|spelling| enter(Path::new(spelling)).unwrap()).collect();
            let other = enter(&sibling).unwrap();
            std::env::set_current_dir(before).unwrap();
            assert!(entered.iter().all(|entered| entered == Path::new(&named)), "{entered:?} as {named}");
            assert_ne!(other, Path::new(&named));
        }
        let missing = dir.path().join("missing");
        let err = enter(&missing).unwrap_err();
        assert_eq!(err.to_string(), format!("Failed to change directory to {}", missing.display()));
    }
}
