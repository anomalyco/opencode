//! Node's `path.resolve` and `FSUtil.resolve`, by the rules of this platform's `path` (`path.win32` on Windows,
//! where ACP clients such as Zed send `C:\` paths).

pub use opencode_util::path::windows_path;
use opencode_util::path::{Flavor, strip_verbatim};

/// `path.resolve(path)`: absolute against the working directory, with `.` and `..` folded.
pub fn resolve_lexical(path: &str) -> String {
    resolve_from("", path)
}

/// `path.resolve(base, path)`.
pub fn resolve_from(base: &str, path: &str) -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    resolve_in(Flavor::NATIVE, &strip_verbatim(&cwd.to_string_lossy()), base, path)
}

/// `FSUtil.resolve`: the real path when it exists, else the lexical one. `realpath` gives no `\\?\` prefix.
pub fn fs_resolve(path: &str) -> String {
    let resolved = resolve_lexical(&windows_path(Flavor::NATIVE, path));
    match std::fs::canonicalize(&resolved) {
        Ok(real) => strip_verbatim(&real.to_string_lossy()).into_owned(),
        Err(_) => resolved,
    }
}

/// `path.isAbsolute`.
pub fn is_absolute(path: &str) -> bool {
    Flavor::NATIVE.is_absolute(path)
}

// `path.resolve(base, path)` from `cwd`, rooted at `/` (or `\`) when nothing is.
fn resolve_in(flavor: Flavor, cwd: &str, base: &str, path: &str) -> String {
    let root = flavor.sep().to_string();
    flavor.resolve(&[&root, cwd, base, path])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_by_flavor() {
        let p = Flavor::Posix;
        assert_eq!(resolve_in(p, "/w", "", "a/../b"), "/w/b");
        assert_eq!(resolve_in(p, "/w", "/p", "../q"), "/q");
        assert_eq!(resolve_in(p, "/w", "/p", "/x/./y"), "/x/y");
        assert_eq!(resolve_in(p, "/", "", ".."), "/");
        let w = Flavor::Windows;
        assert_eq!(resolve_in(w, "C:\\w", "", "a/../b"), "C:\\w\\b");
        assert_eq!(resolve_in(w, "C:\\w", "D:\\p", "src/x.ts"), "D:\\p\\src\\x.ts");
        assert_eq!(resolve_in(w, "C:\\w", "D:\\p", "\\x"), "D:\\x");
        assert_eq!(resolve_in(w, "C:\\w", "C:\\p", "E:/y\\..\\z"), "E:\\z");
        assert_eq!(resolve_in(w, "C:\\w", "\\\\srv\\share\\p", "..\\..\\q"), "\\\\srv\\share\\q");
        assert!(w.is_absolute("C:\\x") && w.is_absolute("c:/x") && !w.is_absolute("x\\y"));
    }
}
