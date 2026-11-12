//! W10: `opencode-native` and `opencode-prompt-demo` on a Windows pseudoconsole, driven as OpenTUI's lifecycle test
//! drives its fixture (`opentui/tests/lifecycle.rs`). A headless app runs the program on a `Pty` and feeds its output
//! to a `TerminalView`, which shows the screen and answers the program's terminal queries, as P-PTY's emulator does.
//!
//! The TUI runs against a fake service with the replies of P-PTY's `fallback: "tui"` (`parity/lib/fake-server.ts`,
//! `packages/tui/test/fixture/tui-client.ts`), written again here because the preview workflow's Windows job checks
//! out `packages/cli-rs` only and has no Bun workspace.
//!
//! The prompt cases are the C.p scenarios (`parity/scenarios/C.p/*.pty.ts`) step for step. With `OPENCODE_SMOKE_OUT`
//! set, each writes `<dir>/C.p/<name>.json` with the `exit` and `checkpoints` of a P-PTY record, to compare with the
//! Linux transcript of `parity/oracle/C.p-prompts.ts`; the mode bytes differ and are not recorded:
//!
//!   bun run parity/pty/run.ts --sides ts,rs parity/scenarios/C.p/text.pty.ts
//!   diff <(jq -S '{exit, checkpoints}' $TMPDIR/opencode-parity/pty/C.p/text.0-ts.json) <(jq -S . <dir>/C.p/text.json)
//!
//! On Linux (with the `cfg` below widened and `opentui` added to the dev-dependencies) every case's record equals
//! the TS one.
#![cfg(windows)]

use std::cell::{Cell, RefCell};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Command, ExitStatus};
use std::rc::Rc;
use std::time::{Duration, Instant};

use opentui::native::EmbeddedTerminalOptions;
use opentui::pty::Pty;
use opentui::testing::TestApp;
use opentui::widget::{TerminalData, TerminalView};
use serde_json::{Value, json};

const ENTER_ALT: &str = "\x1b[?1049h";
const LEAVE_ALT: &str = "\x1b[?1049l";

#[test]
fn the_tui_reaches_home_and_ctrl_c_restores_the_terminal() {
    let sandbox = Sandbox::new();
    let server = fake_service(&sandbox.path("work"));
    let mut command = sandbox.command(env!("CARGO_BIN_EXE_opencode-native"));
    command.args(["--server", &server]);
    let run = Run::start(command, 100, 30);
    run.wait(Some("Ask anything"), 500, 30_000).unwrap();
    // As H.3/title: a second Ctrl+C, if the first left the program running.
    run.press("\x03");
    run.wait(None, 300, 5_000).unwrap();
    if run.exit.get().is_none() {
        run.press("\x03");
    }
    assert_eq!(run.code(), Some(0), "{}", run.screen());
    run.after_leaving();
}

/// One C.p scenario: the demo case, the terminal size, the steps, and the exit code.
struct Case {
    name: &'static str,
    demo: &'static str,
    cols: u16,
    rows: u16,
    steps: &'static [Step],
    exit: i32,
}

/// Keys written as is, then a wait until the screen contains `until` and has not changed for `settle` ms, then the
/// screen recorded as `checkpoint`.
struct Step {
    keys: &'static str,
    until: Option<&'static str>,
    settle: u64,
    checkpoint: Option<&'static str>,
}

/// The first step of a scenario: no keys.
const fn first(until: &'static str, checkpoint: Option<&'static str>) -> Step {
    Step { keys: "", until: Some(until), settle: 250, checkpoint }
}

/// `press` of `parity/scenarios/C.p/demo.ts`.
const fn press(keys: &'static str, checkpoint: &'static str, until: Option<&'static str>) -> Step {
    Step { keys, until, settle: 250, checkpoint: Some(checkpoint) }
}

const CASES: &[Case] = &[
    Case {
        name: "text",
        demo: "text",
        cols: 60,
        rows: 16,
        steps: &[
            Step { checkpoint: Some("placeholder"), ..first("Ada Lovelace", None) },
            press("Grace", "typed", None),
            press("\x7f\x7fx", "backspace", None),
            press("\x1b[D\x1b[Dz", "cursor in the middle", None),
            press("\x01\x0bHopper", "ctrl-a ctrl-k", None),
            press("\r", "submitted", Some("Done")),
        ],
        exit: 0,
    },
    Case {
        name: "text-cancel",
        demo: "text",
        cols: 60,
        rows: 12,
        steps: &[first("Your name", None), press("abc", "typed", None), press("\x03", "cancelled", Some("Cancelled"))],
        exit: 130,
    },
    Case {
        name: "text-validate",
        demo: "text-validate",
        cols: 60,
        rows: 16,
        steps: &[
            first("Port", Some("initial")),
            press("x\r", "invalid", Some("Expected a number")),
            press("\x7f", "fixed", None),
            press("\x15\r", "default", Some("Required")),
            press("\r", "required", None),
            press("\x1b", "escape", Some("Cancelled")),
        ],
        exit: 130,
    },
    Case {
        name: "password",
        demo: "password",
        cols: 50,
        rows: 10,
        steps: &[
            first("API key", None),
            press("\r", "required", Some("Required")),
            press("s3cret", "typed", None),
            press("\x1b[D\x1b[D", "cursor", None),
            press("\r", "submitted", Some("value:")),
        ],
        exit: 0,
    },
    Case {
        name: "confirm",
        demo: "confirm",
        cols: 50,
        rows: 14,
        steps: &[
            first("Continue?", Some("initial")),
            press("\x1b[C", "flipped", None),
            press("l", "flipped back", None),
            press("\r", "second", Some("Delete it?")),
            press("y", "answered", Some("value: true\n")),
        ],
        exit: 0,
    },
    Case {
        name: "select",
        demo: "select",
        cols: 60,
        rows: 14,
        steps: &[
            first("Provider", Some("initial")),
            press("\x1b[B", "down", None),
            press("jj", "wrapped", None),
            press("\x1b[A", "up", None),
            press("\r", "submitted", Some("value:")),
        ],
        exit: 0,
    },
    Case {
        name: "multiselect",
        demo: "multiselect",
        cols: 70,
        rows: 24,
        steps: &[
            first("Providers", Some("initial")),
            press(" ", "toggled first", None),
            press("\x1b[B\x1b[B ", "untoggled google", None),
            press(" ", "toggled google", None),
            press("a", "all", None),
            press("a", "none", None),
            press("\r", "required", Some("Please select")),
            press("\x1b[B ", "fixed", None),
            press("\r", "second", Some("Optional")),
            press("\r", "submitted", Some("none")),
        ],
        exit: 0,
    },
    Case {
        name: "autocomplete",
        demo: "autocomplete",
        cols: 70,
        rows: 24,
        steps: &[
            first("Search", Some("initial")),
            press("go", "filtered", None),
            press("\x7f\x7fitem 1", "item 1", None),
            press("\x1b[B\x1b[B", "navigated", None),
            press("x", "typed while navigating", None),
            press("\x7f\r", "submitted", Some("value:")),
        ],
        exit: 0,
    },
    Case {
        name: "spinner",
        demo: "spinner",
        cols: 50,
        rows: 12,
        steps: &[Step { settle: 300, ..first("Done", Some("done")) }],
        exit: 0,
    },
    Case {
        name: "messages",
        demo: "messages",
        cols: 60,
        rows: 40,
        steps: &[first("Cancelled", Some("messages"))],
        exit: 0,
    },
];

#[test]
fn the_prompts_run_the_c_p_scenarios() {
    let out = std::env::var_os("OPENCODE_SMOKE_OUT").map(|dir| Path::new(&dir).join("C.p"));
    let failures: Vec<String> = CASES
        .iter()
        .filter_map(|case| {
            let sandbox = Sandbox::new();
            let mut command = sandbox.command(env!("CARGO_BIN_EXE_opencode-prompt-demo"));
            command.arg(case.demo);
            let run = Run::start(command, case.cols, case.rows);
            let mut checkpoints = serde_json::Map::new();
            let failure = case.steps.iter().find_map(|step| {
                run.press(step.keys);
                let failure = run.wait(step.until, step.settle, 15_000).err();
                if let Some(name) = step.checkpoint.filter(|_| failure.is_none()) {
                    checkpoints.insert(name.to_owned(), json!(run.lines()));
                }
                failure
            });
            let exit = failure.is_none().then(|| run.code()).flatten();
            if let Some(dir) = &out {
                std::fs::create_dir_all(dir).unwrap();
                let record = json!({ "exit": exit, "checkpoints": checkpoints });
                let text = serde_json::to_string_pretty(&record).unwrap() + "\n";
                std::fs::write(dir.join(format!("{}.json", case.name)), text).unwrap();
            }
            match (failure, exit) {
                (Some(failure), _) => Some(format!("{}: {failure}", case.name)),
                (None, exit) if exit != Some(case.exit) => {
                    Some(format!("{}: exit {exit:?}, not {}\n{}", case.name, case.exit, run.screen()))
                }
                _ => None,
            }
        })
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

/// A temporary home with its own XDG roots and temporary directory, as P-PTY's sandbox.
struct Sandbox {
    root: opencode_util::temp::TempDir,
}

impl Sandbox {
    fn new() -> Self {
        let sandbox = Self { root: opencode_util::temp::tempdir().unwrap() };
        for dir in ["home", "config", "data", "state", "cache", "tmp", "work"] {
            std::fs::create_dir_all(sandbox.path(dir)).unwrap();
        }
        sandbox
    }

    fn path(&self, name: &str) -> std::path::PathBuf {
        self.root.path().join(name)
    }

    fn command(&self, program: &str) -> Command {
        let mut command = Command::new(program);
        command.current_dir(self.path("work"));
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().to_ascii_uppercase().starts_with("OPENCODE_") {
                command.env_remove(name);
            }
        }
        for (name, dir) in [
            ("HOME", "home"),
            ("USERPROFILE", "home"),
            ("APPDATA", "config"),
            ("LOCALAPPDATA", "data"),
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_STATE_HOME", "state"),
            ("XDG_CACHE_HOME", "cache"),
            ("TEMP", "tmp"),
            ("TMP", "tmp"),
            ("TMPDIR", "tmp"),
        ] {
            command.env(name, self.path(dir));
        }
        command.env("OPENCODE_CLI_NAME", "opencode").env("OPENCODE_DISABLE_AUTOUPDATE", "1");
        command
    }
}

/// The program on a pseudoconsole, its raw output, and the screen an emulator draws from it.
struct Run {
    app: TestApp,
    pty: Pty,
    terminal: TerminalView,
    output: Rc<RefCell<Vec<u8>>>,
    exit: Rc<Cell<Option<ExitStatus>>>,
}

impl Run {
    fn start(command: Command, cols: u16, rows: u16) -> Self {
        let app = TestApp::new(cols, rows);
        let terminal = TerminalView::with_options(&app, EmbeddedTerminalOptions { cols, rows, ..Default::default() });
        let (output, exit) = (Rc::new(RefCell::new(Vec::new())), Rc::new(Cell::new(None)));
        let pty = Pty::spawn(&app, command, cols, rows)
            .unwrap()
            .on_output({
                let (output, terminal) = (Rc::clone(&output), terminal.clone());
                move |_cx, bytes| {
                    output.borrow_mut().extend_from_slice(bytes);
                    terminal.write(bytes);
                }
            })
            .on_exit({
                let exit = Rc::clone(&exit);
                move |_cx, status| exit.set(Some(status))
            });
        terminal.on_data({
            let pty = pty.clone();
            move |_cx, bytes, source| {
                if source == TerminalData::Response {
                    let _ = pty.write(bytes);
                }
            }
        });
        Self { app, pty, terminal, output, exit }
    }

    fn lines(&self) -> Vec<String> {
        self.terminal.screen().lines
    }

    fn screen(&self) -> String {
        self.terminal.screen().text()
    }

    fn press(&self, keys: &str) {
        if !keys.is_empty() {
            self.pty.write(keys.as_bytes()).unwrap();
        }
    }

    /// Waits as a P-PTY step does: until the screen contains `until` and has not changed for `settle` ms.
    fn wait(&self, until: Option<&str>, settle: u64, timeout: u64) -> Result<(), String> {
        let (mut last, mut since) = (self.screen(), Instant::now());
        let done = self.app.wait_until(Duration::from_millis(timeout), || {
            let screen = self.screen();
            if screen != last {
                (last, since) = (screen, Instant::now());
            }
            until.is_none_or(|until| last.contains(until)) && since.elapsed() >= Duration::from_millis(settle)
        });
        if done {
            return Ok(());
        }
        Err(format!("timed out waiting for {until:?} (settle {settle} ms)\n{last}"))
    }

    /// The exit code, once the program exits.
    fn code(&self) -> Option<i32> {
        let exited = self.app.wait_until(Duration::from_secs(10), || self.exit.get().is_some());
        assert!(exited, "never exited:\n{}", self.screen());
        self.exit.get().and_then(|status| status.code())
    }

    /// Asserts the program entered the alternate screen and left it last.
    fn after_leaving(&self) {
        let text = String::from_utf8_lossy(&self.output.borrow()).into_owned();
        let enter = text.find(ENTER_ALT).unwrap_or_else(|| panic!("never entered the alternate screen: {text:?}"));
        let leave = text.rfind(LEAVE_ALT).unwrap_or_else(|| panic!("never left the alternate screen: {text:?}"));
        assert!(enter < leave, "entered the alternate screen again after leaving: {text:?}");
    }
}

/// Starts the fake service on a free port and returns its URL. It serves until the test process ends.
fn fake_service(directory: &Path) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let directory = directory.to_string_lossy().into_owned();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let directory = directory.clone();
            std::thread::spawn(move || serve(stream, &directory));
        }
    });
    url
}

/// Answers one request and closes the connection; the event stream stays open until the client goes.
fn serve(mut stream: TcpStream, directory: &str) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut head = String::new();
    if reader.read_line(&mut head).is_err() {
        return;
    }
    let mut parts = head.split_whitespace();
    let (method, target) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
    let path = target.split('?').next().unwrap_or("");
    let mut length = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    let _ = reader.take(length).read_to_end(&mut Vec::new());
    if path == "/api/event" {
        let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n";
        let connected = r#"data: {"id":"evt_connected","type":"server.connected","data":{}}"#;
        if write!(stream, "{head}{connected}\n\n").is_err() {
            return;
        }
        while stream.write_all(b": ping\n\n").is_ok() {
            std::thread::sleep(Duration::from_secs(1));
        }
        return;
    }
    let (status, body) = reply(&method, path, directory);
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        _ => "Not Found",
    };
    let body = body.map(|body| body.to_string()).unwrap_or_default();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// The `fallback: "tui"` replies the Rust TUI reads, with this sandbox's directory as the location and worktree.
fn reply(method: &str, path: &str, directory: &str) -> (u16, Option<Value>) {
    let location = json!({ "directory": directory, "project": { "id": "proj_test", "directory": directory, "canonical": directory } });
    let listed = |data: Value| (200, Some(json!({ "location": location, "data": data })));
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match (method, segments.as_slice()) {
        ("GET", ["api", "info"]) => (
            200,
            Some(json!({
                "version": "local",
                "pid": 0,
                "urls": [],
                "paths": { "tmp": std::env::temp_dir() },
                "capabilities": { "persistentPty": true },
            })),
        ),
        ("GET", ["api", "location"]) => (200, Some(json!({ "directory": directory, "project": location["project"] }))),
        (
            "GET",
            [
                "api",
                "plugin" | "shell" | "mcp" | "form" | "agent" | "model" | "provider" | "integration" | "command"
                | "skill" | "reference",
            ]
            | ["api", "fs", "list"]
            | ["api", "permission", "request"]
            | ["api", "websearch", "provider"],
        ) => listed(json!([])),
        ("GET", ["api", "mcp", "resource"]) => listed(json!({ "resources": [], "templates": [] })),
        ("GET", ["api", "vcs"]) => listed(json!({ "branch": { "current": "main", "default": "main" } })),
        ("GET", ["api", "experimental", "usage", "limits"]) => listed(Value::Null),
        ("GET", ["api", "project" | "config"]) => (200, Some(json!([]))),
        ("GET", ["api", "worktree"]) => (200, Some(json!([{ "directory": directory }]))),
        ("GET", ["api", "session"]) => (200, Some(json!({ "data": [], "cursor": {} }))),
        ("GET", ["api", "session", "active"]) => (200, Some(json!({ "data": {} }))),
        ("GET", ["api", "session", _, "permission" | "form"]) => (200, Some(json!({ "data": [] }))),
        ("GET", ["api", "experimental", "session", _, "terminal"]) => (200, Some(json!({ "data": [] }))),
        ("POST", ["api", "session", _, "model"]) | (_, ["api", "worktree", "refresh"]) => (204, None),
        ("GET", ["api", "experimental", "migration", "v1"]) => (200, Some(json!({ "status": "completed" }))),
        (_, ["api", "rpc", "opencode.goal", "get"]) => (200, Some(json!({ "output": null }))),
        _ => {
            (404, Some(json!({ "_tag": "NotFound", "message": format!("fake service: no route for {method} {path}") })))
        }
    }
}
