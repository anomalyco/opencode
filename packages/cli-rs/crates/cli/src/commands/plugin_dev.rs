//! Native plugin development commands are handled separately from commands delegated to `opencode`.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::memory::{Memory, Route as Served};
use opencode_local::cli_config::{Info, Plugin, Resolved};
use opencode_local::watch::Watch;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Args, Deps, Route};
use opencode_util::{err, error};
use opentui::keymap::RunResult;
use opentui::testing::TestApp;

const DEV_USAGE: &str = "usage: opencode-native plugin dev <dir> [arguments of the TUI]";
const TEST_USAGE: &str = "usage: opencode-native plugin test <library, crate or plugin dir> [--route NAME] \
                          [--size WxH] [--command NAME[=INPUT]] [--wait TEXT]...\n       \
                          opencode-native plugin test <library, crate or plugin dir> --conformance";

/// How long `--wait` waits, in real time.
const WAIT: Duration = Duration::from_secs(10);

/// A native-only command line.
pub enum Native {
    /// `plugin dev <dir>`, with the TUI's own arguments after it.
    Dev {
        dir: PathBuf,
        rest: Vec<String>,
    },
    Test(Test),
    /// `-h` or `--help`: the command's usage.
    Help(&'static str),
}

/// What `plugin test` renders.
#[derive(Debug, PartialEq, Eq)]
pub struct Test {
    pub path: PathBuf,
    pub route: Option<String>,
    pub size: (u16, u16),
    pub steps: Vec<Step>,
    /// `--conformance`: the golden transcripts, not a frame.
    pub conformance: bool,
}

/// A step of `plugin test`, after which it prints a frame.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// `--command NAME[=INPUT]`.
    Command(String, Option<String>),
    /// `--wait TEXT`.
    Wait(String),
}

/// The native-only command `args` names, if any; an error for one it names with arguments it cannot take.
pub fn take(args: &[String]) -> Option<error::Result<Native>> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let ["plugin", command, rest @ ..] = &args[..] else {
        return None;
    };
    match *command {
        "dev" => Some(match rest {
            ["-h" | "--help", ..] => Ok(Native::Help(DEV_USAGE)),
            [flag, ..] if flag.starts_with('-') => Err(err!("unexpected {flag}\n{DEV_USAGE}")),
            [dir, rest @ ..] => {
                Ok(Native::Dev { dir: PathBuf::from(dir), rest: rest.iter().map(|arg| (*arg).to_owned()).collect() })
            }
            [] => Err(err!("{DEV_USAGE}")),
        }),
        "test" => Some(parse_test(rest).map(|test| test.map_or(Native::Help(TEST_USAGE), Native::Test))),
        _ => None,
    }
}

/// The test `args` describe, or `None` for help.
fn parse_test(args: &[&str]) -> error::Result<Option<Test>> {
    let mut test = Test { path: PathBuf::new(), route: None, size: (80, 24), steps: Vec::new(), conformance: false };
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let mut value = || args.next().copied().ok_or_else(|| err!("{arg} needs a value\n{TEST_USAGE}"));
        match *arg {
            "-h" | "--help" => return Ok(None),
            "--route" => test.route = Some(value()?.to_owned()),
            "--size" => {
                let size = value()?;
                let parsed = size.split_once('x').and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)));
                test.size = parsed.filter(|(w, h)| *w > 0 && *h > 0).ok_or_else(|| err!("bad size {size}"))?;
            }
            "--command" => {
                let command = value()?;
                test.steps.push(match command.split_once('=') {
                    Some((name, input)) => Step::Command(name.to_owned(), Some(input.to_owned())),
                    None => Step::Command(command.to_owned(), None),
                });
            }
            "--wait" => test.steps.push(Step::Wait(value()?.to_owned())),
            "--conformance" => test.conformance = true,
            path if test.path.as_os_str().is_empty() && !path.starts_with('-') => test.path = PathBuf::from(path),
            other => return Err(err!("unexpected {other}\n{TEST_USAGE}")),
        }
    }
    if test.path.as_os_str().is_empty() {
        return Err(err!("{TEST_USAGE}"));
    }
    if test.conformance && (test.route.is_some() || !test.steps.is_empty()) {
        return Err(err!("--conformance takes no other flag\n{TEST_USAGE}"));
    }
    Ok(Some(test))
}

/// A plugin under `plugin dev`: its library, and the thread that builds it again while the TUI runs.
pub struct Dev {
    pub library: PathBuf,
    stop: mpsc::Sender<Signal>,
}

impl Drop for Dev {
    fn drop(&mut self) {
        let _ = self.stop.send(Signal::Stop);
    }
}

/// `plugin dev` for a line that parsed as the TUI's, `tui`; one that names another command is an error.
pub fn start(dir: &Path, tui: bool) -> error::Result<Dev> {
    if !tui {
        return Err(err!("plugin dev runs the TUI, and takes only its arguments\n{DEV_USAGE}"));
    }
    let dir = std::fs::canonicalize(dir).map_err(|error| err!("{}: {error}", dir.display()))?;
    // Watched before the first build, so a save during it builds again.
    let sources = Sources::watch(&dir, Duration::from_millis(200));
    eprintln!("Building the plugin in {}...", dir.display());
    let library = install(&build(&dir, false)?, &dir)?;
    let stop = sources.run(move || rebuild(&dir));
    Ok(Dev { library, stop })
}

enum Signal {
    Changed,
    Stop,
}

/// The watches on every directory of a crate, which all signal one channel.
struct Sources {
    dir: PathBuf,
    debounce: Duration,
    signal: mpsc::Sender<Signal>,
    signals: mpsc::Receiver<Signal>,
    watches: HashMap<PathBuf, Watch>,
}

impl Sources {
    fn watch(dir: &Path, debounce: Duration) -> Self {
        let (signal, signals) = mpsc::channel();
        let mut sources = Self { dir: dir.to_owned(), debounce, signal, signals, watches: HashMap::new() };
        sources.arm();
        sources
    }

    /// Watches the directories not watched yet: all of them at first, then the ones made since.
    fn arm(&mut self) {
        let mut dirs = vec![self.dir.clone()];
        while let Some(dir) = dirs.pop() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                let children = entries.flatten().filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()));
                dirs.extend(children.filter(|entry| watched(&entry.file_name())).map(|entry| entry.path()));
            }
            if self.watches.contains_key(&dir) {
                continue;
            }
            let signal = self.signal.clone();
            let changed = move || drop(signal.send(Signal::Changed));
            if let Some(watch) = opencode_local::watch::watch(&dir, watched, self.debounce, changed) {
                self.watches.insert(dir, watch);
            }
        }
    }

    /// Runs `on_change` on one thread after each burst of changes; the changes during a run make one more. Stops
    /// when the returned sender sends `Stop`.
    fn run(mut self, mut on_change: impl FnMut() + Send + 'static) -> mpsc::Sender<Signal> {
        let stop = self.signal.clone();
        std::thread::spawn(move || {
            while let Ok(Signal::Changed) = self.signals.recv() {
                loop {
                    match self.signals.try_recv() {
                        Ok(Signal::Changed) => {}
                        Err(mpsc::TryRecvError::Empty) => break,
                        Ok(Signal::Stop) | Err(mpsc::TryRecvError::Disconnected) => return,
                    }
                }
                self.arm();
                on_change();
            }
        });
        stop
    }
}

/// Whether a change to the entry `name` of a crate's directory is a change of its sources: not the build's output,
/// nor the lock file a build writes, nor a hidden file (`.git`, an editor's swap file).
fn watched(name: &OsStr) -> bool {
    name != "target" && name != "Cargo.lock" && !name.as_encoded_bytes().starts_with(b".")
}

/// Builds `dir` again after a change, on the dev thread: the TUI owns the terminal, so the output goes to
/// `build.log`.
fn rebuild(dir: &Path) {
    let log = match build(dir, true).and_then(|artifact| install(&artifact, dir)) {
        Ok(library) => {
            log::info!("plugin dev: rebuilt {}", library.display());
            String::new()
        }
        Err(error) => {
            log::error!("plugin dev: the build failed; the running version stays. {error}");
            error.to_string()
        }
    };
    if let Err(error) = publish(&dev_dir(dir), "build.log", |staged| std::fs::write(staged, &log)) {
        log::error!("plugin dev: cannot write build.log: {error}");
    }
}

fn dev_dir(dir: &Path) -> PathBuf {
    dir.join("target").join("opencode-dev")
}

/// Builds the crate in `dir` with cargo, and returns its `cdylib`. With `quiet` the diagnostics are the error.
fn build(dir: &Path, quiet: bool) -> error::Result<PathBuf> {
    let manifest = dir.join("Cargo.toml");
    let output = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--message-format=json-render-diagnostics", "--manifest-path"])
        .arg(&manifest)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(if quiet { Stdio::piped() } else { Stdio::inherit() })
        .output()
        .map_err(|error| err!("cannot run cargo: {error}"))?;
    if !output.status.success() {
        return Err(err!("cargo build failed\n{}", String::from_utf8_lossy(&output.stderr)));
    }
    artifact(&String::from_utf8_lossy(&output.stdout), &manifest)
        .ok_or_else(|| err!("{} builds no cdylib: add crate-type = [\"cdylib\"] to its [lib]", dir.display()))
}

/// The `cdylib` among cargo's JSON messages: the last library file of a target of that kind of the package
/// `manifest`, not of a workspace member it depends on.
fn artifact(messages: &str, manifest: &Path) -> Option<PathBuf> {
    let manifest = std::fs::canonicalize(manifest).unwrap_or_else(|_| manifest.to_owned());
    let ours = |path: &str| std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path)) == manifest;
    messages
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|message| message["reason"] == "compiler-artifact")
        .filter(|message| message["manifest_path"].as_str().is_some_and(ours))
        .filter(|message| {
            message["target"]["kind"].as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "cdylib"))
        })
        .flat_map(|message| message["filenames"].as_array().cloned().unwrap_or_default())
        .filter_map(|file| file.as_str().map(PathBuf::from))
        .rfind(|file| file.extension().is_some_and(|extension| extension == std::env::consts::DLL_EXTENSION))
}

/// Copies `artifact` to the library the TUI loads.
fn install(artifact: &Path, dir: &Path) -> error::Result<PathBuf> {
    Ok(publish(&dev_dir(dir), &entry(), |staged| std::fs::copy(artifact, staged).map(drop))?)
}

/// Makes `name` in `dir` what `write` writes, in one rename of a file of this publication's own, so the plugin
/// watcher never reads half a file and two publishers never write one.
fn publish(dir: &Path, name: &str, write: impl FnOnce(&Path) -> std::io::Result<()>) -> std::io::Result<PathBuf> {
    static STAGED: AtomicU64 = AtomicU64::new(0);
    std::fs::create_dir_all(dir)?;
    let staged = dir.join(format!(".{name}.{}.{}", std::process::id(), STAGED.fetch_add(1, Ordering::Relaxed)));
    let published = dir.join(name);
    let result = write(&staged).and_then(|()| std::fs::rename(&staged, &published));
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result.map(|()| published)
}

fn entry() -> String {
    format!("plugin.{}", std::env::consts::DLL_EXTENSION)
}

/// `plugin test`: the plugin in a headless TUI, as text frames on `out`, or its conformance.
pub fn test(test: &Test, out: &mut impl Write) -> error::Result<()> {
    let library = match (test.path.is_dir(), test.path.join("Cargo.toml").is_file()) {
        (true, true) => build(&std::fs::canonicalize(&test.path)?, false)?,
        (true, false) => test.path.join(entry()),
        (false, _) => test.path.clone(),
    };
    let library = std::fs::canonicalize(&library).map_err(|error| err!("{}: {error}", library.display()))?;
    if test.conformance {
        return conformance(&library, out);
    }
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
        abi_builtins: false,
    };
    let tui = opencode_tui::mount_with(&app, deps, Args::default());
    external(
        &tui,
        External { config_dir: root.path().join("config"), cwd: root.path().to_path_buf(), dev: Vec::new() },
    );
    settle(&app);
    let target = library.to_string_lossy();
    let status = || {
        let entry = tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&*target));
        entry.map(|entry| (entry.id, entry.status))
    };
    let Some((id, opencode_plugin::Status::Active)) = status() else {
        return Err(err!("the plugin did not load: {:?}", status().map(|(_, status)| status)));
    };
    let result = steps(test, &app, &tui, &id, out, || match status() {
        Some((_, opencode_plugin::Status::Active)) => Ok(()),
        other => Err(err!("{id} is not active: {:?}", other.map(|(_, status)| status))),
    });
    tui.plugins.deactivate_all();
    result
}

/// `plugin test --conformance`: a line a transcript, and an error naming those the library failed.
fn conformance(library: &Path, out: &mut impl Write) -> error::Result<()> {
    let outcomes = opencode_plugin::conformance::check_library(library).map_err(|error| err!("{error}"))?;
    let mut failed = Vec::new();
    for outcome in &outcomes {
        let name = match outcome.future {
            true => format!("{} (a host of a later minor)", outcome.transcript),
            false => outcome.transcript.clone(),
        };
        match &outcome.result {
            Ok(()) => writeln!(out, "ok   {name}")?,
            Err(error) => {
                writeln!(out, "FAIL {name}\n     {}", error.replace('\n', "\n     "))?;
                failed.push(name);
            }
        }
    }
    match (outcomes.is_empty(), failed.is_empty()) {
        (true, _) => Err(err!("no transcript is of this library's ABI")),
        (false, true) => Ok(()),
        (false, false) => Err(err!("{} of {} transcripts failed: {}", failed.len(), outcomes.len(), failed.join(", "))),
    }
}

/// Runs `test`'s route and steps, printing a frame after each, and checks the plugin with `active` after each.
fn steps(
    test: &Test,
    app: &TestApp,
    tui: &opencode_tui::Tui,
    id: &str,
    out: &mut impl Write,
    active: impl Fn() -> error::Result<()>,
) -> error::Result<()> {
    if let Some(name) = &test.route {
        if !tui.plugins.has_route(id, name) {
            return Err(err!("{id} has no route {name}"));
        }
        tui.navigate(Route::Plugin { id: id.to_owned(), name: name.clone() });
        settle(app);
    }
    print_frame(app, out, test.route.as_deref().unwrap_or("home"))?;
    active()?;
    for step in &test.steps {
        match step {
            Step::Command(name, input) => {
                let ran = tui.keymap.dispatch(name, input.as_deref());
                if ran != RunResult::Ok {
                    return Err(err!("the command {name} did not run: {ran:?}"));
                }
                settle(app);
                print_frame(app, out, name)?;
            }
            Step::Wait(text) => {
                let shown = app.wait_until(WAIT, || {
                    app.advance(Duration::from_millis(16));
                    app.render().text().contains(text.as_str())
                });
                print_frame(app, out, &format!("wait {text}"))?;
                if !shown {
                    return Err(err!("{text} did not show within {} seconds", WAIT.as_secs()));
                }
            }
        }
        active()?;
    }
    Ok(())
}

fn settle(app: &TestApp) {
    for _ in 0..4 {
        app.advance(Duration::from_millis(16));
    }
}

fn print_frame(app: &TestApp, out: &mut impl Write, label: &str) -> std::io::Result<()> {
    writeln!(out, "--- {label}")?;
    for line in app.render().text().lines() {
        writeln!(out, "{}", line.trim_end())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;

    fn line(args: &[&str]) -> Option<error::Result<Native>> {
        take(&args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>())
    }

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
            "--wait",
            "ready",
            "--command",
            "c",
        ]) else {
            panic!("not a test line")
        };
        let steps = vec![
            Step::Command("a".to_owned(), Some("b".to_owned())),
            Step::Wait("ready".to_owned()),
            Step::Command("c".to_owned(), None),
        ];
        let expected =
            Test { path: "lib.so".into(), route: Some("r".into()), size: (100, 30), steps, conformance: false };
        assert_eq!(test, expected);
        let Some(Ok(Native::Test(test))) = line(&["plugin", "test", "lib.so", "--conformance"]) else {
            panic!("not a conformance line")
        };
        assert!(test.conformance && test.route.is_none() && test.steps.is_empty());
        assert!(line(&["plugin", "test", "lib.so", "--conformance", "--route", "r"]).unwrap().is_err());
        assert!(line(&["plugin", "test"]).unwrap().is_err());
        assert!(line(&["plugin", "test", "x", "--size", "0x3"]).unwrap().is_err());
        assert!(line(&["plugin", "test", "x", "--route"]).unwrap().is_err());
        let helps: [&[&str]; 4] = [
            &["plugin", "dev", "-h"],
            &["plugin", "dev", "--help"],
            &["plugin", "test", "-h"],
            &["plugin", "test", "x", "--help"],
        ];
        for help in helps {
            assert!(matches!(line(help), Some(Ok(Native::Help(_)))), "{help:?}");
        }
        let flags: [&[&str]; 3] = [&["plugin", "dev", "-x"], &["plugin", "test", "-x"], &["plugin", "test", "x", "-q"]];
        for flag in flags {
            assert!(line(flag).unwrap().is_err(), "{flag:?}");
        }
    }

    #[test]
    fn plugin_dev_runs_only_the_tui() {
        let crate::parse::Outcome::Run(invocation) = crate::parse::parse(&["run".to_owned(), "hi".to_owned()], "x")
        else {
            panic!("not a run line")
        };
        let error = start(Path::new("/no/such/crate"), invocation.cli.command.is_none()).err().unwrap();
        assert!(error.to_string().contains("runs the TUI"), "{error}");
    }

    #[test]
    fn the_sources_are_not_what_a_build_writes() {
        for name in ["src", "lib.rs", "Cargo.toml", "build.rs"] {
            assert!(watched(OsStr::new(name)), "{name}");
        }
        for name in ["target", "Cargo.lock", ".git", ".lib.rs.swp"] {
            assert!(!watched(OsStr::new(name)), "{name}");
        }
    }

    #[test]
    fn one_thread_builds_after_every_change() {
        if opencode_local::watch::disabled(|name| std::env::var(name).ok()) {
            return;
        }
        let dir = opencode_util::temp::tempdir().unwrap();
        let src = dir.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        let sources = Sources::watch(dir.path(), Duration::from_millis(20));
        std::fs::write(src.join("lib.rs"), "// before the thread").unwrap();
        let (ran, runs) = mpsc::channel();
        let (release, released) = mpsc::channel::<()>();
        let hold = Arc::new(AtomicBool::new(false));
        let held = hold.clone();
        let stop = sources.run(move || {
            ran.send(()).unwrap();
            if held.load(Ordering::SeqCst) {
                let _ = released.recv_timeout(Duration::from_secs(10));
            }
        });
        let wait =
            |what: &str| runs.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| panic!("no build {what}"));
        // Builds a burst of events may still owe, so the next build waited for is the next change's.
        let quiet = || while runs.recv_timeout(Duration::from_millis(300)).is_ok() {};
        wait("for a change before the thread started");
        quiet();
        std::fs::create_dir(src.join("nested")).unwrap();
        wait("for a new directory");
        quiet();
        hold.store(true, Ordering::SeqCst);
        std::fs::write(src.join("nested").join("a.rs"), "").unwrap();
        wait("for a change in the new directory");
        hold.store(false, Ordering::SeqCst);
        std::fs::write(src.join("b.rs"), "").unwrap();
        // Long enough for the change's debounce to end while the build runs.
        std::thread::sleep(Duration::from_millis(200));
        release.send(()).unwrap();
        wait("for a change during a build");
        stop.send(Signal::Stop).unwrap();
    }

    #[test]
    fn racing_publishers_never_mix_their_libraries() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let builds: Vec<PathBuf> = b"ab"
            .iter()
            .map(|byte| {
                let path = dir.path().join(format!("build-{}", char::from(*byte)));
                std::fs::write(&path, vec![*byte; 1 << 20]).unwrap();
                path
            })
            .collect();
        let crate_dir = dir.path().join("crate");
        let library = dev_dir(&crate_dir).join(entry());
        let done = Arc::new(AtomicBool::new(false));
        let reader = {
            let (library, done) = (library.clone(), done.clone());
            std::thread::spawn(move || {
                while !done.load(Ordering::SeqCst) {
                    if let Ok(bytes) = std::fs::read(&library) {
                        assert!(
                            bytes.len() == 1 << 20 && bytes.iter().all(|byte| *byte == bytes[0]),
                            "a mixed library"
                        );
                    }
                }
            })
        };
        let writers: Vec<_> = (0..8)
            .map(|index| {
                let (build, crate_dir) = (builds[index % 2].clone(), crate_dir.clone());
                std::thread::spawn(move || (0..25).for_each(|_| drop(install(&build, &crate_dir).unwrap())))
            })
            .collect();
        writers.into_iter().for_each(|writer| writer.join().unwrap());
        done.store(true, Ordering::SeqCst);
        reader.join().unwrap();
        let left: Vec<_> =
            std::fs::read_dir(dev_dir(&crate_dir)).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(left, [OsStr::new(&entry())]);
    }

    #[test]
    fn a_failed_rebuild_keeps_the_running_library() {
        for installed in [true, false] {
            let dir = opencode_util::temp::tempdir().unwrap();
            std::fs::write(dir.path().join("Cargo.toml"), "[package]\nversion = \"not a crate\"\n").unwrap();
            let library = dev_dir(dir.path()).join(entry());
            if installed {
                std::fs::create_dir_all(library.parent().unwrap()).unwrap();
                std::fs::write(&library, "the running build").unwrap();
            }
            rebuild(dir.path());
            assert_eq!(std::fs::read_to_string(&library).ok().as_deref(), installed.then_some("the running build"));
            let log = std::fs::read_to_string(dev_dir(dir.path()).join("build.log")).unwrap();
            assert!(log.starts_with("cargo build failed"), "{log}");
        }
    }

    #[test]
    fn the_artifact_is_the_cdylib_cargo_built() {
        let ext = std::env::consts::DLL_EXTENSION;
        let messages = [
            serde_json::json!({ "reason": "compiler-artifact", "manifest_path": "/t/Cargo.toml", "target": { "kind": ["custom-build"] }, "filenames": [format!("/t/build.{ext}")] }),
            serde_json::json!({ "reason": "compiler-artifact", "manifest_path": "/t/Cargo.toml", "target": { "kind": ["lib"] }, "filenames": ["/t/libdep.rlib"] }),
            serde_json::json!({ "reason": "compiler-artifact", "manifest_path": "/t/Cargo.toml", "target": { "kind": ["cdylib", "rlib"] }, "filenames": ["/t/libp.rlib", format!("/t/libp.{ext}")] }),
            serde_json::json!({ "reason": "compiler-artifact", "manifest_path": "/t/other/Cargo.toml", "target": { "kind": ["cdylib"] }, "filenames": [format!("/t/libother.{ext}")] }),
            serde_json::json!({ "reason": "build-finished", "success": true }),
        ];
        let text: Vec<String> = messages.iter().map(serde_json::Value::to_string).collect();
        let manifest = Path::new("/t/Cargo.toml");
        assert_eq!(artifact(&text.join("\n"), manifest), Some(PathBuf::from(format!("/t/libp.{ext}"))));
        assert_eq!(artifact(&text[..2].join("\n"), manifest), None);
        assert_eq!(
            artifact(&text.join("\n"), Path::new("/t/other/Cargo.toml")),
            Some(format!("/t/libother.{ext}").into())
        );
    }

    /// The board example built as cargo builds it, found among cargo's own messages.
    fn board() -> PathBuf {
        let manifest =
            std::fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/board/Cargo.toml"))
                .unwrap();
        let output = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
            .args(["build", "--quiet", "--message-format=json", "--manifest-path"])
            .arg(&manifest)
            .arg("--target-dir")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/board-plugin"))
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        artifact(&String::from_utf8_lossy(&output.stdout), &manifest).unwrap()
    }

    #[test]
    fn plugin_test_fails_for_what_it_cannot_show() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let installed = install(&board(), dir.path()).unwrap();
        let run = |path: &Path, route: Option<&str>, steps: Vec<Step>| {
            let mut out = Vec::new();
            let route = route.map(str::to_owned);
            let spec = Test { path: path.to_owned(), route, size: (80, 30), steps, conformance: false };
            let result = test(&spec, &mut out);
            (result, String::from_utf8(out).unwrap())
        };
        let command = |name: &str, input: Option<&str>| Step::Command(name.to_owned(), input.map(str::to_owned));

        let steps = vec![
            command("board.bump", Some("3")),
            command("board.flood", Some("1000")),
            Step::Wait("messages 1000".to_owned()),
        ];
        let (result, out) = run(&installed, Some("board"), steps);
        result.unwrap();
        let frames: Vec<&str> = out.split("--- ").filter(|frame| !frame.is_empty()).collect();
        assert_eq!(frames.len(), 4, "{out}");
        assert!(frames[0].starts_with("board\n") && frames[1].contains("card 3: 1"), "{out}");
        assert!(frames[3].starts_with("wait messages 1000\n") && frames[3].contains("messages 1000"), "{out}");
        // A plugin directory, as under `plugins/`, without a crate: its `plugin.<ext>`.
        let (result, out) = run(installed.parent().unwrap(), None, Vec::new());
        result.unwrap();
        assert!(out.starts_with("--- home\n"), "{out}");

        let (result, _) = run(&installed, Some("nope"), Vec::new());
        assert!(result.unwrap_err().to_string().contains("has no route nope"));
        let (result, out) = run(&installed, Some("board"), vec![command("board.bmup", None)]);
        assert!(result.unwrap_err().to_string().contains("did not run"), "{out}");
        let (result, out) = run(&installed, Some("board"), vec![command("board.panic", None)]);
        assert!(result.unwrap_err().to_string().contains("is not active"), "{out}");
        assert!(out.contains("--- board.panic"), "the frame it got to is printed: {out}");
        let (result, _) = run(&dir.path().join("missing.so"), None, Vec::new());
        assert!(result.is_err());
    }

    // Expected (Pc): `plugin test --conformance` passes the conformance plugin written in C, a line a transcript, also
    // as a host of a later minor; and fails a library that is another plugin, naming the transcripts it failed, after
    // their lines.
    #[cfg(unix)]
    #[test]
    fn plugin_test_conformance_replays_the_transcripts() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let library = dir.path().join("plugin.so");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin");
        let built = Command::new(std::env::var("CC").unwrap_or_else(|_| "cc".to_owned()))
            .args(["-shared", "-fPIC", "-fvisibility=hidden", "-std=c11", "-I"])
            .arg(root.join("../plugin-abi/include"))
            .arg("-o")
            .arg(&library)
            .arg(root.join("examples/conformance/plugin.c"))
            .status();
        let Ok(status) = built else {
            assert!(std::env::var_os("OPENCODE_RS_REQUIRE_CC").is_none(), "OPENCODE_RS_REQUIRE_CC is set, but no cc");
            return;
        };
        assert!(status.success());
        let run = |path: &Path| {
            let mut out = Vec::new();
            let spec =
                Test { path: path.to_owned(), route: None, size: (80, 24), steps: Vec::new(), conformance: true };
            let result = test(&spec, &mut out);
            (result, String::from_utf8(out).unwrap())
        };
        let (result, out) = run(&library);
        result.unwrap();
        assert!(out.lines().all(|line| line.starts_with("ok   ")), "{out}");
        assert!(out.contains("ok   surfaces\n") && out.contains("ok   surfaces (a host of a later minor)\n"), "{out}");

        let (result, out) = run(&board());
        let error = result.unwrap_err().to_string();
        assert!(error.contains("transcripts failed: activation,"), "{error}");
        assert!(out.starts_with("FAIL activation\n"), "{out}");
    }
}
