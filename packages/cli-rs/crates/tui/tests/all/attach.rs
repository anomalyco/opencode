//! Pastes, attachments, and the stash (E.4) over a fixture server that records requests. Clipboard reads go
//! to the test sink (`features::links::testing`), never to the real clipboard.
//!
//! - Long pastes collapse into parts that submit their text, and expand on a click or a second paste.
//! - Clipboard images and pasted file paths attach as `[Image N]`, preview above the prompt, and open in the
//!   image preview dialog.
//! - The stash pushes, pops, and lists, and `prompt-stash.jsonl` is shared with the TypeScript TUI (P-FILE).

use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Prompt, PromptPaste, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::features::links::testing;
use opencode_tui::features::startup::Args;
use opencode_tui::{Deps, Route, Tui};
use opentui::native::ClipboardOutcome;
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// A 1×1 PNG.
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
                    "capabilities": { "tools": true, "input": ["text", "image"], "output": ["text"] },
                    "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
                    "enabled": true, "limit": { "context": 1000, "output": 100 },
                }] }),
            ),
            (
                "GET",
                "/api/provider"
                | "/api/integration"
                | "/api/form"
                | "/api/permission/request"
                | "/api/command"
                | "/api/skill"
                | "/api/reference",
            ) => (200, json!({ "location": location, "data": [] })),
            ("GET", path) if path.ends_with("/form") || path.ends_with("/permission") => {
                (200, json!({ "data": [] }))
            }
            ("GET", "/api/config") => (200, json!([])),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": body["id"], "sessionID": "ses_a", "time": { "created": 1 }, "type": "user",
                    "payload": { "text": body["text"] }, "delivery": "steer",
                } }),
            ),
            ("POST", path) if path.ends_with("/model") || path.ends_with("/agent") => {
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
    home: tempfile::TempDir,
}

impl Setup {
    fn new() -> Self {
        Self::with(tempfile::tempdir().unwrap(), Info::default(), false)
    }

    fn with(home: tempfile::TempDir, info: Info, local: bool) -> Self {
        let seen = Seen::default();
        let client = Client::with_transport(
            "http://opencode.local",
            Arc::new(Fixture { seen: seen.clone() }),
        )
        .unwrap();
        let app = TestApp::new(90, 30);
        let tui = opencode_tui::app::mount_with(
            &app,
            Deps {
                client,
                directory: "/project".into(),
                config: Resolved::new(info, |_| None),
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
            Args {
                local,
                ..Args::default()
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
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn wait_gone(&self, text: &str) {
        let gone = self
            .app
            .wait_until(Duration::from_secs(5), || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    fn text(&self) -> String {
        self.tui.textarea.borrow().clone().unwrap().text()
    }

    fn wait_text(&self, text: &str) {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.text() == text);
        assert!(found, "prompt is {:?}, not {text:?}", self.text());
    }

    fn submit(&self) -> Value {
        let before = self.prompts().len();
        self.app.press("return");
        let sent = self
            .app
            .wait_until(Duration::from_secs(5), || self.prompts().len() > before);
        assert!(sent, "no prompt sent: {:?}", self.seen.lock().unwrap());
        self.prompts().pop().unwrap()
    }

    fn prompts(&self) -> Vec<Value> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, path, _)| method == "POST" && path.ends_with("/prompt"))
            .map(|(_, _, body)| body.clone())
            .collect()
    }

    /// The cell where `needle` starts on screen.
    fn find(&self, needle: &str) -> (u16, u16) {
        let screen = self.app.text();
        screen
            .lines()
            .enumerate()
            .find_map(|(y, line)| {
                let x = line.find(needle)?;
                Some((line[..x].chars().count() as u16, y as u16))
            })
            .unwrap_or_else(|| panic!("{needle:?} not on screen:\n{screen}"))
    }

    fn dispatch(&self, command: &str) {
        self.tui.keymap.dispatch(command, None);
        self.app.advance(Duration::from_millis(1));
    }

    fn stash_file(&self) -> String {
        std::fs::read_to_string(self.home.path().join("state/prompt-stash.jsonl"))
            .unwrap_or_default()
    }

    fn wait_stash_file(&self, check: impl Fn(&str) -> bool) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || check(&self.stash_file()));
        assert!(found, "prompt-stash.jsonl is {:?}", self.stash_file());
        self.stash_file()
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

fn prompt_config(paste: Option<PromptPaste>, image_preview: bool) -> Info {
    Info {
        prompt: Some(Prompt {
            paste,
            image_preview: Some(image_preview),
            ..Prompt::default()
        }),
        ..Info::default()
    }
}

#[test]
fn long_pastes_collapse_into_parts_that_send_their_text() {
    let setup = Setup::new();
    setup.app.type_text("see ");
    setup.app.paste("one\r\ntwo\r\nthree");
    setup.wait_text("see [Pasted ~3 lines] ");
    // More than 150 characters on one line collapses too.
    let long = "x".repeat(151);
    setup.app.paste(&long);
    setup.wait_text("see [Pasted ~3 lines] [Pasted ~1 lines] ");
    setup.app.type_text("go");
    let sent = setup.submit();
    assert_eq!(sent["text"], format!("see one\ntwo\nthree {long} go"));
    // History keeps the parts, so Up brings back the labels and the text behind them.
    setup.app.press("up");
    setup.wait_text("see [Pasted ~3 lines] [Pasted ~1 lines] go");
    let sent = setup.submit();
    assert_eq!(sent["text"], format!("see one\ntwo\nthree {long} go"));
}

#[test]
fn a_second_paste_or_a_click_expands_a_paste_and_backspace_removes_it() {
    let setup = Setup::new();
    setup.app.paste("a\nb\nc");
    setup.wait_text("[Pasted ~3 lines] ");
    setup.app.paste("a\nb\nc");
    setup.wait_text("a\nb\nc ");

    setup.app.press("ctrl+c");
    setup.app.paste("d\ne\nf");
    setup.wait_text("[Pasted ~3 lines] ");
    let (x, y) = setup.find("[Pasted");
    setup.app.click(x, y);
    setup.wait_text("d\ne\nf ");

    setup.app.press("ctrl+c");
    setup.app.paste("g\nh\ni");
    setup.wait_text("[Pasted ~3 lines] ");
    // The label is one unit: two Backspaces take the space, then the whole part.
    setup.app.press("backspace");
    setup.app.press("backspace");
    setup.wait_text("");
}

#[test]
fn copying_a_selection_over_a_paste_copies_its_text() {
    let capture = testing::capture();
    let setup = Setup::new();
    setup.app.type_text("see ");
    setup.app.paste("a\nb\nc");
    setup.wait_text("see [Pasted ~3 lines] ");
    let (x, y) = setup.find("see [Pasted");
    // From "see" (not on the label, whose press would expand it) to the label's last cell.
    setup.app.drag((x, y), (x + 20, y));
    let copied = setup.app.wait_until(Duration::from_secs(5), || {
        !capture.0.copied.borrow().is_empty()
    });
    assert!(copied, "nothing copied:\n{}", setup.app.text());
    assert_eq!(capture.0.copied.borrow().last().unwrap(), "see a\nb\nc");
}

#[test]
fn short_pastes_go_in_as_they_are_and_full_turns_compaction_off() {
    let setup = Setup::new();
    setup.app.paste("short \u{1b}[31mred\u{1b}[0m\rpaste");
    setup.wait_text("short red\npaste");

    let full = Setup::with(
        tempfile::tempdir().unwrap(),
        prompt_config(Some(PromptPaste::Full), false),
        false,
    );
    full.app.paste("a\nb\nc\nd");
    full.wait_text("a\nb\nc\nd");
}

#[test]
fn clipboard_images_attach_preview_and_open_in_the_dialog() {
    let capture = testing::capture();
    let png = base64::engine::general_purpose::STANDARD
        .decode(PNG)
        .unwrap();
    let setup = Setup::with(
        tempfile::tempdir().unwrap(),
        prompt_config(None, true),
        false,
    );
    let read = || ClipboardOutcome::Read {
        mime_type: "image/png".into(),
        data: png.clone(),
    };
    capture.0.clipboard.borrow_mut().extend([read(), read()]);
    setup.app.press("ctrl+v");
    setup.wait_text("[Image 1] ");
    // The same image again keeps its label.
    setup.app.press("ctrl+v");
    setup.wait_text("[Image 1] [Image 1] ");

    // `<leader>i`: the preview dialog shows the image once, under its label.
    setup.app.press("ctrl+x");
    setup.app.press("i");
    let screen = setup.wait_for("Image 1 of 1");
    assert!(screen.contains("[Image 1]"), "{screen}");
    setup.app.press("escape");
    setup.wait_gone("Image 1 of 1");

    let sent = setup.submit();
    let uri = format!("data:image/png;base64,{PNG}");
    assert_eq!(
        sent["files"],
        json!([
            { "uri": uri, "name": "clipboard", "mention": { "start": 0, "end": 9, "text": "[Image 1]" } },
            { "uri": uri, "name": "clipboard", "mention": { "start": 10, "end": 19, "text": "[Image 1]" } },
        ])
    );
    // Sent untrimmed, as TS sends `inputText`.
    assert_eq!(sent["text"], "[Image 1] [Image 1] ");
}

#[test]
fn clipboard_text_pastes_and_read_errors_toast() {
    let capture = testing::capture();
    let setup = Setup::new();
    capture.0.clipboard.borrow_mut().extend([
        ClipboardOutcome::Read {
            mime_type: "text/plain".into(),
            data: b"one\ntwo\nthree".to_vec(),
        },
        ClipboardOutcome::TimedOut,
        ClipboardOutcome::Empty,
    ]);
    setup.app.press("ctrl+v");
    setup.wait_text("[Pasted ~3 lines] ");
    setup.app.press("ctrl+v");
    setup.wait_for("Clipboard read timed out");
    // An empty clipboard changes nothing; an empty terminal paste reads the clipboard too.
    setup.app.paste("");
    setup.app.advance(Duration::from_millis(5));
    assert_eq!(setup.text(), "[Pasted ~3 lines] ");
    assert!(capture.0.clipboard.borrow().is_empty());
}

#[test]
fn pasted_paths_attach_files_and_svgs_paste_their_text() {
    let files = tempfile::tempdir().unwrap();
    let png = files.path().join("shot one.png");
    std::fs::write(
        &png,
        base64::engine::general_purpose::STANDARD
            .decode(PNG)
            .unwrap(),
    )
    .unwrap();
    let svg = files.path().join("logo.svg");
    std::fs::write(&svg, "<svg/>").unwrap();
    let setup = Setup::with(
        tempfile::tempdir().unwrap(),
        prompt_config(None, true),
        true,
    );
    // A dragged path arrives quoted or escaped; both attach.
    setup
        .app
        .paste(&format!("'{}'", png.display()).replace(' ', "\\ "));
    setup.wait_text("[Image 1] ");
    setup.app.paste(&format!("{}", svg.display()));
    setup.wait_text("[Image 1] [SVG: logo.svg] ");
    // A path that is not an attachment is plain text.
    setup.app.paste("/tmp/notes.txt");
    setup.wait_text("[Image 1] [SVG: logo.svg] /tmp/notes.txt");

    let sent = setup.submit();
    assert_eq!(sent["text"], "[Image 1] <svg/> /tmp/notes.txt");
    let url = url::Url::from_file_path(&png).unwrap();
    // A local server also gets the file's URL; the path itself stays in the TUI.
    assert_eq!(
        sent["files"],
        json!([{
            "uri": format!("data:image/png;base64,{PNG}"),
            "source": { "type": "uri", "uri": url.as_str() },
            "name": "shot one.png",
            "mention": { "start": 0, "end": 9, "text": "[Image 1]" },
        }])
    );
}

#[test]
fn previews_show_above_the_prompt_and_a_click_opens_the_dialog() {
    let files = tempfile::tempdir().unwrap();
    let bad = files.path().join("bad.png");
    std::fs::write(&bad, b"not a png").unwrap();
    let setup = Setup::with(
        tempfile::tempdir().unwrap(),
        prompt_config(None, true),
        false,
    );
    setup.app.paste(&bad.display().to_string());
    setup.wait_text("[Image 1] ");
    let (x, y) = setup.find("No preview");
    let (_, prompt) = setup.find("[Image 1]");
    assert!(y < prompt, "the preview sits above the prompt");
    setup.app.click(x, y);
    let screen = setup.wait_for("Image 1 of 1");
    // The dialog covers the prompt; its footer says the image did not load.
    let (_, title) = setup.find("Image 1 of 1");
    assert!(setup.find("No preview").1 > title, "{screen}");
    setup.app.press("escape");
    setup.wait_gone("Image 1 of 1");
    // Without the option, nothing shows.
    let off = Setup::new();
    off.app.paste(&bad.display().to_string());
    off.wait_text("[Image 1] ");
    assert!(!off.app.text().contains("No preview"));
}

#[test]
fn stash_pushes_pops_and_lists_with_delete_confirm() {
    let setup = Setup::new();
    setup.app.type_text("first idea");
    setup.dispatch("prompt.stash");
    setup.wait_text("");
    setup.app.paste("x\ny\nz");
    setup.app.type_text("second");
    setup.dispatch("prompt.stash");
    setup.wait_text("");
    let file = setup.wait_stash_file(|file| file.lines().count() == 2);
    let entries: Vec<Value> = file
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(entries[0]["prompt"]["text"], "first idea");
    assert_eq!(entries[1]["prompt"]["pasted"][0]["text"], "x\ny\nz");
    assert!(entries[1]["timestamp"].is_number());

    // Pop restores the newest with its paste part.
    setup.dispatch("prompt.stash.pop");
    setup.wait_text("[Pasted ~3 lines] second");
    setup.wait_stash_file(|file| file.lines().count() == 1);
    setup.dispatch("prompt.stash");
    setup.wait_text("");

    // The list shows the newest first; Ctrl+D twice deletes; Enter takes one out.
    setup.dispatch("prompt.stash.list");
    let screen = setup.wait_for("Stash");
    let (newest, oldest) = (
        screen.find("[Pasted ~3 lines] second").unwrap(),
        screen.find("first idea").unwrap(),
    );
    assert!(newest < oldest, "{screen}");
    assert!(screen.contains("just now"), "{screen}");
    setup.app.press("ctrl+d");
    setup.wait_for("Press ctrl+d again to confirm");
    setup.app.press("ctrl+d");
    setup.wait_gone("second");
    setup.wait_stash_file(|file| file.lines().count() == 1);
    setup.app.press("return");
    setup.wait_text("first idea");
    setup.wait_gone("Press ctrl+d");
    setup.wait_stash_file(str::is_empty);
}

#[test]
fn stash_file_is_shared_with_typescript() {
    let Some(root) = ts_root() else { return };
    let setup = Setup::new();
    setup.app.type_text("from rust");
    setup.dispatch("prompt.stash");
    setup.app.paste("p\nq\nr");
    setup.dispatch("prompt.stash");
    let rust = setup.wait_stash_file(|file| file.lines().count() == 2);
    let state = setup.home.path().join("state");

    let typescript =
        json!({ "text": "from typescript", "files": [], "agents": [], "skills": [], "pasted": [] });
    let results = run_typescript(
        &root,
        &state,
        json!([{ "list": true }, { "pop": true }, { "push": typescript }, { "list": true }]),
    );
    assert_eq!(
        results,
        json!([
            ["from rust", "[Pasted ~3 lines] "],
            "[Pasted ~3 lines] ",
            ["from rust", "from typescript"],
        ])
    );
    // TypeScript's load rewrote the Rust lines as it serializes them, unchanged.
    let file = std::fs::read_to_string(state.join("prompt-stash.jsonl")).unwrap();
    let lines: Vec<&str> = file.lines().collect();
    assert_eq!(lines[0], rust.lines().next().unwrap());
    assert_eq!(lines.len(), 2);

    // A new Rust TUI reads the TypeScript file: pop gives the TypeScript entry, then the Rust one.
    let home = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(home.path().join("state")).unwrap();
    std::fs::copy(
        state.join("prompt-stash.jsonl"),
        home.path().join("state/prompt-stash.jsonl"),
    )
    .unwrap();
    let again = Setup::with(home, Info::default(), false);
    let loaded = again.app.wait_until(Duration::from_secs(5), || {
        !again.tui.prompt.stash.is_empty()
    });
    assert!(loaded);
    again.dispatch("prompt.stash.pop");
    again.wait_text("from typescript");
    again.app.press("ctrl+c");
    again.dispatch("prompt.stash.pop");
    again.wait_text("from rust");
    again.wait_stash_file(str::is_empty);
}

/// The TypeScript TUI's `push`: one appended line, without a lock.
fn ts_stash(state: &Path, text: &str) {
    use std::io::Write;
    let line = json!({
        "prompt": { "text": text, "files": [], "agents": [], "skills": [], "pasted": [] },
        "timestamp": 1,
    });
    std::fs::create_dir_all(state).unwrap();
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.join("prompt-stash.jsonl"))
        .unwrap()
        .write_all(format!("{line}\n").as_bytes())
        .unwrap();
}

#[test]
fn a_stash_another_tui_made_survives_pop() {
    let setup = Setup::new();
    setup.app.type_text("mine");
    setup.dispatch("prompt.stash");
    setup.wait_stash_file(|file| file.contains("\"mine\""));
    ts_stash(&setup.home.path().join("state"), "ts-important-draft");
    // Pop takes this TUI's newest entry, and drops only its line.
    setup.dispatch("prompt.stash.pop");
    setup.wait_text("mine");
    let file = setup.wait_stash_file(|file| !file.contains("\"mine\""));
    assert!(file.contains("ts-important-draft"), "{file:?}");
}

#[test]
fn a_stash_made_while_the_stash_loads_is_kept() {
    let home = tempfile::TempDir::new().unwrap();
    let state = home.path().join("state");
    ts_stash(&state, "old");
    // Broken lines keep the load busy past the first frames; it heals them away.
    let file = state.join("prompt-stash.jsonl");
    let mut text = std::fs::read_to_string(&file).unwrap();
    text.push_str(&"broken\n".repeat(2_000_000));
    std::fs::write(&file, text).unwrap();
    let setup = Setup::with(home, Info::default(), false);
    assert!(
        setup.tui.prompt.stash.is_empty(),
        "the load finished too early for this test"
    );
    // Without advancing the app: the load finishes on its thread, but the UI has not taken its result.
    let healed = (0..500).any(|_| {
        std::thread::sleep(Duration::from_millis(10));
        std::fs::read_to_string(&file).is_ok_and(|text| text.lines().count() == 1)
    });
    assert!(healed);
    std::thread::sleep(Duration::from_millis(50));
    let early = json!({ "text": "early", "files": [], "agents": [], "skills": [], "pasted": [] });
    setup.tui.prompt.stash.push(&setup.tui.app, early);
    let texts = || {
        setup
            .tui
            .prompt
            .stash
            .list()
            .iter()
            .map(|entry| entry["prompt"]["text"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    let merged = setup
        .app
        .wait_until(Duration::from_secs(5), || texts() == ["old", "early"]);
    assert!(merged, "the stash is {:?}", texts());
    setup.wait_stash_file(|file| file.lines().count() == 2 && file.contains("\"early\""));
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

/// Runs `parity/oracle/E.4-stash.ts`: the real `PromptStashProvider` on `state`.
fn run_typescript(root: &Path, state: &Path, ops: Value) -> Value {
    use std::io::Write;
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/E.4-stash.ts");
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
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.lines().last().unwrap_or_default()).unwrap()
}
