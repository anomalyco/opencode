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

use crate::ports::{Carrier, Port, open_timed, open_with, session};
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
    // Each column in UTC, as TS records: session-manager's dates and buckets are local time in every column.
    if !crate::support::in_utc() {
        return;
    }
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

/// The whole screen's cells once two looks a settle apart agree. A step's text can show while the dialog stack is
/// still changing (a confirm closed and the plugin's alert not yet open, the backdrop missing from a frame).
fn steady_screen(h: &Port) -> Vec<String> {
    let mut last = screen(h);
    for _ in 0..20 {
        h.settle();
        let now = screen(h);
        if now == last {
            return now;
        }
        last = now;
    }
    panic!("the screen never held still:\n{}", last.join("\n"))
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
// nothing, and the palette lists no entry of the plugin's (TS's `enabled: available`, contract ergonomics 2.5). A
// command the server refuses toasts the plugin's failure.
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
            h.tui.keymap.dispatch(COMMAND_PALETTE_COMMAND, None);
            h.wait_for("Search commands");
            h.app.type_text("Run the review");
            h.settle();
            // The query is the one line that holds the title: no entry under it. The screen is not compared: the home
            // composer's placeholder is drawn at random.
            let lines = h.app.text().lines().filter(|line| line.contains("Run the review")).count();
            assert_eq!(lines, 1, "{carrier:?}: the palette lists the entry off a session:\n{}", h.app.text());
            Some(Observed { steps, requests: requests(&h, &["/api/session/ses_p"]) })
        });
    }
}

// Expected: on each column, options with a fault register nothing and toast the plugin's check, without echoing a
// value: a key repeated in two spellings, and a key with an empty or blank alternative (`ctrl+a,`, which the Luau
// audit found could reach the layer as a key without a name). `+`, the plus key, is no fault: it is taken, as TS
// takes it.
#[test]
fn command_hotkeys_refuse_bad_options_alike_in_ts_rust_and_luau() {
    let one = |key: &str| json!({ "id": "one", "key": key, "title": "One", "command": "one" });
    let faults = [
        (
            "repeated",
            vec![
                one("ctrl+shift+x"),
                json!({ "id": "two", "key": "Shift+Control+X", "title": "Two", "command": "two" }),
            ],
        ),
        ("empty alternative", vec![one("ctrl+a,")]),
        ("blank alternative", vec![one("ctrl+a, ,ctrl+b")]),
        ("plus key", vec![one("+")]),
    ]
    .map(|(fault, bindings)| (fault, json!({ "bindings": bindings })));
    // Bindings that are an object, an empty one, which a Luau plugin tells from an empty list by its JSON marker.
    let shapes = [("object bindings", json!({ "bindings": {} }))];
    for (fault, options) in faults.into_iter().chain(shapes) {
        trio("opencode-command-hotkeys", "command-hotkeys", |carrier| {
            let h = open_with(&[carrier], 170, hotkeys_server(204), false, None, Some(&options))?;
            match fault {
                "plus key" => drop(h.wait_for("Hotkeys")),
                _ => h.wait(&format!("{carrier:?} refuses the {fault}"), || h.app.text().contains("Проверьте")),
            }
            h.settle();
            Some(Observed {
                steps: vec![(fault.to_owned(), screen(&h))],
                requests: requests(&h, &["/api/session/ses_p"]),
            })
        });
    }
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
        // Before the pick: the child it opens is read by the host in its own time.
        let requests = requests(&h, &["/api/session"]);
        let (last, title, _) = by_update().pop().unwrap();
        h.app.type_text(&title);
        h.wait("the filtered list", || h.app.text().lines().filter(|line| line.contains(&title)).count() >= 2);
        h.app.press("return");
        let child = opencode_tui::Route::Session { id: opencode_api::generated::SessionID(last) };
        h.wait(&format!("{carrier:?}: the pick opens its child"), || h.tui.route() == child);
        Some(Observed { steps, requests })
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

// --- opencode-session-manager (complex): a route, two layers of keys, a field, a prompt, a confirm and deletes

/// Three sessions in two directories and two projects, at noon UTC, so their dates read alike in any zone within
/// eleven hours: `ses_p` (the route's), `ses_q` beside it, and `ses_r` with its subsession `ses_s` elsewhere.
fn manager_sessions() -> Value {
    let at = |id: &str, title: &str, parent: Option<&str>, directory: &str, project: &str, day: u64| {
        let noon = 1_699_963_200_000 + day * 86_400_000;
        json!({
            "id": id, "title": title, "parentID": parent, "projectID": project, "cost": 0,
            "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "time": { "created": noon - 3_600_000, "updated": noon },
            "location": { "directory": directory },
        })
    };
    json!([
        at("ses_p", "Plan the release", None, DIRECTORY, "proj_a", 3),
        at("ses_q", "Draft the notes", None, DIRECTORY, "proj_a", 1),
        at("ses_r", "Fix the theme picker", None, "/tmp/elsewhere", "proj_b", 2),
        at("ses_s", "Check the colors", Some("ses_r"), "/tmp/elsewhere", "proj_b", 2),
    ])
}

fn manager_server(seen: &Seen) -> Option<Reply> {
    let sessions = manager_sessions();
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": sessions[0] }))),
        // The host's own reads of the route's session: without them, its 404 toast covers the page.
        ("GET", "/api/session/ses_p/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", "/api/session/ses_p/inbox") => Some((200, json!({ "data": [] }))),
        ("GET", "/api/session") if !seen.param("parentID").is_empty() => {
            Some((200, json!({ "data": [], "cursor": {} })))
        }
        ("GET", "/api/session") => Some((200, json!({ "data": sessions, "cursor": {} }))),
        ("GET", "/api/project") => Some((
            200,
            json!([{ "id": "proj_a", "name": "Opencode", "canonical": DIRECTORY }, { "id": "proj_b", "canonical": "/tmp/elsewhere" }]),
        )),
        ("DELETE", _) => Some((204, Value::Null)),
        ("PATCH", _) => Some((200, json!({ "data": {} }))),
        _ => None,
    }
}

// Expected: on each column, `/sm` (the command's alias) opens the page with the sessions grouped by directory, the
// route's session marked and selected; `j` moves the selection, Tab groups by project, `c` shows the subsessions as a
// tree, `l` switches to Chinese and back, `/` opens the search row and focuses its field, which what follows is typed
// into, `r` asks for a new title in a prompt filled with the title under the session's directory, `d` asks before it
// deletes, and enter deletes the session and its subsession and says so.
#[test]
fn session_manager_groups_searches_and_deletes_alike_in_ts_rust_and_luau() {
    trio("@0xuwui/opencode-session-manager", "session-manager", |carrier| {
        let h = open_with(&[carrier], 140, manager_server, true, None, None)?;
        h.wait_for("Plan the release");
        h.settle();
        h.app.type_text("/sm");
        h.wait_for("Browse");
        h.app.press("return");
        h.wait_for("Draft the notes");
        h.settle();
        let mut steps = vec![("page".to_owned(), screen(&h))];
        for (key, step, until) in [
            ("j", "moved", None),
            ("tab", "project", Some("[Project]")),
            ("c", "children", Some("Check the colors")),
            ("l", "chinese", Some("项目")),
            ("l", "english", Some("[Project]")),
            ("shift+tab", "directory", Some("[Directory]")),
            ("/", "search", Some("Search titles")),
            ("escape", "cleared", None),
        ] {
            h.app.press(key);
            if let Some(until) = until {
                h.wait_for(until);
            }
            h.settle();
            steps.push((step.to_owned(), screen(&h)));
            if step == "search" {
                h.app.type_text("notes");
                h.wait_for("1 match");
                h.settle();
                steps.push(("typed".to_owned(), screen(&h)));
            }
        }
        h.app.press("k");
        h.app.press("r");
        h.wait_for("Rename session");
        h.settle();
        steps.push(("rename".to_owned(), screen(&h)));
        h.app.press("escape");
        h.settle();
        steps.push(("renamed".to_owned(), screen(&h)));
        h.app.press("d");
        h.wait_for("This cannot be undone.");
        h.settle();
        steps.push(("delete".to_owned(), screen(&h)));
        h.app.press("return");
        h.wait_for("Deleted");
        h.settle();
        steps.push(("deleted".to_owned(), screen(&h)));
        // The plugin's: its writes, and its reads of the list and the projects; the host reads the route's session.
        let mut requests = requests(&h, &["/api/project"]);
        requests.extend(requests_of(&h, |seen| seen.method != "GET" && seen.path.starts_with("/api/session/")));
        requests.extend(requests_of(&h, |seen| seen.path == "/api/session" && seen.param("parentID").is_empty()));
        Some(Observed { steps, requests })
    });
}

// --- opencode-queue-manager (complex): a chain of dialogs over stored drafts, the session's queue and its inbox

fn queue_server(seen: &Seen) -> Option<Reply> {
    let pending = json!([
        { "id": "msg_p1", "sessionID": "ses_p", "time": { "created": 3000 }, "type": "user", "payload": { "text": "Write the tests" }, "delivery": "queue" },
        { "id": "msg_p2", "sessionID": "ses_p", "time": { "created": 3001 }, "type": "synthetic", "payload": { "text": "Continue" }, "delivery": "queue" },
    ]);
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Queue", None, 1) }))),
        ("GET", "/api/session/ses_p/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", "/api/session/ses_p/inbox") => Some((200, json!({ "data": pending }))),
        ("DELETE", "/api/session/ses_p/inbox/msg_p1") => Some((204, Value::Null)),
        _ => None,
    }
}

// Expected: on each column, `/qm` opens the menu with the drafts and the pending count; a custom count of 0 is refused
// in TS's error alert; two drafts added through the prompt sort A-Z in the stored list; clearing the native queue
// asks, then cancels the one queued user prompt; clearing the drafts asks, then empties them; and a file's lines are
// staged after a confirm. A Luau plugin reads no files, so the Luau column leaves the import out.
#[test]
fn queue_manager_stages_sorts_clears_and_imports_alike_in_ts_rust_and_luau() {
    let file = std::env::temp_dir().join(format!("ports-trio-queue-{}.txt", std::process::id()));
    std::fs::write(&file, "\u{feff}first line\r\n\n  second line \n").unwrap();
    let path = file.to_string_lossy().into_owned();
    trio("@bybrawe/opencode-queue-manager", "queue-manager", |carrier| {
        let h = open_with(&[carrier], 120, queue_server, true, None, None)?;
        h.settle();
        let mut steps = Vec::new();
        // Presses `keys`; with `text`, waits for the prompt they open (its placeholder) and answers it with the text.
        let mut step = |name: &str, keys: &[&str], text: Option<(&str, &str)>, until: &str| {
            keys.iter().for_each(|key| h.app.press(key));
            if let Some((prompt, text)) = text {
                h.wait_for(prompt);
                h.app.type_text(text);
                h.app.press("return");
            }
            h.wait_for(until);
            // Every step shows one of the host's dialogs, the menu or one the plugin opened from it.
            h.wait(&format!("{name}: a dialog is open"), || h.tui.dialogs.is_open());
            h.settle();
            steps.push((name.to_owned(), steady_screen(&h)));
        };
        h.app.type_text("/qm");
        h.wait_for("Queue Manager");
        step("menu", &["return"], None, "native pending");
        step("count", &["return"], None, "Custom (1-500)");
        step("how many", &["down", "down", "down", "down", "down", "return"], None, "e.g. 150");
        step("refused", &[], Some(("e.g. 150", "0")), "between 1 and 500");
        step("back", &["return"], None, "0 drafts");
        step("first", &["down", "return"], Some(("Your prompt", "zeta task")), "1 drafts");
        step("second", &["down", "return"], Some(("Your prompt", "Alpha task")), "2 drafts");
        step("sort", &["down", "down", "down", "down", "return"], None, "Sort A-Z");
        step("sorted", &["down", "return"], None, "2 drafts");
        step("drafts", &["down", "down", "down", "return"], None, "001. Alpha task");
        step("listed", &["escape"], None, "2 drafts");
        step(
            "clear native",
            &["down", "down", "down", "down", "down", "down", "down", "down", "return"],
            None,
            "Cancel 1 queued",
        );
        step("cleared native", &["return"], None, "cancellation requested");
        step(
            "clear drafts",
            &["down", "down", "down", "down", "down", "down", "down", "return"],
            None,
            "Delete 2 draft",
        );
        step("cleared drafts", &["return"], None, "0 drafts");
        // A Luau plugin reads no files.
        #[cfg(feature = "luau")]
        let reads_files = !matches!(carrier, Carrier::Luau(_));
        #[cfg(not(feature = "luau"))]
        let reads_files = true;
        if reads_files {
            step("import", &["down", "down", "return"], Some(("messages.txt", &path)), "Stage 2 messages");
            step("imported", &["return"], None, "2 messages staged");
        }
        drop(step);
        let requests = requests(&h, &["/api/session/ses_p/inbox", "/api/session/ses_p/prompt"]);
        Some(Observed { steps, requests })
    });
    let _ = std::fs::remove_file(file);
}

// --- opencode-goal-plugin (complex): a slot read from the messages' tool results, and a summary in a select

/// An assistant message with one completed tool call of `name` whose result is `text`.
fn goal_message(id: &str, name: &str, text: &str) -> Value {
    json!({
        "id": id, "type": "assistant", "agent": "build", "model": { "providerID": "provider", "id": "model" },
        "content": [{
            "type": "tool", "id": format!("call_{id}"), "name": name,
            "state": { "status": "completed", "input": {}, "content": [{ "type": "text", "text": text }] },
            "time": { "created": 20, "ran": 21, "completed": 22 },
        }],
        "finish": "stop", "time": { "created": 20, "completed": 23 },
    })
}

fn goal_server(seen: &Seen) -> Option<Reply> {
    let goal = json!({
        "sessionID": "ses_p", "objective": "Ship the parser rewrite", "status": "active", "tokenBudget": 20,
        "tokensUsed": 10, "timeUsedSeconds": 3725, "createdAt": 1, "updatedAt": 2, "continuationFailures": 0,
        "lastStatus": "Low-progress continuation turn detected (2/unbounded).", "maxAutoTurns": null,
        "maxDurationSeconds": 7200, "noProgressTokenThreshold": null, "maxNoProgressTurns": null, "noProgressTurns": 2,
        "budgetWrapupSent": false, "stopReason": "token budget reached (10/20)", "history": [], "checkpoints": [],
        "lastCheckpoint": null, "lastAssistantText": "", "lastAssistantMessageID": "", "autoTurns": 4,
        "remainingTokens": 10,
    });
    let (ses_p, ses_q) = (session("ses_p", "Goal", None, 2), session("ses_q", "Cleared", None, 1));
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": ses_p }))),
        ("GET", "/api/session/ses_q") => Some((200, json!({ "data": ses_q }))),
        ("GET", "/api/session") => Some((200, json!({ "data": [ses_p, ses_q], "cursor": {} }))),
        ("GET", "/api/session/ses_p/message") => {
            let result = json!({ "goal": goal }).to_string();
            Some((200, json!({ "data": [goal_message("msg_p", "get_goal", &result)], "cursor": {} })))
        }
        ("GET", "/api/session/ses_q/message") => {
            let messages = [goal_message("msg_q2", "clear_goal", "{}"), goal_message("msg_q1", "get_goal", "{}")];
            Some((200, json!({ "data": messages, "cursor": {} })))
        }
        ("GET", path) if path.ends_with("/inbox") => Some((200, json!({ "data": [] }))),
        ("POST", "/api/session/ses_p/prompt") => Some((200, json!({ "data": { "id": "inb_1" } }))),
        _ => None,
    }
}

// Expected: on each column, with `locale: "zh-CN"`, the sidebar block shows an active goal in Chinese, its stop reason
// and last status presented as the plugin's own; the palette's `目标` opens the summary with Pause among its options,
// and Pause sends the Chinese prompt. On a session whose newest goal tool cleared the goal, the block is gone and the
// summary says there is none, with Refresh alone.
#[test]
fn goal_plugin_shows_and_sends_alike_in_ts_rust_and_luau() {
    trio("@prevalentware/opencode-goal-plugin", "goal-plugin", |carrier| {
        let options = json!({ "locale": "zh-CN" });
        let h = open_with(&[carrier], 170, goal_server, false, None, Some(&options))?;
        h.wait_for("Ship the parser rewrite");
        h.settle();
        let mut steps = vec![("sidebar".to_owned(), cells(&h, SIDEBAR, 0..40))];
        let summary = |h: &Port, steps: &mut Vec<(String, Vec<String>)>, name: &str| {
            h.app.press("ctrl+p");
            h.wait_for("Search commands");
            h.app.type_text("目标");
            h.wait_for("查看、暂停");
            h.app.press("return");
            h.wait_for("刷新");
            h.settle();
            steps.push((name.to_owned(), screen(h)));
        };
        summary(&h, &mut steps, "summary");
        h.app.press("down");
        h.app.press("down");
        h.app.press("return");
        h.wait(&format!("{carrier:?}: the pause is sent"), || !h.sent("/api/session/ses_p/prompt").is_empty());
        h.settle();
        h.tui.navigate(crate::support::session_route("ses_q"));
        h.wait_for("Cleared");
        h.settle();
        steps.push(("cleared".to_owned(), cells(&h, SIDEBAR, 0..40)));
        summary(&h, &mut steps, "none");
        let mut requests = requests(&h, &["/api/session/ses_p/prompt"]);
        requests.extend(requests_of(&h, |seen| seen.path.ends_with("/message")));
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

// --- The measures of `steps/ports-trio.md`

/// The resident memory of process `pid` (`self` for this one), in bytes.
fn rss(pid: &str) -> u64 {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap_or_default();
    let kib = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))
        .and_then(|rest| rest.split_whitespace().next()?.parse::<u64>().ok());
    kib.unwrap_or(0) * 1024
}

/// A fake server's handler, as [`open_timed`] takes one.
type Server = Box<dyn Fn(&Seen) -> Option<Reply> + Send + Sync>;

/// One measured plugin: its package, its ports, its server, options and width, the text its first draw shows, and
/// what makes it run once (one update).
struct Measured {
    npm: &'static str,
    port: &'static str,
    server: fn() -> Server,
    options: Option<fn() -> Value>,
    width: u16,
    ready: &'static str,
    update: fn(&Port, u32),
}

/// A `session.usage.updated` of `session` with `round` input tokens: each slot of these plugins draws again.
fn usage_event(h: &Port, session: &str, round: u32) {
    h.events.emit(&json!({
        "id": format!("evt_measure_{round}"), "created": 10 + round, "type": "session.usage.updated",
        "location": { "directory": DIRECTORY },
        "data": { "sessionID": session, "cost": 0.08, "tokens": { "input": 1000 + round, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
    }));
}

// The measures of the trio, printed: per plugin and column, the time to its first draw from the TUI's mount, the load
// and setup the budget's monitor timed, what one update's calls of the plugin took (the mean of 50, each waited for
// until the monitor counted it), the Luau VM's idle heap, the native library's size, and the JS host's resident memory.
// Run with `--release --features luau --ignored --nocapture --test-threads=1`, on a machine at rest.
#[test]
#[ignore]
fn measure_the_trio() {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let plugins = [
        Measured {
            npm: "opencode-sidebar-tokens",
            port: "sidebar-tokens",
            server: || Box::new(tokens_server),
            options: None,
            width: 170,
            ready: "Cache write",
            update: |h, round| usage_event(h, "ses_p", round),
        },
        Measured {
            npm: "opencode-sidebar-prompt",
            port: "sidebar-prompt",
            server: || Box::new(prompt_server(false)),
            options: None,
            width: 170,
            ready: "Open full prompt",
            update: |h, round| usage_event(h, "ses_p", round),
        },
        Measured {
            npm: "opencode-command-hotkeys",
            port: "command-hotkeys",
            server: || Box::new(hotkeys_server(204)),
            options: Some(hotkeys),
            width: 170,
            ready: "Hotkeys",
            update: |h, _| h.app.press("alt+r"),
        },
        Measured {
            npm: "@khaosoigai/oc-context-grid",
            port: "context-grid",
            server: || Box::new(grid_server),
            options: None,
            width: 170,
            ready: "tokens (18%)",
            update: |h, round| usage_event(h, "ses_p", round),
        },
        Measured {
            npm: "opencode-subagents-sidebar",
            port: "subagents-sidebar",
            server: || Box::new(crate::ports::subagents),
            options: None,
            width: 170,
            ready: "+2 more",
            update: |h, round| usage_event(h, "ses_p", round),
        },
        Measured {
            npm: "@mynameistito/opencode-force-input",
            port: "force-input",
            server: || Box::new(crate::ports::running),
            options: None,
            width: 120,
            ready: "interrupt & send",
            update: |h, round| usage_event(h, "ses_p", round),
        },
        Measured {
            npm: "opencode-session-usage",
            port: "session-usage",
            server: || Box::new(crate::ports::usage(Arc::new(Mutex::new(false)), false)),
            options: None,
            width: 170,
            ready: "≈ $2.50 session total",
            update: |h, round| usage_event(h, "ses_p", round),
        },
    ];
    let rounds = 50;
    // Each library is built before it is timed.
    plugins.iter().for_each(|plugin| drop(crate::ports::build(plugin.port)));
    println!("plugin | column | first draw | load | setup | per update | memory");
    for plugin in &plugins {
        for carrier in columns(plugin.npm, plugin.port) {
            let options = plugin.options.map(|options| options());
            let start = Instant::now();
            let Some(h) = open_timed(&[carrier], plugin.width, (plugin.server)(), false, None, options.as_ref(), true)
            else {
                continue;
            };
            h.wait_for(plugin.ready);
            let first = start.elapsed();
            // The plugin's own entry, once it is active: a ready text such as the session's title can come first.
            let ours = |id: &str| {
                !id.starts_with("opencode.") || (id == "opencode.sidebar.limit" && plugin.port == "session-usage")
            };
            let active = || {
                let entries = h.tui.plugins.entries();
                entries.into_iter().find(|entry| ours(&entry.id) && entry.status == opencode_plugin::Status::Active)
            };
            h.wait(&format!("{carrier:?}: the plugin is active"), || active().is_some());
            h.settle();
            let id = active().map(|entry| entry.id).unwrap_or_default();
            let monitor = h.tui.plugins.monitor();
            let (load, setup) = monitor.load(&id);
            let spent = monitor.calls_time(&id);
            let mut counted = 0;
            for round in 0..rounds {
                let last = monitor.calls_time(&id);
                (plugin.update)(&h, round);
                counted += u32::from(h.app.wait_until(Duration::from_secs(2), || monitor.calls_time(&id) > last));
                h.settle();
            }
            let each = (monitor.calls_time(&id).saturating_sub(spent)) / counted.max(1);
            let memory = match carrier {
                Carrier::Npm(_) => {
                    let pid = h.tui.plugins.scripts.borrow().as_ref().and_then(|scripts| scripts.pid());
                    format!("JS host {} MiB", pid.map_or(0, |pid| rss(&pid.to_string())) / (1 << 20))
                }
                Carrier::Port(name) => format!("library {} KiB", crate::ports::build(name).len() / 1024),
                #[cfg(feature = "luau")]
                Carrier::Luau(name) => {
                    let dir =
                        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/luau").join(name);
                    let heap = opencode_plugin::luau::idle_memory(&opencode_plugin::luau::Sources::read(&dir).unwrap())
                        .unwrap();
                    format!("VM {} KiB", heap / 1024)
                }
            };
            let ms = |took: Option<Duration>| {
                took.map_or("-".to_owned(), |took| format!("{:.2} ms", took.as_secs_f64() * 1e3))
            };
            // From an event to its cells on screen, on every column alike: the JS host's calls run in its own
            // process, where the monitor does not see them.
            let latency = (plugin.port == "sidebar-tokens").then(|| {
                let start = Instant::now();
                for round in 0..rounds {
                    usage_event(&h, "ses_p", 1000 + round);
                    let shown = format!("2,{:03}", round);
                    h.wait(&shown, || h.app.text().contains(&shown));
                }
                format!(", event to cells {:.2} ms", start.elapsed().as_secs_f64() * 1e3 / f64::from(rounds))
            });
            let latency = latency.unwrap_or_default();
            println!(
                "{} | {carrier:?} | {:.0} ms | {} | {} | {:.1} µs ({counted} of {rounds} counted){latency} | {memory}",
                plugin.port,
                first.as_secs_f64() * 1e3,
                ms(load),
                ms(setup),
                each.as_secs_f64() * 1e6,
            );
        }
    }
}
