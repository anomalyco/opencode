//! Editor integration (E.5): the IDE's selection and mentions from a fake IDE MCP server, Zed's selection
//! from a database in a temporary directory, and the prompt's use of them. No real editor, IDE, or Zed
//! database is touched: every source is built here.

use crate::support::{self, DIRECTORY, Fake, Harness, Log, deref_harness, list};

use std::path::Path;
use std::sync::Arc;

use opencode_tui::prompt::editor_context::{self, LabelState, Source, zed};
use serde_json::{Value, json};

use crate::support::ide;

use ide::Ide;

/// The baseline routes; any other read is an empty list and any other write a 204.
fn fake() -> Fake {
    Fake::new(|seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/vcs") => (200, list(DIRECTORY, json!({}))),
        ("POST", path) if path.ends_with("/synthetic") => (
            200,
            json!({ "data": {
                "id": "inb_1", "sessionID": "ses_a", "time": { "created": 1 }, "type": "synthetic",
                "payload": { "text": seen.body["text"] }, "delivery": "steer",
            } }),
        ),
        _ => match support::base(seen, DIRECTORY) {
            (404, _) if seen.method == "GET" => (200, list(DIRECTORY, json!([]))),
            (404, _) if seen.method == "POST" => (204, Value::Null),
            reply => reply,
        },
    })
}

struct Setup {
    harness: Harness,
    seen: Log,
}

deref_harness!(Setup);

impl Setup {
    fn new(source: Source) -> Self {
        let fake = fake();
        let seen = fake.log();
        let setup = Self { harness: support::mount(90, 30, support::deps(Arc::new(fake))), seen };
        setup.wait_for("Model M");
        editor_context::start(&setup.tui, source);
        setup
    }

    fn posts(&self) -> Vec<(String, Value)> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            // The goal footer's RPC `get` is a read (E.14).
            .filter(|seen| seen.method == "POST" && !seen.path.starts_with("/api/rpc/"))
            .map(|seen| (seen.path.clone(), seen.body.clone()))
            .collect()
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
    let setup = Setup::new(Source { port: Some(ide.port), ..Source::default() });
    setup.wait("the MCP handshake", || ide.methods() == ["initialize", "notifications/initialized"]);
    let initialize = ide.received.lock().unwrap()[0].clone();
    assert_eq!(
        initialize["params"],
        json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "opencode", "version": "0.0.0" } })
    );
    assert_eq!(setup.tui.prompt.editor.server().unwrap()["serverInfo"]["name"], "fake-ide");

    ide.notify("selection_changed", selection("/project/src/main.rs", (3, 1), (5, 2), "fn main() {\n}"));
    setup.wait_for("main.rs#3-5");
    assert_eq!(setup.tui.prompt.editor.label_state(), LabelState::Pending);

    // A queued prompt cannot carry the context.
    setup.app.type_text("explain");
    setup.app.press("ctrl+x");
    setup.app.press("return");
    setup.wait_for("Editor context cannot be queued");
    assert!(setup.posts().is_empty());

    setup.app.press("return");
    setup.wait("the prompt", || setup.posts().iter().any(|(path, _)| path.ends_with("/prompt")));
    let posts = setup.posts();
    let paths: Vec<&str> = posts
        .iter()
        .map(|(path, _)| path.as_str())
        .filter(|path| path.ends_with("/synthetic") || path.ends_with("/prompt"))
        .collect();
    assert_eq!(paths, ["/api/session/ses_a/synthetic", "/api/session/ses_a/prompt"]);
    let synthetic = &posts.iter().find(|(path, _)| path.ends_with("/synthetic")).unwrap().1;
    assert_eq!(
        synthetic["text"],
        "<system-reminder>Note: The user selected #3-5 from \"/project/src/main.rs\". ```fn main() {\n}```\n\n This may or may not be relevant to the current task.</system-reminder>\n"
    );
    assert_eq!(synthetic["resume"], false);
    assert_eq!(setup.tui.prompt.editor.label_state(), LabelState::Sent);

    // Sent once: the next prompt goes alone, and the label stays, muted.
    setup.app.type_text("again");
    setup.app.press("return");
    setup.wait("the second prompt", || setup.posts().iter().filter(|(path, _)| path.ends_with("/prompt")).count() == 2);
    let synthetics = setup.posts().iter().filter(|(path, _)| path.ends_with("/synthetic")).count();
    assert_eq!(synthetics, 1);
    setup.wait_for("main.rs#3-5");

    // `prompt.editor_context.clear` removes it.
    setup.tui.keymap.dispatch("prompt.editor_context.clear", None);
    setup.wait("the label to go", || !setup.app.text().contains("main.rs#"));
}

#[test]
fn ide_mentions_insert_file_parts_with_their_lines() {
    let ide = Ide::start();
    let setup = Setup::new(Source { port: Some(ide.port), ..Source::default() });
    setup.wait("the MCP handshake", || ide.methods().len() == 2);
    setup.app.type_text("look at ");
    ide.notify("at_mentioned", json!({ "filePath": "/project/src/lib.rs", "lineStart": 12, "lineEnd": 20 }));
    setup.wait("the mention", || setup.textarea().text() == "look at @src/lib.rs#12-20 ");
    let marks = setup.textarea().extmarks();
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].start, marks[0].end), (8, 25));
    // One line, outside the project: an absolute path and no end.
    ide.notify("at_mentioned", json!({ "filePath": "/elsewhere/a b.ts", "lineStart": 4, "lineEnd": 4 }));
    setup.wait("the second mention", || setup.textarea().text().ends_with("@/elsewhere/a b.ts#4 "));
    setup.app.press("return");
    setup.wait("the prompt", || setup.posts().iter().any(|(path, _)| path.ends_with("/prompt")));
    let prompt = setup.posts().into_iter().find(|(path, _)| path.ends_with("/prompt")).unwrap().1;
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
    let setup = Setup::new(Source { home: Some(home.path().to_owned()), ..Source::default() });
    setup.wait("the MCP handshake", || ide.methods().len() == 2);
    assert_eq!(*ide.authorization.lock().unwrap(), [Some("token-1".to_owned())]);
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
    zed::exec(&db, "update editor_selections set start = 12, end = 17").unwrap();
    setup.wait_for(&format!("{directory}/index.ts#2"));
    let selection = setup.tui.prompt.editor.selection().unwrap();
    assert_eq!(selection.ranges[0].text, "const");
}

/// A Zed database whose only workspace is `/` with `file` active, selected from byte `start` to `end`. Zed keeps
/// no contents for a saved file, so the file is read.
fn zed_database(db: &Path, file: &Path, (start, end): (u32, u32)) {
    let file = file.to_string_lossy().replace('\'', "''");
    zed::exec(
        db,
        &format!(
            "create table workspaces (workspace_id integer, paths text, timestamp text);
            create table panes (pane_id integer, workspace_id integer, active integer);
            create table items (item_id integer, workspace_id integer, pane_id integer, kind text, active integer);
            create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
            create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
            insert into workspaces values (1, '[\"/\"]', '2026-11-04 10:00:00');
            insert into panes values (1, 1, 1);
            insert into items values (7, 1, 1, 'Editor', 1);
            insert into editors values (7, 1, '{file}', null);
            insert into editor_selections values (7, 1, {start}, {end});",
        ),
    )
    .unwrap();
}
