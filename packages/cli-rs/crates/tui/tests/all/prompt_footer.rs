//! Goal footer updates across pending reads and mount changes.

use crate::support::{self, DIRECTORY, Harness};

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_tui::Deps;
use serde_json::{Value, json};

const GET: &str = "/api/rpc/opencode.goal/get";

/// The in-memory server, which holds each goal read until [`Gated::release`], and counts the reads asked for.
#[derive(Clone)]
struct Gated {
    memory: Memory,
    gate: Arc<tokio::sync::Semaphore>,
    reads: Arc<AtomicUsize>,
}

impl Gated {
    fn new(open: bool) -> Self {
        let gate = Arc::new(tokio::sync::Semaphore::new(if open { 1000 } else { 0 }));
        Self { memory: Memory::new(routes()), gate, reads: Arc::default() }
    }

    fn release(&self) {
        self.gate.add_permits(1);
    }

    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }

    fn sent(&self, path: &str) -> Vec<opencode_api::memory::Logged> {
        self.memory.requests().into_iter().filter(|logged| logged.path == path).collect()
    }

    fn paused(&self) {
        self.memory.emit(&json!({
            "id": "evt_goal", "created": 3, "type": "rpc.opencode.goal.changed",
            "location": { "directory": DIRECTORY },
            "data": { "sessionID": "ses_a", "goal": goal("paused", Some("Paused by the user")) },
        }));
    }
}

impl Transport for Gated {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let held = request.url.path() == GET;
        Box::pin(async move {
            if held {
                self.reads.fetch_add(1, Ordering::SeqCst);
                self.gate.acquire().await.map_err(|error| error.to_string())?.forget();
            }
            self.memory.send(request).await
        })
    }
}

fn goal(status: &str, reason: Option<&str>) -> Value {
    json!({ "objective": "Ship the sidebar", "status": status, "reason": reason })
}

fn routes() -> Vec<MemoryRoute> {
    let list = |data: Value| support::list(DIRECTORY, data);
    let session = support::catalog_session();
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/location", 200, &support::location(DIRECTORY)),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([support::agent("build", "primary", false)]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([support::model("p", "m", "Model M")]))),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [session], "cursor": {} })),
        MemoryRoute::json("POST", GET, 200, &json!({ "output": goal("active", None) })),
        MemoryRoute::body("POST", "/api/session/ses_a/command", 204, None, Vec::new()),
    ];
    routes.extend(support::session_routes(&session));
    routes
}

/// Session `ses_a`, `width` columns wide, over `server`. With `events`, the event stream's `server.connected` reads
/// the goal again, at a time the test does not control.
fn mount(server: &Gated, width: u16, events: bool) -> Harness {
    let config = json!({ "animations": false, "plugins": [] });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        events,
        ..support::deps(Arc::new(server.clone()))
    };
    let h = support::mount(width, 30, deps);
    h.wait_for("Fix the parser");
    h
}

#[test]
fn a_change_event_before_the_first_read_returns_wins() {
    let server = Gated::new(false);
    let h = mount(&server, 100, true);
    // The event stream's `server.connected` may read it again. It comes on the stream before the change, so that
    // read is older too.
    h.wait("the goal read to go out", || server.reads() >= 1);
    server.paused();
    h.wait_for("◎ goal paused");
    (0..2).for_each(|_| server.release());
    h.wait("the reads to be answered", || server.memory.in_flight() == 0 && server.sent(GET).len() == server.reads());
    h.app.wait_until(std::time::Duration::from_millis(100), || false);
    h.app.render();
    assert!(h.app.text().contains("◎ goal paused"), "the stale reply showed the active goal:\n{}", h.app.text());
}

#[test]
fn a_remount_while_the_read_is_pending_keeps_the_read() {
    let server = Gated::new(false);
    let h = mount(&server, 100, false);
    // Without the event stream, the mount's read is the only one.
    h.wait("the goal read to go out", || server.reads() == 1);
    let reads = server.reads();
    h.app.type_text("!");
    h.wait_for("esc exit shell mode");
    h.app.press("escape");
    h.wait_gone("exit shell mode");
    server.gate.add_permits(reads);
    h.wait_for("◎ goal");
    assert_eq!(server.reads(), reads);
}

#[test]
fn the_busy_footer_shrinks_on_a_narrow_terminal() {
    let server = Gated::new(true);
    let h = mount(&server, 40, true);
    let screen = h.wait_for("◎ goal");
    let row = screen.lines().find(|line| line.contains("◎ goal")).unwrap();
    assert!(row.contains("/project") && row.trim_end().chars().count() <= 40, "{screen}");
}
