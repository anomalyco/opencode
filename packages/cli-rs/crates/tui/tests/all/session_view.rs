//! The session view's follow-ups to `rs-ms34-session`, over the in-memory transport with its request log
//! (P-REQ): `session.submit_scroll` after a send, and usage limits kept per location as TS keys them.

use crate::support::{self, WAIT};

use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use opencode_api::generated::V2Event;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_tui::{Deps, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};
use tokio::sync::Semaphore;

const DIRECTORY: &str = "/project";
const WORKTREE: &str = "/project/wt";
const LIMITS: &str = "/api/experimental/usage/limits";

fn location_at(directory: &str) -> Value {
    json!({ "directory": directory, "project": { "id": "proj", "directory": DIRECTORY } })
}

fn limits(spent: f64) -> Value {
    json!({
        "workspace": { "id": "wrk_1", "name": "Acme", "usageURL": "https://opencode.ai/console/wrk_1/usage" },
        "budgets": [{
            "id": "big", "limit": 10, "spent": 0, "scope": "each", "per": "model", "coverage": "models",
            "models": [{ "providerID": "opencode", "modelID": "big", "name": "Big Pickle", "spent": spent }],
            "vendors": [], "picked": false, "shared": false, "resetsAt": 1894708800000_i64,
        }],
    })
}

/// The routes of one location, matched by its `location[directory]` query unless it is the default.
fn location_routes(directory: &str, query: Option<&str>, spent: f64) -> Vec<MemoryRoute> {
    let list = |data: Value| json!({ "location": location_at(directory), "data": data });
    let model = json!({
        "id": "big", "modelID": "big", "providerID": "opencode", "name": "Big Pickle", "status": "active",
        "enabled": true, "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "cost": [{ "input": 10.0, "output": 30.0, "cache": { "read": 0, "write": 0 } }],
        "limit": { "context": 200000, "output": 32000 }, "time": { "released": 0 }, "variants": [],
    });
    let provider = json!({
        "id": "opencode", "name": "OpenCode", "integrationID": "opencode", "activation": "auto",
        "package": "@ai-sdk/test",
    });
    let agent = json!({
        "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
        "model": { "providerID": "opencode", "id": "big" },
        "request": { "settings": {}, "headers": {}, "body": {} },
    });
    let routes = [
        MemoryRoute::json("GET", "/api/location", 200, &location_at(directory)),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([agent]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([model]))),
        MemoryRoute::json("GET", "/api/provider", 200, &list(json!([provider]))),
        MemoryRoute::json("GET", "/api/integration", 200, &list(json!([]))),
        MemoryRoute::json("GET", LIMITS, 200, &list(limits(spent))),
    ];
    let Some(query) = query else {
        return routes.into();
    };
    routes
        .into_iter()
        .map(|route| route.with_query([("location[directory]".to_owned(), vec![query.to_owned()])].into()))
        .collect()
}

fn session(id: &str, directory: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title, "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": directory },
    })
}

/// `count` turns of a question and a three-paragraph answer, newest first as the server pages them.
fn turns(count: u64) -> Vec<Value> {
    let mut messages: Vec<Value> = (1..=count)
        .flat_map(|turn| {
            let created = turn * 10_000;
            [
                json!({ "id": format!("msg_{turn:03}a"), "type": "user", "text": format!("Question {turn}"),
                        "time": { "created": created } }),
                json!({
                    "id": format!("msg_{turn:03}b"), "type": "assistant", "agent": "build",
                    "model": { "providerID": "opencode", "id": "big" },
                    "time": { "created": created + 1000, "completed": created + 2000 }, "finish": "stop",
                    "content": [{ "type": "text", "text": format!("Answer {turn} one.\n\nAnswer {turn} two.\n\nAnswer {turn} three.") }],
                }),
            ]
        })
        .collect();
    messages.reverse();
    messages
}

fn routes() -> Vec<MemoryRoute> {
    let mut routes = location_routes(WORKTREE, Some(WORKTREE), 6.0);
    routes.extend(location_routes(DIRECTORY, None, 5.0));
    routes.extend([
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/ses_a/message", 200, &json!({ "data": turns(30), "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/:id/message", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json(
            "POST",
            "/api/session/ses_a/prompt",
            200,
            &json!({ "data": {
                "id": "inb_1", "sessionID": "ses_a", "time": { "created": 1 }, "type": "user",
                "payload": { "text": "Next" }, "delivery": "steer",
            } }),
        ),
    ]);
    for (id, directory, title) in [("ses_a", DIRECTORY, "Long talk"), ("ses_wt", WORKTREE, "Worktree work")] {
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}"),
            200,
            &json!({ "data": session(id, directory, title) }),
        ));
    }
    for path in ["agent", "model"] {
        routes.push(MemoryRoute::body("POST", &format!("/api/session/:id/{path}"), 204, None, ""));
    }
    for list in ["inbox", "permission", "form"] {
        routes.push(MemoryRoute::json("GET", &format!("/api/session/:id/{list}"), 200, &json!({ "data": [] })));
    }
    routes
}

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    memory: Memory,
}

fn mount(id: &str, config: Value) -> Harness {
    mount_at(100, id, config)
}

fn mount_at(width: u16, id: &str, config: Value) -> Harness {
    let memory = Memory::new(routes());
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route: support::session_route(id),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let support::Harness { app, tui } = support::mount(width, 30, deps);
    let h = Harness { app, tui, memory };
    let local = h.tui.local.clone();
    h.wait("the catalog", || local.catalog_ready() && !local.agents().is_empty());
    h
}

impl Harness {
    fn wait(&self, what: &str, check: impl Fn() -> bool) {
        let found = self.app.wait_until(WAIT, || {
            self.app.render();
            check()
        });
        assert!(found, "{what} never happened:\n{}", self.app.text());
    }

    fn wait_for(&self, text: &str) {
        self.wait(text, || self.app.text().contains(text));
    }

    fn apply(&self, kind: &str, seq: u64, data: Value) {
        let session = data["sessionID"].clone();
        let event: V2Event = serde_json::from_value(json!({
            "id": format!("evt_{seq}"), "created": 10_000_000 + seq, "type": kind,
            "durable": { "aggregateID": session, "seq": seq, "version": 1 },
            "data": data,
        }))
        .unwrap();
        self.tui.data.apply(&[event]);
    }

    /// The number the next widget gets, which counts the widgets created so far.
    fn next_widget(&self) -> u32 {
        View::new(&self.app).id()
    }

    fn settle(&self) -> String {
        self.app.wait_until(Duration::from_millis(150), || false);
        self.app.render();
        self.app.text()
    }

    /// The usage limits requests, by the directory they asked for.
    fn limits(&self) -> Vec<Option<String>> {
        self.memory
            .requests()
            .iter()
            .filter(|logged| logged.method == "GET" && logged.path == LIMITS)
            .map(|logged| logged.query.get("location[directory]").and_then(|values| values.first().cloned()))
            .collect()
    }

    /// Pages up until the reader is away from the bottom, then sends a prompt.
    fn send_while_away(&self) {
        self.wait_for("Answer 30 three.");
        for _ in 0..3 {
            self.app.press("pageup");
            self.settle();
        }
        self.wait_for("Jump to latest");
        assert!(!self.app.text().contains("Answer 30 three."), "{}", self.app.text());
        self.app.type_text("Next");
        self.app.press("enter");
        self.wait("the prompt", || {
            self.memory.requests().iter().any(|logged| logged.method == "POST" && logged.path.ends_with("/prompt"))
        });
    }
}

#[test]
fn a_send_returns_to_the_newest_rows_unless_submit_scroll_is_keep() {
    // `onSubmit` calls `toBottom` unless `session.submit_scroll` is `keep` (`index.tsx:1650-1652`).
    let h = mount("ses_a", json!({ "animations": false }));
    h.send_while_away();
    h.wait("the newest rows", || {
        let screen = h.app.text();
        screen.contains("Answer 30 three.") && !screen.contains("Jump to latest")
    });

    let h = mount("ses_a", json!({ "animations": false, "session": { "submit_scroll": "keep" } }));
    h.send_while_away();
    let screen = h.settle();
    assert!(screen.contains("Jump to latest"), "{screen}");
    assert!(!screen.contains("Answer 30 three."), "{screen}");
}

#[test]
fn the_sidebar_and_footer_skip_other_sessions_and_follow_their_own() {
    let h = mount_at(170, "ses_a", json!({ "animations": false }));
    h.wait_for("Long talk");
    h.wait_for("Answer 30 three.");
    let run = |seq: u64| {
        let kind = if seq % 2 == 1 { "session.execution.started" } else { "session.execution.succeeded" };
        h.apply(kind, seq, json!({ "sessionID": format!("ses_other{}", seq % 3) }));
        h.settle();
    };
    // The limit section reads the usage limits outside the store on any change.
    run(1);

    // Runs of sessions outside the family rebuild no section and no footer.
    let before = h.next_widget();
    (2..=20).for_each(run);
    assert_eq!(h.next_widget(), before + 1, "{}", h.app.text());

    // The session's own step ends show, from an earlier reply until the last one has tokens.
    let ended = |seq: u64, message: &str, input: u64| {
        let tokens = json!({ "input": input, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
        h.apply(
            "session.step.ended",
            seq,
            json!({ "sessionID": "ses_a", "assistantMessageID": message, "finish": "stop", "cost": 0, "tokens": tokens }),
        );
    };
    // The usage limits toast covers the section's first lines; its share and the prompt footer show.
    ended(21, "msg_029b", 2_000);
    h.wait_for("1% used");
    h.wait_for("2.0K (1%)");
    ended(22, "msg_030b", 12_000);
    h.wait_for("6% used");
    h.wait_for("12.0K (6%)");
    ended(23, "msg_029b", 30_000);
    let screen = h.settle();
    assert!(screen.contains("6% used") && screen.contains("12.0K (6%)"), "{screen}");
}

/// Holds the usage limits answer until the test releases it.
struct Gated {
    memory: Memory,
    asked: AtomicBool,
    release: Semaphore,
}

impl Transport for Gated {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        Box::pin(async move {
            if request.url.path() == LIMITS {
                self.asked.store(true, Ordering::SeqCst);
                self.release.acquire().await.unwrap().forget();
            }
            self.memory.send(request).await
        })
    }
}

#[test]
fn the_sidebar_limit_shows_once_the_limits_load() {
    // TS reads the limits reactively. Here the store is idle when they load.
    let gated =
        Arc::new(Gated { memory: Memory::new(routes()), asked: AtomicBool::new(false), release: Semaphore::new(0) });
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        route: support::session_route("ses_a"),
        events: true,
        ..support::deps(gated.clone())
    };
    let support::Harness { app, tui } = support::mount(170, 30, deps);
    let h = Harness { app, tui, memory: gated.memory.clone() };
    h.wait_for("Answer 30 three.");
    h.wait("the limits request", || gated.asked.load(Ordering::SeqCst));
    h.settle();
    gated.release.add_permits(1);
    h.wait_for("Running low on Big Pickle");
    // The usage limits toast covers the section.
    h.tui.toasts.dismiss();
    h.wait_for("$5 remaining");
}

#[test]
fn usage_limits_are_kept_per_location() {
    let h = mount("ses_a", json!({ "animations": false }));
    h.wait_for("$5 left");
    assert_eq!(h.limits(), [Some(DIRECTORY.to_owned())]);

    // The worktree's session reads its own location's limits, not the project's.
    h.tui.navigate(support::session_route("ses_wt"));
    h.wait_for("Worktree work");
    h.wait_for("$4 left");
    assert_eq!(h.limits(), [Some(DIRECTORY.to_owned()), Some(WORKTREE.to_owned())]);

    // Back in the project, its limits show again without another request.
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("$5 left");
    h.settle();
    assert_eq!(h.limits().len(), 2);
}
