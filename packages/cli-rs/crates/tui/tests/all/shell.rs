//! The TUI shell (T.1) over a fixture server: the session list opens a session from home, and its
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
            // The session list dialog's scope reads.
            ("GET", "/api/location") => (
                200,
                json!({ "directory": "/project", "project": { "id": "project", "directory": "/project", "canonical": "/project" } }),
            ),
            ("GET", "/api/project") => (200, json!([])),
            ("GET", "/api/session/ses_b") => (200, json!({ "data": session("ses_b", "Fix the parser", 2) })),
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
fn the_session_list_opens_a_session_and_its_transcript_streams() {
    // Tall enough for the palette's System group, which E.18a's commands joined.
    let app = TestApp::new(80, 30);
    let tui = mount(&app, Route::Home);

    // The home shows the logo (E.1); the session list is a dialog (E.11a).
    let home = wait_for(&app, "█▀▀█");
    assert!(!home.contains("Fix the parser"), "{home}");
    app.press("ctrl+x");
    app.press("l");
    let home = wait_for(&app, "Fix the parser");
    assert!(home.contains("Write docs"), "{home}");
    // Most recently updated first.
    assert!(home.find("Fix the parser") < home.find("Write docs"), "{home}");

    app.press("enter");
    let session = wait_for(&app, "The parser drops the last token.");
    assert!(session.contains("Why does the parser fail?"), "{session}");
    assert!(session.find("Why does the parser fail?") < session.find("The parser drops"), "{session}");
    assert!(matches!(tui.route(), Route::Session { id } if id.0 == "ses_b"), "{:?}", tui.route());

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
    assert!(app.wait_until(Duration::from_secs(5), || tui.route() == Route::Home));

    // Ctrl+P opens the palette with the shell's commands; Escape closes it. With sessions loaded,
    // `session.list` is suggested first.
    app.press("ctrl+p");
    let palette = wait_for(&app, "Switch session");
    assert!(palette.contains("Search commands"), "{palette}");
    // The prompt's commands push the shell's below the fold; search for them.
    app.type_text("exit");
    wait_for(&app, "Exit the app");
    app.press("escape");
    assert!(!tui.dialogs.is_open());
}

#[test]
fn a_theme_change_keeps_a_pending_leader_and_the_focus() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, Route::Home);
    // The home's logo (E.1).
    wait_for(&app, "█▀▀█");

    // The terminal reports a light background between the leader and its second key.
    app.press("ctrl+x");
    app.event(Event::ThemeMode(opentui::theme::ThemeMode::Light));
    app.press("l");
    assert!(tui.dialogs.is_open(), "the session list did not open:\n{}", app.text());
    wait_for(&app, "Search sessions");
    app.press("escape");
    assert!(!tui.dialogs.is_open());

    // A focused prompt stays focused across a theme change.
    let prompt = tui.textarea.borrow().clone().unwrap();
    app.app().focus(&prompt);
    app.type_text("draft");
    wait_for(&app, "draft");
    app.event(Event::ThemeMode(opentui::theme::ThemeMode::Dark));
    app.type_text(" kept");
    wait_for(&app, "draft kept");
}

// Expected: in the `system` theme, the terminal's color scheme notice (`?997`) reads the palette again and the theme
// follows it, as TS `theme.tsx` does. Actual: the palette was read once at startup and `system` stayed stale.
#[test]
fn the_system_theme_follows_the_terminal_palette_after_a_color_scheme_change() {
    use opentui::input::OscColor;
    let app = TestApp::with_options(80, 30, AppOptions { palette_size: 16, ..AppOptions::default() });
    let client = Client::with_transport("http://opencode.local", Arc::new(Fixture)).unwrap();
    let theme = opencode_local::cli_config::Theme { name: Some("system".into()), mode: None };
    let info = Info { theme: Some(theme), ..Info::default() };
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots: None,
            route: Route::Home,
            continue_: false,
            events: false,
        },
    );
    wait_for(&app, "█▀▀█");
    let foreground = Color::rgb(0xe0, 0xd0, 0xc0);
    assert_ne!(tui.page().text.base, foreground);

    app.event(Event::ColorScheme);
    let colors = (0..16).map(|index| OscColor::Palette(index, Color::rgb(index * 16, 0x40, 0x80)));
    let rest = [
        OscColor::Foreground(foreground),
        OscColor::Background(Color::rgb(0x10, 0x10, 0x18)),
        OscColor::Cursor(Color::rgb(0xff, 0xff, 0xff)),
    ];
    for color in colors.chain(rest) {
        app.event(Event::Color(color));
    }
    assert_eq!(tui.page().text.base, foreground, "the system theme takes the new foreground");
    wait_for(&app, "█▀▀█");
}

#[test]
fn session_flag_opens_the_session_directly() {
    let app = TestApp::new(80, 20);
    let _tui = mount(&app, Route::Session { id: opencode_api::generated::SessionID("ses_b".into()) });
    let screen = wait_for(&app, "Why does the parser fail?");
    assert!(screen.contains("Fix the parser"), "the header shows the title:\n{screen}");
}
