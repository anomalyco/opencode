//! Run pinned, published JavaScript plugins unmodified against the TUI and a fake server.

use crate::support::{self, DIRECTORY, Harness, Log, Reply, Seen, deref_harness};

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::memory::Memory;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
#[cfg(native)]
use opencode_plugin::abi;
use opencode_plugin::loader::entry_file;
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// The example plugin `name` (`crates/plugin/examples/<name>`), built once per test run.
pub(crate) fn build(name: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, library)) = built.iter().find(|(known, _)| known == name) {
        return library.clone();
    }
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples");
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/sample-plugin");
    // A release test run, as the measures run, builds the plugin in release too.
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(examples.join(name).join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .args((profile == "release").then_some("--release"))
        .status()
        .unwrap();
    assert!(status.success(), "the {name} plugin did not build");
    let file =
        format!("{}opencode_{}{}", std::env::consts::DLL_PREFIX, name.replace('-', "_"), std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join(profile).join(file)).unwrap();
    built.push((name.to_owned(), library.clone()));
    library
}

type Handler = Arc<dyn Fn(&Seen) -> Option<Reply> + Send + Sync>;

/// Holds the next `/interrupt` request before the server sees it, until its sender sends or drops.
type Hold = Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>;

/// A fake server: `/api/event` from `events`, everything else from `handler`, else [`support::base`]; it logs each
/// request but the event stream.
#[derive(Clone)]
struct Server {
    events: Memory,
    log: Log,
    handler: Handler,
    hold: Hold,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.url.path() == "/api/event" {
            return self.events.send(request);
        }
        if request.url.path().ends_with("/interrupt")
            && let Some(held) = self.hold.lock().unwrap().take()
        {
            let server = self.clone();
            return Box::pin(async move {
                let _ = held.await;
                server.send(request).await
            });
        }
        let seen = Seen {
            method: request.method.to_owned(),
            path: request.url.path().to_owned(),
            query: request.url.query().unwrap_or_default().to_owned(),
            body: request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null),
            headers: request.headers.clone(),
        };
        self.log.lock().unwrap().push(seen.clone());
        // `ses_p` exists unless the handler says otherwise: a session the server lacks closes again.
        let parent = (seen.method == "GET" && seen.path == "/api/session/ses_p")
            .then(|| (200, json!({ "data": session("ses_p", "Parent", None, 1) })));
        let (status, body) = (self.handler)(&seen).or(parent).unwrap_or_else(|| support::base(&seen, DIRECTORY));
        Box::pin(async move { Ok(support::respond(status, &body)) })
    }
}

pub(crate) struct Port {
    harness: Harness,
    pub(crate) events: Memory,
    pub(crate) log: Log,
    hold: Hold,
    _root: opencode_util::temp::TempDir,
}

deref_harness!(Port);

/// Example library or pinned package to load into the test TUI.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Carrier<'a> {
    #[cfg_attr(not(native), allow(dead_code))]
    Example(&'a str),
    Npm(&'a str),
}

/// Unpacks the published package `name` from its tarball into `into`.
pub(crate) fn unpack(name: &str, into: &Path) {
    let tarball = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/plugins/npm")
        .join(format!("{}.tgz", name.replace('/', "__")));
    pinned(&tarball);
    std::fs::create_dir_all(into).unwrap();
    let status =
        Command::new("tar").arg("-xzf").arg(&tarball).arg("-C").arg(into).arg("--strip-components=1").status().unwrap();
    assert!(status.success(), "cannot unpack {}", tarball.display());
}

/// Verify the package tarball against its pinned SHA-512 before extraction.
pub(crate) fn pinned(tarball: &Path) {
    use base64::Engine;
    let pins: Value =
        serde_json::from_slice(&std::fs::read(tarball.with_file_name("integrity.json")).unwrap()).unwrap();
    let name = tarball.file_name().unwrap().to_string_lossy();
    let digest = ring::digest::digest(&ring::digest::SHA512, &std::fs::read(tarball).unwrap());
    let actual = format!("sha512-{}", base64::engine::general_purpose::STANDARD.encode(digest.as_ref()));
    assert_eq!(pins[name.as_ref()].as_str(), Some(actual.as_str()), "{name} is not the pinned tarball");
}

/// The TUI on `first`, or on session `ses_p`, with each of `carriers`' plugins in `<config>/plugins`, over `handler`,
/// with real TUI storage in the temp directory when `stored`; `None` without Bun for a package.
pub(crate) fn open_as(
    carriers: &[Carrier<'_>],
    width: u16,
    handler: impl Fn(&Seen) -> Option<Reply> + Send + Sync + 'static,
    stored: bool,
    first: Option<Route>,
) -> Option<Port> {
    let scripts = match carriers.iter().any(|carrier| matches!(carrier, Carrier::Npm(_))) {
        true => Some(crate::plugin_pipe::config()?),
        false => None,
    };
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    for carrier in carriers {
        match *carrier {
            Carrier::Example(name) => {
                let plugin = config.join("plugins").join(name);
                std::fs::create_dir_all(&plugin).unwrap();
                std::fs::write(plugin.join(entry_file()), build(name)).unwrap();
            }
            Carrier::Npm(name) => unpack(name, &config.join("plugins").join(name.replace('/', "__"))),
        }
    }
    let server = Server {
        events: Memory::new(Vec::new()),
        log: Log::default(),
        handler: Arc::new(handler),
        hold: Hold::default(),
    };
    let deps = Deps {
        config: support::config(support::still()),
        route: first.unwrap_or_else(|| support::session_route("ses_p")),
        events: true,
        roots: stored.then(|| support::roots(support::home_paths(&root.path().join("home")), "test")).flatten(),
        ..support::deps(Arc::new(server.clone()))
    };
    let harness = support::mount(width, 40, deps);
    // The budget is not what these rows check. On the wall clock a loaded machine's stall in a call (memory reclaim,
    // swap), which is no wait on a run queue, is charged: one over the overrun fails the plugin. A call here takes no
    // time.
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    let external = External { config_dir: config, cwd: root.path().to_path_buf(), dev: Vec::new() };
    match scripts {
        Some(scripts) => external_with(&harness.tui, external, Some(scripts)),
        None => opencode_tui::plugins::host::external(&harness.tui, external),
    }
    Some(Port { harness, events: server.events, log: server.log, hold: server.hold, _root: root })
}

impl Port {
    /// Lets what the input started finish: the JS host's answers when it runs, then a few frames.
    pub(crate) fn settle(&self) {
        let scripts = self.tui.plugins.scripts.borrow().clone();
        match scripts {
            Some(scripts) => crate::plugin_pipe::settle(&self.harness, &scripts),
            None => (0..5).for_each(|_| self.app.advance(std::time::Duration::from_millis(16))),
        }
    }

    /// The interrupts and prompts the server saw, in order.
    pub(crate) fn wire(&self) -> Vec<String> {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|seen| {
                seen.method == "POST" && (seen.path.ends_with("/interrupt") || seen.path.ends_with("/prompt"))
            })
            .map(|seen| format!("{} {}", seen.method, seen.path))
            .collect()
    }

    /// The rows of the sidebar, right of column `from`, trimmed, without blank rows.
    pub(crate) fn sidebar(&self, from: usize) -> Vec<String> {
        self.app
            .text()
            .lines()
            .map(|line| line.chars().skip(from).collect::<String>().trim().to_owned())
            .filter(|line| !line.is_empty())
            .collect()
    }

    /// The foreground of the cell `offset` cells right of where `needle` starts.
    pub(crate) fn fg(&self, needle: &str, offset: u16) -> opentui::prelude::Color {
        let (x, y) = self.find(needle);
        self.app.render().cell(u32::from(x + offset), u32::from(y)).unwrap().fg
    }

    /// The requests to `path`, as `METHOD path?query`.
    pub(crate) fn sent(&self, path: &str) -> Vec<String> {
        let log = self.log.lock().unwrap();
        log.iter()
            .filter(|seen| seen.path.starts_with(path))
            .map(|seen| format!("{} {}", seen.method, seen.url()))
            .collect()
    }
}

pub(crate) fn session(id: &str, title: &str, parent: Option<&str>, updated: u64) -> Value {
    let session = support::merge(support::session(id, title), json!({ "agent": "build", "parentID": parent }));
    support::merge(session, json!({ "time": { "created": 1, "updated": updated } }))
}

/// `/api/session/active` with `running`.
pub(crate) fn active(running: &[&str]) -> Reply {
    let data: serde_json::Map<String, Value> =
        running.iter().map(|id| ((*id).to_owned(), json!({ "type": "running" }))).collect();
    (200, json!({ "data": data }))
}

// --- opencode-subagents-sidebar

/// Twelve children of `ses_p` in shuffled update order, `ses_c03` and `ses_c07` running, `ses_c05` untitled; a
/// running grandchild under `ses_c01` and an unrelated root, which are no direct children.
pub(crate) fn family() -> Vec<Value> {
    let mut sessions = vec![session("ses_p", "Parent", None, 1), session("ses_x", "Other root", None, 2)];
    for index in 1..=12u64 {
        let title = if index == 5 { String::new() } else { format!("Child {index:02}") };
        sessions.push(session(&format!("ses_c{index:02}"), &title, Some("ses_p"), 100 + (index * 7) % 12));
    }
    sessions.push(session("ses_g", "Grandchild", Some("ses_c01"), 999));
    sessions
}

pub(crate) fn subagents(seen: &Seen) -> Option<Reply> {
    let sessions = family();
    let list = |parent: Option<&str>| {
        let data: Vec<&Value> = sessions.iter().filter(|session| session["parentID"].as_str() == parent).collect();
        (200, json!({ "data": data, "cursor": {} }))
    };
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/active") => Some(active(&["ses_c03", "ses_c07", "ses_g"])),
        ("GET", "/api/session") => {
            let parent = seen.param("parentID");
            Some(list((!parent.is_empty()).then_some(parent.as_str())))
        }
        ("GET", path) if path.ends_with("/inbox") => Some((200, json!({ "data": [] }))),
        ("GET", path) if path.ends_with("/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", path) => {
            let id = path.strip_prefix("/api/session/")?;
            let session = sessions.iter().find(|session| session["id"] == id)?;
            Some((200, json!({ "data": session })))
        }
        _ => None,
    }
}

/// Direct children sorted by descending update time.
pub(crate) fn by_update() -> Vec<(String, String, &'static str)> {
    let mut children: Vec<(u64, String, String, &str)> = (1..=12u64)
        .map(|index| {
            let title = if index == 5 { "Subagent".to_owned() } else { format!("Child {index:02}") };
            let state = if index == 3 || index == 7 { "running" } else { "done" };
            (100 + (index * 7) % 12, format!("ses_c{index:02}"), title, state)
        })
        .collect();
    children.sort_by_key(|child| std::cmp::Reverse(child.0));
    children.into_iter().map(|(_, id, title, state)| (id, title, state)).collect()
}

#[test]
fn the_published_subagents_sidebar_lists_and_picks() {
    let Some(h) = open_as(&[Carrier::Npm("opencode-subagents-sidebar")], 170, subagents, false, None) else { return };
    h.wait_for("+2 more");
    h.wait("Child 03 runs", || {
        h.sidebar(120).iter().any(|row| row.starts_with("• Child 03") && row.ends_with(" running"))
    });
    let rows = h.sidebar(120);
    let start = rows.iter().position(|row| row == "▼ Subagents").unwrap_or_else(|| panic!("{rows:#?}"));
    let listed: Vec<(String, String)> = rows[start + 1..start + 11]
        .iter()
        .map(|row| {
            let (title, state) = row.rsplit_once(' ').unwrap();
            (title.trim().to_owned(), state.to_owned())
        })
        .collect();
    let expected: Vec<(String, String)> =
        by_update().into_iter().take(10).map(|(_, title, state)| (format!("• {title}"), state.to_owned())).collect();
    assert_eq!(listed, expected, "{rows:#?}");
    assert_eq!(rows[start + 11], "+2 more");
    let theme = h.tui.page();
    assert_eq!(h.fg("• Child 03", 0), theme.text.feedback.success.base);
    assert_eq!(h.fg("• Child 04", 0), theme.text.muted);
    let (last, title, _) = by_update().pop().unwrap();
    h.tui.keymap.dispatch("subagents-sidebar.pick", None);
    h.wait_for("Child 12");
    h.app.type_text(&title);
    h.wait("the filtered list", || h.app.text().lines().filter(|line| line.contains(&title)).count() >= 2);
    h.app.press("return");
    let session = Route::Session { id: opencode_api::generated::SessionID(last) };
    h.wait("the pick opens its child", || h.tui.route() == session);
}

#[test]
fn the_published_subagents_sidebar_opens_a_clicked_row_and_stores_the_fold() {
    let Some(h) = open_as(&[Carrier::Npm("opencode-subagents-sidebar")], 170, subagents, true, None) else { return };
    h.wait_for("+2 more");
    let (first, title, _) = &by_update()[0];
    let (x, y) = h.find(&format!("• {title}"));
    h.app.click(x + 2, y);
    let child = Route::Session { id: opencode_api::generated::SessionID(first.clone()) };
    h.wait("the click opens the child", || h.tui.route() == child);
    h.tui.navigate(support::session_route("ses_p"));
    h.wait_for("+2 more");
    let storage = h.tui.storage().unwrap();
    let stored = || storage.load("plugin.subagents-sidebar.view", &Value::Null).unwrap();
    assert_eq!(stored(), Value::Null);
    let (x, y) = h.find("▼ Subagents");
    h.app.click(x + 2, y);
    h.wait("the fold reaches the disk", || stored() == json!({ "open": false }));
}

#[test]
fn quick_folds_each_land_and_keep_a_field_another_client_stored() {
    let Some(h) = open_as(&[Carrier::Npm("opencode-subagents-sidebar")], 170, subagents, true, None) else { return };
    h.wait_for("+2 more");
    let storage = h.tui.storage().unwrap();
    let file = storage.file("plugin.subagents-sidebar.view").unwrap();
    opencode_local::storage::write_json_atomic(&file, &json!({ "open": true, "sibling": 99 })).unwrap();
    let stored = || storage.load("plugin.subagents-sidebar.view", &Value::Null).unwrap();
    let (x, y) = h.find("Subagents");
    h.app.click(x, y);
    h.app.click(x, y);
    h.settle();
    // Both folds reach the disk in their time; a lost one leaves `open` false, which never matches.
    h.wait("both folds reach the disk", || {
        h.app.advance(std::time::Duration::from_millis(1));
        stored() == json!({ "open": true, "sibling": 99 })
    });
    h.app.click(x, y);
    h.wait("the third fold reaches the disk", || stored() == json!({ "open": false, "sibling": 99 }));
}

// --- opencode-sidebar-prompt

#[test]
fn the_published_sidebar_prompt_shows_a_queued_prompt() {
    let queued = json!({
        "id": "msg_3", "sessionID": "ses_p", "type": "user", "time": { "created": 3000 }, "delivery": "queue",
        "payload": { "text": "Then tag the release and announce it in the changelog channel." },
    });
    let handler = move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Release", None, 3) }))),
        ("GET", "/api/session") => Some((200, json!({ "data": [session("ses_p", "Release", None, 3)], "cursor": {} }))),
        ("GET", "/api/session/ses_p/message") => Some((
            200,
            json!({ "data": [{ "id": "msg_1", "type": "user", "text": "Write the release notes.", "time": { "created": 1000 } }], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p/inbox") => Some((200, json!({ "data": [queued.clone()] }))),
        _ => None,
    };
    let Some(h) = open_as(&[Carrier::Npm("opencode-sidebar-prompt")], 140, handler, false, None) else { return };
    let rows = || h.sidebar(100).into_iter().skip_while(|row| row != "Last prompt").take(4).collect::<Vec<_>>();
    h.wait("the sidebar shows a prompt", || rows().len() == 4);
    assert_eq!(
        rows(),
        [
            "Last prompt",
            "Then tag the release and announce it",
            "in the changelog channel.",
            "Open full prompt · /lastprompt"
        ]
    );
}

// --- @mynameistito/opencode-force-input

const FORCE_INPUT: &str = "@mynameistito/opencode-force-input";

pub(crate) fn running(seen: &Seen) -> Option<Reply> {
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/active") => Some(active(&["ses_p"])),
        ("GET", "/api/session") => Some((
            200,
            json!({ "data": [session("ses_p", "Busy", None, 1), session("ses_q", "Calm", None, 1)], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Busy", None, 1) }))),
        ("GET", "/api/session/ses_q") => Some((200, json!({ "data": session("ses_q", "Calm", None, 1) }))),
        ("GET", path) if path.ends_with("/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("POST", path) if path.ends_with("/interrupt") => Some((200, json!({}))),
        _ => None,
    }
}

#[test]
fn the_published_force_input_interrupts_then_sends() {
    let Some(h) = open_as(&[Carrier::Npm(FORCE_INPUT)], 120, running, false, None) else {
        return;
    };
    h.wait("the hint", || h.app.text().contains("⏎ "));
    h.app.type_text("hello");
    h.app.press("ctrl+return");
    h.wait("the prompt is sent", || !h.sent("/api/session/ses_p/prompt").is_empty());
    assert_eq!(h.wire(), ["POST /api/session/ses_p/interrupt", "POST /api/session/ses_p/prompt"]);
    let log = h.log.lock().unwrap();
    let prompts: Vec<&Value> =
        log.iter().filter(|seen| seen.path.ends_with("/prompt")).map(|seen| &seen.body).collect();
    assert_eq!(prompts.len(), 1, "{prompts:?}");
    assert_eq!(prompts[0]["text"], "hello", "ctrl+enter added no newline");
}

#[test]
fn a_prompt_waits_for_every_earlier_interrupt_of_its_session() {
    let Some(h) = open_as(&[Carrier::Npm(FORCE_INPUT)], 120, running, false, None) else { return };
    h.wait("the hint", || h.app.text().contains("⏎ "));
    let (release, held) = tokio::sync::oneshot::channel();
    *h.hold.lock().unwrap() = Some(held);
    h.app.press("escape");
    h.app.type_text("hello");
    h.app.press("ctrl+return");
    let early = h.app.wait_until(Duration::from_millis(300), || !h.sent("/api/session/ses_p/prompt").is_empty());
    assert!(!early, "{:?}", h.wire());
    release.send(()).unwrap();
    h.wait("the prompt is sent", || !h.sent("/api/session/ses_p/prompt").is_empty());
    let interrupt = "POST /api/session/ses_p/interrupt";
    assert_eq!(h.wire(), [interrupt, interrupt, "POST /api/session/ses_p/prompt"]);
}

#[test]
fn a_prompt_waits_for_an_interrupt_sent_from_an_earlier_composer() {
    let Some(h) = open_as(&[Carrier::Npm(FORCE_INPUT)], 120, running, false, None) else { return };
    h.wait("the hint", || h.app.text().contains("⏎ "));
    let (release, held) = tokio::sync::oneshot::channel();
    *h.hold.lock().unwrap() = Some(held);
    h.app.press("escape");
    h.app.press("escape");
    h.tui.navigate(support::session_route("ses_q"));
    h.wait_for("⏎ send");
    h.tui.navigate(support::session_route("ses_p"));
    h.wait_for("⏎ steer");
    h.app.type_text("hello");
    h.app.press("return");
    let early = h.app.wait_until(Duration::from_millis(300), || !h.sent("/api/session/ses_p/prompt").is_empty());
    assert!(!early, "{:?}", h.wire());
    release.send(()).unwrap();
    h.wait("the prompt is sent", || !h.sent("/api/session/ses_p/prompt").is_empty());
    assert_eq!(h.wire(), ["POST /api/session/ses_p/interrupt", "POST /api/session/ses_p/prompt"]);
}

#[test]
fn a_slash_command_waits_for_a_pending_interrupt() {
    let Some(h) = open_as(&[Carrier::Npm(FORCE_INPUT)], 120, running, false, None) else { return };
    h.wait("the hint", || h.app.text().contains("⏎ "));
    let (release, held) = tokio::sync::oneshot::channel();
    *h.hold.lock().unwrap() = Some(held);
    h.app.press("escape");
    h.app.press("escape");
    h.app.type_text("/btw why");
    h.wait_for("/btw why");
    h.app.press("return");
    h.wait("the composer clears", || h.text().is_empty());
    let early = h.app.wait_until(Duration::from_millis(300), || !h.sent("/api/session/ses_p/generate").is_empty());
    assert!(!early, "{:?}", h.wire());
    release.send(()).unwrap();
    h.wait("both are sent", || {
        h.sent("/api/session/ses_p/interrupt").len() + h.sent("/api/session/ses_p/generate").len() == 2
    });
    let order: Vec<String> = h
        .log
        .lock()
        .unwrap()
        .iter()
        .filter(|seen| seen.path.ends_with("/interrupt") || seen.path.ends_with("/generate"))
        .map(|seen| seen.path.clone())
        .collect();
    assert_eq!(order, ["/api/session/ses_p/interrupt", "/api/session/ses_p/generate"]);
}

#[test]
fn a_slash_command_picked_from_the_popup_or_the_palette_waits_for_a_pending_interrupt() {
    use opencode_ui::keymap::COMMAND_PALETTE_COMMAND;

    let Some(h) = open_as(&[Carrier::Npm(FORCE_INPUT)], 120, running, false, None) else { return };
    h.wait("the hint", || h.app.text().contains("⏎ "));
    let order = || -> Vec<String> {
        h.log
            .lock()
            .unwrap()
            .iter()
            .filter(|seen| seen.path.ends_with("/interrupt") || seen.path.contains("compact"))
            .map(|seen| seen.path.rsplit('/').next().unwrap().to_owned())
            .collect()
    };
    let interrupt_then = |pick: &dyn Fn()| {
        let (release, held) = tokio::sync::oneshot::channel();
        *h.hold.lock().unwrap() = Some(held);
        let count = order().len();
        h.app.press("escape");
        h.app.press("escape");
        pick();
        let early = h.app.wait_until(Duration::from_millis(300), || order().len() > count);
        assert!(!early, "{:?}", order());
        release.send(()).unwrap();
        h.wait("both are sent", || order().len() == count + 2);
    };
    interrupt_then(&|| {
        h.app.type_text("/compact");
        h.wait_for("Compact session");
        h.app.press("return");
        h.wait("the popup runs it", || h.text().is_empty());
    });
    interrupt_then(&|| {
        h.tui.keymap.dispatch(COMMAND_PALETTE_COMMAND, None);
        h.wait_for("Search commands");
        h.app.type_text("compact session");
        h.wait_for("Compact session");
        h.app.press("return");
        h.wait_gone("Search commands");
    });
    assert_eq!(order(), ["interrupt", "compact", "interrupt", "compact"]);
}

// --- opencode-session-usage

/// `count` assistant messages of `cost` each, `tokens` input tokens each, on model `p/m`.
fn assistant(prefix: &str, count: usize, cost: f64, tokens: u64) -> Vec<Value> {
    (0..count)
        .map(|index| {
            json!({
                "id": format!("msg_{prefix}{index:03}"), "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": { "created": 1000 + index },
                "content": [], "cost": cost,
                "tokens": { "input": tokens, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            })
        })
        .collect()
}

/// A page of `messages`, a hundred at most, after `cursor`.
fn page(messages: &[Value], cursor: &str) -> Reply {
    let start = cursor.strip_prefix("page").and_then(|start| start.parse().ok()).unwrap_or(0);
    let end = (start + 100).min(messages.len());
    let next = (end < messages.len()).then(|| format!("page{end}"));
    (200, json!({ "data": messages[start..end], "cursor": { "next": next } }))
}

/// The model `p/m` at $1 per million input tokens.
fn priced_model() -> Value {
    support::merge(
        support::model("p", "m", "Model M"),
        json!({ "cost": [{ "input": 1, "output": 2, "cache": { "read": 0, "write": 0 } }] }),
    )
}

/// `ses_p` has 150 messages at $0.01 reported, over two pages; its child `ses_c` reports nothing, so it is priced from
/// the catalog: one message of a million input tokens, and a second once `grown` is set. With `paged`, `ses_p`'s
/// children come on a second page, after an empty first one.
pub(crate) fn usage(grown: Arc<Mutex<bool>>, paged: bool) -> impl Fn(&Seen) -> Option<Reply> + Send + Sync {
    let resets = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
        + (4 * 24 + 9) * 3_600_000
        + 1_800_000;
    move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session") => {
            let (data, next) = match (seen.param("parentID").as_str(), seen.param("cursor").as_str()) {
                ("", _) => (vec![session("ses_p", "Tree", None, 1)], None),
                ("ses_p", "") if paged => (Vec::new(), Some("more")),
                ("ses_p", _) => (vec![session("ses_c", "Child", Some("ses_p"), 2)], None),
                _ => (Vec::new(), None),
            };
            Some((200, json!({ "data": data, "cursor": { "next": next } })))
        }
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Tree", None, 1) }))),
        ("GET", "/api/session/ses_c") => Some((200, json!({ "data": session("ses_c", "Child", Some("ses_p"), 2) }))),
        ("GET", "/api/session/ses_p/message") => Some(page(&assistant("p", 150, 0.01, 10), &seen.param("cursor"))),
        ("GET", "/api/session/ses_c/message") => {
            let count = if *grown.lock().unwrap() { 2 } else { 1 };
            Some(page(&assistant("c", count, 0.0, 1_000_000), &seen.param("cursor")))
        }
        ("GET", "/api/model") => Some((200, support::list(DIRECTORY, json!([priced_model()])))),
        ("GET", "/api/experimental/usage/limits") => Some((
            200,
            json!({
                "location": { "directory": DIRECTORY },
                "data": {
                    "workspace": { "id": "wrk", "name": "Work" }, "budgets": [],
                    "go": {
                        "rolling": { "percent": 2.4, "limited": false, "resetsAt": resets },
                        "weekly": { "percent": 75, "limited": false, "resetsAt": resets },
                        "monthly": { "percent": 12, "limited": true, "resetsAt": resets },
                    },
                },
            }),
        )),
        _ => None,
    }
}

#[test]
fn the_published_session_usage_totals_the_paged_history_and_follows_usage_events() {
    let grown = Arc::new(Mutex::new(false));
    let Some(h) = open_as(&[Carrier::Npm("opencode-session-usage")], 170, usage(grown.clone(), false), false, None)
    else {
        return;
    };
    h.wait_for("≈ $2.50 session total");
    let pages = h.sent("/api/session/ses_p/message");
    assert!(pages.contains(&"GET /api/session/ses_p/message?limit=100&cursor=page100".to_owned()), "{pages:#?}");
    let rows: Vec<String> =
        h.app.text().lines().map(|line| line.chars().skip(120).collect::<String>().trim().to_owned()).collect();
    let start = rows.iter().position(|row| row == "Usage").unwrap_or_else(|| panic!("{rows:#?}"));
    assert_eq!(
        rows[start..start + 11],
        [
            "Usage",
            "≈ $2.50 session total",
            "",
            "Rolling   2% used · resets 4d 9h",
            &format!("━{}", "─".repeat(21)),
            "",
            "Weekly   75% used · resets 4d 9h",
            &format!("{}{}", "━".repeat(17), "─".repeat(5)),
            "",
            "Monthly  12% used · resets 4d 9h",
            &format!("{}{}", "━".repeat(3), "─".repeat(19)),
        ],
        "{rows:#?}"
    );
    let theme = h.tui.page();
    for (label, color) in [
        ("2% used", theme.text.feedback.success.base),
        ("75% used", theme.text.feedback.warning.base),
        ("12% used", theme.text.feedback.error.base),
    ] {
        assert_eq!(h.fg(label, 0), color, "{label}");
    }

    *grown.lock().unwrap() = true;
    h.events.emit(&json!({
        "id": "evt_usage", "created": 2, "type": "session.usage.updated",
        "location": { "directory": DIRECTORY },
        "data": { "sessionID": "ses_c", "cost": 0, "tokens": { "input": 2_000_000, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
    }));
    h.wait_for("≈ $3.50 session total");
}

#[test]
fn the_published_session_usage_asks_for_the_sessions_location_first() {
    let base = usage(Arc::new(Mutex::new(false)), false);
    let elsewhere = |value: Value| support::merge(value, json!({ "location": { "directory": "/elsewhere" } }));
    let handler = move |seen: &Seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": elsewhere(session("ses_p", "Tree", None, 1)) }))),
        ("GET", "/api/session") if seen.param("parentID").is_empty() => {
            Some((200, json!({ "data": [elsewhere(session("ses_p", "Tree", None, 1))], "cursor": {} })))
        }
        _ => base(seen),
    };
    let Some(h) = open_as(&[Carrier::Npm("opencode-session-usage")], 170, handler, false, None) else { return };
    h.wait_for("≈ $2.50 session total");
    let limits = h.sent("/api/experimental/usage/limits");
    assert!(limits.first().is_some_and(|first| first.contains("location%5Bdirectory%5D=%2Felsewhere")), "{limits:#?}");
}

#[test]
fn published_slots_draw_again_after_the_js_host_restarts() {
    let carriers = [Carrier::Npm("opencode-session-usage"), Carrier::Npm("opencode-sidebar-tokens")];
    let Some(h) = open_as(&carriers, 170, usage(Arc::new(Mutex::new(false)), false), false, None) else { return };
    h.wait_for_all(&["≈ $2.50 session total", "Session tokens"]);
    let scripts = h.tui.plugins.scripts.borrow().clone().unwrap();
    // A killed JS host that was still running a plugin's view or handler fails that plugin ("… ended the JS host"),
    // and nothing sets it up again: the panels' own reads land a frame after they show, so the kill can catch one.
    // Settle first: the end is nobody's, and only the restart is left to explain what draws again.
    h.settle();
    let pid = scripts.pid();
    scripts.kill();
    h.wait("a new JS host", || {
        h.app.advance(std::time::Duration::from_millis(1));
        scripts.pid().is_some_and(|now| Some(now) != pid)
    });
    h.settle();
    // A restart that failed a plugin never draws it again, whatever the wait: name that, not the missing text.
    let failed: Vec<String> = h
        .tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| matches!(entry.status, opencode_plugin::Status::Failed(_)))
        .map(|entry| format!("{} {:?}", entry.id, entry.status))
        .collect();
    assert!(failed.is_empty(), "a plugin failed across the restart: {failed:#?}");
    h.wait_for_all(&["≈ $2.50 session total", "Session tokens"]);
}

#[test]
fn the_published_sidebar_tokens_follows_the_sessions_totals() {
    let Some(h) = open_as(&[Carrier::Npm("opencode-sidebar-tokens")], 170, |_| None, false, None) else { return };
    h.wait_for("Session tokens");
    h.events.emit(&json!({
        "id": "evt_usage", "created": 2, "type": "session.usage.updated",
        "location": { "directory": DIRECTORY },
        "data": { "sessionID": "ses_p", "cost": 0.08, "tokens": { "input": 22_870, "output": 100, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
    }));
    h.wait_for("22,870");
    let rows = h.sidebar(120);
    let start = rows.iter().position(|row| row == "Session tokens").unwrap_or_else(|| panic!("{rows:#?}"));
    // The values align at the far edge of the 37-column sidebar.
    let spaced = |label: &str, value: &str| format!("{label}{}{value}", " ".repeat(37 - label.len() - value.len()));
    assert_eq!(
        rows[start..start + 5],
        [
            "Session tokens".to_owned(),
            spaced("Input", "22,870"),
            spaced("Output", "100"),
            spaced("Cache read", "0"),
            spaced("Cache write", "0")
        ],
        "{rows:#?}"
    );
}

#[test]
fn the_published_session_usage_pages_the_children_one_parent_at_a_time() {
    let handler = usage(Arc::new(Mutex::new(false)), true);
    let Some(h) = open_as(&[Carrier::Npm("opencode-session-usage")], 170, handler, false, None) else { return };
    h.wait_for("≈ $2.50 session total");
    let log = h.log.lock().unwrap();
    let cursors: Vec<String> = log
        .iter()
        // The host's own list of the family asks for 200 at a time.
        .filter(|seen| seen.path == "/api/session" && seen.param("parentID") == "ses_p" && seen.param("limit") == "100")
        .map(|seen| seen.param("cursor"))
        .collect();
    assert_eq!(cursors, ["", "more"]);
}

// Expected: the author's fixture loads into the TUI: its sidebar counter shows and counts a click, and its toast follows
// a finished session.
#[test]
#[cfg(native)]
fn the_author_fixture_counts_and_toasts_a_finished_session() {
    let h = open_as(&[Carrier::Example("author")], 170, |_| None, false, None).unwrap();
    h.wait_for("Counted 0");
    let (x, y) = h.find("Counted 0");
    h.app.click(x, y);
    h.wait_for("Counted 1");
    h.events.emit(&json!({
        "id": "evt_done", "created": 2, "type": "session.execution.succeeded",
        "durable": { "aggregateID": "ses_p", "seq": 1, "version": 1 },
        "location": { "directory": DIRECTORY }, "data": { "sessionID": "ses_p" },
    }));
    h.wait_for("A session finished");
}

// --- Dialog::Select on both paths

#[cfg(native)]
fn picking(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("probe.pick"), |host, _| {
        let option = |title: &str, value: &str| abi::SelectOption::new(title, value);
        host.dialog(abi::Dialog::Select(
            abi::Select::new(
                "Pick one".to_owned(),
                vec![
                    option("Alpha", "a").description("first"),
                    option("Beta", "b").footer("2nd"),
                    option("Gamma", "c"),
                ],
                abi::Action::command("probe.picked"),
            )
            .placeholder("Search picks")
            .current("b"),
        ));
    });
    setup.command(command("probe.picked"), |host, input| {
        host.toast(abi::Toast::new(abi::Variant::Info, format!("picked {}", input.unwrap_or("nothing"))));
    });
    Ok(())
}

/// The select's cells as it opens, and the toast after a move down and enter.
#[cfg(native)]
fn picked(loopback: bool) -> (Vec<opentui::testing::Cell>, String) {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let definition = match loopback {
        true => {
            crate::support::loopback(
                &opencode_tui::plugins::host::host(&h.tui),
                crate::support::loopback_entries!("probe", picking),
            )
            .unwrap()
            .0
        }
        false => abi::Plugin { id: "probe", setup: picking }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h.tui.keymap.dispatch("probe.pick", None);
    h.wait_for("Pick one");
    let cells = h.app.render().cells;
    h.app.press("down");
    h.app.press("return");
    let screen = h.wait_for("picked ");
    h.wait_gone("Pick one");
    let toast = screen.lines().find(|line| line.contains("picked ")).unwrap().trim().to_owned();
    (cells, toast)
}

// Expected: a plugin's select opens on its current option, lists the options with their description and footer, and
// picking one closes it and runs the action with the value as its input; the same cells and pick through the C ABI's
// byte shims (`Loopback`).
#[test]
#[cfg(native)]
fn a_select_dialog_picks_the_same_through_the_c_abi_loopback() {
    let direct = picked(false);
    assert!(direct.1.contains("picked c"), "{}", direct.1);
    assert!(picked(true) == direct, "the loopback draws or picks otherwise");
}
