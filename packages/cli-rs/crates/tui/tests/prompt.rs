//! The prompt (E.2) over a fixture server that records requests: editing through the `input.*`
//! layer, submit, queue, history, drafts, shell mode, clear, interrupt, and a new session from home.

#[path = "support/wait.rs"]
mod wait;

use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};
use wait::WAIT;

/// A request the fixture saw: method, path, and JSON body.
type Seen = Arc<Mutex<Vec<(String, String, Value)>>>;

/// Serves a session `ses_a` (agent `build`, model `p/m`), the location catalog, and the prompt
/// writes; a session reads as `SessionNotFoundError` until its create lands, which takes 200 ms;
/// anything else is a 404.
struct Fixture {
    seen: Seen,
    created: Arc<Mutex<Vec<String>>>,
}

fn missing(id: &str) -> (u16, Value) {
    (
        404,
        json!({ "_tag": "SessionNotFoundError", "sessionID": id, "message": format!("Session not found: {id}") }),
    )
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        let path = request.url.path().to_owned();
        self.seen
            .lock()
            .unwrap()
            .push((request.method.to_owned(), path.clone(), body.clone()));
        let created = (request.method == "POST" && path == "/api/session").then(|| {
            (
                self.created.clone(),
                body["id"].as_str().unwrap_or_default().to_owned(),
            )
        });
        let location = json!({ "directory": "/project" });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [session("ses_a")], "cursor": {} })),
            ("GET", "/api/session/ses_a") => (200, json!({ "data": session("ses_a") })),
            ("GET", "/api/session/ses_a/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/agent") => (
                200,
                json!({ "location": location, "data": [agent("build", "primary"), agent("plan", "primary"), agent("general", "subagent")] }),
            ),
            ("GET", "/api/model") => (
                200,
                json!({ "location": location, "data": [model("p", "m", "Model M")] }),
            ),
            ("GET", "/api/provider") => (200, json!({ "location": location, "data": [] })),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", "/api/command") => (
                200,
                json!({ "location": location, "data": [{ "name": "review" }] }),
            ),
            ("POST", "/api/session") => (
                200,
                json!({ "data": session(body["id"].as_str().unwrap_or("ses_new")) }),
            ),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({
                    "data": {
                        "id": body["id"], "sessionID": path.split('/').nth(3), "time": { "created": 1 }, "type": "user",
                        "payload": { "text": body["text"] }, "delivery": body["delivery"].as_str().unwrap_or("steer"),
                    }
                }),
            ),
            ("POST", path) if path.ends_with("/interrupt") => (200, json!({ "interrupted": true })),
            ("GET", path) if path.starts_with("/api/session/ses_") => {
                let id = path.split('/').nth(3).unwrap_or_default();
                // `ses_a` exists from the start: a not-found read of its inbox would delete it.
                let created =
                    id == "ses_a" || self.created.lock().unwrap().iter().any(|known| known == id);
                match path.split('/').nth(4) {
                    _ if !created => missing(id),
                    None => (200, json!({ "data": session(id) })),
                    Some("message") => (200, json!({ "data": [], "cursor": {} })),
                    Some(_) => (200, json!({ "data": [] })),
                }
            }
            ("PATCH", path) if path.contains("/inbox/") => (204, Value::Null),
            ("POST", path)
                if ["/model", "/agent", "/shell", "/command", "/background"]
                    .iter()
                    .any(|end| path.ends_with(end)) =>
            {
                (204, Value::Null)
            }
            _ => (404, json!({})),
        };
        let body = if status == 204 {
            Vec::new()
        } else {
            serde_json::to_vec(&body).unwrap()
        };
        Box::pin(async move {
            if let Some((created, id)) = created {
                tokio::time::sleep(Duration::from_millis(200)).await;
                created.lock().unwrap().push(id);
            }
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": "Fix the parser", "projectID": "project", "cost": 0,
        "agent": "build", "model": { "providerID": "p", "id": "m" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

fn agent(id: &str, mode: &str) -> Value {
    json!({
        "id": id, "name": id, "mode": mode, "hidden": false, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    })
}

fn model(provider: &str, id: &str, name: &str) -> Value {
    json!({
        "id": id, "modelID": id, "providerID": provider, "name": name,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [{ "id": "high" }], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    })
}

struct Setup {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
    _home: tempfile::TempDir,
}

impl Setup {
    fn new(route: Route) -> Self {
        let home = tempfile::tempdir().unwrap();
        Self::with_home(route, home)
    }

    fn with_home(route: Route, home: tempfile::TempDir) -> Self {
        let seen = Seen::default();
        let client = Client::with_transport(
            "http://opencode.local",
            Arc::new(Fixture {
                seen: seen.clone(),
                created: Arc::default(),
            }),
        )
        .unwrap();
        let app = TestApp::new(90, 24);
        let tui = opencode_tui::mount(
            &app,
            Deps {
                client,
                directory: "/project".into(),
                config: Resolved::new(Info::default(), |_| None),
                roots: Some(Roots {
                    paths: paths(home.path()),
                    storage_channel: "latest".into(),
                }),
                route,
                continue_: false,
                events: false,
            },
        );
        Self {
            app,
            tui,
            seen,
            _home: home,
        }
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    /// Waits for the catalog, which shows the agent and model under the prompt.
    fn ready(&self) {
        self.wait_for("Model M");
    }

    fn textarea(&self) -> Textarea {
        self.tui
            .textarea
            .borrow()
            .clone()
            .expect("the prompt fills Tui::textarea")
    }

    fn requests(&self, method: &str, suffix: &str) -> Vec<Value> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(m, path, _)| m == method && path.ends_with(suffix))
            .map(|(_, _, body)| body.clone())
            .collect()
    }

    fn wait_request(&self, method: &str, suffix: &str, count: usize) -> Vec<Value> {
        let found = self
            .app
            .wait_until(WAIT, || self.requests(method, suffix).len() >= count);
        assert!(
            found,
            "no {method} …{suffix}: {:?}",
            self.seen.lock().unwrap()
        );
        self.requests(method, suffix)
    }

    fn history(&self) -> String {
        std::fs::read_to_string(self._home.path().join("state/prompt-history.jsonl"))
            .unwrap_or_default()
    }

    fn wait_history(&self, lines: usize) -> String {
        let found = self
            .app
            .wait_until(WAIT, || self.history().lines().count() >= lines);
        assert!(found, "history has {:?}", self.history());
        self.history()
    }
}

fn paths(home: &Path) -> Paths {
    Paths {
        home: home.to_owned(),
        data: home.join("data"),
        cache: home.join("cache"),
        config: home.join("config"),
        state: home.join("state"),
        tmp: home.join("tmp"),
        bin: home.join("bin"),
        log: home.join("log"),
        repos: home.join("repos"),
    }
}

fn session_route() -> Route {
    Route::Session {
        id: SessionID("ses_a".into()),
    }
}

#[test]
fn typing_edits_through_the_input_layer_and_enter_submits() {
    let setup = Setup::new(session_route());
    setup.ready();
    let screen = setup.wait_for("Build");
    assert!(screen.contains("Build · Model M p"), "{screen}");
    assert!(
        setup
            .app
            .app()
            .focused()
            .is_some_and(|widget| widget.id() == setup.textarea().id())
    );

    setup.app.type_text("hllo worlx");
    // `input.word.backward` (alt+b), `input.move.right`, `input.line.end`, `input.backspace`.
    setup.app.press("alt+b");
    setup.app.press("alt+b");
    setup.app.press("right");
    setup.app.type_text("e");
    setup.app.press("ctrl+e");
    setup.app.press("backspace");
    setup.app.type_text("d");
    assert_eq!(setup.textarea().text(), "hello world");
    // Shift+Enter, and Ctrl+J (a legacy `\n`, `linefeed`), insert newlines (`input.newline`).
    setup.app.press("shift+return");
    setup.app.type_text("a");
    setup.app.feed(b"\n");
    setup.app.type_text("b");
    assert_eq!(setup.textarea().text(), "hello world\na\nb");
    // The textarea's own keys are off: the managed layer edits it.
    assert!(setup.textarea().keymap().is_empty());

    setup.app.press("return");
    let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(prompts[0]["text"], "hello world\na\nb");
    assert_eq!(prompts[0]["delivery"], "steer");
    // The selection is committed before the prompt is sent.
    let models = setup.requests("POST", "/api/session/ses_a/model");
    assert_eq!(models[0]["model"], json!({ "providerID": "p", "id": "m" }));
    assert!(
        setup
            .requests("POST", "/api/session/ses_a/agent")
            .is_empty()
    );
    assert_eq!(setup.textarea().text(), "");
    // The optimistic prompt shows in the transcript at once.
    setup.wait_for("hello world");
}

#[test]
fn queue_and_empty_submit_and_exit_words() {
    let setup = Setup::new(session_route());
    setup.ready();
    // Enter on an empty prompt with nothing queued sends nothing.
    setup.app.press("return");
    setup.app.type_text("later");
    // `prompt.queue` is `<leader>return`.
    setup.app.press("ctrl+x");
    setup.app.press("return");
    let prompts = setup.wait_request("POST", "/prompt", 1);
    assert_eq!(prompts.len(), 1, "{prompts:?}");
    assert_eq!(prompts[0]["delivery"], "queue");
    // Now an empty Enter steers the queued prompt (`onEmptySubmit`).
    setup.app.press("return");
    let id = prompts[0]["id"].as_str().unwrap();
    let steers = setup.wait_request("PATCH", &format!("/api/session/ses_a/inbox/{id}"), 1);
    assert_eq!(steers[0]["delivery"], "steer");

    // Shell prompts cannot be queued; the text stays.
    setup.app.type_text("!ls");
    setup.app.press("ctrl+x");
    setup.app.press("return");
    setup.wait_for("This prompt cannot be queued");
    assert_eq!(setup.textarea().text(), "ls");
    setup.app.press("escape");
    setup.app.press("ctrl+c");

    // `exit`, `quit`, and `:q` exit instead of sending.
    setup.app.type_text(":q");
    setup.app.press("return");
    assert!(setup.app.app().is_quitting());
    assert_eq!(setup.requests("POST", "/prompt").len(), 1);
}

#[test]
fn history_steps_through_submitted_prompts_and_is_written_as_typescript_writes_it() {
    let setup = Setup::new(session_route());
    setup.ready();
    for text in ["first", "second"] {
        setup.app.type_text(text);
        setup.app.press("return");
    }
    let history = setup.wait_history(2);
    assert_eq!(
        history,
        "{\"text\":\"first\",\"files\":[],\"agents\":[],\"skills\":[],\"pasted\":[],\"mode\":\"normal\"}\n\
         {\"text\":\"second\",\"files\":[],\"agents\":[],\"skills\":[],\"pasted\":[],\"mode\":\"normal\"}\n"
    );

    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "second");
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "first");
    // At the start of a one-line prompt, Down moves to the end first, then steps.
    setup.app.press("down");
    assert_eq!(setup.textarea().text(), "first");
    setup.app.press("down");
    assert_eq!(setup.textarea().text(), "second");
    setup.app.press("down");
    setup.app.press("down");
    assert_eq!(setup.textarea().text(), "");

    // Up inside a multi-line prompt moves the cursor before it steps.
    setup.app.type_text("one");
    setup.app.press("shift+return");
    setup.app.type_text("two");
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "one\ntwo");
    setup.app.press("up");
    assert_eq!(setup.textarea().cursor_offset(), 0);
    // A typed prompt that is not the current entry does not step.
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "one\ntwo");
}

#[test]
fn shell_mode_runs_the_command_and_its_keys_leave_it() {
    let setup = Setup::new(session_route());
    setup.ready();
    setup.app.type_text("!");
    setup.wait_for("Shell");
    assert_eq!(setup.textarea().text(), "");
    // Backspace at the start leaves it; `!` later in the text is just text.
    setup.app.press("backspace");
    setup.wait_for("Build");
    setup.app.type_text("a!");
    assert_eq!(setup.textarea().text(), "a!");
    setup.app.press("ctrl+c");
    assert_eq!(setup.textarea().text(), "");

    // Escape leaves it too.
    setup.app.type_text("!");
    setup.wait_for("Shell");
    setup.app.press("escape");
    setup.wait_for("Build");

    setup.app.type_text("!ls -la");
    setup.app.press("return");
    let shells = setup.wait_request("POST", "/api/session/ses_a/shell", 1);
    assert_eq!(shells[0]["command"], "ls -la");
    assert!(setup.requests("POST", "/prompt").is_empty());
    setup.wait_for("Build");
    let history = setup.wait_history(1);
    assert!(history.ends_with("\"mode\":\"shell\"}\n"), "{history}");
    // Up restores the entry in shell mode.
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "ls -la");
    setup.wait_for("Shell");
}

#[test]
fn ctrl_c_clears_then_exits_and_long_prompts_go_to_history() {
    let setup = Setup::new(session_route());
    setup.ready();
    setup.app.type_text("short");
    setup.app.press("ctrl+c");
    assert_eq!(setup.textarea().text(), "");
    assert!(!setup.app.app().is_quitting());
    setup.app.type_text("a prompt long enough to keep");
    setup.app.press("ctrl+c");
    let history = setup.wait_history(1);
    assert!(
        history.contains("a prompt long enough to keep"),
        "{history}"
    );
    assert!(!history.contains("short"), "{history}");
    // On an empty prompt Ctrl+C is `app.exit`.
    setup.app.press("ctrl+c");
    assert!(setup.app.app().is_quitting());
}

#[test]
fn drafts_survive_route_changes() {
    let setup = Setup::new(session_route());
    setup.ready();
    setup.app.type_text("unfinished");
    setup.tui.navigate(Route::Home);
    // The home's logo (E.1).
    setup.wait_for("█▀▀█");
    setup.tui.navigate(session_route());
    setup.ready();
    assert_eq!(setup.textarea().text(), "unfinished");
    // Taking the draft removes it.
    setup.app.press("ctrl+c");
    setup.tui.navigate(Route::Home);
    setup.tui.navigate(session_route());
    setup.ready();
    assert_eq!(setup.textarea().text(), "");
}

#[test]
fn escape_twice_interrupts_a_running_session() {
    let setup = Setup::new(session_route());
    setup.ready();
    setup.tui.data.set_status(
        &SessionID("ses_a".into()),
        opencode_store::SessionStatus::Running,
    );
    setup.wait_for("esc interrupt");
    setup.app.press("escape");
    setup.wait_for("esc again to interrupt");
    assert!(setup.requests("POST", "/interrupt").is_empty());
    setup.app.press("escape");
    setup.wait_request("POST", "/api/session/ses_a/interrupt", 1);
    // `session.background` is Ctrl+B while it runs.
    setup.app.press("ctrl+b");
    setup.wait_request("POST", "/api/session/ses_a/background", 1);
}

#[test]
fn home_prompt_creates_a_session_and_opens_it() {
    let setup = Setup::new(Route::Home);
    // The home (E.1) focuses its prompt.
    setup.ready();
    setup.app.type_text("Reply with ok");
    setup.app.press("return");
    let created = setup.wait_request("POST", "/api/session", 1);
    let created: Vec<_> = created
        .into_iter()
        .filter(|body| body.get("id").is_some())
        .collect();
    assert_eq!(created[0]["agent"], "build");
    assert_eq!(created[0]["model"], json!({ "providerID": "p", "id": "m" }));
    let id = created[0]["id"].as_str().unwrap().to_owned();
    let prompts = setup.wait_request("POST", &format!("/api/session/{id}/prompt"), 1);
    assert_eq!(prompts[0]["text"], "Reply with ok");
    let opened = setup.app.wait_until(WAIT, || {
        setup.tui.route()
            == Route::Session {
                id: SessionID(id.clone()),
            }
    });
    assert!(opened, "{:?}", setup.tui.route());
    setup.wait_for("Reply with ok");
    // The new session reads nothing before its create lands, so no "Session not found" toast.
    let toast = setup.app.wait_until(Duration::from_millis(500), || {
        setup.app.text().contains("not found")
    });
    assert!(!toast, "{}", setup.app.text());
}

/// The TypeScript checkout the P-FILE test runs: `OPENCODE_TS_ROOT`, else this one.
fn ts_root() -> Option<std::path::PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.."));
    let present = root.join("node_modules").is_dir()
        && std::process::Command::new("bun")
            .arg("--version")
            .output()
            .is_ok();
    if !present {
        eprintln!(
            "skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT",
            root.display()
        );
    }
    present.then_some(root)
}

/// Runs `parity/oracle/E.2-history.ts`: the real `PromptHistoryProvider` on `state`.
fn typescript_history(root: &Path, state: &Path, ops: Value) -> Value {
    use std::io::Write;
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/E.2-history.ts");
    let mut child = std::process::Command::new("bun")
        .arg("--cwd")
        .arg(root.join("packages/tui"))
        .args(["--preload", "@opentui/solid/preload"])
        .arg(script)
        .arg(root)
        .arg(state)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(ops.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    serde_json::from_str(stdout.lines().last().unwrap_or_default()).unwrap()
}

/// P-FILE: the TypeScript TUI reads the history the Rust prompt writes, rewrites it byte for byte,
/// and the Rust prompt reads what TypeScript appends.
#[test]
fn history_file_is_shared_with_typescript() {
    let Some(root) = ts_root() else { return };
    let setup = Setup::new(session_route());
    setup.ready();
    setup.app.type_text("first");
    setup.app.press("return");
    setup.app.type_text("!ls -la");
    setup.app.press("return");
    setup.app.type_text("second \"quoted\" ünïcode");
    setup.app.press("return");
    let rust = setup.wait_history(3);
    let state = setup._home.path().join("state");

    let entry = json!({ "text": "from typescript", "files": [], "agents": [], "skills": [], "pasted": [], "mode": "normal" });
    let moves = typescript_history(
        &root,
        &state,
        json!([
            { "move": [-1, ""] },
            { "move": [-1, "second \"quoted\" ünïcode"] },
            { "move": [-1, "ls -la"] },
            { "move": [-1, "first"] },
            { "append": entry },
        ]),
    );
    assert_eq!(
        moves,
        json!(["second \"quoted\" ünïcode", "ls -la", "first", null])
    );
    let typescript = std::fs::read_to_string(state.join("prompt-history.jsonl")).unwrap();
    // TypeScript's load rewrites every entry as it serializes them: the Rust lines survive unchanged.
    assert_eq!(typescript, format!("{rust}{}\n", entry));

    let home = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(home.path().join("state")).unwrap();
    std::fs::copy(
        state.join("prompt-history.jsonl"),
        home.path().join("state/prompt-history.jsonl"),
    )
    .unwrap();
    let again = Setup::with_home(session_route(), home);
    again.ready();
    let loaded = again.app.wait_until(WAIT, || {
        again.app.press("up");
        let found = again.textarea().text() == "from typescript";
        // Until the history loads, Up does nothing; Ctrl+C on an empty prompt would exit.
        if !found && !again.textarea().text().is_empty() {
            again.app.press("ctrl+c");
        }
        found
    });
    assert!(loaded, "{:?}", again.textarea().text());
    again.app.press("up");
    assert_eq!(again.textarea().text(), "second \"quoted\" ünïcode");
}
