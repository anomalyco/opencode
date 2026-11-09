//! A cold Location (AGENTS.md "Plugin Loading"): the server answers catalog reads before its plugins load, so the
//! first lists are empty. The TUI fills them in from the `*.updated` events, without a restart.

use crate::support::{self, DIRECTORY};

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// The catalogs a cold Location answers with an empty list.
const CATALOGS: [&str; 4] = ["/api/agent", "/api/model", "/api/provider", "/api/command"];

/// The in-memory server, whose catalogs stay empty until [`Cold::warm`].
#[derive(Clone)]
struct Cold {
    memory: Memory,
    warm: Arc<AtomicBool>,
}

impl Cold {
    fn new() -> Self {
        Self { memory: Memory::new(routes()), warm: Arc::default() }
    }

    /// The plugins have loaded: the catalogs are full, and each sends its `*.updated` event.
    fn warm(&self) {
        self.warm.store(true, Ordering::SeqCst);
        for kind in ["provider", "model", "agent", "command"] {
            self.memory.emit(&json!({
                "id": format!("evt_{kind}"), "created": 2, "type": format!("{kind}.updated"),
                "location": { "directory": DIRECTORY }, "data": {},
            }));
        }
    }
}

impl Transport for Cold {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let cold =
            request.method == "GET" && !self.warm.load(Ordering::SeqCst) && CATALOGS.contains(&request.url.path());
        Box::pin(async move {
            if cold {
                return Ok(support::respond(200, &support::list(DIRECTORY, json!([]))));
            }
            self.memory.send(request).await
        })
    }
}

fn routes() -> Vec<MemoryRoute> {
    let list = |data: Value| support::list(DIRECTORY, data);
    let agents = json!([support::agent("build", "primary", false), support::agent("plan", "primary", false)]);
    let cost = json!([{ "input": 0, "output": 0, "cache": { "read": 0, "write": 0 } }]);
    let free = support::merge(support::model("p", "m", "Model M"), json!({ "cost": cost }));
    let commands = json!([{ "name": "triage", "description": "Triage the issues" }]);
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &support::location(DIRECTORY)),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/agent", 200, &list(agents)),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([free]))),
        MemoryRoute::json("GET", "/api/provider", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/command", 200, &list(commands)),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ]
}

fn mount(server: &Cold) -> support::Harness {
    let deps = Deps {
        route: Route::Home,
        events: true,
        config: support::config(support::still()),
        ..support::deps(Arc::new(server.clone()))
    };
    let h = support::mount(100, 30, deps);
    h.wait("the cold catalogs to load", || {
        h.tui.data.read(|state| {
            state.location(None).is_some_and(|data| {
                data.model.as_ref().is_some_and(Vec::is_empty)
                    && data.agent.as_ref().is_some_and(Vec::is_empty)
                    && data.command.is_some()
            })
        })
    });
    h
}

// Expected: the prompt's agent and model line fills in once the catalogs arrive, and agent cycling then moves on.
#[test]
fn the_prompt_line_and_agents_fill_in_from_updated_events() {
    let server = Cold::new();
    let h = mount(&server);
    h.app.render();
    assert!(!h.app.text().contains("Model M"), "{}", h.app.text());
    server.warm();
    let screen = h.wait_for("Model M");
    assert!(screen.contains("Build"), "{screen}");
    h.dispatch("agent.cycle");
    h.wait_for("Plan");
}

// Expected: a model picker opened on a cold Location lists the model once it arrives, without reopening. Nothing is
// connected, so it is the free models list, as in TS.
#[test]
fn an_open_model_picker_fills_in() {
    let server = Cold::new();
    let h = mount(&server);
    h.dispatch("model.list");
    h.wait_for("Free models");
    server.warm();
    h.wait_for("Model M");
}

// Expected: `/` lists a server command that arrives while the list is open.
#[test]
fn slash_commands_fill_in() {
    let server = Cold::new();
    let h = mount(&server);
    h.app.type_text("/tri");
    h.app.render();
    assert!(!h.app.text().contains("/triage"), "{}", h.app.text());
    server.warm();
    h.wait_for("/triage");
}
