//! The ports trio (`steps/ports-trio.md`): community TS TUI plugins, each kept as the published package and ported to
//! a native Rust plugin (`crates/plugin/examples/<name>`) and to Luau (`crates/plugin/examples/luau/<name>`). Each row
//! drives one plugin through the same inputs on three columns, in the real TUI over a fake server:
//!
//! - TS: the published tarball, unmodified, on the JS host (skipped without Bun);
//! - Rust: the port's library, loaded over the C ABI;
//! - Luau: the Luau port (with `--features luau`).
//!
//! Every column must draw the same cells (text, colors, attributes) of the region the plugin draws in, at each step,
//! and send the same requests.

use crate::ports::{Carrier, Port, open_with, session};
use crate::support::{DIRECTORY, Reply, Seen};

use serde_json::{Value, json};

/// The columns of a row: the published package `npm`, and the ports named `port`.
fn columns<'a>(npm: &'a str, port: &'a str) -> Vec<Carrier<'a>> {
    #[cfg_attr(not(feature = "luau"), allow(unused_mut))]
    let mut columns = vec![Carrier::Npm(npm), Carrier::Port(port)];
    #[cfg(feature = "luau")]
    columns.push(Carrier::Luau(port));
    columns
}

/// What a column showed and sent: a capture per step, then the requests.
#[derive(Debug, PartialEq)]
struct Observed {
    steps: Vec<(String, Vec<String>)>,
    requests: Vec<String>,
}

/// One row: drives each column of `npm` and `port` with `drive`, which returns what it observed (`None` for a package
/// without Bun), and holds every column to the first one's.
fn trio(npm: &str, port: &str, drive: impl Fn(Carrier<'_>) -> Option<Observed>) {
    let observed: Vec<(Carrier<'_>, Observed)> =
        columns(npm, port).into_iter().filter_map(|carrier| Some((carrier, drive(carrier)?))).collect();
    // `PORTS_TRIO_DUMP=1` prints what each column showed and sent.
    if std::env::var_os("PORTS_TRIO_DUMP").is_some() {
        observed.iter().for_each(|(carrier, seen)| eprintln!("{carrier:?}: {seen:#?}"));
    }
    // Each step against the first column that has it: a column leaves out a step only for a gap of its carrier that
    // its row names.
    for (index, (carrier, seen)) in observed.iter().enumerate().skip(1) {
        for (step, cells) in &seen.steps {
            let earlier = observed[..index].iter().find_map(|(at, other)| {
                other.steps.iter().find(|(name, _)| name == step).map(|(_, wanted)| (at, wanted))
            });
            if let Some((first, wanted)) = earlier {
                assert_eq!(cells, wanted, "{carrier:?} draws step `{step}` unlike {first:?}");
            }
        }
        let (first, expected) = &observed[0];
        assert_eq!(seen.requests, expected.requests, "{carrier:?} sends unlike {first:?}");
    }
}

/// The cells of rows `rows` from column `from` to the right edge: each row's text, then each run of cells with one
/// foreground, background and attributes, as `count×style`.
fn cells(h: &Port, from: u16, rows: std::ops::Range<u16>) -> Vec<String> {
    let capture = h.app.render();
    let text: Vec<String> = h.app.text().lines().map(str::to_owned).collect();
    rows.map(|y| {
        let line: String =
            text.get(usize::from(y)).map(|line| line.chars().skip(usize::from(from)).collect()).unwrap_or_default();
        let mut runs: Vec<(usize, String)> = Vec::new();
        let mut x = u32::from(from);
        while let Some(cell) = capture.cell(x, u32::from(y)) {
            let style = format!("{:?}/{:?}/{:?}", cell.fg, cell.bg, cell.attributes);
            match runs.last_mut() {
                Some((count, last)) if *last == style => *count += 1,
                _ => runs.push((1, style)),
            }
            x += 1;
        }
        let runs: Vec<String> = runs.into_iter().map(|(count, style)| format!("{count}×{style}")).collect();
        format!("{}  {}", line.trim_end(), runs.join(" "))
    })
    .collect()
}

/// The requests the server saw to paths starting with one of `paths`, as `METHOD path?query`: the writes in the order
/// they came, with their bodies, then each read once, sorted. How often the host reads a session again is its timing,
/// not the plugin's: a package's `data.session.sync` reads the route's session once more.
fn requests(h: &Port, paths: &[&str]) -> Vec<String> {
    let log = h.log.lock().unwrap();
    let seen = log.iter().filter(|seen| paths.iter().any(|path| seen.path.starts_with(path)));
    let (reads, mut writes): (Vec<_>, Vec<_>) = seen
        .map(|seen| match seen.method.as_str() {
            "GET" => (true, format!("GET {}", seen.url())),
            method => (false, format!("{method} {} {}", seen.url(), masked(&seen.body))),
        })
        .partition(|(read, _)| *read);
    let mut reads: Vec<(bool, String)> = reads;
    reads.sort();
    reads.dedup();
    writes.extend(reads);
    writes.into_iter().map(|(_, request)| request).collect()
}

/// `body` with each ID the client generates (`msg_…` and the like, after a prefix of three letters) as `<id>`: a prompt
/// names its new message.
fn masked(body: &Value) -> Value {
    match body {
        Value::String(text)
            if text.len() > 12
                && text.as_bytes().get(3) == Some(&b'_')
                && text[..3].bytes().all(|b| b.is_ascii_lowercase()) =>
        {
            Value::String("<id>".to_owned())
        }
        Value::Array(items) => Value::Array(items.iter().map(masked).collect()),
        Value::Object(fields) => {
            Value::Object(fields.iter().map(|(key, value)| (key.clone(), masked(value))).collect())
        }
        other => other.clone(),
    }
}

/// The sidebar's columns at width 170.
const SIDEBAR: u16 = 120;

/// The rows a sidebar block from `title` down takes: to the first blank row after it, at most `most`.
fn block(h: &Port, title: &str, most: u16) -> std::ops::Range<u16> {
    let (_, y) = h.find(title);
    y..(y + most).min(40)
}

// --- opencode-sidebar-tokens: a slot, and a data read that follows an event

fn tokens_server(seen: &Seen) -> Option<Reply> {
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Count", None, 1) }))),
        _ => None,
    }
}

// Expected: on each column, the block draws "Session tokens" and four rows of label and value at the ends of the
// sidebar, `0` before any usage and the session's totals once a `session.usage.updated` brings them, with a reasoning
// row for reasoning tokens; `showReasoning: false` leaves that row out.
#[test]
fn sidebar_tokens_draws_alike_in_ts_rust_and_luau() {
    for options in [None, Some(json!({ "showReasoning": false }))] {
        trio("opencode-sidebar-tokens", "sidebar-tokens", |carrier| {
            let h = open_with(&[carrier], 170, tokens_server, false, None, options.as_ref())?;
            h.wait_for("Cache write");
            let mut steps = vec![("empty".to_owned(), cells(&h, SIDEBAR, block(&h, "Session tokens", 6)))];
            h.events.emit(&json!({
                "id": "evt_usage", "created": 2, "type": "session.usage.updated",
                "location": { "directory": DIRECTORY },
                "data": { "sessionID": "ses_p", "cost": 0.08, "tokens": { "input": 22_870, "output": 100, "reasoning": 1_234, "cache": { "read": 3_000_000, "write": 7 } } },
            }));
            h.wait_for("22,870");
            h.settle();
            steps.push(("totals".to_owned(), cells(&h, SIDEBAR, block(&h, "Session tokens", 6))));
            let shown = h.sidebar(usize::from(SIDEBAR)).iter().any(|row| row.starts_with("Reasoning"));
            assert_eq!(shown, options.is_none(), "{carrier:?}: the reasoning row");
            Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p"]) })
        });
    }
}

// --- opencode-sidebar-prompt: a slot, a slash command, a dialog of the plugin's own, a toast, and the inbox

/// P.8's prompt: longer than a sidebar row, shorter than the preview's limit.
const PROMPT: &str = "Write the release notes for 2.3: the new sidebar, the plugin host, and the fixes to the theme \
                      picker. Keep each line short, link every pull request, and leave the upgrade steps for last.";

/// `ses_p` with `PROMPT` delivered and, with `queued`, a newer prompt still in its inbox; `ses_q` with no prompt.
fn prompt_server(queued: bool) -> impl Fn(&Seen) -> Option<Reply> + Send + Sync {
    move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Release notes", None, 3) }))),
        ("GET", "/api/session/ses_q") => Some((200, json!({ "data": session("ses_q", "Quiet", None, 2) }))),
        ("GET", "/api/session") => Some((
            200,
            json!({ "data": [session("ses_p", "Release notes", None, 3), session("ses_q", "Quiet", None, 2)], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p/message") => Some((
            200,
            json!({ "data": [
                { "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" }, "time": { "created": 2000, "completed": 2500 }, "content": [{ "type": "text", "text": "Drafted." }], "cost": 0 },
                { "id": "msg_1", "type": "user", "text": PROMPT, "time": { "created": 1000 } },
            ], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p/inbox") => Some((
            200,
            json!({ "data": if queued { vec![json!({
            "id": "msg_3", "sessionID": "ses_p", "type": "user", "time": { "created": 3000 }, "delivery": "queue",
            "payload": { "text": "Then tag the release\x1b[1m and announce it in the changelog channel." },
        })] } else { Vec::new() } }),
        )),
        ("GET", path) if path.ends_with("/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", path) if path.ends_with("/inbox") => Some((200, json!({ "data": [] }))),
        _ => None,
    }
}

/// The whole screen's cells.
fn screen(h: &Port) -> Vec<String> {
    cells(h, 0, 0..40)
}

// Expected: on each column, the sidebar shows the newest prompt and the link: with a newer prompt queued in the inbox,
// that one (the host lists a queued prompt among the session's messages, as TS's frame for it reads, so it has no
// `Queued` mark); `/lastprompt` and a click on the link show the whole prompt in a large centered dialog
// with its header and hint, which escape closes; on a session without a prompt, `/lastprompt` toasts that none was
// submitted.
#[test]
fn sidebar_prompt_draws_and_opens_alike_in_ts_rust_and_luau() {
    for queued in [false, true] {
        trio("opencode-sidebar-prompt", "sidebar-prompt", |carrier| {
            let h = open_with(&[carrier], 170, prompt_server(queued), false, None, None)?;
            h.wait_for("Open full prompt");
            h.settle();
            let mut steps = vec![("sidebar".to_owned(), cells(&h, SIDEBAR, block(&h, "Last prompt", 8)))];
            h.app.type_text("/lastprompt");
            h.wait_for("Show full last prompt");
            h.app.press("return");
            h.wait_for("Esc · Close");
            h.settle();
            steps.push(("dialog".to_owned(), screen(&h)));
            h.app.press("escape");
            h.wait_gone("Esc · Close");
            h.settle();
            steps.push(("closed".to_owned(), screen(&h)));
            let (x, y) = h.find("Open full prompt");
            h.app.click(x + 2, y);
            h.wait_for("Esc · Close");
            h.settle();
            steps.push(("clicked".to_owned(), screen(&h)));
            h.app.press("escape");
            h.wait_gone("Esc · Close");
            h.tui.navigate(crate::support::session_route("ses_q"));
            h.wait_for("No prompt submitted");
            h.app.type_text("/lastprompt");
            h.wait_for("Show full last prompt");
            h.app.press("return");
            h.wait_for("No prompt submitted in this session.");
            Some(Observed { steps, requests: requests(&h, &["/api/session/ses_"]) })
        });
    }
}

// --- opencode-command-hotkeys: configured keys, palette entries, server writes, a toast

/// `ses_p`, whose commands answer with `status` and whose goal is active.
fn hotkeys_server(status: u16) -> impl Fn(&Seen) -> Option<Reply> + Send + Sync {
    move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Hotkeys", None, 1) }))),
        ("POST", "/api/session/ses_p/command") => Some((status, json!({}))),
        ("POST", "/api/rpc/opencode.goal/get") => {
            Some((200, json!({ "output": { "id": "goal_1", "status": "active" } })))
        }
        ("GET", "/api/session/ses_p/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", "/api/session/ses_p/inbox") => Some((200, json!({ "data": [] }))),
        _ => None,
    }
}

/// Two bindings: `/review --all` on alt+r, and the goal's pause and resume on alt+o.
fn hotkeys() -> serde_json::Value {
    json!({ "bindings": [
        { "id": "review", "key": "alt+r", "title": "Run the review", "command": "review", "text": "--all" },
        { "id": "goal", "key": "alt+o", "title": "Toggle the goal", "action": "goal-toggle" },
    ] })
}

/// The commands the server was asked to run. The host reads goals itself, at the same path the plugin reads one.
fn writes(h: &Port) -> usize {
    h.log.lock().unwrap().iter().filter(|seen| seen.method == "POST" && seen.path.ends_with("/command")).count()
}

// Expected: on each column, alt+r runs `/review --all` in the session in view, the palette's "Run the review" runs it
// again, and alt+o reads the session's goal at the session's location and pauses it; on the home screen the keys run
// nothing. A command the server refuses toasts the plugin's failure.
#[test]
fn command_hotkeys_send_alike_in_ts_rust_and_luau() {
    use opencode_ui::keymap::COMMAND_PALETTE_COMMAND;

    for status in [204, 500] {
        trio("opencode-command-hotkeys", "command-hotkeys", |carrier| {
            let h = open_with(&[carrier], 170, hotkeys_server(status), false, None, Some(&hotkeys()))?;
            h.wait_for("Hotkeys");
            h.settle();
            h.app.press("alt+r");
            h.wait(&format!("{carrier:?}: the review runs"), || writes(&h) == 1);
            h.settle();
            let mut steps = Vec::new();
            if status == 500 {
                h.wait_for("Не удалось");
                steps.push(("failed".to_owned(), screen(&h)));
                return Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p"]) });
            }
            h.tui.keymap.dispatch(COMMAND_PALETTE_COMMAND, None);
            h.wait_for("Search commands");
            h.app.type_text("Run the review");
            h.wait("the entry", || h.app.text().lines().filter(|line| line.contains("Run the review")).count() >= 1);
            h.app.press("return");
            h.wait("the palette runs it", || writes(&h) == 2);
            h.settle();
            h.app.press("alt+o");
            h.wait("the goal pauses", || writes(&h) == 3);
            h.settle();
            steps.push(("ran".to_owned(), screen(&h)));
            h.tui.navigate(opencode_tui::Route::Home);
            h.settle();
            h.app.press("alt+r");
            h.settle();
            assert_eq!(writes(&h), 3, "{carrier:?}: a key off a session runs nothing");
            Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p"]) })
        });
    }
}

// Expected: on each column, options with a fault (here a repeated key, spelled two ways) register nothing and toast
// the plugin's check, without echoing a value.
#[test]
fn command_hotkeys_refuse_bad_options_alike_in_ts_rust_and_luau() {
    let options = json!({ "bindings": [
        { "id": "one", "key": "ctrl+shift+x", "title": "One", "command": "one" },
        { "id": "two", "key": "Shift+Control+X", "title": "Two", "command": "two" },
    ] });
    trio("opencode-command-hotkeys", "command-hotkeys", |carrier| {
        let h = open_with(&[carrier], 170, hotkeys_server(204), false, None, Some(&options))?;
        h.wait_for("Проверьте");
        h.settle();
        Some(Observed {
            steps: vec![("refused".to_owned(), screen(&h))],
            requests: requests(&h, &["/api/session/ses_p"]),
        })
    });
}

// --- @khaosoigai/oc-context-grid: a slot, a page of its own, a keyboard mode, and the catalog

/// `ses_p`, $0.08 spent: a user prompt, then a step that read a file and answered, its usage 35,500 tokens of the
/// 200k window of model `p/m`.
fn grid_server(seen: &Seen) -> Option<Reply> {
    let model = crate::support::merge(
        crate::support::model("p", "m", "Model M"),
        json!({ "limit": { "context": 200_000, "output": 8_000 } }),
    );
    let ses_p = crate::support::merge(session("ses_p", "Grid", None, 1), json!({ "cost": 0.08 }));
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": ses_p }))),
        ("GET", "/api/session") => Some((200, json!({ "data": [ses_p], "cursor": {} }))),
        ("GET", "/api/model") => Some((200, crate::support::list(DIRECTORY, json!([model])))),
        ("GET", "/api/session/ses_p/message") => Some((
            200,
            json!({ "data": [
                {
                    "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
                    "time": { "created": 2000, "completed": 2600 }, "cost": 0.08,
                    "tokens": { "input": 30_000, "output": 500, "reasoning": 0, "cache": { "read": 5_000, "write": 0 } },
                    "content": [
                        { "type": "text", "text": "The file says what the release holds; the notes follow it." },
                        { "type": "tool", "id": "call_1", "name": "read", "time": { "created": 2100, "ran": 2200, "completed": 2300 },
                          "state": { "status": "completed", "input": { "path": "CHANGELOG.md" }, "content": [{ "type": "text", "text": "x".repeat(40_000) }] } },
                    ],
                },
                { "id": "msg_1", "type": "user", "text": "Read the changelog and draft the notes for 2.3, then list the open questions.", "time": { "created": 1000 } },
            ], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p/inbox") => Some((200, json!({ "data": [] }))),
        _ => None,
    }
}

// Expected: on each column, the sidebar shows "Context grid", the usage against the window and its 30 squares in their
// categories' colors; `/contextgrid` opens the page with the model, the usage and the cost, the 100 squares and the
// estimate by category with the free space, and escape goes back to the session; opened from home, the page says no
// session is selected, and escape goes home.
#[test]
fn context_grid_draws_and_pages_alike_in_ts_rust_and_luau() {
    trio("@khaosoigai/oc-context-grid", "context-grid", |carrier| {
        let h = open_with(&[carrier], 170, grid_server, false, None, None)?;
        h.wait_for("tokens (18%)");
        h.settle();
        let mut steps = vec![("sidebar".to_owned(), cells(&h, SIDEBAR, block(&h, "Context grid", 6)))];
        h.app.type_text("/contextgrid");
        h.wait_for("Show context usage as a grid");
        h.app.press("return");
        h.wait_for("Estimated usage by category");
        h.settle();
        steps.push(("page".to_owned(), screen(&h)));
        h.app.press("escape");
        h.wait(&format!("{carrier:?}: escape goes back"), || h.tui.route() == crate::support::session_route("ses_p"));
        h.settle();
        steps.push(("back".to_owned(), screen(&h)));
        h.tui.navigate(opencode_tui::Route::Home);
        h.settle();
        h.app.type_text("/contextgrid");
        h.wait_for("Show context usage as a grid");
        h.app.press("return");
        h.wait_for("No session selected.");
        h.settle();
        steps.push(("no session".to_owned(), screen(&h)));
        h.app.press("escape");
        h.wait(&format!("{carrier:?}: escape goes home"), || h.tui.route() == opencode_tui::Route::Home);
        Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p", "/api/model"]) })
    });
}

// --- opencode-subagents-sidebar: a slot, a select, clicks, and storage

// Expected: on each column, the sidebar lists the session's direct children newest first, ten of them and `+2 more`,
// with green running dots; a click on the header folds the list and stores the fold, a second unfolds it; `/subagents`
// lists all twelve, and the pick opens its child. On the JS host the package stores the fold but draws it only at the
// sidebar's next mount, where TS draws it at once (`steps/ports-trio.md`): its column leaves out the folded list.
#[test]
fn subagents_sidebar_lists_folds_and_picks_alike_in_ts_rust_and_luau() {
    use crate::ports::{by_update, subagents};

    trio("opencode-subagents-sidebar", "subagents-sidebar", |carrier| {
        let h = open_with(&[carrier], 170, subagents, true, None, None)?;
        h.wait_for("+2 more");
        h.wait("Child 03 runs", || {
            h.sidebar(usize::from(SIDEBAR)).iter().any(|row| row.starts_with("• Child 03") && row.ends_with(" running"))
        });
        h.settle();
        let mut steps = vec![("listed".to_owned(), cells(&h, SIDEBAR, block(&h, "Subagents", 13)))];
        let storage = h.tui.storage().unwrap();
        let stored = || storage.load("plugin.subagents-sidebar.view", &Value::Null).unwrap();
        let (x, y) = h.find("▼ Subagents");
        h.app.click(x + 2, y);
        h.wait(&format!("{carrier:?}: the fold reaches the disk"), || stored() == json!({ "open": false }));
        if !matches!(carrier, Carrier::Npm(_)) {
            h.wait(&format!("{carrier:?}: the list folds"), || h.app.text().contains("▶ Subagents (12, 2 running)"));
            h.settle();
            steps.push(("folded".to_owned(), cells(&h, SIDEBAR, block(&h, "Subagents", 3))));
        }
        h.settle();
        let (x, y) = h.find("Subagents");
        h.app.click(x, y);
        h.wait("the unfold reaches the disk", || stored() == json!({ "open": true }));
        h.wait_for("+2 more");
        h.tui.keymap.dispatch("subagents-sidebar.pick", None);
        h.wait_for("Child 12");
        h.settle();
        steps.push(("picker".to_owned(), screen(&h)));
        let (last, title, _) = by_update().pop().unwrap();
        h.app.type_text(&title);
        h.wait("the filtered list", || h.app.text().lines().filter(|line| line.contains(&title)).count() >= 2);
        h.app.press("return");
        let child = opencode_tui::Route::Session { id: opencode_api::generated::SessionID(last) };
        h.wait(&format!("{carrier:?}: the pick opens its child"), || h.tui.route() == child);
        Some(Observed { steps, requests: requests(&h, &["/api/session"]) })
    });
}

// --- @mynameistito/opencode-force-input: a key that interrupts and sends, and a prompt-footer hint

// Expected: on each column, the hint reads as TS draws it while the session runs; ctrl+enter sends one interrupt and
// then the prompt, with its text and no newline; shell mode hides the hint; an idle session's hint says enter sends.
#[test]
fn force_input_sends_and_hints_alike_in_ts_rust_and_luau() {
    use crate::ports::running;

    trio("@mynameistito/opencode-force-input", "force-input", |carrier| {
        let h = open_with(&[carrier], 120, running, false, None, None)?;
        h.wait_for("⏎ steer · ctrl+⏎ interrupt & send");
        h.settle();
        let footer = |h: &Port| {
            let (_, y) = h.find("⏎ ");
            cells(h, 0, y..y + 1)
        };
        let mut steps = vec![("running".to_owned(), footer(&h))];
        h.app.type_text("hello");
        h.app.press("ctrl+return");
        h.wait("the prompt is sent", || !h.sent("/api/session/ses_p/prompt").is_empty());
        h.settle();
        h.app.type_text("!");
        h.wait_gone("⏎ steer");
        h.app.press("backspace");
        h.wait_for("⏎ steer");
        h.tui.navigate(crate::support::session_route("ses_q"));
        h.wait_for("⏎ send");
        h.settle();
        steps.push(("idle".to_owned(), footer(&h)));
        Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p/interrupt", "/api/session/ses_p/prompt"]) })
    });
}

// --- opencode-session-usage: a slot over paged fetches of the session tree, the catalog, and usage events

// Expected: on each column, the panel totals every message of the session and its child over both pages of the
// parent's history ($1.50 reported, $1.00 at catalog prices), draws the three meters with their countdowns and bars in
// their severities' colors, and follows the child's `session.usage.updated` to the new total; the fetches are the same.
#[test]
fn session_usage_totals_alike_in_ts_rust_and_luau() {
    use std::sync::{Arc, Mutex};

    trio("opencode-session-usage", "session-usage", |carrier| {
        let grown = Arc::new(Mutex::new(false));
        let h = open_with(&[carrier], 170, crate::ports::usage(grown.clone(), false), false, None, None)?;
        h.wait(&format!("{carrier:?}: the total"), || h.app.text().contains("≈ $2.50 session total"));
        h.wait_for("Monthly");
        h.settle();
        let mut steps = vec![("total".to_owned(), cells(&h, SIDEBAR, block(&h, "Usage", 12)))];
        *grown.lock().unwrap() = true;
        h.events.emit(&json!({
            "id": "evt_usage", "created": 2, "type": "session.usage.updated",
            "location": { "directory": DIRECTORY },
            "data": { "sessionID": "ses_c", "cost": 0, "tokens": { "input": 2_000_000, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
        }));
        h.wait(&format!("{carrier:?}: the total follows"), || h.app.text().contains("≈ $3.50 session total"));
        h.settle();
        steps.push(("followed".to_owned(), cells(&h, SIDEBAR, block(&h, "Usage", 12))));
        let paths = ["/api/session/ses_p/message", "/api/session/ses_c/message", "/api/experimental/usage/limits"];
        let mut requests = requests(&h, &paths);
        requests.extend(requests_of(&h, |seen| seen.path == "/api/session" && seen.param("limit") == "100"));
        Some(Observed { steps, requests })
    });
}

/// The reads the server saw that `keep` keeps, each once, sorted.
fn requests_of(h: &Port, keep: impl Fn(&Seen) -> bool) -> Vec<String> {
    let log = h.log.lock().unwrap();
    let mut seen: Vec<String> =
        log.iter().filter(|seen| keep(seen)).map(|seen| format!("{} {}", seen.method, seen.url())).collect();
    seen.sort();
    seen.dedup();
    seen
}
