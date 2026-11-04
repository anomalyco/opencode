//! The root command's TUI arguments (C.13) that P-APP cannot record, because the TS app fixture passes no
//! `environment`: the terminal's variables go to the session on a local server, and to nobody otherwise.

use std::sync::Arc;
use std::time::Duration;

use indexmap::IndexMap;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Logged, Memory, Route as MemoryRoute};
use opencode_local::cli_config::{Info, Resolved};
use opencode_tui::{Args, Deps, Route};
use opentui::testing::TestApp;
use serde_json::{Value, json};

const DIRECTORY: &str = "/project";

fn routes() -> Vec<MemoryRoute> {
    let location = json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let agent = json!({
        "id": "build", "name": "build", "mode": "primary", "hidden": false, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    });
    let model = json!({
        "id": "model", "modelID": "model", "providerID": "demo", "name": "Demo Model",
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    });
    let inbox = |id: &str| {
        json!({ "data": {
            "id": "msg_p", "sessionID": id, "time": { "created": 3 }, "type": "user",
            "payload": { "text": "hello" }, "delivery": "steer",
        } })
    };
    vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([agent]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([model]))),
        MemoryRoute::json(
            "POST",
            "/api/session",
            200,
            &json!({ "data": session("ses_new") }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_new",
            200,
            &json!({ "data": session("ses_new") }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_b",
            200,
            &json!({ "data": session("ses_b") }),
        ),
        MemoryRoute::json(
            "GET",
            "/api/session/:id/message",
            200,
            &json!({ "data": [], "cursor": {} }),
        ),
        MemoryRoute::json("GET", "/api/session/:id/inbox", 200, &json!({ "data": [] })),
        MemoryRoute::body("PUT", "/api/session/:id/environment", 204, None, ""),
        MemoryRoute::body("POST", "/api/session/:id/agent", 204, None, ""),
        MemoryRoute::body("POST", "/api/session/:id/model", 204, None, ""),
        MemoryRoute::json(
            "POST",
            "/api/session/ses_new/prompt",
            200,
            &inbox("ses_new"),
        ),
    ]
}

fn session(id: &str) -> Value {
    json!({
        "id": id, "title": "", "projectID": "proj", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    })
}

fn environment() -> IndexMap<String, String> {
    IndexMap::from([("TERM_PROGRAM".to_owned(), "parity".to_owned())])
}

fn mount(
    app: &TestApp,
    memory: &Memory,
    route: Route,
    args: Args,
) -> std::rc::Rc<opencode_tui::Tui> {
    let client = Client::with_transport("http://opencode.local", Arc::new(memory.clone())).unwrap();
    opencode_tui::mount_with(
        app,
        Deps {
            client,
            directory: DIRECTORY.into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: None,
            route,
            continue_: false,
            events: true,
        },
        args,
    )
}

/// The writes so far, as `METHOD path`.
fn writes(memory: &Memory) -> Vec<String> {
    memory
        .requests()
        .iter()
        .filter(|logged| logged.method != "GET")
        .map(|logged| format!("{} {}", logged.method, logged.path))
        .collect()
}

fn find<'a>(log: &'a [Logged], method: &str, path: &str) -> Option<&'a Logged> {
    log.iter()
        .find(|logged| logged.method == method && logged.path == path)
}

#[test]
fn a_new_session_gets_the_environment_before_its_first_prompt() {
    let app = TestApp::new(100, 30);
    let memory = Memory::new(routes());
    let tui = mount(
        &app,
        &memory,
        Route::Home,
        Args {
            prompt: Some("hello".into()),
            new_session_id: Some(SessionID("ses_new".into())),
            local: true,
            environment: Some(environment()),
            ..Args::default()
        },
    );
    let sent = app.wait_until(Duration::from_secs(5), || {
        writes(&memory).contains(&"POST /api/session/ses_new/prompt".to_owned())
    });
    assert!(sent, "no prompt: {:?}", writes(&memory));
    let writes = writes(&memory);
    let position = |write: &str| writes.iter().position(|sent| sent == write);
    let (create, upload, prompt) = (
        position("POST /api/session"),
        position("PUT /api/session/ses_new/environment"),
        position("POST /api/session/ses_new/prompt"),
    );
    assert!(create < upload && upload < prompt, "{writes:?}");
    let log = memory.requests();
    let body = find(&log, "PUT", "/api/session/ses_new/environment")
        .and_then(|logged| logged.body.clone());
    assert_eq!(
        body,
        Some(json!({ "variables": { "TERM_PROGRAM": "parity" } }))
    );
    drop(tui);
}

#[test]
fn an_opened_session_gets_the_environment_only_on_a_local_server() {
    for (environment, uploads) in [(Some(environment()), true), (None, false)] {
        let app = TestApp::new(100, 30);
        let memory = Memory::new(routes());
        let tui = mount(
            &app,
            &memory,
            Route::Session {
                id: SessionID("ses_b".into()),
            },
            Args {
                local: environment.is_some(),
                environment,
                ..Args::default()
            },
        );
        let uploaded = app.wait_until(Duration::from_secs(if uploads { 5 } else { 1 }), || {
            find(&memory.requests(), "PUT", "/api/session/ses_b/environment").is_some()
        });
        assert_eq!(uploaded, uploads, "{:?}", writes(&memory));
        drop(tui);
    }
}
