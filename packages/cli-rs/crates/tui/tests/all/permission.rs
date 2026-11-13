//! The permission prompt (E.9a) over a fixture server: a pending request from the store shows above the
//! prompt, and each answer sends one reply request (P-REQ: method, path, body).

use crate::support::{self, Fake, Harness, WAIT, deref_harness};

use std::sync::{Arc, Mutex};

use opencode_api::generated::SessionInfo;
use opencode_local::cli_config::Permissions;
use opencode_tui::Deps;
use opencode_tui::routes::session::permission::{always_lines, presentation};
use serde_json::{Value, json};

/// A mutating request as the server saw it.
#[derive(Debug, PartialEq)]
struct Sent {
    method: &'static str,
    path: String,
    body: Value,
}

/// The pending requests of the root session and of its child.
#[derive(Default)]
struct Fixture {
    root: Vec<Value>,
    child: Vec<Value>,
}

/// Serves the sessions and their pending requests, and records every POST in `sent`.
fn fake(fixture: Fixture, sent: Arc<Mutex<Vec<Sent>>>) -> Fake {
    Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_root") => (200, json!({ "data": session("ses_root", None) })),
        // The root's children, which a child's arrival reads.
        ("GET", "/api/session") => (200, json!({ "data": [session("ses_child", Some("ses_root"))], "cursor": {} })),
        ("GET", "/api/session/ses_root/message") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/session/ses_root/permission") => (200, json!({ "data": fixture.root })),
        ("GET", "/api/session/ses_child/permission") => (200, json!({ "data": fixture.child })),
        // The goal footer's RPC read (E.14); no goal is set.
        ("POST", path) if path.starts_with("/api/rpc/") => (200, json!({ "output": null })),
        ("POST", path) => {
            sent.lock().unwrap().push(Sent { method: "POST", path: path.to_owned(), body: seen.body.clone() });
            (204, Value::Null)
        }
        _ => support::not_found(),
    })
}

fn session(id: &str, parent: Option<&str>) -> Value {
    support::merge(support::session(id, "Fix the parser"), json!({ "parentID": parent }))
}

fn request(id: &str, session: &str, action: &str, resources: &[&str], save: &[&str]) -> Value {
    json!({ "id": id, "sessionID": session, "action": action, "resources": resources, "save": save })
}

struct Prompt {
    harness: Harness,
    sent: Arc<Mutex<Vec<Sent>>>,
}

deref_harness!(Prompt);

fn mount(fixture: Fixture, permissions: Permissions) -> Prompt {
    let sent = Arc::default();
    let mut config = support::config(opencode_local::cli_config::Info::default());
    config.permissions = permissions;
    let deps = Deps {
        config,
        route: support::session_route("ses_root"),
        ..support::deps(Arc::new(fake(fixture, Arc::clone(&sent))))
    };
    Prompt { harness: support::mount(100, 30, deps), sent }
}

impl Prompt {
    /// Waits for the replies and returns them.
    fn replies(&self, count: usize) -> Vec<Sent> {
        let arrived = self.app.wait_until(WAIT, || self.sent.lock().unwrap().len() >= count);
        let sent = std::mem::take(&mut *self.sent.lock().unwrap());
        assert!(arrived, "expected {count} replies, got {sent:?}");
        sent
    }
}

fn reply(request: &str, session: &str, body: Value) -> Sent {
    Sent { method: "POST", path: format!("/api/session/{session}/permission/{request}/reply"), body }
}

#[test]
fn enter_allows_once_and_the_prompt_returns() {
    let harness = mount(
        Fixture { root: vec![request("per_1", "ses_root", "shell", &["ls -la"], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    let screen = harness.wait_for("Permission required");
    assert!(screen.contains("- ls -la"), "{screen}");
    assert!(screen.contains("Allow once"), "{screen}");
    assert!(screen.contains("Reject"), "{screen}");
    assert!(!screen.contains("Always allow"), "no save patterns:\n{screen}");
    assert!(screen.contains("ctrl+f fullscreen"), "{screen}");
    assert!(!screen.contains("╹▀"), "the prompt hides:\n{screen}");

    harness.app.press("enter");
    assert_eq!(harness.replies(1), [reply("per_1", "ses_root", json!({ "decision": "once" }))]);
    harness.wait_for("╹▀");
    assert!(!harness.app.text().contains("Permission required"));
}

#[test]
fn always_shows_the_saved_patterns_and_replies_always() {
    let harness = mount(
        Fixture {
            root: vec![request("per_1", "ses_root", "shell", &["git status"], &["git *"])],
            ..Fixture::default()
        },
        Permissions::Prompt,
    );
    harness.wait_for("Always allow");
    harness.app.press("right");
    let screen = harness.wait_for("This will always allow the following patterns");
    assert!(screen.contains("- git *"), "{screen}");
    harness.app.press("enter");
    assert_eq!(harness.replies(1), [reply("per_1", "ses_root", json!({ "decision": "always" }))]);
}

#[test]
fn escape_rejects_a_root_request() {
    let harness = mount(
        Fixture { root: vec![request("per_1", "ses_root", "read", &["/etc/hosts"], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    let screen = harness.wait_for("Read /etc/hosts");
    assert!(screen.contains("Path: /etc/hosts"), "{screen}");
    harness.app.press("escape");
    assert_eq!(harness.replies(1), [reply("per_1", "ses_root", json!({ "decision": "reject" }))]);
}

#[test]
fn a_subagent_rejection_asks_what_to_do_differently() {
    let harness = mount(
        Fixture { child: vec![request("per_2", "ses_child", "grep", &["TODO"], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    harness.wait_for("Fix the parser");
    // The child joins the root's family, and its pending requests are read.
    let child: SessionInfo = serde_json::from_value(session("ses_child", Some("ses_root"))).unwrap();
    harness.tui.data.remember(child);
    harness.wait_for("Grep \"TODO\"");

    // `h` wraps from "Allow once" to "Reject".
    harness.app.press("h");
    harness.app.press("enter");
    harness.wait_for("Tell OpenCode what to do differently");
    // Escape goes back to the question without replying.
    harness.app.press("escape");
    harness.wait_for("Grep \"TODO\"");
    harness.app.press("h");
    harness.app.press("enter");
    harness.wait_for("Reject permission");

    // Ctrl+C clears the reason first.
    harness.app.type_text("oops");
    harness.wait_for("oops");
    harness.app.press("ctrl+c");
    assert!(harness.app.wait_until(WAIT, || { !harness.app.text().contains("oops") }));
    harness.wait_for("Reject permission");
    harness.app.type_text("use rg");
    harness.wait_for("use rg");
    harness.app.press("enter");
    assert_eq!(harness.replies(1), [reply("per_2", "ses_child", json!({ "decision": "reject", "message": "use rg" }))]);
}

/// The rejection prompt restyles in place, keeping the reason typed so far: each cell equals the prompt mounted in
/// the new theme with the same reason.
#[test]
fn a_theme_switch_keeps_the_rejection_and_its_reason() {
    support::assert_restyles_in_place(
        || {
            mount(
                Fixture { child: vec![request("per_2", "ses_child", "grep", &["TODO"], &[])], ..Fixture::default() },
                Permissions::Prompt,
            )
        },
        |harness| {
            harness.wait_for("Fix the parser");
            let child: SessionInfo = serde_json::from_value(session("ses_child", Some("ses_root"))).unwrap();
            harness.tui.data.remember(child);
            harness.wait_for("Grep \"TODO\"");
            harness.app.press("h");
            harness.app.press("enter");
            harness.wait_for("Reject permission");
            harness.app.type_text("use rg");
        },
        |screen| screen.contains("use rg") && screen.contains("Tell OpenCode what to do differently"),
    );
}

#[test]
fn ctrl_f_toggles_fullscreen_and_escape_minimizes_first() {
    let harness = mount(
        Fixture { root: vec![request("per_1", "ses_root", "webfetch", &[], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    harness.wait_for("ctrl+f fullscreen");
    harness.app.press("ctrl+f");
    harness.wait_for("ctrl+f minimize");
    harness.app.press("escape");
    harness.wait_for("ctrl+f fullscreen");
    assert!(harness.sent.lock().unwrap().is_empty());
    harness.app.press("ctrl+f");
    harness.wait_for("ctrl+f minimize");
    harness.app.press("enter");
    assert_eq!(harness.replies(1), [reply("per_1", "ses_root", json!({ "decision": "once" }))]);
}

#[test]
fn autoaccept_replies_once_to_each_request_without_prompting() {
    let harness = mount(
        Fixture {
            root: vec![
                request("per_1", "ses_root", "shell", &["ls"], &[]),
                request("per_2", "ses_root", "edit", &["src/a.rs"], &[]),
            ],
            ..Fixture::default()
        },
        Permissions::Autoaccept,
    );
    let mut sent = harness.replies(2);
    sent.sort_by(|a, b| a.path.cmp(&b.path));
    assert_eq!(
        sent,
        [
            reply("per_1", "ses_root", json!({ "decision": "once" })),
            reply("per_2", "ses_root", json!({ "decision": "once" })),
        ]
    );
    let screen = harness.wait_for("╹▀");
    assert!(!screen.contains("Permission required"), "{screen}");
}

// `index.tsx:208-215`: in autoaccept the prompted list is empty, so a request already shown goes when the mode
// turns on, and the session prompt comes back.
#[test]
fn turning_on_autoaccept_answers_and_hides_the_shown_request() {
    let harness = mount(
        Fixture { root: vec![request("per_1", "ses_root", "shell", &["ls"], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    harness.wait_for("Permission required");
    opencode_tui::dialogs::settings::update(&harness.tui, |draft| {
        opencode_tui::dialogs::settings::set_path(draft, &["session", "permissions"], json!("autoaccept"))
    });
    assert_eq!(harness.replies(1), [reply("per_1", "ses_root", json!({ "decision": "once" }))]);
    let screen = harness.wait_for("╹▀");
    assert!(!screen.contains("Permission required"), "{screen}");
}

#[test]
fn presentation_matches_the_typescript_rules() {
    let path = |value: &str| value.replace("/project/", "");
    let show = |action: &str, resources: &[&str], input: Value, metadata: Value| {
        let resources: Vec<String> = resources.iter().map(|item| (*item).to_owned()).collect();
        let current = presentation(action, &resources, None, &input, &metadata, &path);
        (current.icon, current.title, current.lines)
    };
    let cases = [
        (show("bash", &[], json!({ "command": "ls" }), Value::Null), ("#", "Shell command", vec!["$ ls"])),
        (
            show("read", &[], json!({ "filePath": "/project/a.rs" }), Value::Null),
            ("→", "Read a.rs", vec!["Path: a.rs"]),
        ),
        (show("glob", &["*.rs"], Value::Null, Value::Null), ("✱", "Glob \"*.rs\"", vec!["Pattern: *.rs"])),
        (
            show("task", &[], json!({ "subagent_type": "explore", "description": "Find it" }), Value::Null),
            ("#", "Explore Subagent", vec!["◉ Find it"]),
        ),
        (
            show("webfetch", &[], Value::Null, json!({ "url": "https://x.dev" })),
            ("%", "WebFetch https://x.dev", vec!["URL: https://x.dev"]),
        ),
        (
            show(
                "lsp",
                &[],
                json!({ "path": "/project/a.rs", "operation": "hover", "line": 3, "character": 7 }),
                Value::Null,
            ),
            ("→", "LSP hover a.rs:3:7", vec!["Operation: hover", "Path: a.rs", "Position: 3:7"]),
        ),
        (
            show("external_directory", &["/tmp/build/*"], Value::Null, Value::Null),
            ("←", "Access external directory /tmp/build", vec!["- /tmp/build/*"]),
        ),
        (
            show("doom_loop", &[], Value::Null, Value::Null),
            (
                "⟳",
                "Continue after repeated failures",
                vec!["This keeps the session running despite repeated failures."],
            ),
        ),
        (show("mcp_tool", &[], Value::Null, Value::Null), ("⚙", "Call tool mcp_tool", vec!["Tool: mcp_tool"])),
    ];
    for ((icon, title, lines), (want_icon, want_title, want_lines)) in cases {
        assert_eq!(
            (icon, title.as_str(), lines),
            (want_icon, want_title, want_lines.into_iter().map(str::to_owned).collect())
        );
    }

    let edit = presentation(
        "edit",
        &["/project/a.rs".to_owned()],
        None,
        &json!({ "patchText": "*** patch" }),
        &json!({ "files": [{ "patch": "@@ -1 +1 @@\n-a\n+b\n" }] }),
        &path,
    );
    assert_eq!(edit.title, "Edit a.rs");
    assert_eq!(edit.diff.as_deref(), Some("@@ -1 +1 @@\n-a\n+b\n"));
    assert_eq!(edit.patch, None, "a diff wins over the patch text");

    assert_eq!(always_lines("shell", &["*".to_owned()]), ["This will always allow shell for this project."]);
    assert_eq!(
        always_lines("shell", &["git *".to_owned()]),
        ["This will always allow the following patterns for this project.", "- git *"]
    );
}

// Expected (bigboi-3): a plugin toggled in `/plugins` mounts the session again with its pending permission, which
// must not take the keys from the open manager.
#[test]
fn a_pending_permission_does_not_take_the_plugin_manager_search() {
    let harness = mount(
        Fixture { root: vec![request("per_1", "ses_root", "shell", &["ls -la"], &[])], ..Fixture::default() },
        Permissions::Prompt,
    );
    harness.wait_for("Permission required");
    crate::system::toggle_a_plugin(&harness);
    harness.app.type_text("zzqq");
    harness.wait_for("No results found");
    harness.app.press("escape");
    harness.wait_gone("No results found");
    harness.wait_for("Permission required");
}

/// The permission prompt's model test (M5, `round2/models.md`): random asks, replies from this client and from
/// others, reply failures, `autoaccept` toggles, session switches and keys, some dispatched before the keys of the
/// prompt they replace are gone. After each event the test compares what the TUI shows, which keys it holds, which
/// widget has focus and which replies the server got with a small model of the TS prompt.
///
/// `PERMISSION_SEED` runs one seed, `PERMISSION_SEEDS` sets how many seeds run otherwise, and `PERMISSION_STEPS`
/// sets the events per seed.
mod model {
    use crate::support::{self, WAIT};

    use std::cell::Cell;
    use std::rc::Rc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use opencode_api::generated::{PermissionListInput, SessionID, SessionInfo};
    use opencode_api::memory::{Memory, Route as MemoryRoute};
    use opencode_api::transport::{BoxFuture, Request, Response, Transport};
    use opencode_tui::{Deps, Tui};
    use opentui::prelude::{Event, KeyEvent};
    use opentui::testing::TestApp;
    use opentui::widget::Widget;
    use serde_json::{Value, json};

    const A: &str = "ses_a";
    const B: &str = "ses_b";
    /// A child of `ses_a`, so its requests ask what to do differently on reject.
    const C: &str = "ses_c";

    /// xorshift64*: deterministic for a seed, and enough to pick events.
    struct Rng(u64);

    impl Rng {
        fn new(seed: u64) -> Self {
            Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
        }

        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }

        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }

        fn pick<T: Copy>(&mut self, items: &[T]) -> T {
            items[self.below(items.len())]
        }

        fn chance(&mut self, percent: usize) -> bool {
            self.below(100) < percent
        }
    }

    #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
    struct Replied {
        id: String,
        decision: String,
        message: Option<String>,
    }

    /// The server: pending requests in ask order, the replies it got, and whether it fails them now.
    struct Server {
        memory: Memory,
        state: Mutex<ServerState>,
    }

    #[derive(Default)]
    struct ServerState {
        pending: Vec<Value>,
        replies: Vec<Replied>,
        fail: bool,
    }

    impl Transport for Server {
        fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
            let path = request.url.path().to_owned();
            let segments: Vec<&str> = path.split('/').collect();
            let (status, body) = match (request.method, segments.as_slice()) {
                ("GET", ["", "api", "session", session, "permission"]) => {
                    let state = self.state.lock().unwrap();
                    let data: Vec<&Value> = state.pending.iter().filter(|item| item["sessionID"] == *session).collect();
                    (200, json!({ "data": data }))
                }
                ("POST", ["", "api", "session", session, "permission", id, "reply"]) => {
                    let body: Value = serde_json::from_slice(request.body.as_deref().unwrap_or_default()).unwrap();
                    self.answer(session, id, &body)
                }
                _ => return self.memory.send(request),
            };
            Box::pin(async move { Ok(support::respond(status, &body)) })
        }
    }

    impl Server {
        fn answer(&self, session: &str, id: &str, body: &Value) -> (u16, Value) {
            let mut state = self.state.lock().unwrap();
            state.replies.push(Replied {
                id: id.to_owned(),
                decision: body["decision"].as_str().unwrap().to_owned(),
                message: body["message"].as_str().map(str::to_owned),
            });
            if state.fail {
                return (500, json!({ "_tag": "UnknownError", "message": "reply failed" }));
            }
            let Some(index) = state.pending.iter().position(|item| item["id"] == id) else {
                return (404, json!({ "_tag": "NotFound", "message": format!("{id} is not pending") }));
            };
            state.pending.remove(index);
            drop(state);
            self.memory.emit(&json!({
                "id": format!("evt_{id}_replied"), "created": 1, "type": "permission.replied",
                "data": { "sessionID": session, "requestID": id, "reply": body["decision"] },
            }));
            (204, Value::Null)
        }
    }

    fn session(id: &str, title: &str, parent: Option<&str>) -> Value {
        support::merge(support::session(id, title), json!({ "parentID": parent }))
    }

    fn sessions() -> [Value; 3] {
        [session(A, "Alpha", None), session(B, "Beta", None), session(C, "Child", Some(A))]
    }

    fn routes() -> Vec<MemoryRoute> {
        let directory = support::DIRECTORY;
        let mut routes = vec![
            MemoryRoute::json("GET", "/api/location", 200, &support::location(directory)),
            MemoryRoute::json(
                "GET",
                "/api/agent",
                200,
                &support::list(directory, json!([support::agent("build", "primary", false)])),
            ),
            MemoryRoute::json("GET", "/api/model", 200, &support::list(directory, json!([]))),
            MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": sessions(), "cursor": {} })),
        ];
        routes.extend(sessions().iter().flat_map(support::session_routes));
        routes
    }

    #[derive(Clone, Debug)]
    struct Ask {
        id: String,
        session: &'static str,
        save: bool,
    }

    /// What the prompt shows, as TS derives it.
    #[derive(Clone, Debug, PartialEq)]
    enum Shown {
        Hidden,
        Asking { id: String, selected: usize, expanded: bool },
        Rejecting { id: String, text: String },
    }

    struct Model {
        pending: Vec<Ask>,
        viewed: &'static str,
        auto: bool,
        shown: Shown,
    }

    impl Model {
        /// The viewed session's requests in prompt order: a root's own, then its descendants'.
        fn queue(&self) -> Vec<&Ask> {
            let family: &[&str] = if self.viewed == A { &[A, C] } else { &[B] };
            family.iter().flat_map(|session| self.pending.iter().filter(move |ask| ask.session == *session)).collect()
        }

        /// Settles after a change. In `autoaccept` the prompt is empty and every request is answered once;
        /// otherwise the first request shows, from the start when it is a different one.
        fn settle(&mut self) -> Vec<Replied> {
            if self.auto {
                self.shown = Shown::Hidden;
                let sent: Vec<Replied> = self.queue().iter().map(|ask| reply(&ask.id, "once", None)).collect();
                self.pending.retain(|ask| !sent.iter().any(|sent| sent.id == ask.id));
                return sent;
            }
            let head = self.queue().first().map(|ask| ask.id.clone());
            let current = match &self.shown {
                Shown::Hidden => None,
                Shown::Asking { id, .. } | Shown::Rejecting { id, .. } => Some(id.clone()),
            };
            if head != current {
                self.shown = head.map_or(Shown::Hidden, |id| Shown::Asking { id, selected: 0, expanded: false });
            }
            Vec::new()
        }

        fn ask(&self, id: &str) -> &Ask {
            self.pending.iter().find(|ask| ask.id == id).unwrap()
        }

        /// The keys that mean something to the shown prompt.
        fn keys(&self) -> &'static [&'static str] {
            match self.shown {
                Shown::Hidden => &[],
                Shown::Asking { .. } => &["left", "right", "h", "l", "ctrl+f", "escape", "ctrl+c", "enter"],
                Shown::Rejecting { .. } => &["z", "h", "l", "ctrl+c", "escape", "enter"],
            }
        }

        fn press(&mut self, key: &str, fail: bool) -> Vec<Replied> {
            let mut sent = Vec::new();
            match self.shown.clone() {
                Shown::Hidden => unreachable!("no keys while hidden"),
                Shown::Asking { id, selected, expanded } => {
                    let count = if self.ask(&id).save { 3 } else { 2 };
                    let child = self.ask(&id).session == C;
                    let choice = |selected: usize| match (selected, count) {
                        (0, _) => "once",
                        (1, 3) => "always",
                        _ => "reject",
                    };
                    let select = match key {
                        "left" | "h" => {
                            self.shown =
                                Shown::Asking { id: id.clone(), selected: (selected + count - 1) % count, expanded };
                            None
                        }
                        "right" | "l" => {
                            self.shown = Shown::Asking { id: id.clone(), selected: (selected + 1) % count, expanded };
                            None
                        }
                        "ctrl+f" => {
                            self.shown = Shown::Asking { id: id.clone(), selected, expanded: !expanded };
                            None
                        }
                        "escape" | "ctrl+c" if expanded => {
                            self.shown = Shown::Asking { id: id.clone(), selected, expanded: false };
                            None
                        }
                        "escape" | "ctrl+c" => Some("reject"),
                        "enter" => Some(choice(selected)),
                        _ => unreachable!("{key}"),
                    };
                    match select {
                        Some("reject") if child => {
                            self.shown = Shown::Rejecting { id, text: String::new() };
                        }
                        Some(decision) => sent.push(self.reply(&id, decision, None, fail)),
                        None => {}
                    }
                }
                Shown::Rejecting { id, mut text } => match key {
                    "ctrl+c" if !text.is_empty() => self.shown = Shown::Rejecting { id, text: String::new() },
                    "ctrl+c" | "escape" => self.shown = Shown::Asking { id, selected: 0, expanded: false },
                    "enter" => {
                        let message = Some(text).filter(|text| !text.is_empty());
                        sent.push(self.reply(&id, "reject", message, fail));
                    }
                    letter => {
                        text.push_str(letter);
                        self.shown = Shown::Rejecting { id, text };
                    }
                },
            }
            sent.extend(self.settle());
            sent
        }

        fn reply(&mut self, id: &str, decision: &str, message: Option<String>, fail: bool) -> Replied {
            if !fail {
                self.pending.retain(|ask| ask.id != id);
            }
            reply(id, decision, message)
        }

        /// What the TUI must show for [`Self::shown`].
        fn observation(&self) -> Observation {
            match &self.shown {
                Shown::Hidden => Observation { focus: Focus::Prompt, ..Observation::default() },
                Shown::Asking { id, selected, expanded } => {
                    let always = self.ask(id).save && *selected == 1;
                    Observation {
                        question: true,
                        minimize: *expanded,
                        always,
                        request: (!always).then(|| id.clone()),
                        question_keys: 1,
                        ..Observation::default()
                    }
                }
                Shown::Rejecting { .. } => {
                    Observation { rejecting: true, reject_keys: 1, focus: Focus::Field, ..Observation::default() }
                }
            }
        }
    }

    fn reply(id: &str, decision: &str, message: Option<String>) -> Replied {
        Replied { id: id.to_owned(), decision: decision.to_owned(), message }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq)]
    enum Focus {
        #[default]
        Nothing,
        Prompt,
        Field,
    }

    #[derive(Debug, Default, PartialEq)]
    struct Observation {
        question: bool,
        rejecting: bool,
        /// The fullscreen hint says "minimize".
        minimize: bool,
        /// The body lists the patterns "Always allow" saves.
        always: bool,
        /// The request whose command the body shows.
        request: Option<String>,
        /// Registered question layers, counted by their fullscreen command.
        question_keys: usize,
        /// Registered reject layers, counted by their cancel command.
        reject_keys: usize,
        focus: Focus,
    }

    fn observe(app: &TestApp, tui: &Tui) -> Observation {
        let screen = app.text();
        let commands = tui.keymap.commands();
        let count = |found: &dyn Fn(&opencode_ui::keymap::CommandView) -> bool| {
            commands.iter().filter(|command| found(command)).count()
        };
        let prompt = tui.textarea.borrow().as_ref().map(Widget::id);
        let focus = match app.app().focused().map(|widget| widget.id()) {
            None => Focus::Nothing,
            Some(id) if Some(id) == prompt => Focus::Prompt,
            Some(_) => Focus::Field,
        };
        Observation {
            question: screen.contains("Permission required"),
            rejecting: screen.contains("Tell OpenCode what to do differently"),
            minimize: screen.contains("ctrl+f minimize"),
            always: screen.contains("This will always allow"),
            request: screen
                .split("- cmd")
                .nth(1)
                .and_then(|rest| rest.split_once('x'))
                .map(|(id, _)| format!("per_{id}")),
            question_keys: count(&|command| command.id == "permission.prompt.fullscreen"),
            reject_keys: count(&|command| command.title.as_deref() == Some("Cancel permission rejection")),
            focus,
        }
    }

    #[derive(Debug)]
    enum Step {
        Ask {
            session: &'static str,
            save: bool,
        },
        ElsewhereReply(String),
        Key {
            key: &'static str,
            fail: bool,
        },
        /// Two keys dispatched before the first one's deferred work runs, so the second can meet the keys of the
        /// prompt the first replaced.
        Keys(&'static str, &'static str),
        Autoaccept(bool),
        Switch(&'static str),
    }

    fn generate(rng: &mut Rng, model: &Model) -> Step {
        let shown = model.shown != Shown::Hidden;
        let roll = rng.below(100);
        if shown && roll < 55 {
            let key = rng.pick(model.keys());
            if roll < 15 {
                // The second key goes only after a first one that sends nothing; two replies in one tick race.
                let mut after = Model { pending: model.pending.clone(), shown: model.shown.clone(), ..*model };
                if after.press(key, false).is_empty() && after.shown != Shown::Hidden {
                    return Step::Keys(key, rng.pick(after.keys()));
                }
            }
            return Step::Key { key, fail: rng.chance(20) };
        }
        match rng.below(100) {
            0..45 => Step::Ask { session: rng.pick(&[A, A, C, C, B]), save: rng.chance(50) },
            45..65 if !model.pending.is_empty() => {
                Step::ElsewhereReply(model.pending[rng.below(model.pending.len())].id.clone())
            }
            65..77 => Step::Autoaccept(!model.auto),
            _ => Step::Switch(if model.viewed == A { B } else { A }),
        }
    }

    struct Run {
        app: TestApp,
        tui: std::rc::Rc<Tui>,
        server: Arc<Server>,
        asked: usize,
    }

    impl Run {
        fn apply(&mut self, model: &mut Model, step: &Step) -> Vec<Replied> {
            match step {
                Step::Ask { session, save } => {
                    self.asked += 1;
                    let id = format!("per_{}", self.asked);
                    let request = json!({
                        "id": id, "sessionID": session, "action": "shell",
                        "resources": [format!("cmd{}x", self.asked)], "save": if *save { vec!["cmd *"] } else { vec![] },
                    });
                    self.server.state.lock().unwrap().pending.push(request.clone());
                    self.server.memory.emit(&json!({ "id": format!("evt_{id}"), "created": 1, "type": "permission.asked", "data": request }));
                    model.pending.push(Ask { id, session, save: *save });
                    model.settle()
                }
                Step::ElsewhereReply(id) => {
                    self.server.answer(model.ask(id).session, id, &json!({ "decision": "once" }));
                    // The server's own log keeps only this client's replies.
                    self.server.state.lock().unwrap().replies.pop();
                    model.pending.retain(|ask| ask.id != *id);
                    model.settle()
                }
                Step::Key { key, fail } => {
                    self.server.state.lock().unwrap().fail = *fail;
                    self.app.press(key);
                    model.press(key, *fail)
                }
                Step::Keys(first, second) => {
                    for key in [first, second] {
                        self.app.app().dispatch(Event::Key(KeyEvent::from_shortcut(key).unwrap()));
                    }
                    self.app.advance(Duration::from_millis(1));
                    let mut sent = model.press(first, false);
                    sent.extend(model.press(second, false));
                    sent
                }
                Step::Autoaccept(on) => {
                    let value = if *on { "autoaccept" } else { "prompt" };
                    opencode_tui::dialogs::settings::update(&self.tui, move |draft| {
                        opencode_tui::dialogs::settings::set_path(draft, &["session", "permissions"], json!(value))
                    });
                    model.auto = *on;
                    model.settle()
                }
                Step::Switch(session) => {
                    self.tui.navigate(support::session_route(session));
                    model.viewed = session;
                    // TS mounts the other session's prompt from the start.
                    model.shown = Shown::Hidden;
                    model.settle()
                }
            }
        }

        /// Whether the client's store has every pending request of the server and no other.
        fn synced(&self) -> bool {
            let pending = |session: &str| -> Vec<String> {
                let state = self.server.state.lock().unwrap();
                let items = state.pending.iter().filter(|item| item["sessionID"] == session);
                items.map(|item| item["id"].as_str().unwrap().to_owned()).collect()
            };
            let held = |session: &str| -> Vec<String> {
                self.tui.data.read(|state| {
                    let requests = state.permissions(&SessionID(session.to_owned())).unwrap_or_default();
                    requests.iter().map(|request| request.id.0.clone()).collect()
                })
            };
            [A, B, C].iter().all(|session| {
                let (mut pending, mut held) = (pending(session), held(session));
                pending.sort();
                held.sort();
                pending == held
            })
        }
    }

    /// Runs `steps` random events from `seed` and checks the TUI after each one.
    fn run(seed: u64, steps: usize) {
        let server = Arc::new(Server { memory: Memory::new(routes()), state: Mutex::default() });
        let deps = Deps { route: support::session_route(A), events: true, ..support::deps(server.clone()) };
        let support::Harness { app, tui } = support::mount(100, 30, deps);
        support::wait_for(&app, "Alpha");
        let child: SessionInfo = serde_json::from_value(session(C, "Child", Some(A))).unwrap();
        tui.data.remember(child);
        let mut run = Run { app, tui, server, asked: 0 };
        let mut model = Model { pending: Vec::new(), viewed: A, auto: false, shown: Shown::Hidden };
        let mut rng = Rng::new(seed);
        let mut history = Vec::new();
        for step in 0..steps {
            let event = generate(&mut rng, &model);
            let mut want = run.apply(&mut model, &event);
            history.push(event);
            let observation = model.observation();
            // The store must hold what the server holds: a request asked or answered in a session the screen
            // does not show changes nothing visible, and the next step would act on the store before it. A reply
            // the step should not cause lands in this step's replies or the next one's, which the model never
            // wants.
            run.app.wait_until(WAIT, || {
                observe(&run.app, &run.tui) == observation
                    && run.server.state.lock().unwrap().replies.len() >= want.len()
                    && run.synced()
            });
            let mut got = std::mem::take(&mut run.server.state.lock().unwrap().replies);
            run.server.state.lock().unwrap().fail = false;
            got.sort();
            want.sort();
            let seen = observe(&run.app, &run.tui);
            assert!(
                seen == observation && got == want,
                "seed {seed}, step {step}: {history:#?}\nmodel {:?}\nwant {observation:#?} and {want:#?}\ngot {seen:#?} and {got:#?}\n{}",
                model.shown,
                run.app.text(),
            );
        }
        // No later step catches a reply the last one should not cause. Two requests on the client's runtime, each
        // after the one before came back, reach the server after a reply the client spawned before them; then the
        // store takes in what that reply changed.
        for _ in 0..2 {
            let done = Rc::new(Cell::new(false));
            let data = run.tui.data.clone();
            let input = PermissionListInput { session_id: SessionID(A.to_owned()) };
            let finish = done.clone();
            run.app.app().spawn(async move { data.client().permission_list(&input).await.is_ok() }, move |_, ok| {
                finish.set(ok);
            });
            assert!(run.app.wait_until(WAIT, || done.get()), "seed {seed}: the round trip did not come back");
        }
        run.app.wait_until(WAIT, || run.synced());
        let got = std::mem::take(&mut run.server.state.lock().unwrap().replies);
        assert!(got.is_empty(), "seed {seed}, after the last step: {history:#?}\nunwanted {got:#?}");
    }

    #[test]
    fn the_prompt_follows_its_model() {
        let var = |name: &str, default: u64| std::env::var(name).ok().map_or(default, |value| value.parse().unwrap());
        let steps = var("PERMISSION_STEPS", 60) as usize;
        match std::env::var("PERMISSION_SEED") {
            Ok(seed) => run(seed.parse().unwrap(), steps),
            Err(_) => (1..=var("PERMISSION_SEEDS", 8)).for_each(|seed| run(seed, steps)),
        }
    }
}
