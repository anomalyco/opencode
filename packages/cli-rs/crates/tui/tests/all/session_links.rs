//! Session IDs as links (#63224, #63247; `packages/tui/test/ui/session-link.test.tsx`): titles of loaded sessions,
//! plain IDs for the current, archived and missing ones, one lookup per ID, code spans, renames, and clicks that open
//! the session from the transcript and from the `/btw` answer.

use crate::support::{self, DIRECTORY, Harness, Seen};

use std::sync::Arc;

use opencode_api::generated::V2Event;
use opencode_local::cli_config::{Info, Markdown, Session};
use opencode_tui::Deps;
use opentui::prelude::Attributes;
use serde_json::json;

fn id(name: &str) -> String {
    format!("ses_{name:0<26}")
}

/// Serves the current session with one reply of `text`, the `known` and `archived` sessions, and a 404 for any other
/// session.
fn open(width: u16, height: u16, text: &str, info: Info) -> (Harness, support::Log) {
    let (current, known, archived) = (id("current"), id("known"), id("archived"));
    let reply = json!({
        "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
        "content": [{ "type": "text", "text": text }], "finish": "stop", "time": { "created": 2, "completed": 3 },
    });
    let fake = support::Fake::new(move |seen: &Seen| {
        let path = seen.path.trim_start_matches("/api/session/");
        let session = |title: &str| (200, json!({ "data": support::session(path, title) }));
        match (seen.method.as_str(), path) {
            ("GET", path) if path == current => session("Fix the parser"),
            ("GET", path) if path == known => session("Fix the flaky reconnect test on Windows"),
            ("GET", path) if path == archived => (
                200,
                json!({ "data": support::merge(
                    support::session(path, "Old work"),
                    json!({ "time": { "created": 1, "updated": 1, "archived": 1 } }),
                ) }),
            ),
            ("GET", path) if path == format!("{current}/message") => {
                (200, json!({ "data": [reply.clone()], "cursor": {} }))
            }
            ("GET", path) if path.ends_with("/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", path) if path.ends_with("/inbox") => (200, json!({ "data": [] })),
            ("GET", path) if path.starts_with("ses_") && !path.contains('/') => (
                404,
                json!({ "_tag": "SessionNotFoundError", "sessionID": path, "message": format!("Session not found: {path}") }),
            ),
            _ => support::base(seen, DIRECTORY),
        }
    });
    let log = fake.log();
    let deps = Deps {
        config: support::config(Info { animations: Some(false), ..info }),
        route: support::session_route(&id("current")),
        ..support::deps(Arc::new(fake))
    };
    (support::mount(width, height, deps), log)
}

/// The underlined runs on screen, the links.
fn linked(h: &Harness) -> Vec<String> {
    let capture = h.app.render();
    let mut runs = Vec::new();
    for y in 0..capture.height {
        let mut run = String::new();
        for x in 0..capture.width {
            let cell = capture.cell(x, y).unwrap();
            if cell.attributes.contains(Attributes::UNDERLINE) {
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

fn lookups(log: &support::Log, session: &str) -> usize {
    support::lines(log).iter().filter(|line| **line == format!("GET /api/session/{session}")).count()
}

fn rename(h: &Harness, session: &str, title: &str) {
    let event = json!({
        "id": "evt_1", "created": 3, "type": "session.renamed",
        "durable": { "aggregateID": session, "seq": 1, "version": 1 },
        "data": { "sessionID": session, "title": title },
    });
    h.tui.data.apply(&[serde_json::from_value::<V2Event>(event).unwrap()]);
}

fn opened(h: &Harness, session: &str) -> bool {
    h.tui.route() == support::session_route(session)
}

// Expected: the loaded session shows as its title, underlined; the current, archived and missing sessions and the
// fenced code stay IDs. Each ID is looked up once, misses included, across a rename that draws the new title.
#[test]
fn loaded_sessions_show_their_titles_and_the_rest_stay_ids() {
    let (known, archived, missing, current) = (id("known"), id("archived"), id("missing"), id("current"));
    let text = format!(
        "See {known} now\n\n- current {current}\n- archived {archived}\n- missing @session:{missing}\n\n```\n{known}\n```"
    );
    let (h, log) = open(100, 30, &text, Info::default());
    h.wait_for("@Fix the flaky reconnect test on Windows");
    h.wait("the missing session to be read", || lookups(&log, &missing) == 1);
    assert_eq!(linked(&h), ["@Fix the flaky reconnect test on Windows"]);
    let screen = h.app.text();
    for plain in [&current, &archived, &format!("@session:{missing}"), &known] {
        assert!(screen.contains(plain.as_str()), "{plain} is not shown:\n{screen}");
    }

    rename(&h, &known, "Renamed");
    h.wait_for("@Renamed");
    assert_eq!(linked(&h), ["@Renamed"]);
    for session in [&known, &archived, &missing] {
        assert_eq!(lookups(&log, session), 1, "{session}: {:?}", support::lines(&log));
    }
    assert_eq!(lookups(&log, &current), 1);
}

// Expected: a code span links only when it is exactly an ID, so a command stays copyable; markers shown, the link
// keeps the source text.
#[test]
fn code_spans_link_only_when_they_are_exactly_an_id() {
    let known = id("known");
    let text = format!("Run `opencode --session {known}` or open `{known}`.");
    let (h, _) = open(120, 20, &text, Info::default());
    h.wait_for("@Fix the flaky");
    assert_eq!(linked(&h), ["@Fix the flaky reconnect test on Windows"]);
    assert!(h.app.text().contains(&format!("opencode --session {known}")));

    let source =
        Info { session: Some(Session { markdown: Some(Markdown::Source), ..Session::default() }), ..Info::default() };
    let (h, _) = open(120, 20, &text, source);
    h.wait("the link", || !linked(&h).is_empty());
    assert_eq!(linked(&h), [known.as_str()]);
    assert!(h.app.text().contains(&format!("`opencode --session {known}`")));
}

// Expected: a wrapped title opens its session from either row; text around it and a drag over it do not.
#[test]
fn a_wrapped_title_opens_its_session_from_either_row() {
    let known = id("known");
    let (h, _) = open(40, 24, &format!("Please see {known} now"), Info::default());
    let screen = h.wait_for("Windows");
    let (head_x, head) = support::at(&screen, "@Fix").unwrap();
    let (tail_x, tail) = support::at(&screen, "Windows").unwrap();
    assert!(tail > head, "{screen}");

    h.app.click(support::at(&screen, "see").unwrap().0, head);
    h.app.click(support::at(&screen, "now").unwrap().0, tail);
    h.app.drag((head_x, head), (head_x + 3, head));
    h.app.advance(std::time::Duration::from_millis(1));
    assert!(opened(&h, &id("current")), "{:?}", h.tui.route());

    h.app.click(tail_x + 2, tail);
    h.wait("the click to open the session", || opened(&h, &known));
}

// Expected: a click on a link in the `/btw` answer closes the dialog and opens the session.
#[test]
fn a_link_in_the_btw_answer_closes_it_and_opens_the_session() {
    let known = id("known");
    let answer = format!("See {known}");
    let (current, title) = (id("current"), "Fix the parser");
    let fake = support::Fake::new(move |seen: &Seen| {
        let path = seen.path.trim_start_matches("/api/session/");
        match (seen.method.as_str(), path) {
            ("GET", path) if path == current => (200, json!({ "data": support::session(path, title) })),
            ("GET", path) if path == known => (200, json!({ "data": support::session(path, "Reconnect") })),
            ("GET", path) if path.ends_with("/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", path) if path.ends_with("/inbox") => (200, json!({ "data": [] })),
            ("POST", path) if path.ends_with("/generate") => {
                let tokens = json!({ "input": 1, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
                (200, json!({ "data": { "text": answer, "tokens": tokens, "cost": 0 } }))
            }
            _ => support::base(seen, DIRECTORY),
        }
    });
    let deps = Deps {
        config: support::config(support::still()),
        route: support::session_route(&id("current")),
        ..support::deps(Arc::new(fake))
    };
    let h = support::mount(100, 30, deps);
    h.wait_for("Fix the parser");
    h.tui.keymap.dispatch("session.aside", Some("which session?"));
    h.wait_for("@Reconnect");
    let (x, y) = h.find("@Reconnect");
    h.app.click(x + 2, y);
    h.wait("the click to open the session", || opened(&h, &id("known")));
    assert!(!h.tui.dialogs.is_open());
}
