//! Path formatting (U.3): `packages/tui/src/util/path-format.ts` and `context/path-format.tsx`.
//!
//! Paths show relative to the working directory when they are inside it, else with `~` for the home directory, as
//! the TUI shows them. POSIX and Windows paths follow Node's `path.posix` and `path.win32` rules, whichever the base
//! looks like, so a Windows server's paths format the same on any client.

use std::path::Path;

pub use opencode_util::path::Flavor;

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
    if flavor.outside(&relative) {
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
    let flavor = Flavor::of(base);
    let slashes = |text: String| {
        if forward_slashes { text.replace('\\', "/") } else { text }
    };
    if flavor == Flavor::Posix && Flavor::of(input) == Flavor::Windows {
        return slashes(input.to_owned());
    }
    let absolute = if flavor.is_absolute(input) { input.to_owned() } else { flavor.resolve(&[base, input]) };
    let relative = flavor.relative(base, &absolute);
    let formatted = if relative.is_empty() {
        ".".to_owned()
    } else if !flavor.outside(&relative) {
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

/// `path.relative(from, to)`, by the rules `from` looks like.
pub fn relative(from: &str, to: &str) -> String {
    Flavor::of(from).relative(from, to)
}
