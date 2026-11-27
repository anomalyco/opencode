//! Find-in-session integration tests: experiment gating, slash/keybind entry, bounded transcript
//! window reveal, plain fences, prompt draft preservation, case/whitespace stability, and restyling.

use crate::support::{self, DIRECTORY, Harness, Seen, WAIT};

use std::sync::Arc;

use opencode_api::generated::V2Event;
use opencode_local::cli_config::{Info, Tabs, TabsMode};
use opencode_tui::Deps;
use opentui::style::Color;
use serde_json::{Value, json};

const SESSION: &str = "ses_find_test";

fn mount_session(width: u16, height: u16, messages: Vec<Value>, enabled: bool) -> Harness {
    let experimental = if enabled { json!({ "session-find": true }) } else { json!({}) };
    let mut info: Info = opencode_local::cli_config::decode_text(
        &json!({ "animations": false, "experimental": experimental }).to_string(),
    )
    .unwrap();
    info.tabs = Some(Tabs { mode: Some(TabsMode::Off), ..Tabs::default() });
    let fake = support::Fake::new(move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_find_test") => (200, json!({ "data": support::session(SESSION, "Find") })),
        ("GET", "/api/session/ses_find_test/message") => {
            let mut rev = messages.clone();
            rev.reverse();
            (200, json!({ "data": rev, "cursor": {} }))
        }
        ("GET", "/api/session/ses_find_test/inbox") => (200, json!({ "data": [] })),
        _ => support::base(seen, DIRECTORY),
    });
    let deps =
        Deps { config: support::config(info), route: support::session_route(SESSION), ..support::deps(Arc::new(fake)) };
    support::mount(width, height, deps)
}

fn user_msg(id: &str, text: &str, created: u64) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

fn assistant_msg(id: &str, text: &str, created: u64) -> Value {
    json!({
        "id": id,
        "type": "assistant",
        "agent": "build",
        "model": { "providerID": "p", "id": "m" },
        "finish": "stop",
        "time": { "created": created, "completed": created + 1 },
        "content": [{ "type": "text", "text": text }],
    })
}

fn painted_runs(h: &Harness, bg: Color) -> Vec<String> {
    let capture = h.app.render();
    let mut runs = Vec::new();
    for y in 0..capture.height {
        let mut run = String::new();
        for x in 0..capture.width {
            let cell = capture.cell(x, y).unwrap();
            if cell.bg == bg {
                run.push_str(&cell.symbol);
            } else if !run.is_empty() {
                runs.push(std::mem::take(&mut run));
            }
        }
        if !run.is_empty() {
            runs.push(run);
        }
    }
    runs
}

#[test]
fn session_find_is_gated_by_experiment_and_opens_via_keybinds_and_slash() {
    let messages = vec![user_msg("m1", "alpha needle", 1)];
    // Off by default: <leader>f and super+f do nothing.
    let h = mount_session(100, 30, messages.clone(), false);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("alpha needle")));
    h.app.press("ctrl+x");
    h.app.press("f");
    h.app.render();
    assert!(!h.app.text().contains("Find in session..."));
    h.app.press("super+f");
    h.app.render();
    assert!(!h.app.text().contains("Find in session..."));

    // Enabled: super+f and /find both open Find.
    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("alpha needle")));
    h.app.press("super+f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));

    // /find slash command opens Find.
    h.app.type_text("/find");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session")));
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
}

#[test]
fn bounded_transcript_window_finds_and_reveals_unmounted_matches_and_plain_fences() {
    // 80 filler messages ensure the earliest messages are well outside TAIL_ROWS (40) on initial open.
    let mut messages = vec![
        user_msg("msg_000", "Earliest hidden needle", 1),
        assistant_msg(
            "msg_001",
            "Concealed **foo**bar and plain fence:\n\n```\nplain needle here\n```\n\n```typescript\nconst x = 1\n```",
            2,
        ),
    ];
    for index in 0..80 {
        messages.push(user_msg(&format!("msg_{:03}", index + 2), &format!("Filler turn {index}"), index as u64 + 10));
    }
    messages.push(user_msg("msg_999", "Tail needle at bottom", 200));

    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Tail needle at bottom")));
    assert!(!h.app.text().contains("Earliest hidden needle"));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));

    h.app.type_text("needle");
    // Match 1 is in unmounted msg_000, match 2 in plain fence of unmounted msg_001, match 3 at the tail.
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 1 of 3") && screen.contains("Earliest hidden needle")
    }));
    let theme = h.tui.page();
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);
    assert_eq!(painted_runs(&h, theme.find.background.r#match), vec!["needle"]);

    // Move to match 2 (inside plain code fence without an info string).
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 2 of 3") && screen.contains("plain needle here")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);

    // Move to match 3 (back down at the tail).
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 3 of 3") && screen.contains("Tail needle at bottom")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["needle"]);

    // Escape clears highlights even after moving back up to the plain fence.
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));
    assert!(painted_runs(&h, theme.find.background.current).is_empty());
    assert!(painted_runs(&h, theme.find.background.r#match).is_empty());

    // Concealed bold match in an unmounted row is still found and brought into view.
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    h.app.type_text("foobar");
    assert!(h.app.wait_until(WAIT, || {
        let screen = h.app.text();
        screen.contains("Find · 1 of 1") && screen.contains("Concealed foobar")
    }));
    assert_eq!(painted_runs(&h, theme.find.background.current), vec!["foobar"]);
}

#[test]
fn preserves_prompt_draft_keeps_match_on_case_or_whitespace_change_and_closes_on_permission() {
    let messages = vec![user_msg("m1", "First needle", 1), user_msg("m2", "Second NEEDLE", 2)];
    let h = mount_session(100, 30, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Second NEEDLE")));

    // Type a draft in the prompt before opening Find.
    h.app.type_text("keep this draft");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("keep this draft")));

    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    assert!(!h.app.text().contains("keep this draft"));

    h.app.type_text("needle");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 1 of 2")));
    h.app.press("enter");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find · 2 of 2")));
    // Adding trailing whitespace keeps match 2 selected instead of resetting to 1.
    h.app.type_text(" ");
    h.app.render();
    assert!(h.app.text().contains("Find · 2 of 2"));

    // Escape closes Find and brings the prompt back with its draft intact.
    h.app.press("escape");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("keep this draft")));

    // Reopen Find, then emit a permission request: Find closes automatically.
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    let event = json!({
        "id": "evt_perm",
        "created": 10,
        "type": "permission.asked",
        "data": {
            "id": "perm_1",
            "sessionID": SESSION,
            "action": "shell",
            "resources": ["ls"],
            "save": [],
        },
    });
    h.tui.data.apply(vec![serde_json::from_value::<V2Event>(event).unwrap()]);
    assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Find in session...")));
}

#[test]
fn narrow_terminal_hides_next_and_previous_hints_and_keeps_esc_close() {
    let messages = vec![user_msg("m1", "hello needle", 1)];
    let h = mount_session(46, 20, messages, true);
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("hello needle")));
    h.app.press("ctrl+x");
    h.app.press("f");
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("Find in session...")));
    let screen = h.app.text();
    assert!(screen.contains("esc close"), "{screen}");
    assert!(!screen.contains("shift+enter previous"), "{screen}");
    assert!(!screen.contains("enter next"), "{screen}");
}
