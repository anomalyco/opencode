//! Path formatting (U.3): `packages/tui/src/util/path-format.ts` and `context/path-format.tsx`.
//!
//! Paths show relative to the working directory when they are inside it, else with `~` for the home directory, as
//! the TUI shows them. POSIX and Windows paths follow Node's `path.posix` and `path.win32` rules, whichever the base
//! looks like, so a Windows server's paths format the same on any client.

use std::path::Path;

/// `abbreviateHome`: `~` or `~/…` when `input` is inside `home`, else `input`.
pub fn abbreviate_home(input: &str, home: &str) -> String {
    if home.is_empty() {
        return input.to_owned();
    }
    let flavor = Flavor::of(home);
    let relative = flavor.relative(home, input);
    if relative.is_empty() {
        return "~".to_owned();
    }
    if outside(flavor, &relative) {
        return input.to_owned();
    }
    format!("~/{}", relative.split(flavor.sep()).collect::<Vec<_>>().join("/"))
}

/// `formatPath`: `input` relative to `base` when inside it (`.` for `base` itself), else abbreviated with `home`
/// when given, else absolute.
pub fn format_path(input: &str, base: &str, home: Option<&str>, forward_slashes: bool) -> String {
    if input.is_empty() {
        return String::new();
    }
    let windows = windows_path(base);
    let slashes = |text: String| {
        if forward_slashes { text.replace('\\', "/") } else { text }
    };
    if !windows && windows_path(input) {
        return slashes(input.to_owned());
    }
    let flavor = if windows { Flavor::Windows } else { Flavor::Posix };
    let absolute = if flavor.is_absolute(input) { input.to_owned() } else { flavor.resolve(&[base, input]) };
    let relative = flavor.relative(base, &absolute);
    let formatted = if relative.is_empty() {
        ".".to_owned()
    } else if !outside(flavor, &relative) {
        relative
    } else {
        match home {
            Some(home) if !home.is_empty() => abbreviate_home(&absolute, home),
            _ => absolute,
        }
    };
    slashes(formatted)
}

/// `usePathFormatter().format`: relative to the location's directory, else the working directory, with `~` for
/// the user's home.
pub fn format(input: &str, directory: Option<&str>, cwd: &Path, home: Option<&Path>) -> String {
    let cwd = cwd.to_string_lossy();
    let base = directory.filter(|directory| !directory.is_empty()).unwrap_or(&cwd);
    let home = home.map(|home| home.to_string_lossy().into_owned());
    format_path(input, base, home.as_deref(), false)
}

fn outside(flavor: Flavor, relative: &str) -> bool {
    relative == ".." || relative.starts_with(&format!("..{}", flavor.sep())) || flavor.is_absolute(relative)
}

fn windows_path(input: &str) -> bool {
    let bytes = input.as_bytes();
    let drive =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
    drive || input.starts_with("\\\\")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Flavor {
    Posix,
    Windows,
}

impl Flavor {
    fn of(path: &str) -> Self {
        if windows_path(path) { Self::Windows } else { Self::Posix }
    }

    fn sep(self) -> char {
        match self {
            Self::Posix => '/',
            Self::Windows => '\\',
        }
    }

    fn is_absolute(self, path: &str) -> bool {
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

    // Splits a path into its root (`/`, `C:\`, `\\server\share\`, `\`, or empty) and its segments.
    fn split(self, path: &str) -> (String, Vec<String>) {
        let is_sep = |c: char| c == '/' || (self == Self::Windows && c == '\\');
        let segments = |rest: &str| -> Vec<String> {
            rest.split(is_sep).filter(|part| !part.is_empty()).map(str::to_owned).collect()
        };
        if self == Self::Posix {
            let root = if path.starts_with('/') { "/" } else { "" };
            return (root.to_owned(), segments(path));
        }
        let bytes = path.as_bytes();
        if bytes.len() >= 2 && is_sep(char::from(bytes[0])) && is_sep(char::from(bytes[1])) {
            let parts = segments(path);
            if parts.len() >= 2 {
                return (format!("\\\\{}\\{}\\", parts[0], parts[1]), parts[2..].to_vec());
            }
        }
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let rooted = bytes.get(2).is_some_and(|&b| is_sep(char::from(b)));
            let drive = &path[..2];
            let root = if rooted { format!("{drive}\\") } else { drive.to_owned() };
            return (root, segments(&path[2..]));
        }
        let root = if bytes.first().is_some_and(|&b| is_sep(char::from(b))) { "\\" } else { "" };
        (root.to_owned(), segments(path))
    }

    // `path.resolve` over absolute bases: the last rooted path wins, `.` and `..` fold.
    fn resolve(self, paths: &[&str]) -> String {
        let mut root = String::new();
        let mut segments: Vec<String> = Vec::new();
        for path in paths {
            let (path_root, parts) = self.split(path);
            if !path_root.is_empty() {
                // A rooted Windows path without a drive keeps the drive it is resolved against.
                root = if path_root == "\\" && root.len() >= 2 && root.as_bytes()[1] == b':' {
                    format!("{}\\", &root[..2])
                } else {
                    path_root
                };
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
        let sep = self.sep().to_string();
        let joined = segments.join(&sep);
        if root.is_empty() {
            return if joined.is_empty() { ".".to_owned() } else { joined };
        }
        format!("{root}{joined}")
    }

    // `path.relative` between two paths resolved the same way: `..` up to the common ancestor, then down.
    fn relative(self, from: &str, to: &str) -> String {
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
}
