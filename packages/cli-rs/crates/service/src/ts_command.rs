//! TypeScript binary resolution: `OPENCODE_TS_BIN`, else `opencode` (F.9).
//!
//! The Rust client is not a server (user Q2). It starts the TypeScript `opencode` for the background
//! service and the standalone server, as the TypeScript client runs `selfCommand()`
//! (`packages/cli/src/services/service-config.ts:150`, `standalone.ts:18-20`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The program that runs the TypeScript CLI, with the arguments that come before a command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TsCommand {
    pub program: OsString,
    pub args: Vec<OsString>,
}

impl TsCommand {
    /// The variable that names the TypeScript binary.
    pub const VAR: &str = "OPENCODE_TS_BIN";

    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var_os(name))
    }

    /// `OPENCODE_TS_BIN` (one executable path; an empty value counts as unset), else `opencode`,
    /// found on `PATH` when it runs. On Windows `opencode` is looked up here, through `PATHEXT`, because
    /// `Command` finds only `opencode.exe` and npm installs an `opencode.cmd` shim.
    pub fn from_vars(var: impl Fn(&str) -> Option<OsString>) -> Self {
        Self::resolve(var, cfg!(windows))
    }

    /// `from_vars` as it runs on Windows when `windows` is set, so tests on other systems reach the lookup.
    pub fn resolve(var: impl Fn(&str) -> Option<OsString>, windows: bool) -> Self {
        if let Some(program) = var(Self::VAR).filter(|program| !program.is_empty()) {
            return Self::new(program);
        }
        let found = if windows {
            var("PATH").and_then(|path| {
                search(
                    &path,
                    var("PATHEXT").as_deref(),
                    "opencode",
                    |path| path.is_file(),
                    |path| std::fs::read_to_string(path).ok(),
                )
            })
        } else {
            None
        };
        Self::new(found.map_or_else(|| "opencode".into(), PathBuf::into_os_string))
    }

    pub fn new(program: impl Into<OsString>) -> Self {
        Self { program: program.into(), args: Vec::new() }
    }

    /// `opencode serve --service`.
    pub fn service(&self) -> Vec<OsString> {
        self.with(&["serve", "--service"])
    }

    /// `opencode serve --stdio --port 0`.
    pub fn standalone(&self) -> Vec<OsString> {
        self.with(&["serve", "--stdio", "--port", "0"])
    }

    /// The program, its leading arguments, then `args`.
    pub fn with(&self, args: &[&str]) -> Vec<OsString> {
        [self.program.clone()]
            .into_iter()
            .chain(self.args.iter().cloned())
            .chain(args.iter().map(OsString::from))
            .collect()
    }
}

/// Where Windows finds `name` on `path`: each directory in order, trying `.exe` first and then the other `PATHEXT`
/// extensions (`.COM;.EXE;.BAT;.CMD` when unset). An npm `.cmd` shim that runs an `.exe` resolves to that `.exe`, so
/// delegated arguments reach it without `cmd.exe` quoting. `exists` and `read` stand in for the file system.
pub fn search(
    path: &std::ffi::OsStr,
    pathext: Option<&std::ffi::OsStr>,
    name: &str,
    exists: impl Fn(&Path) -> bool,
    read: impl Fn(&Path) -> Option<String>,
) -> Option<PathBuf> {
    let pathext = pathext.map_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned(), |ext| ext.to_string_lossy().into_owned());
    let extensions: Vec<&str> = std::iter::once(".exe")
        .chain(pathext.split(';').filter(|ext| !ext.is_empty() && !ext.eq_ignore_ascii_case(".exe")))
        .collect();
    // `std::env::split_paths` on Windows: a `;` inside double quotes is part of the directory, and quotes are dropped.
    let mut dirs = vec![String::new()];
    let mut quoted = false;
    for c in path.to_string_lossy().chars() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => dirs.push(String::new()),
            _ => dirs.last_mut().expect("one directory at least").push(c),
        }
    }
    let found = dirs
        .iter()
        .filter(|dir| !dir.is_empty())
        .flat_map(|dir| {
            extensions.iter().map(move |ext| Path::new(dir).join(format!("{name}{}", ext.to_ascii_lowercase())))
        })
        .find(|candidate| exists(candidate))?;
    let shim = found.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"));
    let target = shim
        .then(|| read(&found))
        .flatten()
        .and_then(|text| {
            let dir = found.parent().unwrap_or(Path::new("")).to_path_buf();
            let target = shim_target(&text)?;
            Some(target.split(['\\', '/']).filter(|part| !part.is_empty()).fold(dir, |dir, part| dir.join(part)))
        })
        .filter(|target| exists(target));
    Some(target.unwrap_or(found))
}

/// The `.exe` an npm `cmd-shim` runs, relative to the shim's directory: the first quoted word of the line that passes
/// `%*` on, when it is `%dp0%\…\x.exe` (`%~dp0\…` in older shims). A shim that runs a script through `node` starts
/// that line with `"%_prog%"` instead, so it has none.
pub fn shim_target(text: &str) -> Option<&str> {
    let line = text.lines().find(|line| line.contains("%*"))?;
    let quoted = line.split('"').nth(1)?;
    let relative = quoted.strip_prefix("%dp0%").or_else(|| quoted.strip_prefix("%~dp0"))?;
    let exe =
        relative.len() > 4 && relative.get(relative.len() - 4..).is_some_and(|ext| ext.eq_ignore_ascii_case(".exe"));
    (exe && !relative.contains('%')).then_some(relative)
}

/// For tests: writes an executable script that stands in for the TypeScript binary. `sh` writes it, because a
/// write descriptor open in the test process can leak into a child that another test thread forks, and an exec
/// of the script then fails with ETXTBSY.
#[doc(hidden)]
#[cfg(unix)]
pub fn write_script(path: &std::path::Path, script: &str) {
    let status = std::process::Command::new("sh")
        .args(["-c", "printf %s \"$1\" > \"$0\" && chmod 755 \"$0\""])
        .arg(path)
        .arg(script)
        .status()
        .unwrap();
    assert!(status.success(), "write {}", path.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_variable_wins_and_empty_means_unset() {
        let from = |value: Option<&str>| {
            TsCommand::from_vars(|name| (name == "OPENCODE_TS_BIN").then_some(value).flatten().map(OsString::from))
        };
        assert_eq!(from(None).program, "opencode");
        assert_eq!(from(Some("")).program, "opencode");
        assert_eq!(from(Some("/x/opencode")).program, "/x/opencode");
        let mut command = TsCommand::new("bun");
        command.args.push("cli.ts".into());
        assert_eq!(command.service(), ["bun", "cli.ts", "serve", "--service"]);
        assert_eq!(command.standalone(), ["bun", "cli.ts", "serve", "--stdio", "--port", "0"]);
    }

    // What `cmd-shim` (npm 10) writes for a native and for a JavaScript `bin`.
    const EXE_SHIM: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe\"   %*\r\n";
    const NODE_SHIM: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\x\\cli.js\" %*\r\n";

    #[test]
    fn a_shim_names_its_exe() {
        assert_eq!(shim_target(EXE_SHIM), Some("\\node_modules\\@opencode\\cli\\bin\\opencode.exe"));
        assert_eq!(shim_target("\"%~dp0\\bin\\Opencode.EXE\" %*"), Some("\\bin\\Opencode.EXE"));
        assert_eq!(shim_target(NODE_SHIM), None);
        assert_eq!(shim_target("\"%dp0%\\bin\\opencode.js\" %*"), None);
        assert_eq!(shim_target("\"%dp0%\\%x%.exe\" %*"), None);
        assert_eq!(shim_target("\"C:\\opencode.exe\" %*"), None);
        assert_eq!(shim_target("\"%dp0%.exe\" %*"), None);
        assert_eq!(shim_target(""), None);
    }

    #[test]
    fn the_search_follows_path_then_extensions_with_exe_first() {
        let npm = Path::new("npm");
        let shim_exe = ["npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"].iter().collect::<PathBuf>();
        let find = |pathext: Option<&str>, files: &[PathBuf], shim: &str| {
            search(
                std::ffi::OsStr::new("\"npm\";;winget"),
                pathext.map(std::ffi::OsStr::new),
                "opencode",
                |path| files.iter().any(|file| file == path),
                |path| (path.extension().is_some_and(|ext| ext == "cmd")).then(|| shim.to_owned()),
            )
        };
        let winget = Path::new("winget").join("opencode.exe");
        let cmd = npm.join("opencode.cmd");
        let cases = [
            // A `.cmd` that names an existing `.exe` resolves to it.
            (None, vec![cmd.clone(), shim_exe.clone(), winget.clone()], EXE_SHIM, Some(shim_exe.clone())),
            // Its target is missing, or it runs `node`: the shim itself.
            (None, vec![cmd.clone(), winget.clone()], EXE_SHIM, Some(cmd.clone())),
            (None, vec![cmd.clone(), shim_exe.clone()], NODE_SHIM, Some(cmd.clone())),
            // An earlier directory wins over a later `.exe`; within one, `.exe` wins over PATHEXT's order.
            (Some(".CMD;.EXE"), vec![cmd.clone(), npm.join("opencode.exe")], NODE_SHIM, Some(npm.join("opencode.exe"))),
            (None, vec![winget.clone()], "", Some(winget.clone())),
            // Only PATHEXT's extensions count, and the extensionless sh shim never does.
            (Some(".EXE"), vec![cmd.clone()], EXE_SHIM, None),
            (None, vec![npm.join("opencode"), npm.join("opencode.ps1")], "", None),
            (Some(".BAT"), vec![npm.join("opencode.bat")], "", Some(npm.join("opencode.bat"))),
        ];
        for (pathext, files, shim, expected) in cases {
            assert_eq!(find(pathext, &files, shim), expected, "{pathext:?} {files:?}");
        }
    }

    // `Command` runs a found `.cmd` through `cmd.exe /c` and escapes its arguments for it.
    #[cfg(windows)]
    #[test]
    fn a_found_cmd_shim_spawns_with_its_arguments() {
        let dir = opencode_util::temp::tempdir().unwrap();
        std::fs::write(dir.path().join("opencode"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.path().join("opencode.cmd"), "@ECHO off\r\nECHO %*\r\n").unwrap();
        let ts = TsCommand::resolve(
            |name| match name {
                "PATH" => Some(dir.path().into()),
                "PATHEXT" => Some(".COM;.EXE;.BAT;.CMD;.VBS;.JS".into()),
                _ => None,
            },
            true,
        );
        assert_eq!(ts.program, dir.path().join("opencode.cmd"));
        let command = ts.with(&["serve", "--stdio", "a b"]);
        let output = std::process::Command::new(&command[0]).args(&command[1..]).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "serve --stdio \"a b\"");
    }

    #[test]
    fn a_quoted_directory_keeps_its_semicolon() {
        let shim = Path::new("tool;cache").join("opencode.cmd");
        let found =
            search(std::ffi::OsStr::new("C:\\x;\"tool;cache\";D:\\y"), None, "opencode", |path| path == shim, |_| None);
        assert_eq!(found, Some(shim));
    }
}
