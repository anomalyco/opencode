//! The `animations` switch (`rs-animations-off`): with it off a running session draws the TS still glyphs and asks
//! for no frames; turning it on or off at run time takes effect at once.

use crate::support;

use std::sync::Arc;
use std::time::Duration;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::Deps;
use opencode_tui::dialogs::settings;
use opencode_ui::motion::{SPINNER_FRAMES, SPINNER_INTERVAL};
use opentui::prelude::Color;
use serde_json::{Value, json};

fn session(id: &str, parent: Option<&str>, title: &str) -> Value {
    support::merge(support::test_session(id, title), json!({ "parentID": parent, "agent": "build" }))
}

fn tool(id: &str, name: &str, input: Value, metadata: Value) -> Value {
    json!({
        "type": "tool", "id": id, "name": name, "time": { "created": 1500, "ran": 1500 },
        "state": { "status": "running", "input": input, "metadata": metadata },
    })
}

fn routes() -> Vec<MemoryRoute> {
    // Newest first, as the server pages them.
    let messages = json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" }, "time": { "created": 1500 },
            "content": [
                tool("c1", "read", json!({ "path": "/project/src/a.rs" }), json!({})),
                tool("c2", "task", json!({ "description": "Survey the views", "subagent_type": "explore" }),
                    json!({ "sessionID": "ses_child" })),
                tool("c3", "shell", json!({ "command": "npm test" }), json!({})),
            ],
        },
        { "id": "msg_1", "type": "user", "text": "Run the tools", "time": { "created": 1000 } },
    ]);
    let mut routes: Vec<MemoryRoute> = [session("ses_a", None, "Fix the parser"), session("ses_b", None, "Write docs")]
        .iter()
        .flat_map(support::session_routes)
        .filter(|route| route.path != "/api/session/ses_a/message")
        .collect();
    routes.extend([
        MemoryRoute::json("GET", "/api/session/ses_a/message", 200, &json!({ "data": messages, "cursor": {} })),
        MemoryRoute::json(
            "GET",
            "/api/session/ses_child",
            200,
            &json!({ "data": session("ses_child", Some("ses_a"), "Child") }),
        ),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/experimental/migration/v1", 200, &json!({ "status": "completed" })),
        MemoryRoute::json(
            "GET",
            "/api/session/active",
            200,
            &json!({ "data": { "ses_a": { "type": "running" }, "ses_b": { "type": "running" } } }),
        ),
    ]);
    routes
}

fn mount(layout: &str, animations: bool) -> support::Harness {
    let config = json!({ "animations": animations, "tabs": { "layout": layout }, "session": { "sidebar": "hide" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes())))
    };
    let h = support::mount(120, 30, deps);
    h.tui.navigate(support::session_route("ses_b"));
    h.wait_for("Write docs");
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("Survey the views");
    h.wait_for("npm test");
    h
}

/// Whether a spinner frame past the first shows. A running tab's still indicator is the first frame, `⠋`, as in
/// TS (`TabIndicator`).
fn moving(screen: &str) -> bool {
    screen.chars().any(|c| ('⠀'..='⣿').contains(&c) && c != '⠋')
}

/// Renders, then lets `span` pass in steps, counting the steps after which the app wanted another frame.
fn frames(h: &support::Harness, span: Duration) -> usize {
    h.app.render();
    let step = Duration::from_millis(40);
    (0..span.as_millis() / step.as_millis())
        .filter(|_| {
            h.app.advance(step);
            let wants = h.app.needs_frame();
            h.app.render();
            wants
        })
        .count()
}

/// The glyph before the running shell's command.
fn shell_glyph(h: &support::Harness) -> char {
    let screen = h.app.text();
    let line = screen.lines().find(|line| line.contains(" npm test")).unwrap_or_else(|| panic!("{screen}"));
    line.trim_start_matches([' ', '┃']).chars().next().unwrap()
}

/// Every cell's background, which only the tab pulse moves here.
fn backgrounds(h: &support::Harness) -> Vec<Color> {
    let capture = h.app.render();
    (0..30).flat_map(|y| (0..120).map(move |x| (x, y))).map(|(x, y)| capture.cell(x, y).unwrap().bg).collect()
}

#[test]
fn off_draws_still_glyphs_and_asks_for_no_frames() {
    for layout in ["horizontal", "vertical"] {
        let h = mount(layout, false);
        let screen = h.app.text();
        assert!(screen.contains("⋯ npm test"), "{layout}:\n{screen}");
        assert!(screen.contains("⋯ Explore Subagent — Survey the views"), "{layout}:\n{screen}");
        assert!(screen.contains("⠋ Fix the parser") && screen.contains("⠋ Write docs"), "{layout}:\n{screen}");
        assert!(screen.contains("[⋯] esc interrupt"), "{layout}:\n{screen}");
        assert!(!moving(&screen), "{layout}: a spinner frame shows:\n{screen}");
        // The startup polls (the data migration's status) settle first.
        frames(&h, Duration::from_secs(2));
        let still = backgrounds(&h);
        assert_eq!(frames(&h, Duration::from_secs(3)), 0, "{layout}: frames with animations off");
        assert_eq!(h.app.text(), screen);
        assert!(backgrounds(&h) == still, "{layout}: the tab pulse moved");
    }
}

#[test]
fn turning_animations_off_and_on_takes_effect_at_once() {
    for layout in ["horizontal", "vertical"] {
        let h = mount(layout, true);
        let before = backgrounds(&h);
        assert!(frames(&h, Duration::from_secs(1)) > 0, "{layout}: no frames with animations on");
        assert!(backgrounds(&h) != before, "{layout}: the tab pulse did not move");

        h.dispatch("app.toggle.animations");
        assert_eq!(h.tui.settings.info().animations, Some(false));
        h.app.render();
        let screen = h.app.text();
        assert!(screen.contains("⋯ npm test"), "{layout}:\n{screen}");
        assert!(screen.contains("⋯ Explore Subagent — Survey the views"), "{layout}:\n{screen}");
        assert!(!moving(&screen), "{layout}: a spinner frame shows:\n{screen}");
        frames(&h, Duration::from_secs(2));
        assert_eq!(frames(&h, Duration::from_secs(3)), 0, "{layout}: frames after turning animations off");

        settings::update(&h.tui, |draft| settings::set_path(draft, &["animations"], json!(true)));
        assert!(frames(&h, Duration::from_millis(200)) > 0, "{layout}: no frames after turning animations on");
        // The braille dots again, one step every 80 ms (`spinner.tsx`).
        let first = SPINNER_FRAMES.iter().position(|frame| frame.starts_with(shell_glyph(&h))).unwrap();
        for step in 1..=10 {
            h.app.advance(SPINNER_INTERVAL);
            let expected = SPINNER_FRAMES[(first + step) % SPINNER_FRAMES.len()];
            assert_eq!(shell_glyph(&h).to_string(), expected, "{layout}: step {step}");
        }
        let before = backgrounds(&h);
        frames(&h, Duration::from_millis(400));
        assert!(backgrounds(&h) != before, "{layout}: the tab pulse did not resume");
    }
}
