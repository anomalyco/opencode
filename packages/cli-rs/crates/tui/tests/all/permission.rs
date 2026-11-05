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
