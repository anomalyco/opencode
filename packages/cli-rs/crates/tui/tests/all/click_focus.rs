//! Which clicks move the keyboard focus (`rs-click-focus`). TS runs the renderer with `autoFocus: false`
//! (`app.tsx:258`), so a click moves no focus by itself: the transcript, the sidebar, the tabs, the footer, and a
//! toast leave the prompt focused. Only the prompt (`prompt/index.tsx:1838-1844`), an embedded terminal
//! (`EmbeddedTerminal.forwardMouse`), and a panel's host (`panel-host.tsx:34`) take it, and a click on the session
//! pane while the right pane has it gives it back to the prompt (`session-frame.tsx:300-322`).

use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::pty::{self, Incoming, Remote};
use opencode_local::cli_config::{self, Resolved};
use opencode_tui::{Deps, Route, Tui};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::AppOptions;
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";

fn terminal() -> Value {
    json!({
        "id": "pty_1", "title": "Terminal", "command": "/bin/sh", "args": [], "cwd": DIRECTORY,
        "status": "running", "pid": 42, "sessionID": "ses_a", "foregroundProcess": null,
        "size": { "cols": 80, "rows": 24 }, "output": { "head": 0, "tail": 0 },
    })
}

fn routes() -> Vec<MemoryRoute> {
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let session = json!({
        "id": "ses_a", "title": "Fix the parser", "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    });
    let diff = json!({
        "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1,
        "status": "modified",
    });
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([]))),
        MemoryRoute::json(
            "GET",
            "/api/info",
            200,
            &json!({ "version": "test", "pid": 0, "urls": [], "paths": { "tmp": "/tmp" },
                     "capabilities": { "persistentPty": true } }),
        ),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [session], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/ses_a", 200, &json!({ "data": session })),
        MemoryRoute::json("GET", "/api/session/ses_a/diff", 200, &json!({ "data": [diff] })),
        MemoryRoute::json("GET", "/api/vcs/base", 200, &list(Value::Null)),
        MemoryRoute::json("GET", "/api/vcs/diff", 200, &list(json!([diff]))),
        MemoryRoute::json("GET", "/api/session/ses_a/message", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/experimental/session/ses_a/terminal", 200, &json!({ "data": [terminal()] })),
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
    for list in ["inbox", "permission", "form"] {
        routes.push(MemoryRoute::json("GET", &format!("/api/session/ses_a/{list}"), 200, &json!({ "data": [] })));
    }
    routes
}

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    remotes: Arc<Mutex<Vec<Remote>>>,
}

fn mount() -> Harness {
    let memory = Memory::new(routes());
    let client = Client::with_transport("http://opencode.local", Arc::new(memory)).unwrap();
    // The TUI's own options, as `app::run` builds the app.
    let options = AppOptions { capture_stderr: false, ..opencode_tui::app::options() };
    let app = TestApp::with_options(160, 30, options);
    let info = cli_config::decode_text(r#"{"animations":false}"#).unwrap();
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Session { id: SessionID("ses_a".into()) },
            continue_: false,
            events: true,
        },
    );
    let remotes: Arc<Mutex<Vec<Remote>>> = Arc::default();
    let opened = remotes.clone();
    tui.terminals.set_connector(Arc::new(move |_| {
        let (socket, remote) = pty::pair();
        opened.lock().unwrap().push(remote);
        Ok(socket)
    }));
    let harness = Harness { app, tui, remotes };
    harness.wait_for("Fix the parser");
    harness
}

impl Harness {
    fn wait_for(&self, what: &str) -> String {
        let found = self.app.wait_until(Duration::from_secs(5), || self.app.text().contains(what));
        let screen = self.app.text();
        assert!(found, "{what:?} never showed:\n{screen}");
        screen
    }

    /// The cell of the `nth` line that contains `what`, at its first character.
    fn find(&self, what: &str, nth: usize) -> (u16, u16) {
        let screen = self.wait_for(what);
        let (y, line) = screen
            .lines()
            .enumerate()
            .filter(|(_, line)| line.contains(what))
            .nth(nth)
            .unwrap_or_else(|| panic!("no line {nth} with {what:?}:\n{screen}"));
        let x = line[..line.find(what).unwrap()].chars().count();
        (x as u16, y as u16)
    }

    fn prompt_text(&self) -> String {
        self.tui.textarea.borrow().as_ref().unwrap().text()
    }

    fn prompt_focused(&self) -> bool {
        let textarea = self.tui.textarea.borrow().clone().unwrap();
        self.tui.app.focused().is_some_and(|widget| widget.id() == textarea.id())
    }

    /// Clicks `at`, types `text`, and asserts the prompt took it.
    fn click_then_type(&self, what: &str, at: (u16, u16), text: &str) {
        let before = self.prompt_text();
        self.app.click(at.0, at.1);
        self.app.type_text(text);
        assert_eq!(
            self.prompt_text(),
            format!("{before}{text}"),
            "typing after a click on the {what} at {at:?} missed the prompt:\n{}",
            self.app.text()
        );
        assert!(self.prompt_focused(), "the {what} took the focus");
    }

    /// Opens the session's terminal and attaches its socket, so the pane shows the embedded terminal.
    fn open_terminal(&self) -> (u16, u16) {
        assert!(
            self.app.wait_until(Duration::from_secs(5), || self.tui.terminals.available()),
            "the server never reported terminals"
        );
        self.tui.keymap.dispatch("terminal.toggle", None);
        assert!(
            self.app.wait_until(Duration::from_secs(5), || { !self.remotes.lock().unwrap().is_empty() }),
            "no socket opened"
        );
        let deliver = self.remotes.lock().unwrap()[0].deliver.clone();
        for text in [
            r#"{"type":"attached","inputProtocol":1,"info":{"size":{"cols":80,"rows":24}},"role":"controller"}"#,
            r#"{"type":"replay_complete"}"#,
        ] {
            deliver.try_send(Incoming::Text(text.into())).unwrap();
        }
        self.app.wait_until(Duration::from_millis(200), || false);
        // Inside the terminal, a few cells right of the session pane's prompt.
        let (x, y) = self.find("╹▀", 0);
        let line = self.app.text().lines().nth(y as usize).unwrap().to_owned();
        (x + line.trim().chars().count() as u16 + 5, 10)
    }

    /// Bytes the terminal's socket sent so far.
    fn sent(&self) -> Vec<u8> {
        self.app.render();
        let mut remotes = self.remotes.lock().unwrap();
        let mut bytes = Vec::new();
        while let Ok(frame) = remotes[0].sent.try_recv() {
            bytes.extend(frame);
        }
        bytes
    }
}

#[test]
fn clicks_outside_the_prompt_leave_it_focused() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    assert!(h.prompt_focused(), "the session did not focus its prompt");
    let (width, _) = h.tui.app.size();
    // The transcript's empty rows, under the title.
    h.click_then_type("transcript", (20, 8), "a");
    // The sidebar's title, at the right.
    let (_, y) = h.find("Fix the parser", 1);
    h.click_then_type("sidebar", (width - 10, y), "b");
    // The open tab in the tab strip.
    h.click_then_type("tab strip", (5, 0), "c");
    // The footer's hints under the prompt.
    let (x, y) = h.find("shift+tab agents", 0);
    h.click_then_type("footer", (x + 2, y), "d");
    h.tui.toasts.show(ToastOptions::new(Variant::Info, "Saved the draft"));
    let at = h.find("Saved the draft", 0);
    h.click_then_type("toast", at, "e");
    assert_eq!(h.prompt_text(), "abcde");
}

#[test]
fn a_drag_selection_copies_and_keeps_the_prompt_focused() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    let (x, y) = h.find("Fix the parser", 1);
    h.app.drag((x, y), (x + 8, y));
    assert!(h.prompt_focused(), "a drag took the focus");
    assert_eq!(h.tui.app.selected_text().as_deref(), Some("Fix the p"));
    h.app.type_text("z");
    assert_eq!(h.prompt_text(), "z");
}

#[test]
fn a_click_inside_a_dialog_leaves_its_filter_focused() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    h.app.press("ctrl+p");
    // A group header in the list does not take the filter's focus.
    let (x, y) = h.find("Suggested", 0);
    h.app.click(x, y);
    h.app.type_text("zq");
    h.wait_for("zq");
    assert_eq!(h.prompt_text(), "");
}

#[test]
fn a_click_on_the_prompt_focuses_it() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    h.tui.app.blur();
    // The prompt's first row, right of its `┃` border.
    let (x, y) = h.find("┃", 0);
    h.click_then_type("prompt", (x + 4, y + 1), "f");
}

#[test]
fn a_click_on_the_terminal_focuses_it_and_one_on_the_session_pane_gives_it_back() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    let at = h.open_terminal();
    // The terminal took the focus when it opened; the prompt has it back.
    h.tui.keymap.dispatch("pane.focus.left", None);
    assert!(h.prompt_focused());
    h.sent();
    h.app.click(at.0, at.1);
    h.app.type_text("t");
    assert!(h.sent().ends_with(b"t"), "a click on the terminal did not focus it:\n{}", h.app.text());
    assert_eq!(h.prompt_text(), "");
    // `session-frame.tsx:300-322`: a click on the session pane returns the focus to the prompt.
    h.click_then_type("session pane", (20, 8), "g");
}

#[test]
fn a_click_on_a_panel_focuses_its_host() {
    let h = mount();
    h.wait_for("ctrl+p commands");
    h.tui.keymap.dispatch("diff.open", None);
    h.wait_for("src/main.rs");
    h.tui.keymap.dispatch("pane.focus.left", None);
    assert!(h.prompt_focused());
    let (x, y) = h.find("src/main.rs", 0);
    h.app.click(x, y + 2);
    assert!(!h.prompt_focused(), "a click on the panel left the prompt focused");
    h.app.type_text("h");
    assert_eq!(h.prompt_text(), "", "keys after a panel click reached the prompt");
}
