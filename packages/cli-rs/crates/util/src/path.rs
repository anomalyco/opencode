//! Node's `path.posix` and `path.win32` on strings. TypeScript code uses `path`, which is `path.win32` when
//! `process.platform` is `win32`; [`Flavor::NATIVE`] picks the same one. The functions are pure, so either flavour
//! runs on any host.

use std::borrow::Cow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flavor {
    Posix,
    Windows,
}

impl Flavor {
    /// The flavour Node's `path` has on this platform.
    pub const NATIVE: Self = if cfg!(windows) { Self::Windows } else { Self::Posix };

    /// The flavour a path looks like: Windows for a drive (`C:\`, `C:/`) or UNC (`\\`) root.
    pub fn of(path: &str) -> Self {
        let bytes = path.as_bytes();
        let drive =
            bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
        if drive || path.starts_with("\\\\") { Self::Windows } else { Self::Posix }
    }

    /// `path.sep`.
    pub fn sep(self) -> char {
        match self {
            Self::Posix => '/',
            Self::Windows => '\\',
        }
    }

    /// Whether `c` separates segments: `/`, and `\` on Windows.
    pub fn is_sep(self, c: char) -> bool {
        c == '/' || (self == Self::Windows && c == '\\')
    }

    /// `path.isAbsolute`.
    pub fn is_absolute(self, path: &str) -> bool {
        match self {
            Self::Posix => path.starts_with('/'),
            Self::Windows => {
                let bytes = path.as_bytes();
                matches!(bytes.first(), Some(b'/' | b'\\'))
                    || (bytes.len() >= 3
                        && bytes[0].is_ascii_alphabetic()
                        && bytes[1] == b':'
                        && matches!(bytes[2], b'/' | b'\\'))
            }
        }
    }

    /// `path.parse(path).root`, with `\` on Windows.
    pub fn root(self, path: &str) -> String {
        self.split(path).0
    }

    /// Splits a path into its root (`/`, `C:\`, `C:`, `\\server\share\`, `\`, or empty) and its segments.
    pub fn split(self, path: &str) -> (String, Vec<String>) {
        let is_sep = |c: char| self.is_sep(c);
        let segments = |rest: &str| -> Vec<String> {
            rest.split(is_sep).filter(|part| !part.is_empty()).map(str::to_owned).collect()
        };
        if self == Self::Posix {
            let root = if path.starts_with('/') { "/" } else { "" };
            return (root.to_owned(), segments(path));
        }
        let (device, rest, absolute) = windows_root(path);
        let root = if absolute { format!("{device}\\") } else { device };
        (root, segments(rest))
    }

    /// `path.resolve` over an absolute base: the last rooted path wins, `.` and `..` fold. Without a rooted path
    /// the result stays relative (`.` when empty), where Node would start from the working directory.
    pub fn resolve(self, paths: &[&str]) -> String {
        if self == Self::Windows {
            return resolve_windows(paths);
        }
        let mut root = String::new();
        let mut segments: Vec<String> = Vec::new();
        for path in paths {
            let (path_root, parts) = self.split(path);
            if !path_root.is_empty() {
                root = path_root;
                segments.clear();
            }
            for part in parts {
                match part.as_str() {
                    "." => {}
                    ".." => {
                        segments.pop();
                    }
                    _ => segments.push(part),
                }
            }
        }
        let joined = segments.join(&self.sep().to_string());
        if root.is_empty() {
            return if joined.is_empty() { ".".to_owned() } else { joined };
        }
        format!("{root}{joined}")
    }

    /// `path.relative` between two paths resolved the same way: `..` up to the common ancestor, then down. Windows
    /// compares without case.
    pub fn relative(self, from: &str, to: &str) -> String {
        let from = self.resolve(&[from]);
        let to = self.resolve(&[to]);
        let (from_root, from_parts) = self.split(&from);
        let (to_root, to_parts) = self.split(&to);
        let same = |a: &str, b: &str| match self {
            Self::Posix => a == b,
            Self::Windows => a.eq_ignore_ascii_case(b),
        };
        if !same(&from_root, &to_root) {
            return to;
        }
        let common = from_parts.iter().zip(&to_parts).take_while(|(a, b)| same(a, b)).count();
        let mut parts: Vec<String> = vec!["..".to_owned(); from_parts.len() - common];
        parts.extend(to_parts[common..].iter().cloned());
        parts.join(&self.sep().to_string())
    }

    /// `path.normalize`: `.` and `..` fold, separators collapse (to `\` on Windows), a trailing separator stays, and
    /// an empty relative path is `.`. `..` above a root is dropped; in a relative path it stays.
    pub fn normalize(self, path: &str) -> String {
        if path.is_empty() {
            return ".".to_owned();
        }
        let (root, parts) = self.split(path);
        let absolute = root.ends_with(['/', '\\']);
        let mut segments: Vec<String> = Vec::new();
        for part in parts {
            match part.as_str() {
                "." => {}
                ".." if segments.last().is_some_and(|last| last != "..") => {
                    segments.pop();
                }
                ".." if absolute => {}
                _ => segments.push(part),
            }
        }
        let mut tail = segments.join(&self.sep().to_string());
        if tail.is_empty() && !absolute {
            tail.push('.');
        }
        if !tail.is_empty() && path.ends_with(|c| self.is_sep(c)) {
            tail.push(self.sep());
        }
        format!("{root}{tail}")
    }

    /// `path.join`: the non-empty parts joined with the separator, then [normalized](Self::normalize).
    pub fn join(self, parts: &[&str]) -> String {
        let parts: Vec<&str> = parts.iter().copied().filter(|part| !part.is_empty()).collect();
        self.normalize(&parts.join(&self.sep().to_string()))
    }

    /// Whether a [`relative`](Self::relative) result leaves its base: `..`, `../…`, or absolute.
    pub fn outside(self, relative: &str) -> bool {
        relative == ".." || relative.starts_with(&format!("..{}", self.sep())) || self.is_absolute(relative)
    }

    /// `path.basename`: the last segment, without trailing separators and, on Windows, without a drive.
    pub fn basename(self, path: &str) -> &str {
        let path = match self {
            Self::Windows
                if path.len() >= 2 && path.as_bytes()[0].is_ascii_alphabetic() && path.as_bytes()[1] == b':' =>
            {
                &path[2..]
            }
            _ => path,
        };
        path.trim_end_matches(|c| self.is_sep(c)).rsplit(|c| self.is_sep(c)).next().unwrap_or_default()
    }
}

/// `path.win32.resolve`: from the last path back, collect segments until a rooted path with a device (a drive or a
/// UNC share). A path on another device than the one found first is skipped, and a rooted path without a device takes
/// the device of an earlier path. `..` stops at the root of an absolute result. Only a result without a device stays
/// relative, where Node would start from the working directory.
fn resolve_windows(paths: &[&str]) -> String {
    let mut device = String::new();
    let mut absolute = false;
    let mut rests = Vec::new();
    for path in paths.iter().rev().filter(|path| !path.is_empty()) {
        let (path_device, rest, path_absolute) = windows_root(path);
        if !path_device.is_empty() {
            if device.is_empty() {
                device = path_device;
            } else if !device.eq_ignore_ascii_case(&path_device) {
                continue;
            }
        }
        if !absolute {
            rests.push(rest);
            absolute = path_absolute;
        }
        if absolute && !device.is_empty() {
            break;
        }
    }
    // A drive no path is rooted on: Node takes its directory from `=C:`, which only `cmd` sets, else its root.
    absolute |= !device.is_empty();
    let mut segments: Vec<&str> = Vec::new();
    for part in rests.iter().rev().flat_map(|rest| rest.split(['/', '\\'])) {
        match part {
            "" | "." => {}
            ".." if segments.last().is_some_and(|last| *last != "..") => {
                segments.pop();
            }
            ".." if absolute => {}
            _ => segments.push(part),
        }
    }
    let joined = segments.join("\\");
    if absolute {
        return format!("{device}\\{joined}");
    }
    let relative = format!("{device}{joined}");
    if relative.is_empty() { ".".to_owned() } else { relative }
}

/// The device (`C:`, `\\server\share`, or empty) of a Windows path, the rest after it, and whether the path is
/// rooted. As in Node, `\\` starts a UNC device only when a server and a share follow.
fn windows_root(path: &str) -> (String, &str, bool) {
    let is_sep = |c: char| c == '/' || c == '\\';
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return (path[..2].to_owned(), &path[2..], bytes.get(2).is_some_and(|&b| is_sep(char::from(b))));
    }
    if !path.starts_with(is_sep) {
        return (String::new(), path, false);
    }
    let unc = path[1..].strip_prefix(is_sep).and_then(|rest| {
        let (server, rest) = rest.split_once(is_sep)?;
        let rest = rest.trim_start_matches(is_sep);
        let share_end = rest.find(is_sep).unwrap_or(rest.len());
        (!server.is_empty() && share_end > 0)
            .then(|| (format!("\\\\{server}\\{}", &rest[..share_end]), &rest[share_end..]))
    });
    let (device, rest) = unc.unwrap_or((String::new(), path));
    (device, rest, true)
}

/// `FSUtil.windowsPath`: on Windows, the MSYS and WSL spellings `/c:/x`, `/c/x`, `/cygdrive/c/x` and `/mnt/c/x`
/// become `C:/x`. Other paths, and every path on POSIX, are unchanged.
pub fn windows_path(flavor: Flavor, path: &str) -> Cow<'_, str> {
    if flavor == Flavor::Posix {
        return Cow::Borrowed(path);
    }
    let rules: [(&str, bool, &[char]); 4] =
        [("/", true, &['/', '\\']), ("/", false, &['/']), ("/cygdrive/", false, &['/']), ("/mnt/", false, &['/'])];
    for (prefix, colon, separators) in rules {
        let Some(rest) = path.strip_prefix(prefix) else { continue };
        let mut chars = rest.chars();
        let Some(drive) = chars.next().filter(char::is_ascii_alphabetic) else { continue };
        let rest = chars.as_str();
        let Some(rest) = (if colon { rest.strip_prefix(':') } else { Some(rest) }) else { continue };
        let tail = match rest.chars().next() {
            None => "",
            Some(c) if separators.contains(&c) => &rest[1..],
            Some(_) => continue,
        };
        return Cow::Owned(format!("{}:/{tail}", drive.to_ascii_uppercase()));
    }
    Cow::Borrowed(path)
}

/// The path `realpath` gives, from what `std::fs::canonicalize` gives: Windows returns a verbatim path, so
/// `\\?\C:\x` becomes `C:\x` and `\\?\UNC\server\share` becomes `\\server\share`. Other paths are unchanged.
pub fn strip_verbatim(path: &str) -> Cow<'_, str> {
    if let Some(rest) = path.strip_prefix("\\\\?\\UNC\\") {
        return Cow::Owned(format!("\\\\{rest}"));
    }
    match path.strip_prefix("\\\\?\\") {
        Some(rest) if Flavor::of(rest) == Flavor::Windows && !rest.starts_with('\\') => Cow::Borrowed(rest),
        _ => Cow::Borrowed(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_split_resolve_and_relate() {
        let w = Flavor::Windows;
        for (path, root) in [
            ("C:\\a\\b", "C:\\"),
            ("c:/a/b", "c:\\"),
            ("C:a", "C:"),
            ("\\\\srv\\share\\x", "\\\\srv\\share\\"),
            ("//srv/share/x", "\\\\srv\\share\\"),
            ("\\a", "\\"),
            ("a\\b", ""),
        ] {
            assert_eq!(w.root(path), root, "{path}");
        }
        assert_eq!(w.resolve(&["C:\\p", "a/../b\\.\\c"]), "C:\\p\\b\\c");
        assert_eq!(w.resolve(&["C:\\p", "D:/q"]), "D:\\q");
        assert_eq!(w.resolve(&["C:\\p\\q", "\\r"]), "C:\\r");
        assert_eq!(w.resolve(&["C:\\", ".."]), "C:\\");
        assert_eq!(w.resolve(&["\\\\srv\\share\\x", ".."]), "\\\\srv\\share\\");
        // From `path.win32.resolve`: a later path keeps the device of an earlier one.
        assert_eq!(w.resolve(&["C:\\repo\\base", "C:child"]), "C:\\repo\\base\\child");
        assert_eq!(w.resolve(&["\\\\srv\\share\\repo", "/docs"]), "\\\\srv\\share\\docs");
        assert_eq!(w.resolve(&["C:\\repo", "///a/b"]), "C:\\a\\b");
        assert_eq!(w.resolve(&["c:\\p", "C:q", "..\\r"]), "C:\\p\\r");
        assert_eq!(w.resolve(&["\\\\srv\\share\\proj", "/foo"]), "\\\\srv\\share\\foo");
        assert_eq!(w.resolve(&["C:\\p", "C:sub\\x"]), "C:\\p\\sub\\x");
        assert_eq!(w.resolve(&["C:\\Users\\me\\proj", "C:sub\\file.txt"]), "C:\\Users\\me\\proj\\sub\\file.txt");
        // A drive no path is rooted on: Node reads that drive's directory from `=C:`, which a process started
        // outside `cmd` lacks, and then starts at the drive's root.
        assert_eq!(w.resolve(&["D:\\p", "C:sub\\file.txt"]), "C:\\sub\\file.txt");
        assert_eq!(w.resolve(&["C:\\p", "D:q"]), "D:\\q");
        // Where Node would read the working directory, the result stays relative.
        assert_eq!(w.resolve(&["a", "..\\..\\b"]), "..\\b");
        assert_eq!(w.root("///a/b"), "\\");
        assert_eq!(w.relative("C:\\Users\\U", "c:\\users\\u\\src/x"), "src\\x");
        assert_eq!(w.relative("C:\\a\\b", "C:\\a\\c"), "..\\c");
        assert_eq!(w.relative("C:\\a", "D:\\a"), "D:\\a");
        assert!(w.outside("..\\c") && w.outside("D:\\a") && !w.outside("..x"));
        assert!(w.is_absolute("C:/x") && w.is_absolute("\\x") && !w.is_absolute("C:x") && !w.is_absolute("x"));
        assert_eq!(w.basename("C:\\a\\b\\"), "b");
        assert_eq!(w.basename("C:/a/b"), "b");
        assert_eq!(w.basename("C:\\"), "");
        assert_eq!(w.basename("C:x"), "x");
    }

    #[test]
    fn join_and_normalize_follow_node() {
        let (w, p) = (Flavor::Windows, Flavor::Posix);
        // `path.win32.join` and `path.posix.join`.
        for (flavor, parts, expected) in [
            (w, &["/old", "*"][..], "\\old\\*"),
            (w, &["D:\\shared\\lib", "*"], "D:\\shared\\lib\\*"),
            (w, &["C:/a//b/../c/", "*"], "C:\\a\\c\\*"),
            (w, &["\\\\srv\\share", "*"], "\\\\srv\\share\\*"),
            (w, &["C:", "*"], "C:\\*"),
            (w, &["", ""], "."),
            (p, &["/old", "*"], "/old/*"),
            (p, &["/a//b/./../c/", "*"], "/a/c/*"),
            (p, &["a", "../../b"], "../b"),
            (p, &["C:\\x", "*"], "C:\\x/*"),
        ] {
            assert_eq!(flavor.join(parts), expected, "{flavor:?} {parts:?}");
        }
        // `path.win32.normalize` and `path.posix.normalize`.
        for (flavor, path, expected) in [
            (w, "C:", "C:."),
            (w, "C:\\..\\a\\", "C:\\a\\"),
            (w, "/x/./y", "\\x\\y"),
            (w, "a\\..\\", ".\\"),
            (w, "\\\\srv\\share", "\\\\srv\\share\\"),
            (p, "/..", "/"),
            (p, "./", "./"),
            (p, "", "."),
        ] {
            assert_eq!(flavor.normalize(path), expected, "{flavor:?} {path}");
        }
    }

    #[test]
    fn posix_paths_ignore_backslashes() {
        let p = Flavor::Posix;
        assert_eq!(p.resolve(&["/p", "a/../b/./c"]), "/p/b/c");
        assert_eq!(p.resolve(&["/p", "C:\\x"]), "/p/C:\\x");
        assert_eq!(p.relative("/h", "/h/a/b"), "a/b");
        assert_eq!(p.basename("/p/a\\b/"), "a\\b");
        assert_eq!(p.root("/x"), "/");
        assert!(!p.is_absolute("C:\\x"));
    }

    #[test]
    fn msys_and_wsl_drives_become_windows_drives() {
        let w = |path| windows_path(Flavor::Windows, path).into_owned();
        assert_eq!(w("/c:/x"), "C:/x");
        assert_eq!(w("/c:\\x"), "C:/x");
        assert_eq!(w("/d"), "D:/");
        assert_eq!(w("/c/Users/u"), "C:/Users/u");
        assert_eq!(w("/cygdrive/e/p"), "E:/p");
        assert_eq!(w("/mnt/c"), "C:/");
        assert_eq!(w("/cd/x"), "/cd/x");
        assert_eq!(w("/mnt/cd"), "/mnt/cd");
        assert_eq!(w("C:\\x"), "C:\\x");
        assert_eq!(windows_path(Flavor::Posix, "/c/x"), "/c/x");
    }

    #[test]
    fn verbatim_prefixes_strip() {
        assert_eq!(strip_verbatim("\\\\?\\C:\\Users\\u"), "C:\\Users\\u");
        assert_eq!(strip_verbatim("\\\\?\\UNC\\srv\\share\\x"), "\\\\srv\\share\\x");
        assert_eq!(strip_verbatim("\\\\?\\Volume{1}\\x"), "\\\\?\\Volume{1}\\x");
        assert_eq!(strip_verbatim("C:\\x"), "C:\\x");
        assert_eq!(strip_verbatim("/tmp/x"), "/tmp/x");
    }
}
