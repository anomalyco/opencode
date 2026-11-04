//! Prompt autocomplete (E.3) over a fixture server that records requests: slash commands (the
//! keymap's and the server's), `@` mentions of agents, skills, references, and files, `/cd` with
//! directory completion and recents, and the mentions as atomic prompt parts.

#[path = "support/wait.rs"]
mod wait;

use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

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

/// A request the fixture saw: method, path, query, and JSON body.
type Seen = Arc<Mutex<Vec<(String, String, String, Value)>>>;

struct Fixture {
    seen: Seen,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let body: Value = request
            .body
            .as_ref()
            .and_then(|body| serde_json::from_slice(body).ok())
            .unwrap_or(Value::Null);
        let path = request.url.path().to_owned();
        let query: Vec<(String, String)> = request.url.query_pairs().into_owned().collect();
        let param = |name: &str| {
            query
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
                .unwrap_or_default()
        };
        self.seen.lock().unwrap().push((
            request.method.to_owned(),
            path.clone(),
            request.url.query().unwrap_or_default().to_owned(),
            body.clone(),
        ));
        let location = json!({ "directory": "/project" });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [session("ses_a")], "cursor": {} })),
            ("GET", "/api/session/ses_a") => (200, json!({ "data": session("ses_a") })),
            ("GET", "/api/session/ses_a/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/agent") => (
                200,
                json!({ "location": location, "data": [
                    agent("build", "primary", false), agent("general", "subagent", false),
                    agent("explore", "all", false), agent("secret", "subagent", true),
                ] }),
            ),
            ("GET", "/api/model") => (
                200,
                json!({ "location": location, "data": [model("p", "m", "Model M")] }),
            ),
            ("GET", "/api/command") => (
                200,
                json!({ "location": location, "data": [{ "name": "review", "description": "Review changes" }] }),
            ),
            ("GET", "/api/skill") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "release-notes", "name": "release-notes", "description": "Write release notes.",
                    "path": "/skills/release-notes/SKILL.md", "content": "",
                }] }),
            ),
            ("GET", "/api/reference") => (
                200,
                json!({ "location": location, "data": [
                    { "name": "docs", "path": "/refs/docs", "source": { "type": "local", "path": "/refs/docs" } },
                    { "name": "hidden", "path": "/refs/h", "hidden": true, "source": { "type": "local", "path": "/refs/h" } },
                ] }),
            ),
            ("GET", "/api/fs/find") => (
                200,
                json!({ "location": location, "data": [
                    { "path": "src/main.rs", "type": "file" }, { "path": "src", "type": "directory" },
                ] }),
            ),
            ("GET", "/api/fs/list") => {
                let entries = match param("path").as_str() {
                    "/project" => json!([
                        { "path": "packages", "type": "directory" }, { "path": ".git", "type": "directory" },
                        { "path": "README.md", "type": "file" },
                    ]),
                    "/project/packages" => json!([
                        { "path": "packages/tui", "type": "directory" }, { "path": "packages/cli", "type": "directory" },
                    ]),
                    _ => json!([]),
                };
                (200, json!({ "location": location, "data": entries }))
            }
            ("GET", "/api/location") => (
                200,
                json!({ "directory": "/project", "project": { "id": "project", "directory": "/project", "canonical": "/project" } }),
            ),
            (
                "GET",
                "/api/provider" | "/api/integration" | "/api/form" | "/api/permission/request",
            ) => (200, json!({ "location": location, "data": [] })),
            ("GET", "/api/vcs") => (
                200,
                json!({ "location": location, "data": { "branch": { "current": "main", "default": "main" } } }),
            ),
            ("GET", path) if path.ends_with("/form") || path.ends_with("/permission") => {
                (200, json!({ "data": [] }))
            }
            ("GET", "/api/config") => (200, json!([])),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": "ses_a", "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": body["delivery"].as_str().unwrap_or("steer"),
                } }),
            ),
            ("POST", path)
                if ["/model", "/agent", "/command", "/move"]
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

fn agent(id: &str, mode: &str, hidden: bool) -> Value {
    json!({
        "id": id, "name": id, "mode": mode, "hidden": hidden, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    })
}

fn model(provider: &str, id: &str, name: &str) -> Value {
    json!({
        "id": id, "modelID": id, "providerID": provider, "name": name,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    })
}

struct Setup {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
    home: tempfile::TempDir,
}

impl Setup {
    fn new() -> Self {
        Self::with_home(tempfile::tempdir().unwrap())
    }

    fn with_home(home: tempfile::TempDir) -> Self {
        let seen = Seen::default();
        let client = Client::with_transport(
            "http://opencode.local",
            Arc::new(Fixture { seen: seen.clone() }),
        )
        .unwrap();
        let app = TestApp::new(90, 30);
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
                route: Route::Session {
                    id: SessionID("ses_a".into()),
                },
                continue_: false,
                events: false,
            },
        );
        let setup = Self {
            app,
            tui,
            seen,
            home,
        };
        setup.wait_for("Model M");
        setup
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait_gone(&self, text: &str) {
        let gone = self
            .app
            .wait_until(WAIT, || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    fn textarea(&self) -> Textarea {
        self.tui.textarea.borrow().clone().unwrap()
    }

    fn text(&self) -> String {
        self.textarea().text()
    }

    fn requests(&self, method: &str, suffix: &str) -> Vec<(String, Value)> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(m, path, _, _)| m == method && path.ends_with(suffix))
            .map(|(_, _, query, body)| (query.clone(), body.clone()))
            .collect()
    }

    fn wait_request(&self, method: &str, suffix: &str, count: usize) -> Vec<(String, Value)> {
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

    fn state_file(&self, name: &str) -> String {
        std::fs::read_to_string(self.home.path().join("state").join(name)).unwrap_or_default()
    }

    fn wait_file(&self, name: &str, text: &str) -> String {
        let found = self
            .app
            .wait_until(WAIT, || self.state_file(name).contains(text));
        assert!(found, "{name} has {:?}", self.state_file(name));
        self.state_file(name)
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

#[test]
fn slash_lists_commands_and_enter_runs_one_without_arguments() {
    let setup = Setup::new();
    setup.app.type_text("/");
    // The first ten of the sorted list, keymap commands with their titles; E.14's `/btw` is among them.
    let screen = setup.wait_for("/agents");
    for row in ["/btw", "/cd", "/compact", "Change working directory"] {
        assert!(screen.contains(row), "{row:?} missing:\n{screen}");
    }
    // The server's command, with its description.
    setup.app.type_text("re");
    setup.wait_for("Review changes");
    for _ in 0..2 {
        setup.app.press("backspace");
    }
    setup.app.type_text("sessions");
    setup.wait_gone("/agents");
    setup.app.press("return");
    // `/sessions` ran: the slash text is gone and the session list is open.
    setup.wait_for("Fix the parser");
    assert_eq!(setup.text(), "");
    assert!(setup.requests("POST", "/prompt").is_empty());
}

#[test]
fn server_commands_complete_then_send_and_can_be_queued() {
    let setup = Setup::new();
    setup.app.type_text("/rev");
    setup.wait_for("Review changes");
    setup.app.press("return");
    assert_eq!(setup.text(), "/review ");
    setup.wait_gone("Review changes");
    setup.app.type_text("now");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/command", 1);
    assert_eq!(sent[0].1["name"], "review");
    assert_eq!(sent[0].1["text"], "now");
    assert_eq!(sent[0].1["delivery"], "steer");

    // `prompt.queue` (<leader>return) on an open list completes the server command first.
    setup.app.type_text("/rev");
    setup.wait_for("Review changes");
    setup.app.press("ctrl+x");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/command", 2);
    assert_eq!(sent[1].1["name"], "review");
    assert_eq!(sent[1].1["delivery"], "queue");
}

#[test]
fn agent_mentions_are_one_unit_and_are_sent_as_parts() {
    let setup = Setup::new();
    setup.app.type_text("ask @");
    let screen = setup.wait_for("@general");
    // Subagents and `all` agents; not primary or hidden ones.
    assert!(screen.contains("@explore"), "{screen}");
    assert!(
        !screen.contains("@build") && !screen.contains("@secret"),
        "{screen}"
    );
    setup.app.type_text("gen");
    setup.wait_gone("@explore");
    setup.app.press("return");
    assert_eq!(setup.text(), "ask @general ");
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (4, 12));
    assert!(marks[0].options.atomic && marks[0].options.style.is_some());
    // Backspace takes the space, then the whole mention.
    setup.app.press("backspace");
    setup.app.press("backspace");
    assert_eq!(setup.text(), "ask ");
    assert!(setup.textarea().extmarks().is_empty());

    // Tab picks too; the part moves with the text typed before it.
    setup.app.type_text("@gen");
    setup.wait_for("@general");
    setup.app.press("tab");
    setup.app.type_text("now");
    setup.app.press("ctrl+a");
    setup.app.type_text("please ");
    setup.app.press("ctrl+e");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "please ask @general now");
    assert_eq!(
        sent[0].1["agents"],
        json!([{ "name": "general", "mention": { "start": 11, "end": 19, "text": "@general" } }])
    );
    assert_eq!(sent[0].1["files"], json!([]));

    // History brings the mention back as a part.
    setup.app.press("up");
    assert_eq!(setup.text(), "please ask @general now");
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (11, 19));
}

#[test]
fn file_mentions_search_record_frecency_and_carry_line_ranges() {
    let setup = Setup::new();
    setup.app.type_text("@ma");
    setup.wait_for("src/main.rs");
    // `m`'s results can show before the search for `ma` goes out.
    let searched = setup.app.wait_until(WAIT, || {
        setup
            .requests("GET", "/api/fs/find")
            .iter()
            .any(|(query, _)| query.contains("query=ma") && query.contains("limit=20"))
    });
    assert!(searched, "{:?}", setup.requests("GET", "/api/fs/find"));
    setup.app.press("return");
    assert_eq!(setup.text(), "@src/main.rs ");
    let frecency = setup.wait_file("frecency.jsonl", "/project/src/main.rs");
    let line: Value = serde_json::from_str(frecency.lines().next().unwrap()).unwrap();
    assert_eq!(line["path"], "/project/src/main.rs");
    assert_eq!(line["frequency"], 1);

    // A line range goes into the name and the URI.
    setup.app.type_text("@src/main.rs#3-5");
    // The list's row, not the typed text: until the search for it lands, Enter picks `#3`.
    setup.wait_for("┃ src/main.rs#3-5 ");
    setup.app.press("return");
    setup.app.type_text("fix");
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(sent[0].1["text"], "@src/main.rs @src/main.rs#3-5 fix");
    assert_eq!(
        sent[0].1["files"],
        json!([
            { "uri": "file:///project/src/main.rs", "name": "src/main.rs",
              "mention": { "start": 0, "end": 12, "text": "@src/main.rs" } },
            { "uri": "file:///project/src/main.rs?start=3&end=5", "name": "src/main.rs#3-5",
              "mention": { "start": 13, "end": 29, "text": "@src/main.rs#3-5" } },
        ])
    );
}

#[test]
fn skills_and_references_are_listed_and_sent() {
    let setup = Setup::new();
    setup.app.type_text("@");
    let screen = setup.wait_for("@release-notes");
    for row in [
        "Write release notes.",
        "@docs",
        "/refs/docs",
        "skill",
        "reference",
        "agent",
    ] {
        assert!(screen.contains(row), "{row:?} missing:\n{screen}");
    }
    assert!(!screen.contains("@hidden"), "{screen}");
    // A reference name narrows the list to it, and no file search runs for it.
    let finds = setup.requests("GET", "/api/fs/find").len();
    setup.app.type_text("docs");
    setup.wait_gone("@release-notes");
    setup.app.press("return");
    setup.app.type_text("@rel");
    setup.wait_for("@release-notes");
    setup.app.press("return");
    assert_eq!(setup.text(), "@docs @release-notes ");
    assert!(
        setup
            .requests("GET", "/api/fs/find")
            .iter()
            .all(|(query, _)| !query.contains("query=docs")),
        "{finds}"
    );
    setup.app.press("return");
    let sent = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(
        sent[0].1["files"],
        json!([{ "uri": "file:///refs/docs", "name": "docs",
                 "mention": { "start": 0, "end": 5, "text": "@docs" } }])
    );
    assert_eq!(
        sent[0].1["skills"],
        json!([{ "id": "release-notes", "mention": { "start": 6, "end": 20, "text": "@release-notes" } }])
    );
}

#[test]
fn cd_completes_directories_moves_the_session_and_keeps_recents() {
    let setup = Setup::new();
    setup.app.type_text("/cd ");
    let screen = setup.wait_for("packages/");
    assert!(
        !screen.contains(".git") && !screen.contains("README"),
        "{screen}"
    );
    let lists = setup.wait_request("GET", "/api/fs/list", 1);
    assert!(lists[0].0.contains("path=%2Fproject"), "{lists:?}");
    // Tab opens the directory; Enter takes the first row (the typed directory itself).
    setup.app.press("tab");
    assert_eq!(setup.text(), "/cd packages/");
    setup.wait_for("packages/tui/");
    setup.app.press("down");
    setup.app.press("return");
    assert_eq!(setup.text(), "/cd packages/tui/");
    setup.wait_gone("packages/cli/");
    setup.app.press("return");
    let moves = setup.wait_request("POST", "/api/session/ses_a/move", 1);
    assert_eq!(moves[0].1["directory"], "packages/tui/");
    let recents = setup.wait_file("latest/tui/directory-recents.json", "/project/packages/tui");
    let recents: Value = serde_json::from_str(&recents).unwrap();
    assert_eq!(
        recents["projects"]["project"][0]["directory"],
        "/project/packages/tui"
    );

    // An empty argument lists recents first; Ctrl+D twice forgets one.
    setup.app.type_text("/cd ");
    setup.wait_for("recent");
    setup.app.press("ctrl+d");
    setup.wait_for("Press ctrl+d to confirm");
    setup.app.press("ctrl+d");
    setup.wait_gone("recent");
    setup.wait_file("latest/tui/directory-recents.json", "\"project\":[]");
}

#[test]
fn escape_hides_and_ctrl_c_dismisses_the_command() {
    let setup = Setup::new();
    setup.app.type_text("/xyz");
    setup.wait_for("No matching commands");
    setup.app.press("escape");
    setup.wait_gone("No matching commands");
    assert_eq!(setup.text(), "/xyz");
    // Typing reopens it; Ctrl+C removes the typed command.
    setup.app.press("backspace");
    setup.wait_for("No matching commands");
    setup.app.press("ctrl+c");
    setup.wait_gone("No matching commands");
    assert_eq!(setup.text(), "");
    // Up wraps to the last command and scrolls to it; Down wraps back to the first.
    setup.app.type_text("/");
    setup.wait_for("/agents");
    setup.app.press("up");
    setup.wait_gone("/agents");
    assert!(
        setup.app.text().contains("/variants"),
        "{}",
        setup.app.text()
    );
    setup.app.press("down");
    setup.wait_for("/agents");
}

/// Picks `@src/main.rs` from the file search.
fn mention_main(setup: &Setup) {
    setup.app.type_text("@ma");
    setup.wait_for("src/main.rs");
    setup.app.press("return");
    setup.app.press("ctrl+c");
}

/// P-FILE: the TypeScript `FrecencyProvider` reads the `frecency.jsonl` the Rust prompt writes, and the Rust
/// prompt reads what TypeScript writes.
#[test]
fn frecency_file_is_shared_with_typescript() {
    let Some(root) = ts_root() else { return };
    let setup = Setup::new();
    mention_main(&setup);
    mention_main(&setup);
    let rust = setup.wait_file("frecency.jsonl", "\"frequency\":2");
    assert_eq!(rust.lines().count(), 2, "{rust}");
    let state = setup.home.path().join("state");

    // TypeScript keeps the latest line per path and counts on from it.
    let frequencies = typescript_frecency(&root, &state, json!(["src/main.rs", "README.md"]));
    assert_eq!(
        frequencies,
        json!({ "/project/src/main.rs": 3, "/project/README.md": 1 })
    );
    let typescript = std::fs::read_to_string(state.join("frecency.jsonl")).unwrap();
    // Its load rewrote the Rust lines to one per path, the Rust line kept as written.
    assert_eq!(typescript.lines().next(), rust.lines().nth(1));
    assert_eq!(typescript.lines().count(), 3, "{typescript}");

    // A new Rust prompt reads the TypeScript file: its load rewrites it the same way, and it counts on.
    let home = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(home.path().join("state")).unwrap();
    std::fs::copy(
        state.join("frecency.jsonl"),
        home.path().join("state/frecency.jsonl"),
    )
    .unwrap();
    let again = Setup::with_home(home);
    mention_main(&again);
    let written = again.wait_file("frecency.jsonl", "\"frequency\":4");
    let last: Value = serde_json::from_str(written.lines().last().unwrap()).unwrap();
    assert_eq!(
        (last["path"].clone(), last["frequency"].clone()),
        (json!("/project/src/main.rs"), json!(4))
    );
    // The load kept one line per path, then the pick appended one.
    assert_eq!(written.lines().count(), 3, "{written}");
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

/// Runs `parity/oracle/E.3-frecency.ts`: the real `FrecencyProvider` on `state`, with the cwd `/project`.
fn typescript_frecency(root: &Path, state: &Path, paths: Value) -> Value {
    use std::io::Write;
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/E.3-frecency.ts");
    let mut child = std::process::Command::new("bun")
        .arg("--cwd")
        .arg(root.join("packages/tui"))
        .args(["--preload", "@opentui/solid/preload"])
        .arg(script)
        .arg(root)
        .arg(state)
        .arg("/project")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(paths.to_string().as_bytes())
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
