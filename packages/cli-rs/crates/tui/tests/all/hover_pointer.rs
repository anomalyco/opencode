//! The mouse pointer shape (OSC 22) over the TUI. TS never asks for one (Core 0.8.1's renderables set none and
//! `packages/tui/src` never calls `setMousePointer`). The Rust TUI shows the hand over every element that acts on
//! a click and the resize shape over the pane resize handle, a deliberate deviation
//! (`parity/deviations/W01-hand-pointer.md`). Text, the transcript, and the prompt keep the default pointer.

use crate::support::WAIT;

use std::sync::Arc;

use opencode_api::client::Client;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_local::cli_config::{self, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::{Deps, Route};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

const WIDTH: u16 = 100;
const HEIGHT: u16 = 30;

fn routes() -> Vec<MemoryRoute> {
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ];
    for (id, title) in [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")] {
        let session = json!({
            "id": id, "title": title, "projectID": "proj_test", "cost": 0,
            "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "time": { "created": 1, "updated": 1 },
            "location": { "directory": "/project" },
        });
        routes.push(MemoryRoute::json("GET", &format!("/api/session/{id}"), 200, &json!({ "data": session })));
        let messages = if id == "ses_b" { transcript() } else { Vec::new() };
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}/message"),
            200,
            &json!({ "data": messages, "cursor": {} }),
        ));
        for list in ["inbox", "permission", "form"] {
            routes.push(MemoryRoute::json("GET", &format!("/api/session/{id}/{list}"), 200, &json!({ "data": [] })));
        }
    }
    routes
}

/// Newest first: a user prompt, then an answer with plain text, a link, and a subagent call.
fn transcript() -> Vec<Value> {
    let task = json!({
        "status": "completed", "input": { "description": "Check the docs", "agent": "general" },
        "metadata": { "sessionID": "ses_child" }, "content": [{ "type": "text", "text": "done" }],
    });
    vec![
        json!({
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500, "completed": 1600 }, "finish": "stop",
            "content": [
                { "type": "text", "text": "Plain words, then [the docs site](https://opencode.ai/docs)." },
                { "type": "tool", "id": "call_1", "name": "task", "state": task, "time": { "created": 1500 } },
            ],
        }),
        json!({ "id": "msg_1", "type": "user", "text": "Run the tools", "time": { "created": 1000 } }),
    ]
}

/// Mounts the TUI on `ses_a` with `ses_b` open as a second tab, and runs `check` with the app.
fn with_tabs(width: u16, config: Value, check: impl FnOnce(&TestApp, &opencode_tui::Tui)) {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().to_owned();
    let paths = Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into_os_string())).unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    let client = Client::with_transport("http://opencode.local", Arc::new(Memory::new(routes()))).unwrap();
    let app = TestApp::new(width, HEIGHT);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(cli_config::decode_text(&config.to_string()).unwrap(), |_| None),
            roots: Some(Roots { paths, storage_channel: "test".into() }),
            route: Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) },
            continue_: false,
            events: true,
        },
    );
    tui.navigate(Route::Session { id: opencode_api::generated::SessionID("ses_b".into()) });
    wait_for(&app, &["Fix the parser", "Write the docs", "Check the docs"]);
    check(&app, &tui);
}

fn wait_for(app: &TestApp, texts: &[&str]) {
    let found = app.wait_until(WAIT, || texts.iter().all(|text| app.text().contains(text)));
    assert!(found, "{texts:?} never showed:\n{}", app.text());
}

/// The column and row where `text` starts.
fn find(app: &TestApp, text: &str) -> (u16, u16) {
    let screen = app.text();
    screen
        .lines()
        .enumerate()
        .find_map(|(row, line)| line.find(text).map(|byte| (line[..byte].chars().count() as u16, row as u16)))
        .unwrap_or_else(|| panic!("{text:?} is not on screen:\n{screen}"))
}

fn pointer_at(app: &TestApp, x: u16, y: u16) -> MousePointer {
    app.hover(x, y);
    app.mouse_pointer()
}

/// The pointer over the first cell of `text`.
fn pointer_over(app: &TestApp, text: &str) -> MousePointer {
    let (x, y) = find(app, text);
    pointer_at(app, x, y)
}

#[test]
fn clickable_elements_show_the_hand_and_everything_else_the_default() {
    with_tabs(WIDTH, json!({ "animations": false, "tabs": { "layout": "horizontal" } }), |app, tui| {
        let (plus, strip) = find(app, "+");
        let hands = [
            ("tab", pointer_over(app, "Fix the parser")),
            ("current tab", pointer_over(app, "Write the docs")),
            ("new tab", pointer_at(app, plus, strip)),
            ("user message", pointer_over(app, "Run the tools")),
            ("subagent row", pointer_over(app, "Check the docs")),
            ("link", pointer_over(app, "the docs site")),
            ("working directory", pointer_over(app, "/project")),
        ];
        let (prompt, _) = find(app, "╹");
        let defaults = [
            ("strip past the new tab", pointer_at(app, plus + 4, strip)),
            ("transcript text", pointer_over(app, "Plain words")),
            ("transcript gap", pointer_at(app, 50, 12)),
            ("prompt", pointer_at(app, prompt + 4, HEIGHT - 4)),
            ("prompt hint", pointer_over(app, "commands")),
        ];
        assert_shapes(app, &hands, MousePointer::POINTER);
        assert_shapes(app, &defaults, MousePointer::DEFAULT);

        tui.toasts.show(opencode_ui::toast::ToastOptions::new(opencode_ui::toast::Variant::Info, "Pointer toast"));
        wait_for(app, &["Pointer toast"]);
        assert_eq!(pointer_over(app, "Pointer toast"), MousePointer::POINTER, "toast:\n{}", app.text());
        tui.toasts.dismiss();

        // A select dialog: its rows and close button take the hand, its filter input keeps the default.
        tui.keymap.dispatch("command.palette.show", None);
        wait_for(app, &["Search commands"]);
        let hands = [("select row", pointer_over(app, "Switch session")), ("dialog close", pointer_over(app, "esc"))];
        assert_shapes(app, &hands, MousePointer::POINTER);
        assert_eq!(pointer_over(app, "Search commands"), MousePointer::DEFAULT, "filter:\n{}", app.text());
    });

    // Wide enough for the rail.
    with_tabs(140, json!({ "animations": false, "tabs": { "layout": "vertical" } }), |app, _| {
        let (rail, _) = find(app, "Fix the parser");
        let hands = [
            ("rail tab", pointer_over(app, "Fix the parser")),
            ("rail current tab", pointer_over(app, "Write the docs")),
            ("rail new tab", pointer_over(app, "New session")),
        ];
        assert_shapes(app, &hands, MousePointer::POINTER);
        assert_eq!(pointer_at(app, rail, HEIGHT - 2), MousePointer::DEFAULT, "rail below the tabs:\n{}", app.text());
        // The handle is two columns wide, on the rail's right edge.
        let resize: Vec<u16> =
            (0..140).filter(|&x| pointer_at(app, x, HEIGHT / 2) == MousePointer::EW_RESIZE).collect();
        let (prompt, _) = find(app, "╹");
        assert!(resize.len() == 2 && resize[1] == resize[0] + 1 && resize[1] < prompt, "{resize:?}\n{}", app.text());
    });
}

#[test]
fn the_sidebar_working_directory_shows_the_hand() {
    // Wide enough for the sidebar, whose footer repeats the prompt footer's directory on the right.
    with_tabs(180, json!({ "animations": false, "tabs": { "layout": "horizontal" } }), |app, _| {
        let screen = app.text();
        let (row, line) = screen.lines().enumerate().filter(|(_, line)| line.contains("/project")).last().unwrap();
        let x = line[..line.rfind("/project").unwrap()].chars().count() as u16;
        assert!(x > 120, "{screen}");
        assert_eq!(pointer_at(app, x, row as u16), MousePointer::POINTER, "{screen}");
        let (title, y) = screen
            .lines()
            .enumerate()
            .skip(1)
            .find_map(|(row, line)| line.rfind("Write the docs").map(|byte| (line[..byte].chars().count(), row)))
            .unwrap();
        assert_eq!(pointer_at(app, title as u16, y as u16), MousePointer::DEFAULT, "sidebar title:\n{screen}");
    });
}

fn assert_shapes(app: &TestApp, shapes: &[(&str, MousePointer)], want: MousePointer) {
    let wrong: Vec<_> = shapes.iter().filter(|(_, got)| *got != want).collect();
    assert!(wrong.is_empty(), "expected {want:?}: {wrong:?}\n{}", app.text());
}
