//! Node's `path.resolve` and `FSUtil.resolve` on POSIX paths.

use std::path::{Component, Path, PathBuf};

/// `path.resolve(path)`: absolute against the working directory, with `.` and `..` folded.
pub fn resolve_lexical(path: &str) -> String {
    let joined = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut out = PathBuf::from("/");
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
            Component::RootDir | Component::CurDir | Component::Prefix(_) => {}
        }
    }
    out.to_string_lossy().into_owned()
}

/// `path.resolve(base, path)`.
pub fn resolve_from(base: &str, path: &str) -> String {
    if Path::new(path).is_absolute() {
        return resolve_lexical(path);
    }
    resolve_lexical(&format!("{base}/{path}"))
}

/// `FSUtil.resolve`: the real path when it exists, else the lexical one.
pub fn fs_resolve(path: &str) -> String {
    let resolved = resolve_lexical(path);
    match std::fs::canonicalize(&resolved) {
        Ok(real) => real.to_string_lossy().into_owned(),
        Err(_) => resolved,
    }
}

pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}
