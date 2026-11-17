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

use serde_json::json;

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
    let (first, expected) = &observed[0];
    for (carrier, seen) in &observed[1..] {
        for ((step, cells), (_, wanted)) in seen.steps.iter().zip(&expected.steps) {
            assert_eq!(cells, wanted, "{carrier:?} draws step `{step}` unlike {first:?}");
        }
        assert_eq!(seen.steps.len(), expected.steps.len(), "{carrier:?} against {first:?}");
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
/// they came, then each read once, sorted. How often the host reads a session again is its timing, not the plugin's:
/// a package's `data.session.sync` reads the route's session once more.
fn requests(h: &Port, paths: &[&str]) -> Vec<String> {
    let log = h.log.lock().unwrap();
    let seen = log.iter().filter(|seen| paths.iter().any(|path| seen.path.starts_with(path)));
    let (reads, mut writes): (Vec<_>, Vec<_>) =
        seen.map(|seen| (seen.method == "GET", format!("{} {}", seen.method, seen.url()))).partition(|(read, _)| *read);
    let mut reads: Vec<(bool, String)> = reads;
    reads.sort();
    reads.dedup();
    writes.extend(reads);
    writes.into_iter().map(|(_, request)| request).collect()
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
