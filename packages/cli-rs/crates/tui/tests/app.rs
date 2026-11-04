//! P-APP, Rust side (H.2, `docs/H.2.md`): replays every recording under `parity/fixtures/*/*.app.json`
//! through the whole Rust TUI in a `TestApp`, over the in-memory transport, and compares each checkpoint's
//! cells and the requests with what the TS TUI did. `PARITY_SCENARIO=<step>/<name>` selects one scenario.

use std::fmt::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_local::cli_config::{self, Resolved};
use opencode_parity::Fixture;
use opencode_parity::app::{self, Recording, Sent, Step};
use opencode_plugin::{Definition, Placement, Setup, slot};
use opencode_tui::{Args, Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;

/// How long a checkpoint waits for its `until` text. Longer than any MS1 screen takes; a screen the Rust TUI
/// does not draw yet is compared after this.
const UNTIL: Duration = Duration::from_secs(2);
/// How long a checkpoint waits for the client to go idle and the frame to settle.
const SETTLE: Duration = Duration::from_secs(3);

#[test]
fn scenarios() {
    let only = std::env::var("PARITY_SCENARIO").ok();
    let recordings = Recording::all(only.as_deref()).unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !recordings.is_empty(),
        "no P-APP recording matches {only:?}"
    );
    let mut failed = Vec::new();
    for recording in &recordings {
        let (passed, report) = run(recording);
        eprintln!(
            "{} {}\n{report}",
            if passed { "ok  " } else { "FAIL" },
            recording.scenario
        );
        if !passed {
            failed.push(recording.scenario.clone());
        }
    }
    assert!(
        failed.is_empty(),
        "P-APP scenarios failed: {failed:?} (reports above)"
    );
}

/// Runs one recording; returns whether it passed and its report.
fn run(recording: &Recording) -> (bool, String) {
    let memory = Memory::new(routes(recording));
    let app = TestApp::new(recording.width, recording.height);
    let client =
        Client::with_transport("http://opencode.local", Arc::new(memory.clone())).expect("client");
    let config = cli_config::decode_text(&recording.config.to_string()).unwrap_or_default();
    let args = &recording.args;
    // TS opens `sessionID` unless it forks it (`app.tsx:680-686`).
    let session = args.session_id.clone().map(SessionID);
    let tui = opencode_tui::mount_with(
        &app,
        Deps {
            client,
            directory: recording.directory.clone(),
            config: Resolved::new(config, |_| None),
            roots: None,
            route: match &session {
                Some(id) if !args.fork => Route::Session { id: id.clone() },
                _ => recording
                    .env
                    .get("OPENCODE_ROUTE")
                    .and_then(|value| opencode_tui::features::startup::env_route(value))
                    .unwrap_or(Route::Home),
            },
            continue_: args.continue_,
            events: true,
        },
        Args {
            // The TS fixture's `app.version`.
            version: "test".to_owned(),
            prompt: args.prompt.clone(),
            new_session_id: args.new_session_id.clone().map(SessionID),
            session,
            fork: args.fork,
            agent: args.agent.clone(),
            model: args.model.clone(),
            ..Args::default()
        },
    );
    // The Rust twins of the TS test plugins under parity/plugins, which the Rust TUI lists as skipped (P.1).
    if recording
        .env
        .get("OPENCODE_PARITY_PLUGIN")
        .is_some_and(|plugin| plugin == "slot")
    {
        opencode_tui::plugins::host::add(&tui, slot_plugin());
    }

    let mut passed = true;
    let mut report = String::new();
    for step in &recording.steps {
        match step {
            Step::Keys { keys } => keys.iter().for_each(|key| app.press(key)),
            Step::Type { text } => app.type_text(text),
            Step::Click { click } => app.click(click[0], click[1]),
            Step::Event { event } => memory.emit(event),
            Step::Drag { drag: [from, to] } => app.drag((from[0], from[1]), (to[0], to[1])),
            Step::Checkpoint(checkpoint) => {
                let capture = settle(&app, &memory, checkpoint.until.as_deref());
                let result = match app::compare_checkpoint(checkpoint, capture) {
                    Ok(result) => result,
                    Err(error) => {
                        passed = false;
                        let _ = writeln!(report, "  {}: {error}", checkpoint.checkpoint);
                        continue;
                    }
                };
                let (ok, line) = verdict(result.comparison.is_equal(), &checkpoint.deviation);
                passed &= ok;
                if result.comparison.is_equal() {
                    let _ = writeln!(report, "  checkpoint {}: {line}", checkpoint.checkpoint);
                    continue;
                }
                let path = std::env::temp_dir()
                    .join("opencode-parity")
                    .join(format!("{}.json", checkpoint.fixture));
                let written = path
                    .parent()
                    .map_or(Ok(()), std::fs::create_dir_all)
                    .and_then(|()| std::fs::write(&path, &result.actual));
                let full = result.comparison.to_string();
                let summary = full.lines().next().unwrap_or_default();
                let _ = writeln!(
                    report,
                    "  checkpoint {}: {summary}; {line}",
                    checkpoint.checkpoint
                );
                // An allowed difference prints its summary only, unless PARITY_VERBOSE is set.
                if !ok || std::env::var_os("PARITY_VERBOSE").is_some() {
                    let _ = writeln!(report, "{}", indent(&full));
                }
                if written.is_ok() {
                    let _ = writeln!(report, "    actual cells: {}", path.display());
                }
            }
        }
    }

    let log = memory.requests();
    let all: Vec<Sent> = log.iter().map(sent).collect();
    let unmatched: Vec<Sent> = log
        .iter()
        .filter(|logged| logged.unmatched)
        .map(sent)
        .collect();
    let requests = app::compare_requests(recording, &all, &unmatched);
    let deviation: Vec<String> = recording.deviation.iter().cloned().collect();
    let (ok, line) = verdict(requests.is_equal(), &deviation);
    passed &= ok;
    let _ = writeln!(report, "  requests: {line}");
    if let Some(writes) = &requests.writes_differ {
        let _ = writeln!(report, "{}", indent(writes));
    }
    for request in &requests.unmatched {
        let _ = writeln!(report, "    missing from the recording: {request}");
    }
    if !requests.not_sent.is_empty() {
        let _ = writeln!(
            report,
            "    TS reads the Rust TUI does not send ({}): {}",
            requests.not_sent.len(),
            requests.not_sent.join(", ")
        );
    }
    drop(tui);
    (passed, report)
}

/// `parity/plugins/slot/tui.tsx`: one line appended to `home.footer`.
fn slot_plugin() -> Definition<Tui> {
    Definition::new("parity.slot", |cx: &mut Setup<'_, Tui>| {
        cx.slot(Placement::append(slot::HOME_FOOTER), |tui, _| {
            let app = &tui.app;
            Box::new(
                View::new(app)
                    .padding_edge(Edge::Left, 2)
                    .child(&Text::new(app, "slot plugin: home.footer").fg(tui.page().text.muted)),
            )
        });
    })
}

/// The scenario routes first, then each recorded read by its exact query, then by path alone.
fn routes(recording: &Recording) -> Vec<MemoryRoute> {
    let scenario = recording.routes.iter().map(|route| {
        let method = route.method.as_deref().unwrap_or("GET");
        let status = route
            .status
            .unwrap_or(if route.json.is_some() || route.body.is_some() {
                200
            } else {
                204
            });
        match (&route.json, &route.body) {
            (Some(json), _) => MemoryRoute::json(method, &route.path, status, json),
            (None, Some(body)) => MemoryRoute::body(
                method,
                &route.path,
                status,
                Some(
                    route
                        .headers
                        .get("content-type")
                        .map_or("text/plain", String::as_str),
                ),
                body.clone(),
            ),
            (None, None) => MemoryRoute::body(method, &route.path, status, None, ""),
        }
    });
    let recorded = |entry: &app::Exchange| match (&entry.json, &entry.text) {
        (Some(json), _) => MemoryRoute::json(&entry.method, &entry.path, entry.status, json),
        (None, text) => MemoryRoute::body(
            &entry.method,
            &entry.path,
            entry.status,
            entry.content_type.as_deref(),
            text.clone().unwrap_or_default(),
        ),
    };
    let exchanges = || {
        recording
            .requests
            .reads
            .iter()
            .chain(&recording.requests.writes)
    };
    scenario
        .chain(exchanges().map(|entry| recorded(entry).with_query(entry.query.clone())))
        .chain(exchanges().map(recorded))
        .collect()
}

/// Waits for `until` (bounded by [`UNTIL`]), then until no request is in flight and two renders 25 ms apart
/// are equal (bounded by [`SETTLE`]).
fn settle(app: &TestApp, memory: &Memory, until: Option<&str>) -> Fixture {
    if let Some(until) = until {
        app.wait_until(UNTIL, || {
            memory.in_flight() == 0 && app.text().contains(until)
        });
    }
    let deadline = Instant::now() + SETTLE;
    let mut previous = None;
    loop {
        app.wait_until(Duration::from_millis(25), || false);
        let capture = Fixture::from_capture(&app.render());
        if memory.in_flight() == 0 && previous.as_ref() == Some(&capture)
            || Instant::now() >= deadline
        {
            return capture;
        }
        previous = Some(capture);
    }
}

/// Whether a comparison passes, and the line that says why.
fn verdict(equal: bool, deviation: &[String]) -> (bool, String) {
    let missing: Vec<&String> = deviation
        .iter()
        .filter(|name| !app::deviation_exists(name))
        .collect();
    if !missing.is_empty() {
        return (false, format!("deviation files missing: {missing:?}"));
    }
    match (equal, deviation.is_empty()) {
        (true, true) => (true, "equal".to_owned()),
        (true, false) => (true, format!("equal; remove the deviations {deviation:?}")),
        (false, false) => (true, format!("differs, allowed by {deviation:?}")),
        (false, true) => (false, "differs".to_owned()),
    }
}

fn sent(logged: &opencode_api::memory::Logged) -> Sent {
    Sent {
        method: logged.method.clone(),
        path: logged.path.clone(),
        query: logged.query.clone(),
        body: logged.body.clone(),
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
