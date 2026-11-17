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
use opencode_local::paths::Paths;
use opencode_parity::Fixture;
use opencode_parity::app::{self, Recording, Sent, Step};
use opencode_plugin::abi::{self, Node, Placement, Render, Span};
use opencode_plugin::slot;
use opencode_tui::{Args, Deps, Route};
use opentui::prelude::*;
use opentui::testing::TestApp;

/// How long a checkpoint waits for its `until` text. Longer than any MS1 screen takes; a screen the Rust TUI
/// does not draw yet is compared after this.
const UNTIL: Duration = Duration::from_secs(2);
/// How long a checkpoint waits for the client to go idle and the frame to settle on the recorded cells. Only a frame
/// that never matches waits this long.
const SETTLE: Duration = Duration::from_secs(10);

#[test]
fn scenarios() {
    let only = std::env::var("PARITY_SCENARIO").ok();
    let recordings = Recording::all(only.as_deref()).unwrap_or_else(|error| panic!("{error}"));
    assert!(!recordings.is_empty(), "no P-APP recording matches {only:?}");
    // The built-ins' own screens (E.14) run on both carriers (P6a): with Rust values, and through the C ABI's byte
    // shims. `PARITY_CARRIER=both` runs every selected scenario on both.
    let both = std::env::var("PARITY_CARRIER").is_ok_and(|carrier| carrier == "both");
    let mut failed = Vec::new();
    for recording in &recordings {
        // An npm scenario runs its packages on the JS host, so without bun it is skipped, as the JS host's own rows are
        // (`OPENCODE_RS_REQUIRE_TS=1` makes a missing bun fail instead).
        let npm = recording.env.get("OPENCODE_PARITY_PLUGIN").is_some_and(|plugin| plugin == "npm");
        #[cfg(feature = "ts")]
        if npm && crate::plugin_pipe::bun().is_none() {
            eprintln!("skip {} (no bun)", recording.scenario);
            continue;
        }
        // A build without the `ts` feature has no JS host to run them on (ts-feature).
        #[cfg(not(feature = "ts"))]
        if npm {
            eprintln!("skip {} (built without the ts feature)", recording.scenario);
            continue;
        }
        let carriers: &[bool] = match both || recording.scenario.starts_with("E.14/") {
            true => &[false, true],
            false => &[false],
        };
        for &abi in carriers {
            let (passed, report) = run(recording, abi, None);
            let name = format!("{}{}", recording.scenario, if abi { " (C ABI)" } else { "" });
            eprintln!("{} {name}\n{report}", if passed { "ok  " } else { "FAIL" });
            if !passed {
                failed.push(name);
            }
        }
    }
    assert!(failed.is_empty(), "P-APP scenarios failed: {failed:?} (reports above)");
}

/// The ports trio (`ports_trio.rs`): the published packages of the P.8 recordings that have ports, by scenario, and
/// the port each is swapped for.
const PORTS: [(&str, &str); 7] = [
    ("P.8/sidebar-tokens", "sidebar-tokens"),
    ("P.8/sidebar-prompt", "sidebar-prompt"),
    ("P.8/session-usage", "session-usage"),
    ("P.8/subagents", "subagents-sidebar"),
    ("P.8/force-input", "force-input"),
    ("P.8/context-grid", "context-grid"),
    ("P.8/command-hotkeys", "command-hotkeys"),
];

/// What a recording's published package is swapped for: its native port's library, or its Luau port.
#[derive(Clone, Copy, Debug)]
enum Swap {
    Native(&'static str),
    #[cfg(feature = "luau")]
    Luau(&'static str),
}

// Expected (ports trio): each port, native and in Luau, in place of the published package TS ran, draws the cells of
// each of TS's checkpoints and sends TS's requests, as the package itself does on the JS host (`scenarios`).
#[test]
fn ports_replay_the_ts_recordings() {
    let mut failed = Vec::new();
    for (scenario, port) in PORTS {
        let recordings = Recording::all(Some(scenario)).unwrap_or_else(|error| panic!("{error}"));
        let recording = recordings.iter().find(|recording| recording.scenario == scenario).expect(scenario);
        #[cfg_attr(not(feature = "luau"), allow(unused_mut))]
        let mut swaps = vec![Swap::Native(port)];
        #[cfg(feature = "luau")]
        swaps.push(Swap::Luau(port));
        for swap in swaps {
            let (passed, report) = run(recording, false, Some(swap));
            let name = format!("{scenario} as {swap:?}");
            eprintln!("{} {name}\n{report}", if passed { "ok  " } else { "FAIL" });
            if !passed {
                failed.push(name);
            }
        }
    }
    assert!(failed.is_empty(), "ports differ from TS's recordings: {failed:?} (reports above)");
}

/// Runs one recording, with the built-ins on the C ABI's byte shims when `abi`, and its published package swapped for
/// `swap`; returns whether it passed and its report.
fn run(recording: &Recording, abi: bool, swap: Option<Swap>) -> (bool, String) {
    let memory = Memory::new(routes(recording));
    let app = TestApp::new(recording.width, recording.height);
    let npm = swap.is_none() && recording.env.get("OPENCODE_PARITY_PLUGIN").is_some_and(|plugin| plugin == "npm");
    let swapped = swap.map(swapped);
    #[cfg(feature = "ts")]
    let config_text = match (&swapped, npm) {
        (Some((_, dir)), _) => swap_config(&recording.config, dir),
        (None, true) => npm_config(&recording.config),
        (None, false) => recording.config.to_string(),
    };
    #[cfg(not(feature = "ts"))]
    let config_text = {
        // An npm scenario is skipped before it runs in such a build; a port swapped in for its package is not.
        let _ = npm;
        match &swapped {
            Some((_, dir)) => swap_config(&recording.config, dir),
            None => recording.config.to_string(),
        }
    };
    let config = cli_config::decode_text(&config_text).unwrap_or_default();
    #[cfg(feature = "ts")]
    let cache = (!recording.cache.is_empty()).then(|| cache(&recording.cache));
    #[cfg(not(feature = "ts"))]
    let cache: Option<opencode_util::temp::TempDir> = None;
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
            abi_builtins: abi,
            // The TS fixture's roots are a temporary directory's; its cache is the scenario's npm cache.
            roots: cache.as_ref().and_then(|cache| {
                support::roots(Paths { cache: cache.path().to_owned(), ..support::paths(cache.path()) }, "test")
            }),
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
    match recording.env.get("OPENCODE_PARITY_PLUGIN").map(String::as_str) {
        Some("slot") => opencode_tui::plugins::host::add(&tui, slot_plugin().into()),
        Some("app") => opencode_tui::plugins::host::add(&tui, app_plugin().into()),
        Some("p0a") => opencode_tui::plugins::host::add(&tui, p0a_plugin().into()),
        Some("p0b") => opencode_tui::plugins::host::add(&tui, p0b_plugin().into()),
        Some("fence-margin") => opencode_tui::plugins::host::add(&tui, fence_margin_plugin().into()),
        Some("fence") => opencode_tui::plugins::host::add(&tui, fence_plugin().into()),
        _ => {}
    }
    // P8: the published packages the scenario names, unmodified, on the JS host.
    #[cfg(feature = "ts")]
    let _plugins = npm.then(|| {
        let bun = crate::plugin_pipe::bun().expect("an npm scenario needs bun (OPENCODE_BUN or bun on the path)");
        let config = opencode_plugin::pipe::Config {
            version: "test".to_owned(),
            channel: "test".to_owned(),
            ..opencode_plugin::pipe::Config::new(bun)
        };
        let root = opencode_util::temp::tempdir().expect("plugin root");
        // The user's global opencode config names the scenario's cached packages, as a TS server plugin's TUI part
        // loads without approval only then in Rust (O-162); TS asks for none.
        let user: Vec<&String> = recording.cache.keys().collect();
        std::fs::create_dir_all(root.path().join("config")).expect("config directory");
        let global = serde_json::json!({ "plugins": user }).to_string();
        std::fs::write(root.path().join("config").join("opencode.json"), global).expect("the global opencode config");
        let external = opencode_tui::plugins::host::External {
            config_dir: root.path().join("config"),
            cwd: root.path().to_path_buf(),
            dev: Vec::new(),
        };
        opencode_tui::plugins::host::external_with(&tui, external, Some(config));
        root
    });
    // Ports trio: the port, which the loader loads from where the swapped entry names it.
    if let Some((root, _)) = &swapped {
        let external = opencode_tui::plugins::host::External {
            config_dir: root.path().join("config"),
            cwd: root.path().to_path_buf(),
            dev: Vec::new(),
        };
        opencode_tui::plugins::host::external(&tui, external);
    }
    // The editor context's sources (E.5): the fake IDE server and the Zed database the TS side had.
    let ide = recording.ide.as_ref().map(|_| ide::Ide::start());
    let zed = recording.zed.as_ref().map(|zed| {
        let directory = opencode_util::temp::tempdir().expect("zed directory");
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
            Step::Release { release } => memory.release(release),
            Step::Wait { wait } => {
                // As long on the app's clock as in real time, as the TS recorder's `Bun.sleep` lets its timers run.
                app.wait_until(Duration::from_millis(*wait), || false);
                app.advance(Duration::from_millis(*wait));
            }
            Step::Drag { drag: [from, to] } => app.drag((from[0], from[1]), (to[0], to[1])),
            Step::Ide { ide: message } => {
                let ide = ide.as_ref().expect("an ide step needs `ide` in the scenario");
                app.wait_until(UNTIL, || ide.initialized());
                ide.send(message);
            }
            // The recorded socket sends what the step made the TS fake send.
            Step::Pty { .. } => {}
            Step::Checkpoint(checkpoint) => {
                let capture = settle(&app, &|| memory.in_flight(), checkpoint.until.as_deref(), |capture| {
                    app::compare_checkpoint(checkpoint, capture.clone()).is_ok_and(|result| {
                        result.comparison.is_equal() || app::allows(&checkpoint.deviation, &result.comparison)
                    })
                });
                let result = match app::compare_checkpoint(checkpoint, capture) {
                    Ok(result) => result,
                    Err(error) => {
                        passed = false;
                        let _ = writeln!(report, "  {}: {error}", checkpoint.checkpoint);
                        continue;
                    }
                };
                let files: Vec<String> = checkpoint.deviation.iter().map(|entry| entry.file.clone()).collect();
                let allowed = app::allows(&checkpoint.deviation, &result.comparison);
                let (ok, line) = verdict(result.comparison.is_equal(), allowed, &files);
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

    // A write a last key starts can come after the last checkpoint, as the recorder's stays open past it: a JS plugin's
    // declined Enter goes on once the JS host answered, and the prompt goes then (CT-19). Wait, at most `UNTIL`, until as
    // many writes went as TS sent.
    let writes = || memory.requests().iter().filter(|logged| !app::is_read(&logged.method, &logged.path)).count();
    let deadline = Instant::now() + SETTLE;
    while !(memory.in_flight() == 0 && writes() >= recording.requests.writes.len()) && Instant::now() < deadline {
        app.wait_until(Duration::from_millis(25), || false);
        app.advance(Duration::from_millis(25));
    }
    let log = memory.requests();
    let all: Vec<Sent> = log.iter().map(sent).collect();
    let unmatched: Vec<Sent> = log.iter().filter(|logged| logged.unmatched).map(sent).collect();
    let requests = app::compare_requests(recording, &all, &unmatched);
    let deviation: Vec<String> = recording.deviation.iter().cloned().collect();
    let (ok, line) = verdict(requests.is_equal(), !deviation.is_empty(), &deviation);
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
        let (ok, line) = verdict(handshake(expected) == handshake(&ide.received.lock().unwrap()), false, &[]);
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
    // A plugin that failed says why, which the frames only show as its toast.
    for entry in tui.plugins.entries() {
        if let opencode_plugin::Status::Failed(error) = &entry.status {
            let _ = writeln!(report, "  plugin {} failed: {error}", entry.id);
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
                        let Some(frame) = remote.sent.recv().await else { return };
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
fn slot_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        for path in [slot::HOME_FOOTER, slot::SESSION_COMPOSER_TOP] {
            // TS pads the left edge only; the line is short, so the right edge's padding shows nothing.
            let node = Node::column(vec![Node::text([Span::new(format!("slot plugin: {path}"))]).fg("text.muted")]);
            setup.slot(Placement::append(path), move |_, _, _| Render::Show(node.clone().padding(2, 0)));
        }
        Ok(())
    }
    abi::Plugin { id: "parity.slot", setup }
}

/// `parity/plugins/app/tui.tsx`: one line appended to `app`.
fn app_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let node = Node::column(vec![Node::text([Span::new("app plugin: app")]).fg("text.muted")]);
        setup.slot(Placement::append(slot::APP), move |_, _, _| Render::Show(node.clone().padding(2, 0)));
        Ok(())
    }
    abi::Plugin { id: "parity.app", setup }
}

/// `parity/plugins/fence/tui.tsx`, as a renderer claim of `parity` fences (Pr): each line of the fence after a label.
fn fence_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.claim(abi::claim::Claim::fence("parity", |_, part| {
            let abi::claim::Part::Fence(fence) = part else { return None };
            let lines = fence.code.lines().filter(|line| !line.is_empty()).map(|line| format!("fence plugin: {line}"));
            Some(abi::v2::Node::text([Span::new(lines.collect::<Vec<_>>().join("\n"))]).fg("text.muted"))
        }));
        Ok(())
    }
    abi::Plugin { id: "parity.fence", setup }
}

/// `parity/plugins/p0a/tui.tsx`: F6 asks a confirm, F7 shows an alert, F8 inserts into the composer, F9 sets it, and
/// the probe's styled box is appended to `home.footer`.
fn p0a_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let command = |name: &str, key: Option<&str>| {
            abi::Command::default().with_name(name.to_owned()).with_keybind(key.map(str::to_owned))
        };
        let then = |name: &str| abi::Action::Command { name: name.to_owned(), input: None };
        setup.command(command("parity.p0a.confirm", Some("f6")), move |host, _| {
            host.dialog(abi::Dialog::Confirm(abi::Confirm {
                size: None,
                centered: false,
                title: "Delete the draft?".to_owned(),
                message: "It cannot be undone.".to_owned(),
                label: abi::ConfirmLabel { confirm: Some("delete".to_owned()), cancel: Some("keep".to_owned()) },
                action: then("parity.p0a.answered"),
            }));
        });
        setup.command(command("parity.p0a.answered", None), |host, input| {
            host.toast(abi::Toast::new(abi::Variant::Info, format!("answered {}", input.unwrap_or_default())));
        });
        setup.command(command("parity.p0a.alert", Some("f7")), move |host, _| {
            host.dialog(abi::Dialog::Alert(abi::Alert {
                size: None,
                centered: false,
                title: "Heads up".to_owned(),
                message: "The plugin says hello.".to_owned(),
                action: Some(then("parity.p0a.closed")),
            }));
        });
        setup.command(command("parity.p0a.closed", None), |host, _| {
            host.toast(abi::Toast::new(abi::Variant::Info, "alert closed"));
        });
        setup.command(command("parity.p0a.insert", Some("f8")), |host, _| {
            host.edit_composer(abi::ComposerEdit::Insert { text: "inserted".to_owned() });
        });
        setup.command(command("parity.p0a.set", Some("f9")), |host, _| {
            host.edit_composer(abi::ComposerEdit::Set { text: "set by the plugin".to_owned() });
        });
        setup.slot(Placement::append(slot::HOME_FOOTER), |_, _, _| Render::Show(crate::plugin_p0a::probe::styled()));
        Ok(())
    }
    abi::Plugin { id: "parity.p0a", setup }
}

/// `parity/plugins/p0b/tui.tsx`: one line appended to `app` that shows what the reads of ABI 1.6 answer.
fn p0b_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.slot(Placement::append(slot::APP), |read, input, _| {
            let line = [
                format!("p0b: w{}", input.width),
                format!("tabs {} {}", read.tabs_enabled(), read.tabs().len()),
                format!("keys {}", read.shortcuts("command.palette.show").join(",")),
                format!("variants {}", read.variants().len()),
                format!("pending {}", read.keymap_pending().len()),
            ]
            .join(" ");
            let node = Node::column(vec![Node::text([Span::new(line)]).fg("text.muted")]);
            Render::Show(node.padding(2, 0))
        });
        setup.sized(Placement::append(slot::APP));
        Ok(())
    }
    abi::Plugin { id: "parity.p0b", setup }
}

/// `parity/plugins/fence-margin/tui.tsx`: `parity` fences drawn as `fence: <code>` in TS `TextRenderable`'s white.
fn fence_margin_plugin() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.code_block("parity", |_, fence| abi::Fenced::Lines {
            lines: vec![vec![Span::new(format!("fence: {}", fence.code))]],
            fg: Some(abi::Color::Rgba(abi::Rgba::new(255, 255, 255, 255))),
            drag: false,
        });
        Ok(())
    }
    abi::Plugin { id: "parity.fence-margin", setup }
}

/// P8: the recording's config with each `plugins` entry `./out/npm/node_modules/<name>` unpacked there from the
/// published tarball `parity/plugins/npm/<name>.tgz` (a scope's `/` as `__`), as the TS recorder does, and named by its
/// absolute path: the TS side resolved it against the parity directory, its working directory. An entry
/// `./plugins/<name>` is that directory of the parity tree, by its absolute path.
#[cfg(feature = "ts")]
fn npm_config(config: &serde_json::Value) -> String {
    const PREFIX: &str = "./out/npm/node_modules/";
    let parity = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("parity");
    let mut config = config.clone();
    let entries = config.get_mut("plugins").and_then(serde_json::Value::as_array_mut).into_iter().flatten();
    for entry in entries {
        let target = match entry {
            serde_json::Value::String(target) => target,
            serde_json::Value::Object(map) => match map.get_mut("package") {
                Some(serde_json::Value::String(target)) => target,
                _ => continue,
            },
            _ => continue,
        };
        // A local V2 plugin under parity/plugins runs on the JS host too, as TS loads it from there (FT-12).
        if target.starts_with("./plugins/") {
            let local = target.split('/').skip(1).fold(parity.clone(), |path, part| path.join(part));
            *target = local.to_string_lossy().into_owned();
            continue;
        }
        let Some(name) = target.strip_prefix(PREFIX).map(str::to_owned) else { continue };
        let into = parity.join(&target[2..]);
        let _ = std::fs::remove_dir_all(&into);
        std::fs::create_dir_all(&into).expect("the npm package's directory");
        let tarball = parity.join("plugins/npm").join(format!("{}.tgz", name.replace('/', "__")));
        crate::ports::pinned(&tarball);
        let status = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(&tarball)
            .arg("-C")
            .arg(&into)
            .arg("--strip-components=1")
            .status()
            .expect("tar");
        assert!(status.success(), "cannot unpack {}", tarball.display());
        *target = into.to_string_lossy().into_owned();
    }
    config.to_string()
}

/// A directory holding `swap`'s port, as a plugin directory a `plugins` entry names: a native library, or a Luau plugin
/// with Luau plugins on; and the directory.
fn swapped(swap: Swap) -> (opencode_util::temp::TempDir, std::path::PathBuf) {
    let root = opencode_util::temp::tempdir().expect("port root");
    std::fs::create_dir_all(root.path().join("config")).expect("config directory");
    let dir = match swap {
        Swap::Native(name) => {
            let dir = root.path().join(name);
            std::fs::create_dir_all(&dir).expect("the port's directory");
            std::fs::write(dir.join(opencode_plugin::loader::entry_file()), crate::ports::build(name))
                .expect("library");
            dir
        }
        #[cfg(feature = "luau")]
        Swap::Luau(name) => {
            opencode_plugin::luau::enable();
            let dir = root.path().join(format!("{name}.luau"));
            let examples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/luau");
            crate::plugin_pipe::copy(&examples.join(name), &dir);
            dir
        }
    };
    (root, dir)
}

/// The recording's config with each `plugins` entry naming `dir`, the port, and keeping its options.
fn swap_config(config: &serde_json::Value, dir: &std::path::Path) -> String {
    let mut config = config.clone();
    let target = serde_json::Value::String(dir.to_string_lossy().into_owned());
    for entry in config.get_mut("plugins").and_then(serde_json::Value::as_array_mut).into_iter().flatten() {
        match entry {
            serde_json::Value::Object(map) => drop(map.insert("package".to_owned(), target.clone())),
            entry => *entry = target.clone(),
        }
    }
    config.to_string()
}

/// js-npm: an npm cache in a temporary directory holding each package of `packages` (spec to tarball name) as TS's
/// `Npm.add` leaves it, as the TS recorder lays it out (`npmCache` in parity/app/scenarios.test.tsx).
#[cfg(feature = "ts")]
fn cache(packages: &BTreeMap<String, String>) -> opencode_util::temp::TempDir {
    let cache = opencode_util::temp::tempdir().expect("npm cache");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    for (spec, name) in packages {
        let generation =
            cache.path().join("npm").join(opencode_plugin::loader::npm::cache_key(spec)).join(now.to_string());
        let version = spec.rsplit_once('@').map_or(spec.as_str(), |(_, version)| version);
        std::fs::create_dir_all(&generation).expect("the generation");
        let manifest = serde_json::json!({ "dependencies": { name: version } });
        std::fs::write(generation.join("package.json"), manifest.to_string()).expect("the generation's package.json");
        crate::ports::unpack(name, &generation.join("node_modules").join(name));
    }
    cache
}

/// The scenario routes first, then each recorded read by its exact query, then by path alone.
fn routes(recording: &Recording) -> Vec<MemoryRoute> {
    let scenario = recording.routes.iter().map(|route| {
        let method = route.method.as_deref().unwrap_or("GET");
        let status = route
            .status
            .unwrap_or(if route.json.is_some() || route.body.is_some() || route.base64.is_some() { 200 } else { 204 });
        let served = match (&route.json, &route.body) {
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
        };
        let served = match &route.query {
            Some(query) => served.with_query(query.clone()),
            None => served,
        };
        if route.hold { served.held() } else { served }
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

/// Waits for `until` (bounded by [`UNTIL`]), then until nothing is in flight (`in_flight`), two renders 25 ms apart are
/// equal, and the frame is `expected` (bounded by [`SETTLE`]). A frame can stay still before a read that changes it
/// has even been sent, so stillness alone is not enough. Each 25 ms passes on the app's manual clock too: the TS
/// recorder's settle lets real time pass, 30 ms a poll, three polls at least, and its timers run in it, such as the
/// 50 ms poll by which the open list follows its prompt (flakes-10). A frozen clock left a list opened before its prompt
/// laid out one row tall.
pub(crate) fn settle(
    app: &TestApp,
    in_flight: &dyn Fn() -> usize,
    until: Option<&str>,
    expected: impl Fn(&Fixture) -> bool,
) -> Fixture {
    if let Some(until) = until {
        app.wait_until(UNTIL, || in_flight() == 0 && app.text().contains(until));
    }
    let deadline = Instant::now() + SETTLE;
    let mut previous = None;
    loop {
        app.wait_until(Duration::from_millis(25), || false);
        app.advance(Duration::from_millis(25));
        let capture = Fixture::from_capture(&app.render());
        let still = in_flight() == 0 && previous.as_ref() == Some(&capture);
        if still && expected(&capture) || Instant::now() >= deadline {
            return capture;
        }
        previous = Some(capture);
    }
}

/// Whether a comparison passes, and the line that says why. `allowed`: the deviations allow the difference.
fn verdict(equal: bool, allowed: bool, deviation: &[String]) -> (bool, String) {
    let missing: Vec<&String> = deviation.iter().filter(|name| !app::deviation_exists(name)).collect();
    if !missing.is_empty() {
        return (false, format!("deviation files missing: {missing:?}"));
    }
    match (equal, deviation.is_empty(), allowed) {
        (true, true, _) => (true, "equal".to_owned()),
        (true, false, _) => (true, format!("equal; remove the deviations {deviation:?}")),
        (false, true, _) => (false, "differs".to_owned()),
        (false, false, true) => (true, format!("differs, allowed by {deviation:?}")),
        (false, false, false) => (false, format!("differs beyond {deviation:?}")),
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
