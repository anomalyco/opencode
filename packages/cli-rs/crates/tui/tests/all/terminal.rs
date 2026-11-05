//! The terminal pane (E.13a) through the whole TUI, over the in-memory transport and a fake socket, for the paths the
//! P-APP scenario `E.13a/terminal` does not reach: `/terminal` creating a terminal, input written before the pane
//! mounts, a stored selection whose terminal is gone, and a server without terminals.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::memory::{Logged, Memory, Route as MemoryRoute};
use opencode_api::pty::{self, Incoming, Remote};
use opencode_tui::Deps;
use opentui::keymap::RunResult;
use serde_json::{Value, json};

use crate::support::{self, Harness, WAIT, deref_harness};

const CHANNEL: &str = "test";

fn terminal() -> Value {
    json!({
        "id": "pty_1", "title": "Terminal", "command": "/bin/sh", "args": [], "cwd": "/project",
        "status": "running", "pid": 42, "sessionID": "ses_a", "foregroundProcess": null,
        "size": { "cols": 80, "rows": 24 }, "output": { "head": 0, "tail": 0 },
    })
}

fn routes(persistent_pty: bool) -> Vec<MemoryRoute> {
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json(
            "GET",
            "/api/info",
            200,
            &json!({ "version": "test", "pid": 0, "urls": [], "paths": { "tmp": "/tmp" },
                     "capabilities": { "persistentPty": persistent_pty } }),
        ),
        MemoryRoute::json("GET", "/api/experimental/session/ses_a/terminal", 200, &json!({ "data": [terminal()] })),
        MemoryRoute::json("POST", "/api/experimental/session/ses_a/terminal", 200, &json!({ "data": terminal() })),
        MemoryRoute::json(
            "GET",
            "/api/experimental/persistent-pty/pty_1/snapshot",
            200,
            &json!({ "data": { "info": terminal(), "text": "", "checkpoint": "", "cursor": { "x": 0, "y": 0 } } }),
        ),
        MemoryRoute::json(
            "POST",
            "/api/experimental/persistent-pty/pty_1/connect-token",
            200,
            &json!({ "data": { "ticket": "tk", "expires_in": 30 } }),
        ),
    ];
    routes.extend(support::session_routes(&support::test_session("ses_a", "Fix the parser")));
    routes
}

struct Terminal {
    harness: Harness,
    memory: Memory,
    remotes: Arc<Mutex<Vec<Remote>>>,
    state: PathBuf,
    _home: tempfile::TempDir,
}

deref_harness!(Terminal);

fn mount(persistent_pty: bool, selection: Option<Value>) -> Terminal {
    let home = tempfile::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let tui_state = paths.state.join(CHANNEL).join("tui");
    std::fs::create_dir_all(&tui_state).unwrap();
    if let Some(selection) = selection {
        std::fs::write(tui_state.join("session-terminal-selection.json"), selection.to_string()).unwrap();
    }
    let state = paths.state.clone();
    let memory = Memory::new(routes(persistent_pty));
    let deps = Deps {
        config: support::config(support::decode(r#"{"animations":false}"#)),
        roots: support::roots(paths, CHANNEL),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = support::mount(100, 30, deps);
    let remotes: Arc<Mutex<Vec<Remote>>> = Arc::default();
    let opened = remotes.clone();
    harness.tui.terminals.set_connector(Arc::new(move |_| {
        let (socket, remote) = pty::pair();
        opened.lock().unwrap().push(remote);
        Ok(socket)
    }));
    let harness = Terminal { harness, memory, remotes, state, _home: home };
    harness.wait(|harness| harness.app.text().contains("Fix the parser"));
    harness
}

impl Terminal {
    fn wait(&self, check: impl Fn(&Self) -> bool) -> bool {
        self.app.wait_until(WAIT, || check(self))
    }

    /// Runs a terminal command once it is registered: the layer follows `/api/info` a tick after the list request
    /// goes out.
    fn run(&self, command: &str) {
        assert!(
            self.wait(|harness| matches!(harness.tui.keymap.dispatch(command, None), RunResult::Ok)),
            "{command} never ran"
        );
    }

    fn requests(&self, method: &str, path: &str) -> Vec<Logged> {
        self.memory.requests().into_iter().filter(|logged| logged.method == method && logged.path == path).collect()
    }

    fn selection(&self) -> Value {
        let path = self.state.join(CHANNEL).join("tui").join("session-terminal-selection.json");
        std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null)
    }

    /// Attaches the opened socket as controller and ends the replay.
    fn attach(&self) {
        assert!(self.wait(|harness| !harness.remotes.lock().unwrap().is_empty()), "no socket opened");
        // A replay that ends before the pane is laid out has no size to send pending input at (as in TS, where the
        // server is never that fast). The pane mounted before its socket opened, so one frame lays it out.
        self.app.render();
        let deliver = self.remotes.lock().unwrap()[0].deliver.clone();
        for text in [
            r#"{"type":"attached","inputProtocol":1,"info":{"size":{"cols":80,"rows":24}},"role":"controller"}"#,
            r#"{"type":"replay_complete"}"#,
        ] {
            deliver.try_send(Incoming::Text(text.into())).unwrap();
        }
    }

    /// The frames the socket got, waiting until there are `count`. Rendering lays the pane out, which gives it the
    /// size a claim needs.
    fn frames(&self, count: usize) -> Vec<Vec<u8>> {
        let mut frames = Vec::new();
        self.app.wait_until(WAIT, || {
            self.app.render();
            let mut remotes = self.remotes.lock().unwrap();
            while let Ok(frame) = remotes[0].sent.try_recv() {
                frames.push(frame);
            }
            frames.len() >= count
        });
        frames
    }
}

#[test]
fn slash_terminal_creates_a_terminal_in_the_session_directory_and_selects_it() {
    let harness = mount(true, None);
    assert!(
        harness.wait(|harness| { !harness.requests("GET", "/api/experimental/session/ses_a/terminal").is_empty() })
    );
    harness.run("session.terminal");
    assert!(harness.wait(|harness| harness.selection()["sessions"]["ses_a"] == "pty_1"));
    let create = harness.requests("POST", "/api/experimental/session/ses_a/terminal");
    assert_eq!(create[0].body, Some(json!({ "args": [], "cwd": "/project", "title": "Terminal", "env": {} })));
    harness.attach();
    // The new terminal has focus, so the replay's end claims control at the pane's size: 50 columns less 2, and the
    // 29 rows under the tab strip.
    assert_eq!(harness.frames(1), [vec![0, 0, 48, 0, 29]]);
    harness.tui.terminals.write("pty_1", b"ls");
    assert_eq!(harness.frames(1), [vec![1, 0, 48, 0, 29, b'l', b's']]);
}

#[test]
fn input_written_before_the_pane_mounts_waits_for_the_replay_and_replaces_the_claim() {
    let harness = mount(true, None);
    harness.tui.terminals.write("pty_1", b"pwd\r");
    assert!(
        harness.wait(|harness| { !harness.requests("GET", "/api/experimental/session/ses_a/terminal").is_empty() })
    );
    harness.run("terminal.toggle");
    harness.attach();
    // The replay's end is handled before the next frame, the order a loaded machine gave once.
    harness.app.wait_until(Duration::from_millis(200), || false);
    // `processStream`: pending input goes out instead of the size-only claim.
    assert_eq!(harness.frames(1), [[&[1, 0, 48, 0, 29][..], b"pwd\r"].concat()]);
}

#[test]
fn a_stored_selection_whose_terminal_is_gone_is_cleared() {
    let harness = mount(true, Some(json!({ "sessions": { "ses_a": "pty_gone", "ses_b": "pty_2" } })));
    assert!(harness.wait(|harness| harness.selection()["sessions"]["ses_a"].is_null()));
    assert_eq!(harness.selection()["sessions"]["ses_b"], "pty_2");
    assert!(harness.remotes.lock().unwrap().is_empty());
}

#[test]
fn a_server_without_terminals_lists_none_and_ignores_the_commands() {
    let harness = mount(false, Some(json!({ "sessions": { "ses_a": "pty_1" } })));
    assert!(harness.wait(|harness| !harness.requests("GET", "/api/info").is_empty()));
    harness.app.wait_until(Duration::from_millis(100), || false);
    harness.tui.keymap.dispatch("terminal.toggle", None);
    harness.tui.keymap.dispatch("session.terminal", None);
    harness.app.wait_until(Duration::from_millis(100), || false);
    assert!(
        harness
            .memory
            .requests()
            .iter()
            .all(|logged| !logged.path.contains("terminal") && !logged.path.contains("persistent-pty"))
    );
    assert!(harness.remotes.lock().unwrap().is_empty());
}
