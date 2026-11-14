//! `plugin dev <dir>` and `plugin test <path>` (P4, `rich-plugins/synthesis.md` 4.7): the native plugin author's
//! commands. The TypeScript CLI has neither, so they are not in the command table that mirrors it: `main` takes them
//! before it parses the line (deviation `D01-plugin-dev-test`).
//!
//! - `plugin dev <dir> [tui arguments]` builds the plugin crate in `<dir>` with cargo, copies its library to
//!   `<dir>/target/opencode-dev/`, and runs the TUI with that library as one more `plugins` entry. While the TUI runs,
//!   a change in `<dir>` or `<dir>/src` builds it again; a build that passes replaces the library, which the TUI's
//!   plugin watcher reloads (a reload leaks one library, as every reload does). A build that fails leaves the running
//!   version, and its output goes to `build.log` beside the library.
//! - `plugin test <library or crate dir> [--route NAME] [--size WxH] [--command NAME[=INPUT]]...` loads the plugin into
//!   the TUI on the client's own headless renderer, with no server, and prints a text frame of Home, or of its route
//!   `NAME`, then one after each command.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::memory::{Memory, Route as Served};
use opencode_local::cli_config::{Info, Plugin, Resolved};
use opencode_local::watch::Watch;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Args, Deps, Route};
use opencode_util::{err, error};
use opentui::testing::TestApp;

/// A native-only command line.
pub enum Native {
    /// `plugin dev <dir>`, with the TUI's own arguments after it.
    Dev {
        dir: PathBuf,
        rest: Vec<String>,
    },
    Test(Test),
}

/// What `plugin test` renders.
#[derive(Debug, PartialEq, Eq)]
pub struct Test {
    pub path: PathBuf,
    pub route: Option<String>,
    pub size: (u16, u16),
    pub commands: Vec<(String, Option<String>)>,
}

/// The native-only command `args` names, if any; an error for one it names with arguments it cannot take.
pub fn take(args: &[String]) -> Option<error::Result<Native>> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let ["plugin", command, rest @ ..] = &args[..] else {
        return None;
    };
    let usage = |text: &str| Some(Err(err!("{text}")));
    match *command {
        "dev" => match rest {
            [dir, rest @ ..] => Some(Ok(Native::Dev {
                dir: PathBuf::from(dir),
                rest: rest.iter().map(|arg| (*arg).to_owned()).collect(),
            })),
            [] => usage("usage: opencode-native plugin dev <dir> [arguments of the TUI]"),
        },
        "test" => Some(parse_test(rest).map(Native::Test)),
        _ => None,
    }
}

fn parse_test(args: &[&str]) -> error::Result<Test> {
    let usage = "usage: opencode-native plugin test <library or crate dir> [--route NAME] [--size WxH] \
                 [--command NAME[=INPUT]]...";
    let mut test = Test { path: PathBuf::new(), route: None, size: (80, 24), commands: Vec::new() };
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let mut value = || args.next().copied().ok_or_else(|| err!("{arg} needs a value\n{usage}"));
        match *arg {
            "--route" => test.route = Some(value()?.to_owned()),
            "--size" => {
                let size = value()?;
                let parsed = size.split_once('x').and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)));
                test.size = parsed.filter(|(w, h)| *w > 0 && *h > 0).ok_or_else(|| err!("bad size {size}"))?;
            }
            "--command" => {
                let command = value()?;
                test.commands.push(match command.split_once('=') {
                    Some((name, input)) => (name.to_owned(), Some(input.to_owned())),
                    None => (command.to_owned(), None),
                });
            }
            path if test.path.as_os_str().is_empty() && !path.starts_with("--") => test.path = PathBuf::from(path),
            other => return Err(err!("unexpected {other}\n{usage}")),
        }
    }
    if test.path.as_os_str().is_empty() {
        return Err(err!("{usage}"));
    }
    Ok(test)
}

/// A plugin under `plugin dev`: its library, and the watch that builds it again while the TUI runs.
pub struct Dev {
    pub library: PathBuf,
    _watches: Vec<Watch>,
}

/// Builds the crate in `dir`, installs its library, and watches the crate for changes.
pub fn dev(dir: &Path) -> error::Result<Dev> {
    let dir = std::fs::canonicalize(dir).map_err(|error| err!("{}: {error}", dir.display()))?;
    eprintln!("Building the plugin in {}...", dir.display());
    let library = install(&build(&dir, false)?, &dir)?;
    let watches = [dir.clone(), dir.join("src")]
        .iter()
        .filter_map(|watched| {
            let dir = dir.clone();
            opencode_local::watch::watch(
                watched,
                |name| name != "target" && name != ".git",
                Duration::from_millis(200),
                move || rebuild(&dir),
            )
        })
        .collect();
    Ok(Dev { library, _watches: watches })
}

/// Builds `dir` again after a change, on the watch's thread: the TUI owns the terminal, so the output goes to
/// `build.log`.
fn rebuild(dir: &Path) {
    let log = dev_dir(dir).join("build.log");
    match build(dir, true).and_then(|artifact| install(&artifact, dir)) {
        Ok(library) => {
            log::info!("plugin dev: rebuilt {}", library.display());
            let _ = std::fs::write(&log, "");
        }
        Err(error) => {
            log::error!("plugin dev: the build failed; the running version stays. {error}");
            let _ = std::fs::write(&log, error.to_string());
        }
    }
}

fn dev_dir(dir: &Path) -> PathBuf {
    dir.join("target").join("opencode-dev")
}

/// Builds the crate in `dir` with cargo, and returns its `cdylib`. With `quiet` the diagnostics are the error.
fn build(dir: &Path, quiet: bool) -> error::Result<PathBuf> {
    let output = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--message-format=json-render-diagnostics", "--manifest-path"])
        .arg(dir.join("Cargo.toml"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(if quiet { Stdio::piped() } else { Stdio::inherit() })
        .output()
        .map_err(|error| err!("cannot run cargo: {error}"))?;
    if !output.status.success() {
        return Err(err!("cargo build failed\n{}", String::from_utf8_lossy(&output.stderr)));
    }
    artifact(&String::from_utf8_lossy(&output.stdout))
        .ok_or_else(|| err!("{} builds no cdylib: add crate-type = [\"cdylib\"] to its [lib]", dir.display()))
}

/// The `cdylib` among cargo's JSON messages: the last library file of a target of that kind.
fn artifact(messages: &str) -> Option<PathBuf> {
    messages
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|message| message["reason"] == "compiler-artifact")
        .filter(|message| {
            message["target"]["kind"].as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "cdylib"))
        })
        .flat_map(|message| message["filenames"].as_array().cloned().unwrap_or_default())
        .filter_map(|file| file.as_str().map(PathBuf::from))
        .rfind(|file| file.extension().is_some_and(|extension| extension == std::env::consts::DLL_EXTENSION))
}

/// Copies `artifact` to the library the TUI loads, in one rename, so the plugin watcher never reads half a file.
fn install(artifact: &Path, dir: &Path) -> error::Result<PathBuf> {
    let target = dev_dir(dir);
    std::fs::create_dir_all(&target)?;
    let library = target.join(opencode_plugin_entry());
    let staged = target.join("plugin.staged");
    std::fs::copy(artifact, &staged)?;
    std::fs::rename(&staged, &library)?;
    Ok(library)
}

fn opencode_plugin_entry() -> String {
    format!("plugin.{}", std::env::consts::DLL_EXTENSION)
}

/// `plugin test`: the plugin in a headless TUI, as text frames on stdout.
pub fn test(test: &Test) -> error::Result<()> {
    let library = match test.path.is_dir() {
        true => build(&test.path, false)?,
        false => test.path.clone(),
    };
    let library = std::fs::canonicalize(&library).map_err(|error| err!("{}: {error}", library.display()))?;
    let root = opencode_util::temp::tempdir()?;
    let info = Info { plugins: Some(vec![Plugin::Name(library.to_string_lossy().into_owned())]), ..Info::default() };
    let sessions = Served::json("GET", "/api/session", 200, &serde_json::json!({ "data": [], "cursor": {} }));
    let app = TestApp::new(test.size.0, test.size.1);
    let deps = Deps {
        client: Client::with_transport("http://opencode.local", Arc::new(Memory::new(vec![sessions])))?,
        directory: root.path().to_string_lossy().into_owned(),
        config: Resolved::new(info, |_| None),
        roots: None,
        route: Route::Home,
        continue_: false,
        events: false,
        builtins: vec![opencode_mermaid::plugin().into(), opencode_latex::plugin().into()],
    };
    let tui = opencode_tui::mount_with(&app, deps, Args::default());
    external(&tui, External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf() });
    settle(&app);
    let entry =
        tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&*library.to_string_lossy()));
    let Some(entry) = entry.filter(|entry| entry.status == opencode_plugin::Status::Active) else {
        let status = tui.plugins.entries().into_iter().find(|entry| entry.target.is_some()).map(|entry| entry.status);
        return Err(err!("the plugin did not load: {status:?}"));
    };
    if let Some(name) = &test.route {
        tui.navigate(Route::Plugin { id: entry.id.clone(), name: name.clone() });
        settle(&app);
    }
    print_frame(&app, test.route.as_deref().unwrap_or("home"));
    for (name, input) in &test.commands {
        tui.keymap.dispatch(name, input.as_deref());
        settle(&app);
        print_frame(&app, name);
    }
    tui.plugins.deactivate_all();
    Ok(())
}

fn settle(app: &TestApp) {
    for _ in 0..4 {
        app.advance(Duration::from_millis(16));
    }
}

fn print_frame(app: &TestApp, label: &str) {
    println!("--- {label}");
    for line in app.render().text().lines() {
        println!("{}", line.trim_end());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(args: &[&str]) -> Option<error::Result<Native>> {
        take(&args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>())
    }

    // Expected: `plugin dev` and `plugin test` are taken with their arguments; the delegated `plugin` commands and
    // every other line are left to the parser; a line with a bad argument is an error.
    #[test]
    fn the_native_plugin_commands_are_taken_before_the_parser() {
        assert!(line(&["plugin", "list"]).is_none());
        assert!(line(&["run", "dev"]).is_none());
        assert!(matches!(line(&["plugin", "dev", "x", "--continue"]), Some(Ok(Native::Dev { dir, rest }))
            if dir == Path::new("x") && rest == ["--continue"]));
        assert!(line(&["plugin", "dev"]).unwrap().is_err());
        let Some(Ok(Native::Test(test))) = line(&[
            "plugin",
            "test",
            "lib.so",
            "--route",
            "r",
            "--size",
            "100x30",
            "--command",
            "a=b",
            "--command",
            "c",
        ]) else {
            panic!("not a test line")
        };
        let commands = vec![("a".to_owned(), Some("b".to_owned())), ("c".to_owned(), None)];
        assert_eq!(test, Test { path: "lib.so".into(), route: Some("r".into()), size: (100, 30), commands });
        assert!(line(&["plugin", "test"]).unwrap().is_err());
        assert!(line(&["plugin", "test", "x", "--size", "0x3"]).unwrap().is_err());
        assert!(line(&["plugin", "test", "x", "--route"]).unwrap().is_err());
    }

    // Expected: a rebuild that fails leaves the installed library as it was, and its output is in `build.log`.
    #[test]
    fn a_failed_rebuild_keeps_the_running_library() {
        let dir = opencode_util::temp::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]\nversion = \"not a crate\"\n").unwrap();
        let installed = dev_dir(dir.path()).join(opencode_plugin_entry());
        std::fs::create_dir_all(installed.parent().unwrap()).unwrap();
        std::fs::write(&installed, "the running build").unwrap();
        rebuild(dir.path());
        assert_eq!(std::fs::read_to_string(&installed).unwrap(), "the running build");
        let log = std::fs::read_to_string(dev_dir(dir.path()).join("build.log")).unwrap();
        assert!(log.starts_with("cargo build failed"), "{log}");
    }

    // Expected: the library is the `cdylib` among cargo's messages, not an `rlib` or a build script.
    #[test]
    fn the_artifact_is_the_cdylib_cargo_built() {
        let ext = std::env::consts::DLL_EXTENSION;
        let messages = [
            serde_json::json!({ "reason": "compiler-artifact", "target": { "kind": ["custom-build"] }, "filenames": [format!("/t/build.{ext}")] }),
            serde_json::json!({ "reason": "compiler-artifact", "target": { "kind": ["lib"] }, "filenames": ["/t/libdep.rlib"] }),
            serde_json::json!({ "reason": "compiler-artifact", "target": { "kind": ["cdylib", "rlib"] }, "filenames": ["/t/libp.rlib", format!("/t/libp.{ext}")] }),
            serde_json::json!({ "reason": "build-finished", "success": true }),
        ];
        let text: Vec<String> = messages.iter().map(serde_json::Value::to_string).collect();
        assert_eq!(artifact(&text.join("\n")), Some(PathBuf::from(format!("/t/libp.{ext}"))));
        assert_eq!(artifact(&text[..2].join("\n")), None);
    }
}
