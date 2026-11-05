//! The mouse pointer shape (OSC 22) over the whole TUI. The TS TUI never asks for one: Core 0.8.1's renderables
//! set none, `packages/tui/src` never calls `setMousePointer`, and a PTY capture of a tab hover shows only the
//! `default` shape the renderer writes at startup. So every cell, over the tab strip, the rail, the prompt, a
//! select dialog with its filter input, and a panel's resize handle, keeps the default pointer.

use crate::support::wait::WAIT;

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
        MemoryRoute::json(
            "GET",
            "/api/session",
            200,
            &json!({ "data": [], "cursor": {} }),
        ),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ];
    for (id, title) in [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")] {
        let session = json!({
            "id": id, "title": title, "projectID": "proj_test", "cost": 0,
            "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "time": { "created": 1, "updated": 1 },
            "location": { "directory": "/project" },
        });
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}"),
            200,
            &json!({ "data": session }),
        ));
        routes.push(MemoryRoute::json(
            "GET",
            &format!("/api/session/{id}/message"),
            200,
            &json!({ "data": [], "cursor": {} }),
        ));
        for list in ["inbox", "permission", "form"] {
            routes.push(MemoryRoute::json(
                "GET",
                &format!("/api/session/{id}/{list}"),
                200,
                &json!({ "data": [] }),
            ));
        }
    }
    routes
}

/// Mounts the TUI on `ses_a` with `ses_b` open as a second tab, and runs `check` with the app.
fn with_tabs(config: Value, check: impl FnOnce(&TestApp, &opencode_tui::Tui)) {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().to_owned();
    let paths =
        Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into_os_string())).unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    let client =
        Client::with_transport("http://opencode.local", Arc::new(Memory::new(routes()))).unwrap();
    let app = TestApp::new(WIDTH, HEIGHT);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(
                cli_config::decode_text(&config.to_string()).unwrap(),
                |_| None,
            ),
            roots: Some(Roots {
                paths,
                storage_channel: "test".into(),
            }),
            route: Route::Session {
                id: opencode_api::generated::SessionID("ses_a".into()),
            },
            continue_: false,
            events: true,
        },
    );
    tui.navigate(Route::Session {
        id: opencode_api::generated::SessionID("ses_b".into()),
    });
    wait_for(&app, &["Fix the parser", "Write the docs"]);
    check(&app, &tui);
}

fn wait_for(app: &TestApp, texts: &[&str]) {
    let found = app.wait_until(WAIT, || texts.iter().all(|text| app.text().contains(text)));
    assert!(found, "{texts:?} never showed:\n{}", app.text());
}

/// Hovers every cell and returns the cells whose pointer is not the default, with the shape.
fn shaped_cells(app: &TestApp) -> Vec<(u16, u16, MousePointer)> {
    let mut shaped = Vec::new();
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            app.hover(x, y);
            let pointer = app.mouse_pointer();
            if pointer != MousePointer::DEFAULT {
                shaped.push((x, y, pointer));
            }
        }
    }
    shaped
}

#[test]
fn every_cell_keeps_the_default_pointer_as_in_typescript() {
    for layout in ["horizontal", "vertical"] {
        with_tabs(
            json!({ "animations": false, "tabs": { "layout": layout } }),
            |app, tui| {
                assert_eq!(shaped_cells(app), [], "{layout}, session:\n{}", app.text());

                // A select dialog: its filter input and its rows.
                tui.keymap.dispatch("command.palette.show", None);
                wait_for(app, &["Search commands"]);
                assert_eq!(shaped_cells(app), [], "{layout}, palette:\n{}", app.text());
            },
        );
    }
}
