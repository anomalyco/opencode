//! A reconnect reads the location again, config included (review carbon-2 of MS6), also when the connection
//! status never showed the stream down: a `resync` or a fast reconnect leaves only the new `server.connected`.

use crate::support::{self, WAIT};

use std::sync::{Arc, Mutex};

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_tui::{Deps, Route};
use serde_json::json;

/// The memory server, with the configured model changeable while it runs.
struct Server {
    memory: Memory,
    model: Mutex<&'static str>,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.method != "GET" || request.url.path() != "/api/config" {
            return self.memory.send(request);
        }
        let body = json!([{ "type": "document", "info": { "model": *self.model.lock().unwrap() } }]);
        Box::pin(async move { Ok(support::respond(200, &body)) })
    }
}

#[test]
fn a_reconnect_the_status_did_not_show_reads_the_config_again() {
    let directory = support::DIRECTORY;
    let location =
        json!({ "directory": directory, "project": { "id": "proj", "directory": directory, "canonical": directory } });
    let list = |data| json!({ "location": location, "data": data });
    let models = json!([support::model("p", "m1", "Model One"), support::model("p", "m2", "Model Two")]);
    let server = Arc::new(Server {
        memory: Memory::new(vec![
            MemoryRoute::json("GET", "/api/location", 200, &location),
            MemoryRoute::json("GET", "/api/agent", 200, &list(json!([support::agent("build", "primary", false)]))),
            MemoryRoute::json("GET", "/api/model", 200, &list(models)),
            MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        ]),
        model: Mutex::new("p/m1"),
    });
    let h = support::mount(100, 30, Deps { route: Route::Home, events: true, ..support::deps(server.clone()) });
    h.wait_for("Model One");
    *server.model.lock().unwrap() = "p/m2";
    // A second `server.connected` on the same stream: the status stays connected throughout.
    server.memory.emit(&json!({ "id": "evt_again", "type": "server.connected", "data": {} }));
    let found = h.app.wait_until(WAIT, || h.app.text().contains("Model Two"));
    assert!(found, "the config was not read again:\n{}", h.app.text());
}

/// The memory server, with the transcript of `ses_a` changeable while it runs.
struct Transcript {
    memory: Memory,
    messages: Mutex<serde_json::Value>,
}

impl Transport for Transcript {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.method != "GET" || request.url.path() != "/api/session/ses_a/message" {
            return self.memory.send(request);
        }
        let body = json!({ "data": *self.messages.lock().unwrap(), "cursor": {} });
        Box::pin(async move { Ok(support::respond(200, &body)) })
    }
}

// R4-1: the events of a turn lost with the old stream (a stall after Ctrl+Z) reach the open session through its reads
// on the next `server.connected`, as TS reads the session and its rows again when the connection turns connected.
#[test]
fn a_reconnect_reads_the_open_transcript_again() {
    let user = |id: &str, text: &str, created: u64| json!({ "id": id, "type": "user", "text": text, "time": { "created": created } });
    let mut routes = support::session_routes(&support::test_session("ses_a", "Fix the parser"));
    routes.extend([
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/session/active", 200, &json!({ "data": {} })),
    ]);
    let server = Arc::new(Transcript {
        memory: Memory::new(routes),
        messages: Mutex::new(json!([user("msg_1", "BEFORE THE STOP", 1000)])),
    });
    let h = support::mount(100, 30, Deps { events: true, ..support::deps(server.clone()) });
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("BEFORE THE STOP");
    *server.messages.lock().unwrap() =
        json!([user("msg_2", "PARENT WHILE STOPPED", 2000), user("msg_1", "BEFORE THE STOP", 1000)]);
    server.memory.emit(&json!({ "id": "evt_again", "type": "server.connected", "data": {} }));
    let found = h.app.wait_until(WAIT, || h.app.text().contains("PARENT WHILE STOPPED"));
    assert!(found, "the transcript was not read again:\n{}", h.app.text());
}
