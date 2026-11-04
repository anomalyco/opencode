//! The TUI shell (T.1) over a fixture server: the home lists sessions, Enter opens one, and its
//! transcript shows and streams.

use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::V2Event;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// Serves the fixture routes; anything else is a 404.
struct Fixture;

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let (status, body) = match (request.method, request.url.path()) {
            ("GET", "/api/session") => (
                200,
                json!({ "data": [session("ses_b", "Fix the parser", 2), session("ses_a", "Write docs", 1)], "cursor": {} }),
            ),
            ("GET", "/api/session/ses_b") => (
                200,
                json!({ "data": session("ses_b", "Fix the parser", 2) }),
            ),
            ("GET", "/api/session/ses_b/message") => (
                200,
                json!({
                    "data": [
                        {
                            "id": "msg_2", "type": "assistant", "agent": "build",
                            "model": { "providerID": "provider", "id": "model" }, "time": { "created": 2 },
                            "content": [{ "type": "text", "text": "The parser drops the last token." }],
                        },
                        { "id": "msg_1", "type": "user", "text": "Why does the parser fail?", "time": { "created": 1 } },
                    ],
                    "cursor": {},
                }),
            ),
            _ => (404, json!({})),
        };
        let body = serde_json::to_vec(&body).unwrap();
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn session(id: &str, title: &str, updated: u64) -> Value {
    json!({
        "id": id, "title": title, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": updated, "updated": updated },
        "location": { "directory": "/project" },
    })
}

fn mount(app: &TestApp, route: Route) -> std::rc::Rc<Tui> {
    let client = Client::with_transport("http://opencode.local", Arc::new(Fixture)).unwrap();
    opencode_tui::mount(
        app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: None,
            route,
            continue_: false,
            events: false,
        },
    )
}

fn wait_for(app: &TestApp, text: &str) -> String {
    let found = app.wait_until(Duration::from_secs(5), || app.text().contains(text));
    let screen = app.text();
    assert!(found, "{text:?} never showed:\n{screen}");
    assert!(!screen.contains("Malformed"), "a read failed:\n{screen}");
    screen
}

#[test]
fn home_lists_sessions_and_enter_opens_the_transcript() {
    let app = TestApp::new(80, 20);
    let tui = mount(&app, Route::Home);

    let home = wait_for(&app, "Fix the parser");
    assert!(home.contains("Write docs"), "{home}");
    // Most recently updated first.
    assert!(
        home.find("Fix the parser") < home.find("Write docs"),
        "{home}"
    );

    app.press("enter");
    let session = wait_for(&app, "The parser drops the last token.");
    assert!(session.contains("Why does the parser fail?"), "{session}");
    assert!(
        session.find("Why does the parser fail?") < session.find("The parser drops"),
        "{session}"
    );
    assert!(
        matches!(tui.route(), Route::Session { id } if id.0 == "ses_b"),
        "{:?}",
        tui.route()
    );

    // A streamed delta updates the open row in place.
    let delta: V2Event = serde_json::from_value(json!({
        "id": "evt_1", "created": 3, "type": "session.text.delta",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_b", "assistantMessageID": "msg_2", "ordinal": 0, "delta": " Fixed." },
    }))
    .unwrap();
    tui.data.apply(&[delta]);
    wait_for(&app, "The parser drops the last token. Fixed.");

    // `session.new` (<leader>n) goes home.
    app.press("ctrl+x");
    app.press("n");
    wait_for(&app, "Write docs");
    assert_eq!(tui.route(), Route::Home);

    // Ctrl+P opens the palette with the shell's commands; Escape closes it. With sessions loaded,
    // `session.list` is suggested first.
    app.press("ctrl+p");
    let palette = wait_for(&app, "Switch session");
    assert!(palette.contains("Commands"), "{palette}");
    // The prompt's commands push the shell's below the fold; search for them.
    app.type_text("exit");
    wait_for(&app, "Exit the app");
    app.press("escape");
    assert!(!tui.dialogs.is_open());
}

#[test]
fn session_flag_opens_the_session_directly() {
    let app = TestApp::new(80, 20);
    let _tui = mount(
        &app,
        Route::Session {
            id: opencode_api::generated::SessionID("ses_b".into()),
        },
    );
    let screen = wait_for(&app, "Why does the parser fail?");
    assert!(
        screen.contains("Fix the parser"),
        "the header shows the title:\n{screen}"
    );
}
