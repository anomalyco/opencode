//! P-APP, Rust side (H.2, `docs/H.2.md`): replays every recording under `parity/fixtures/*/*.app.json`
//! through the whole Rust TUI in a `TestApp`, over the in-memory transport, and compares each checkpoint's
//! cells and the requests with what the TS TUI did. `PARITY_SCENARIO=<step>/<name>` selects one scenario.

use crate::support::{self, ide};

use std::collections::BTreeMap;
use std::fmt::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_api::pty;
use opencode_local::cli_config;
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
    assert!(!recordings.is_empty(), "no P-APP recording matches {only:?}");
    let mut failed = Vec::new();
    for recording in &recordings {
        let (passed, report) = run(recording);
        eprintln!("{} {}\n{report}", if passed { "ok  " } else { "FAIL" }, recording.scenario);
        if !passed {
            failed.push(recording.scenario.clone());
        }
    }
    assert!(failed.is_empty(), "P-APP scenarios failed: {failed:?} (reports above)");
}

/// Runs one recording; returns whether it passed and its report.
fn run(recording: &Recording) -> (bool, String) {
    let memory = Memory::new(routes(recording));
    let app = TestApp::new(recording.width, recording.height);
    let config = cli_config::decode_text(&recording.config.to_string()).unwrap_or_default();
    let args = &recording.args;
    // TS opens `sessionID` unless it forks it (`app.tsx:680-686`).
    let session = args.session_id.clone().map(SessionID);
    let tui = opencode_tui::mount_with(
        &app,
        Deps {
            directory: recording.directory.clone(),
            config: support::config(config),
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
            ..support::deps(Arc::new(memory.clone()))
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
            auto: args.auto,
            ..Args::default()
        },
    );
    // The Rust twins of the TS test plugins under parity/plugins, which the Rust TUI lists as skipped (P.1).
    if recording.env.get("OPENCODE_PARITY_PLUGIN").is_some_and(|plugin| plugin == "slot") {
        opencode_tui::plugins::host::add(&tui, slot_plugin());
    }
    // The editor context's sources (E.5): the fake IDE server and the Zed database the TS side had.
    let ide = recording.ide.as_ref().map(|_| ide::Ide::start());
    let zed = recording.zed.as_ref().map(|zed| {
        let directory = tempfile::tempdir().expect("zed directory");
        let db = directory.path().join("db.sqlite");
        opencode_tui::prompt::editor_context::zed::exec(&db, &zed.sql).expect("zed database");
        (directory, db)
    });
    if ide.is_some() || zed.is_some() {
        opencode_tui::prompt::editor_context::start(
            &tui,
            opencode_tui::prompt::editor_context::Source {
                port: ide.as_ref().map(|ide| ide.port),
                zed_terminal: zed.is_some(),
                zed_db: zed.iter().map(|(_, db)| db.clone()).collect(),
                ..Default::default()
            },
        );
    }
    let sockets = Arc::new(Sockets::new(recording));
    tui.terminals.set_connector(sockets.clone());

    let mut passed = true;
    let mut report = String::new();
    for (index, step) in recording.steps.iter().enumerate() {
        sockets.step.store(index, Ordering::SeqCst);
        match step {
            Step::Keys { keys } => keys.iter().for_each(|key| app.press(key)),
            Step::Type { text } => app.type_text(text),
            Step::Paste { paste } => app.paste(paste),
            Step::Click { click } => app.click(click[0], click[1]),
            Step::RightClick { right_click: [x, y] } => {
                app.mouse(MouseEventKind::Down(MouseButton::Right), *x, *y);
                app.mouse(MouseEventKind::Up(MouseButton::Right), *x, *y);
            }
            Step::Event { event } => memory.emit(event),
            Step::Drag { drag: [from, to] } => app.drag((from[0], from[1]), (to[0], to[1])),
            Step::Ide { ide: message } => {
                let ide = ide.as_ref().expect("an ide step needs `ide` in the scenario");
                app.wait_until(UNTIL, || ide.initialized());
                ide.send(message);
            }
            // The recorded socket sends what the step made the TS fake send.
            Step::Pty { .. } => {}
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
                let path = std::env::temp_dir().join("opencode-parity").join(format!("{}.json", checkpoint.fixture));
                let written = path
                    .parent()
                    .map_or(Ok(()), std::fs::create_dir_all)
                    .and_then(|()| std::fs::write(&path, &result.actual));
                let full = result.comparison.to_string();
                let summary = full.lines().next().unwrap_or_default();
                let _ = writeln!(report, "  checkpoint {}: {summary}; {line}", checkpoint.checkpoint);
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
    let unmatched: Vec<Sent> = log.iter().filter(|logged| logged.unmatched).map(sent).collect();
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
    if let (Some(expected), Some(ide)) = (&recording.ide, &ide) {
        let (ok, line) = verdict(handshake(expected) == handshake(&ide.received.lock().unwrap()), &[]);
        passed &= ok;
        let _ = writeln!(report, "  ide: {line}");
    }
    if !recording.sockets.is_empty() {
        let opened = sockets.opened.lock().unwrap().clone();
        let sent: Vec<Vec<Vec<u8>>> = sockets.sent.iter().map(|frames| frames.lock().unwrap().clone()).collect();
        match app::compare_sockets(recording, &opened, &sent) {
            Ok(()) => {
                let _ = writeln!(report, "  sockets: equal");
            }
            Err(differences) => {
                passed = false;
                let _ = writeln!(report, "  sockets: differ\n{}", indent(&differences));
            }
        }
    }
    drop(tui);
    (passed, report)
}

/// What a client sent the IDE server, each message once and without its request ID: TS connects again when
/// the session's directory differs from its working directory, which the Rust runner's does not.
fn handshake(messages: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut unique: Vec<serde_json::Value> = Vec::new();
    for message in messages {
        let mut message = message.clone();
        if let Some(object) = message.as_object_mut() {
            object.remove("id");
        }
        if !unique.contains(&message) {
            unique.push(message);
        }
    }
    unique
}

/// Replays the recorded fake PTY sockets (E.13a): each socket sends the TS fake's messages once the scenario reached
/// the same step and the TUI sent as many frames, and keeps the frames the TUI sent.
struct Sockets {
    recorded: Vec<app::SocketRecording>,
    step: Arc<AtomicUsize>,
    opened: Mutex<Vec<(String, BTreeMap<String, String>)>>,
    sent: Vec<Arc<Mutex<Vec<Vec<u8>>>>>,
}

impl Sockets {
    fn new(recording: &Recording) -> Self {
        Self {
            recorded: recording.sockets.clone(),
            step: Arc::default(),
            opened: Mutex::default(),
            sent: recording.sockets.iter().map(|_| Arc::default()).collect(),
        }
    }
}

impl pty::Connector for Sockets {
    fn open(&self, url: url::Url) -> pty::BoxFuture<Result<pty::Socket, String>> {
        let query = url
            .query_pairs()
            .map(|(key, value)| {
                let value = if key == "attachment_id" { "<attachment>".to_owned() } else { value.into_owned() };
                (key.into_owned(), value)
            })
            .collect();
        let index = {
            let mut opened = self.opened.lock().unwrap();
            opened.push((url.path().to_owned(), query));
            opened.len() - 1
        };
        let Some(recorded) = self.recorded.get(index).cloned() else {
            return Box::pin(async { Err("no recorded socket".to_owned()) });
        };
        let (socket, mut remote) = pty::pair();
        let step = self.step.clone();
        let sent = self.sent[index].clone();
        Box::pin(async move {
            tokio::spawn(async move {
                for received in recorded.received {
                    while sent.lock().unwrap().len() < received.after {
                        let Some(frame) = remote.sent.recv().await else {
                            return;
                        };
                        sent.lock().unwrap().push(frame);
                    }
                    while step.load(Ordering::SeqCst) < received.step {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                    let message = match received.message {
                        app::SocketMessage::Text { text } => pty::Incoming::Text(text),
                        app::SocketMessage::Binary { binary } => pty::Incoming::Binary(
                            base64::engine::general_purpose::STANDARD.decode(binary).unwrap_or_default(),
                        ),
                        app::SocketMessage::Close { .. } => pty::Incoming::Closed,
                    };
                    if remote.deliver.send(message).await.is_err() {
                        return;
                    }
                }
                while let Some(frame) = remote.sent.recv().await {
                    sent.lock().unwrap().push(frame);
                }
            });
            Ok(socket)
        })
    }
}

/// `parity/plugins/slot/tui.tsx`: one line appended to `home.footer`, and one to `session.composer.top`.
fn slot_plugin() -> Definition<Tui> {
    Definition::new("parity.slot", |cx: &mut Setup<'_, Tui>| {
        for path in [slot::HOME_FOOTER, slot::SESSION_COMPOSER_TOP] {
            cx.slot(Placement::append(path), move |tui, _| {
                let app = &tui.app;
                Box::new(
                    View::new(app)
                        .padding_edge(Edge::Left, 2)
                        .child(&Text::new(app, format!("slot plugin: {path}")).fg(tui.page().text.muted)),
                )
            });
        }
    })
}

/// The scenario routes first, then each recorded read by its exact query, then by path alone.
fn routes(recording: &Recording) -> Vec<MemoryRoute> {
    let scenario = recording.routes.iter().map(|route| {
        let method = route.method.as_deref().unwrap_or("GET");
        let status = route
            .status
            .unwrap_or(if route.json.is_some() || route.body.is_some() || route.base64.is_some() { 200 } else { 204 });
        match (&route.json, &route.body) {
            (Some(json), _) => MemoryRoute::json(method, &route.path, status, json),
            (None, None) if let Some(bytes) = &route.base64 => MemoryRoute::body(
                method,
                &route.path,
                status,
                Some(route.headers.get("content-type").map_or("application/octet-stream", String::as_str)),
                base64::engine::general_purpose::STANDARD.decode(bytes).expect("a base64 route body"),
            ),
            (None, Some(body)) => MemoryRoute::body(
                method,
                &route.path,
                status,
                Some(route.headers.get("content-type").map_or("text/plain", String::as_str)),
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
    let exchanges = || recording.requests.reads.iter().chain(&recording.requests.writes);
    scenario
        .chain(exchanges().map(|entry| recorded(entry).with_query(entry.query.clone())))
        .chain(exchanges().map(recorded))
        .collect()
}

/// Waits for `until` (bounded by [`UNTIL`]), then until no request is in flight and two renders 25 ms apart
/// are equal (bounded by [`SETTLE`]).
fn settle(app: &TestApp, memory: &Memory, until: Option<&str>) -> Fixture {
    if let Some(until) = until {
        app.wait_until(UNTIL, || memory.in_flight() == 0 && app.text().contains(until));
    }
    let deadline = Instant::now() + SETTLE;
    let mut previous = None;
    loop {
        app.wait_until(Duration::from_millis(25), || false);
        let capture = Fixture::from_capture(&app.render());
        if memory.in_flight() == 0 && previous.as_ref() == Some(&capture) || Instant::now() >= deadline {
            return capture;
        }
        previous = Some(capture);
    }
}

/// Whether a comparison passes, and the line that says why.
fn verdict(equal: bool, deviation: &[String]) -> (bool, String) {
    let missing: Vec<&String> = deviation.iter().filter(|name| !app::deviation_exists(name)).collect();
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
    text.lines().map(|line| format!("    {line}")).collect::<Vec<_>>().join("\n")
}
