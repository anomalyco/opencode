//! Node's `path.posix` and `path.win32` on strings. TypeScript code uses `path`, which is `path.win32` when
//! `process.platform` is `win32`; [`Flavor::NATIVE`] picks the same one. The functions are pure, so either flavour
//! runs on any host, except that [`Flavor::resolve`] on Windows reads the working directory's drive.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

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
        self.render(self.parse(path).0, std::iter::empty())
    }

    /// `path.resolve` over an absolute base: the last rooted path wins, `.` and `..` fold. Without a rooted path
    /// the result stays relative (`.` when empty), where Node would start from the working directory. On Windows a
    /// rooted result without a drive takes the working directory's, as Node does.
    pub fn resolve(self, paths: &[&str]) -> String {
        self.resolve_in(&self.cwd(), paths)
    }

    /// `path.relative` between two paths resolved the same way: `..` up to the common ancestor, then down. Windows
    /// compares without case.
    pub fn relative(self, from: &str, to: &str) -> String {
        let cwd = self.cwd();
        let (from, to) = (self.resolve_one(&cwd, from), self.resolve_one(&cwd, to));
        let ((from_root, from_rest), (to_root, to_rest)) = (self.parse(&from), self.parse(&to));
        if !from_root.same(to_root) {
            return self.render(to_root, self.segments(to_rest));
        }
        let same = |a: &str, b: &str| match self {
            Self::Posix => a == b,
            Self::Windows => a.eq_ignore_ascii_case(b),
        };
        let common = self.segments(from_rest).zip(self.segments(to_rest)).take_while(|(a, b)| same(a, b)).count();
        let ups = self.segments(from_rest).count() - common;
        self.render(Root::NONE, std::iter::repeat_n("..", ups).chain(self.segments(to_rest).skip(common)))
    }

    /// `path.normalize`: `.` and `..` fold, separators collapse (to `\` on Windows), a trailing separator stays, and
    /// an empty relative path is `.`. `..` above a root is dropped; in a relative path it stays.
    pub fn normalize(self, path: &str) -> String {
        if path.is_empty() {
            return ".".to_owned();
        }
        let (root, rest) = self.parse(path);
        let mut segments = Vec::new();
        fold(&mut segments, self.segments(rest), !root.absolute);
        let mut out = self.render(root, segments.iter().copied());
        if segments.is_empty() && !root.absolute {
            out.push('.');
        }
        if (!segments.is_empty() || !root.absolute) && path.ends_with(|c| self.is_sep(c)) {
            out.push(self.sep());
        }
        out
    }

    /// `path.join`: the non-empty parts joined with the separator, then [normalized](Self::normalize).
    pub fn join(self, parts: &[&str]) -> String {
        let parts: Vec<&str> = parts.iter().copied().filter(|part| !part.is_empty()).collect();
        self.normalize(&parts.join(&self.sep().to_string()))
    }

    /// Whether a [`relative`](Self::relative) result leaves its base: `..`, `../…`, or absolute.
    pub fn outside(self, relative: &str) -> bool {
        relative.strip_prefix("..").is_some_and(|rest| rest.is_empty() || rest.starts_with(self.sep()))
            || self.is_absolute(relative)
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

    /// [`resolve`](Self::resolve), with `cwd` as the working directory whose device a rooted Windows path without
    /// one takes.
    fn resolve_in(self, cwd: &str, paths: &[&str]) -> String {
        let (root, start) = match self {
            Self::Posix => {
                let start = paths.iter().rposition(|path| path.starts_with('/'));
                (Root { device: Device::None, absolute: start.is_some() }, start.unwrap_or(0))
            }
            Self::Windows => windows_start(cwd, paths),
        };
        let rests = paths[start..].iter().filter_map(|path| {
            let (path_root, rest) = self.parse(path);
            (path_root.device.is_none() || path_root.device.same(root.device)).then_some(rest)
        });
        let segments = rests.flat_map(|rest| self.segments(rest));
        let resolved = if segments.clone().all(|part| part != "." && part != "..") {
            self.render(root, segments)
        } else {
            let mut folded = Vec::new();
            // POSIX drops `..` above the start where Node would start from the working directory.
            fold(&mut folded, segments, self == Self::Windows && !root.absolute);
            self.render(root, folded.into_iter())
        };
        if resolved.is_empty() { ".".to_owned() } else { resolved }
    }

    /// `path` resolved alone, borrowed when resolving changes no more than its separators, so that both have the
    /// same root and segments.
    fn resolve_one<'a>(self, cwd: &str, path: &'a str) -> Cow<'a, str> {
        let (root, rest) = self.parse(path);
        let settled = match root.device {
            Device::None => !path.is_empty() && (self == Self::Posix || !root.absolute),
            _ => root.absolute,
        };
        if settled && self.segments(rest).all(|part| part != "." && part != "..") {
            return Cow::Borrowed(path);
        }
        Cow::Owned(self.resolve_in(cwd, &[path]))
    }

    /// The working directory whose device a rooted Windows path without one takes. Only a Windows host has one.
    fn cwd(self) -> String {
        if self == Self::Windows
            && Self::NATIVE == Self::Windows
            && let Ok(cwd) = std::env::current_dir()
        {
            return strip_verbatim(&cwd.to_string_lossy()).into_owned();
        }
        String::new()
    }

    /// A path's root, and the rest after it.
    fn parse(self, path: &str) -> (Root<'_>, &str) {
        match self {
            Self::Posix => (Root { device: Device::None, absolute: path.starts_with('/') }, path),
            Self::Windows => {
                let (device, rest, absolute) = windows_root(path);
                (Root { device, absolute }, rest)
            }
        }
    }

    /// The non-empty segments of a path's rest.
    fn segments(self, rest: &str) -> impl Iterator<Item = &str> + Clone {
        let separators: &'static [char] = match self {
            Self::Posix => &['/'],
            Self::Windows => &['/', '\\'],
        };
        rest.split(separators).filter(|part| !part.is_empty())
    }

    /// `root`, then `segments` joined with the separator.
    fn render<'a>(self, root: Root<'_>, segments: impl Iterator<Item = &'a str> + Clone) -> String {
        let device = match root.device {
            Device::None => ["", "", "", ""],
            Device::Drive(drive) => [drive, "", "", ""],
            Device::Unc { server, share } => ["\\\\", server, "\\", share],
        };
        let length = device.iter().map(|part| part.len()).sum::<usize>() + usize::from(root.absolute);
        let mut out = String::with_capacity(length + segments.clone().map(|part| part.len() + 1).sum::<usize>());
        device.iter().for_each(|part| out.push_str(part));
        if root.absolute {
            out.push(self.sep());
        }
        for (index, part) in segments.enumerate() {
            if index > 0 {
                out.push(self.sep());
            }
            out.push_str(part);
        }
        out
    }
}

/// A path's root: its device on Windows, and whether a separator follows it.
#[derive(Clone, Copy)]
struct Root<'a> {
    device: Device<'a>,
    absolute: bool,
}

impl Root<'_> {
    const NONE: Root<'static> = Root { device: Device::None, absolute: false };

    fn same(self, other: Root<'_>) -> bool {
        self.absolute == other.absolute && self.device.same(other.device)
    }
}

/// A Windows device: a drive (`C:`), a UNC share (`\\server\share`), or none.
#[derive(Clone, Copy)]
enum Device<'a> {
    None,
    Drive(&'a str),
    Unc { server: &'a str, share: &'a str },
}

impl Device<'_> {
    fn is_none(self) -> bool {
        matches!(self, Self::None)
    }

    /// Whether two devices are the same, without case.
    fn same(self, other: Device<'_>) -> bool {
        match (self, other) {
            (Self::None, Device::None) => true,
            (Self::Drive(a), Device::Drive(b)) => a.eq_ignore_ascii_case(b),
            (Self::Unc { server, share }, Device::Unc { server: other_server, share: other_share }) => {
                server.eq_ignore_ascii_case(other_server) && share.eq_ignore_ascii_case(other_share)
            }
            _ => false,
        }
    }
}

/// Folds `.` and `..` into `segments`. `..` takes back the segment before it; with none to take back it stays when
/// `keep_up`, else it is dropped.
fn fold<'a>(segments: &mut Vec<&'a str>, parts: impl Iterator<Item = &'a str>, keep_up: bool) {
    for part in parts {
        match part {
            "." => {}
            ".." if segments.last().is_some_and(|last| *last != "..") => {
                segments.pop();
            }
            ".." if !keep_up => {}
            _ => segments.push(part),
        }
    }
}

/// `path.win32.resolve`'s root, and the index of the first path whose segments count: from the last path back,
/// segments collect until a rooted path with a device (a drive or a UNC share). A path on another device than the one
/// found first is skipped, and a rooted path without a device takes the device of an earlier path, else the device
/// of `cwd` (Node's `process.cwd()`). Only a relative result stays relative, where Node would start from the working
/// directory.
fn windows_start<'a>(cwd: &'a str, paths: &[&'a str]) -> (Root<'a>, usize) {
    let mut device = Device::None;
    let mut absolute = false;
    let mut start = 0;
    for (index, path) in paths.iter().enumerate().rev().filter(|(_, path)| !path.is_empty()) {
        let (path_device, _, path_absolute) = windows_root(path);
        if !path_device.is_none() {
            if device.is_none() {
                device = path_device;
            } else if !device.same(path_device) {
                continue;
            }
        }
        if !absolute {
            start = index;
            absolute = path_absolute;
        }
        if absolute && !device.is_none() {
            break;
        }
    }
    if absolute && device.is_none() {
        device = windows_root(cwd).0;
    }
    // A drive no path is rooted on: Node takes its directory from `=C:`, which only `cmd` sets, else its root.
    (Root { device, absolute: absolute || !device.is_none() }, start)
}

/// The device of a Windows path, the rest after it, and whether the path is rooted. As in Node, `\\` starts a UNC
/// device only when a server and a share follow.
fn windows_root(path: &str) -> (Device<'_>, &str, bool) {
    let is_sep = |c: char| c == '/' || c == '\\';
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return (Device::Drive(&path[..2]), &path[2..], bytes.get(2).is_some_and(|&b| is_sep(char::from(b))));
    }
    if !path.starts_with(is_sep) {
        return (Device::None, path, false);
    }
    let unc = path[1..].strip_prefix(is_sep).and_then(|rest| {
        let (server, rest) = rest.split_once(is_sep)?;
        let rest = rest.trim_start_matches(is_sep);
        let share_end = rest.find(is_sep).unwrap_or(rest.len());
        (!server.is_empty() && share_end > 0)
            .then(|| (Device::Unc { server, share: &rest[..share_end] }, &rest[share_end..]))
    });
    let (device, rest) = unc.unwrap_or((Device::None, path));
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

/// `fs.realpathSync`: `canonicalize` without the verbatim prefix Windows adds ([`strip_verbatim`]).
pub fn realpath(path: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(path).ok()?;
    Some(match real.to_str() {
        Some(text) => PathBuf::from(strip_verbatim(text).as_ref()),
        None => real,
    })
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
        // Another root gives the target resolved, with its separators respelled.
        assert_eq!(w.relative("C:\\a", "d:/a/b"), "d:\\a\\b");
        assert_eq!(w.relative("\\\\srv\\share\\a", "//SRV/Share/a/b"), "b");
        assert!(w.outside("..\\c") && w.outside("D:\\a") && !w.outside("..x"));
        assert!(w.is_absolute("C:/x") && w.is_absolute("\\x") && !w.is_absolute("C:x") && !w.is_absolute("x"));
        assert_eq!(w.basename("C:\\a\\b\\"), "b");
        assert_eq!(w.basename("C:/a/b"), "b");
        assert_eq!(w.basename("C:\\"), "");
        assert_eq!(w.basename("C:x"), "x");
    }

    #[test]
    fn a_rooted_windows_path_without_a_drive_takes_the_working_directorys() {
        // From `path.win32.resolve` with `process.cwd()` the `cwd` column.
        for (cwd, paths, expected) in [
            ("D:\\work", &["\\x"][..], "D:\\x"),
            ("D:\\work", &["/project", "packages/"], "D:\\project\\packages"),
            ("D:\\work", &["\\", "/workspace", "sub"], "D:\\workspace\\sub"),
            ("D:\\work", &["C:\\p", "/x"], "C:\\x"),
            ("D:\\work", &["\\\\srv\\share\\p", "/x"], "\\\\srv\\share\\x"),
            ("\\\\srv\\share\\w", &["/x/../y"], "\\\\srv\\share\\y"),
            ("D:\\work", &["C:x"], "C:\\x"),
            // A relative result stays relative, and without a drive to give a rooted one stays as it is.
            ("D:\\work", &["a\\b", ".."], "a"),
            ("", &["/x"], "\\x"),
            ("/home/u", &["/x"], "\\x"),
        ] {
            assert_eq!(Flavor::Windows.resolve_in(cwd, paths), expected, "{cwd} {paths:?}");
        }
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
        assert_eq!(p.relative("/h/./a", "/h//b/"), "../b");
        // An empty relative path resolves to `.`, which counts as a segment.
        assert_eq!(p.relative("a/..", "b"), "../b");
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
