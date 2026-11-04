//! Editor integration (E.5): the IDE's selection and mentions from a fake IDE MCP server, Zed's selection
//! from a database in a temporary directory, and the prompt's use of them. No real editor, IDE, or Zed
//! database is touched: every source is built here.

use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_tui::prompt::editor_context::{self, LabelState, Source};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

#[path = "support/ide.rs"]
mod ide;

use ide::Ide;

type Seen = Arc<Mutex<Vec<(String, String, Value)>>>;

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
        self.seen
            .lock()
            .unwrap()
            .push((request.method.to_owned(), path.clone(), body.clone()));
        let location = json!({ "directory": "/project" });
        let (status, body) = match (request.method, path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [session()], "cursor": {} })),
            ("GET", "/api/session/ses_a") => (200, json!({ "data": session() })),
            ("GET", "/api/session/ses_a/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/agent") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
                    "request": { "settings": {}, "headers": {}, "body": {} },
                }] }),
            ),
            ("GET", "/api/model") => (
                200,
                json!({ "location": location, "data": [{
                    "id": "m", "modelID": "m", "providerID": "p", "name": "Model M",
                    "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
                    "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
                    "enabled": true, "limit": { "context": 1000, "output": 100 },
                }] }),
            ),
            ("GET", "/api/location") => (
                200,
                json!({ "directory": "/project", "project": { "id": "project", "directory": "/project", "canonical": "/project" } }),
            ),
            ("GET", "/api/vcs") => (200, json!({ "location": location, "data": {} })),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", _) => (200, json!({ "location": location, "data": [] })),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": "ses_a", "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("POST", path) if path.ends_with("/synthetic") => (
                200,
                json!({ "data": {
                    "id": "inb_1", "sessionID": "ses_a", "time": { "created": 1 }, "type": "synthetic",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("POST", _) => (204, Value::Null),
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

fn session() -> Value {
    json!({
        "id": "ses_a", "title": "Fix the parser", "projectID": "project", "cost": 0,
        "agent": "build", "model": { "providerID": "p", "id": "m" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
}

struct Setup {
    app: TestApp,
    tui: Rc<Tui>,
    seen: Seen,
}

impl Setup {
    fn new(source: Source) -> Self {
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
                roots: None,
                route: Route::Session {
                    id: SessionID("ses_a".into()),
                },
                continue_: false,
                events: false,
            },
        );
        let setup = Self { app, tui, seen };
        setup.wait_for("Model M");
        editor_context::start(&setup.tui, source);
        setup
    }

    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait(&self, what: &str, done: impl Fn() -> bool) {
        assert!(
            self.app.wait_until(Duration::from_secs(5), done),
            "{what}:\n{}",
            self.app.text()
        );
    }

    fn posts(&self) -> Vec<(String, Value)> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, _, _)| method == "POST")
            .map(|(_, path, body)| (path.clone(), body.clone()))
            .collect()
    }

    fn textarea(&self) -> opentui::prelude::Textarea {
        self.tui.textarea.borrow().clone().unwrap()
    }
}

fn selection(file: &str, start: (u32, u32), end: (u32, u32), text: &str) -> Value {
    json!({
        "text": text, "filePath": file,
        "selection": {
            "start": { "line": start.0, "character": start.1 },
            "end": { "line": end.0, "character": end.1 },
        },
    })
}

#[test]
fn ide_selection_shows_and_goes_once_before_the_prompt() {
    let ide = Ide::start();
    let setup = Setup::new(Source {
        port: Some(ide.port),
        ..Source::default()
    });
    setup.wait("the MCP handshake", || {
        ide.methods() == ["initialize", "notifications/initialized"]
    });
    let initialize = ide.received.lock().unwrap()[0].clone();
    assert_eq!(
        initialize["params"],
        json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "opencode", "version": "0.0.0" } })
    );
    assert_eq!(
        setup.tui.prompt.editor.server().unwrap()["serverInfo"]["name"],
        "fake-ide"
    );

    ide.notify(
        "selection_changed",
        selection("/project/src/main.rs", (3, 1), (5, 2), "fn main() {\n}"),
    );
    setup.wait_for("main.rs#3-5");
    assert_eq!(setup.tui.prompt.editor.label_state(), LabelState::Pending);

    // A queued prompt cannot carry the context.
    setup.app.type_text("explain");
    setup.app.press("ctrl+x");
    setup.app.press("return");
    setup.wait_for("Editor context cannot be queued");
    assert!(setup.posts().is_empty());

    setup.app.press("return");
    setup.wait("the prompt", || {
        setup.posts().iter().any(|(path, _)| path.ends_with("/prompt"))
    });
    let posts = setup.posts();
    let paths: Vec<&str> = posts
        .iter()
        .map(|(path, _)| path.as_str())
        .filter(|path| path.ends_with("/synthetic") || path.ends_with("/prompt"))
        .collect();
    assert_eq!(
        paths,
        ["/api/session/ses_a/synthetic", "/api/session/ses_a/prompt"]
    );
    let synthetic = &posts
        .iter()
        .find(|(path, _)| path.ends_with("/synthetic"))
        .unwrap()
        .1;
    assert_eq!(
        synthetic["text"],
        "<system-reminder>Note: The user selected #3-5 from \"/project/src/main.rs\". ```fn main() {\n}```\n\n This may or may not be relevant to the current task.</system-reminder>\n"
    );
    assert_eq!(synthetic["resume"], false);
    assert_eq!(setup.tui.prompt.editor.label_state(), LabelState::Sent);

    // Sent once: the next prompt goes alone, and the label stays, muted.
    setup.app.type_text("again");
    setup.app.press("return");
    setup.wait("the second prompt", || {
        setup
            .posts()
            .iter()
            .filter(|(path, _)| path.ends_with("/prompt"))
            .count()
            == 2
    });
    let synthetics = setup
        .posts()
        .iter()
        .filter(|(path, _)| path.ends_with("/synthetic"))
        .count();
    assert_eq!(synthetics, 1);
    setup.wait_for("main.rs#3-5");

    // `prompt.editor_context.clear` removes it.
    setup
        .tui
        .keymap
        .dispatch("prompt.editor_context.clear", None);
    setup.wait("the label to go", || !setup.app.text().contains("main.rs#"));
}

#[test]
fn ide_mentions_insert_file_parts_with_their_lines() {
    let ide = Ide::start();
    let setup = Setup::new(Source {
        port: Some(ide.port),
        ..Source::default()
    });
    setup.wait("the MCP handshake", || ide.methods().len() == 2);
    setup.app.type_text("look at ");
    ide.notify(
        "at_mentioned",
        json!({ "filePath": "/project/src/lib.rs", "lineStart": 12, "lineEnd": 20 }),
    );
    setup.wait("the mention", || {
        setup.textarea().text() == "look at @src/lib.rs#12-20 "
    });
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (8, 25));
    // One line, outside the project: an absolute path and no end.
    ide.notify(
        "at_mentioned",
        json!({ "filePath": "/elsewhere/a b.ts", "lineStart": 4, "lineEnd": 4 }),
    );
    setup.wait("the second mention", || {
        setup.textarea().text().ends_with("@/elsewhere/a b.ts#4 ")
    });
    setup.app.press("return");
    setup.wait("the prompt", || {
        setup.posts().iter().any(|(path, _)| path.ends_with("/prompt"))
    });
    let prompt = setup
        .posts()
        .into_iter()
        .find(|(path, _)| path.ends_with("/prompt"))
        .unwrap()
        .1;
    assert_eq!(
        prompt["files"],
        json!([
            { "uri": "file:///project/src/lib.rs?start=12&end=20", "name": "src/lib.rs#12-20",
              "mention": { "start": 8, "end": 25, "text": "@src/lib.rs#12-20" } },
            { "uri": "file:///elsewhere/a%20b.ts?start=4", "name": "/elsewhere/a b.ts#4",
              "mention": { "start": 26, "end": 46, "text": "@/elsewhere/a b.ts#4" } },
        ])
    );
}

#[test]
fn lock_files_name_the_server_and_its_token() {
    let ide = Ide::start();
    let home = tempfile::tempdir().unwrap();
    let locks = home.path().join(".claude/ide");
    std::fs::create_dir_all(&locks).unwrap();
    std::fs::write(
        locks.join(format!("{}.lock", ide.port)),
        json!({ "workspaceFolders": ["/project"], "authToken": "token-1", "transport": "ws" }).to_string(),
    )
    .unwrap();
    let setup = Setup::new(Source {
        home: Some(home.path().to_owned()),
        ..Source::default()
    });
    setup.wait("the MCP handshake", || ide.methods().len() == 2);
    assert_eq!(
        *ide.authorization.lock().unwrap(),
        [Some("token-1".to_owned())]
    );
}

#[test]
fn zed_selection_is_read_from_its_database() {
    let root = tempfile::tempdir().unwrap();
    let db = root.path().join("db.sqlite");
    let file = root.path().join("index.ts");
    std::fs::write(&file, "const a = 1\nconst b = 2\n").unwrap();
    zed_database(&db, &file, (6, 17));
    let setup = Setup::new(Source {
        zed_terminal: true,
        zed_db: vec![root.path().join("missing.sqlite"), db.clone()],
        ..Source::default()
    });
    // `index.*` names its directory too; bytes 6..17 run from line 1 into line 2.
    let directory = root.path().file_name().unwrap().to_string_lossy().into_owned();
    setup.wait_for(&format!("{directory}/index.ts#1-2"));
    // The next poll sees a new selection.
    let connection = rusqlite::Connection::open(&db).unwrap();
    connection
        .execute("update editor_selections set start = 12, end = 17", [])
        .unwrap();
    drop(connection);
    setup.wait_for(&format!("{directory}/index.ts#2"));
    let selection = setup.tui.prompt.editor.selection().unwrap();
    assert_eq!(selection.ranges[0].text, "const");
}

/// A Zed database whose only workspace is `/` with `file` active, selected from byte `start` to `end`. Zed keeps
/// no contents for a saved file, so the file is read.
fn zed_database(db: &Path, file: &Path, (start, end): (u32, u32)) {
    let connection = rusqlite::Connection::open(db).unwrap();
    connection
        .execute_batch(
            "create table workspaces (workspace_id integer, paths text, timestamp text);
            create table panes (pane_id integer, workspace_id integer, active integer);
            create table items (item_id integer, workspace_id integer, pane_id integer, kind text, active integer);
            create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
            create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
            insert into workspaces values (1, '[\"/\"]', '2026-11-04 10:00:00');
            insert into panes values (1, 1, 1);
            insert into items values (7, 1, 1, 'Editor', 1);",
        )
        .unwrap();
    connection
        .execute(
            "insert into editors values (7, 1, ?1, null)",
            [file.to_string_lossy()],
        )
        .unwrap();
    connection
        .execute(
            "insert into editor_selections values (7, 1, ?1, ?2)",
            [start, end],
        )
        .unwrap();
}
