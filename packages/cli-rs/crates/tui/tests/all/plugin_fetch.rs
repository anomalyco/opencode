//! `/stats` and `/btw` on the one plugin API (O-67): their requests go through the plugin's `fetch` and come back to
//! `on_reply`; the stats route and its escape, the `/btw` prompt, live answer panel and pending spinner, a reply after a
//! disable, a moved service, and the stats route through the C ABI's byte shims (`Loopback`).

use crate::support::{self, DIRECTORY, Harness, Seen};

use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Auth;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// Where requests go now, as the managed service's transport reroutes them: an origin and a password.
type Endpoint = Arc<Mutex<(String, String)>>;

/// A server that answers the stats and `session.generate`, holding each generate until [`Server::release`], and
/// sends each request to the current [`Endpoint`], as `Follow` does after the service restarts.
#[derive(Clone)]
struct Server {
    log: Arc<Mutex<Vec<(Seen, String)>>>,
    gate: Arc<tokio::sync::Semaphore>,
    endpoint: Endpoint,
}

impl Server {
    fn new(open: bool) -> Self {
        let gate = Arc::new(tokio::sync::Semaphore::new(if open { 1000 } else { 0 }));
        let endpoint = Arc::new(Mutex::new(("http://127.0.0.1:4096".to_owned(), "old".to_owned())));
        Self { log: Arc::default(), gate, endpoint }
    }

    fn release(&self) {
        self.gate.add_permits(1);
    }

    /// The requests to `path`, with the URL each went to.
    fn sent(&self, path: &str) -> Vec<(Seen, String)> {
        self.log.lock().unwrap().iter().filter(|(seen, _)| seen.path.ends_with(path)).cloned().collect()
    }
}

impl Transport for Server {
    fn send(&self, mut request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let (origin, password) = self.endpoint.lock().unwrap().clone();
        let url = format!("{origin}{}", &request.url[url::Position::BeforePath..]);
        request.headers.retain(|(name, _)| name != "authorization");
        request.headers.push(("authorization".into(), format!("Basic {}", Auth::password(password).token())));
        let seen = Seen {
            method: request.method.to_owned(),
            path: request.url.path().to_owned(),
            query: request.url.query().unwrap_or_default().to_owned(),
            body: request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null),
            headers: request.headers.clone(),
        };
        self.log.lock().unwrap().push((seen.clone(), url));
        let gate = self.gate.clone();
        Box::pin(async move {
            let (status, body) = match (seen.method.as_str(), seen.path.as_str()) {
                ("GET", "/api/experimental/session/stats") => (200, stats()),
                ("POST", path) if path.ends_with("/generate") => {
                    gate.acquire().await.map_err(|error| error.to_string())?.forget();
                    let question = seen.body["prompt"].as_str().unwrap_or_default().lines().last().unwrap_or_default();
                    (200, json!({ "data": { "text": answer(question) } }))
                }
                _ => support::base(&seen, DIRECTORY),
            };
            let bytes = serde_json::to_vec(&body).unwrap();
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(bytes))])),
            })
        })
    }
}

/// The answer to `question`: sixty items for `long`.
fn answer(question: &str) -> String {
    match question {
        "long" => (1..=60).map(|item| format!("- item {item:02}\n")).collect(),
        _ => format!("answer to {question}"),
    }
}

fn stats() -> Value {
    let from = 1_767_268_800_000_u64;
    json!({ "data": {
        "range": { "from": from, "to": from + 27 * 86_400_000 },
        "sessions": 42, "subagents": 3, "prompts": 120, "steps": 300,
        "tokens": { "input": 1_000_000, "output": 200_000, "reasoning": 34_000, "cache": { "read": 0, "write": 0 } },
        "cost": 12.5, "tools": { "mode": "none" }, "activeDays": 9, "streak": 4,
        "activity": [{ "date": "2026-01-02", "steps": 3 }], "models": [],
    } })
}

/// Session `ses_a` over `server`, with `plugins` in the config.
fn mount(server: &Server, plugins: &[&str]) -> Harness {
    let config = json!({ "animations": false, "plugins": plugins });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        ..support::deps(Arc::new(server.clone()))
    };
    let h = support::mount(100, 40, deps);
    h.wait_for("Fix the parser");
    h
}

#[allow(unsafe_code)]
unsafe extern "C" fn stats_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    let plugin = opencode_tui::plugins::stats::plugin();
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("loopback.stats", plugin.setup, host, options, instance, out) }
}

/// The poster's cells as `/stats` opens it from the session, twice, going back with escape in between. With
/// `loopback`, stats runs through the byte shims of the C ABI.
fn stats_frames(loopback: bool) -> Vec<Vec<opentui::testing::Cell>> {
    let server = Server::new(true);
    let h = mount(&server, if loopback { &["-opencode.stats"] } else { &[] });
    if loopback {
        let (definition, _) =
            opencode_plugin::loader::native::loopback(&opencode_tui::plugins::host::host(&h.tui), stats_create)
                .unwrap();
        opencode_tui::plugins::host::add(&h.tui, definition);
        h.wait_for("Fix the parser");
    }
    let session = Route::Session { id: SessionID("ses_a".into()) };
    let mut frames = Vec::new();
    for open in 1..=2 {
        h.tui.keymap.dispatch("stats.open", None);
        h.wait_for("best streak");
        assert_eq!(server.sent("/session/stats").len(), open, "each opening fetches the stats afresh");
        frames.push(h.app.render().cells);
        h.app.press("escape");
        h.wait("escape to go back to the session", || h.tui.route() == session);
        h.wait_for("Fix the parser");
    }
    frames
}

// Expected: `/stats` from a session fetches the stats and shows the poster; escape, a command of the route's scope,
// goes back to the session, and opening it again fetches again; the same cells through the C ABI's byte shims.
#[test]
fn stats_goes_back_with_escape_and_fetches_afresh_the_same_through_the_c_abi_loopback() {
    let direct = stats_frames(false);
    assert_eq!(direct[0], direct[1]);
    assert!(stats_frames(true) == direct, "the loopback draws other cells");
}

// Expected: a fetch goes through the TUI's client as it is now, so after the managed service moved, the stats go to
// the new port with the new password.
#[test]
fn a_moved_service_gets_the_fetch() {
    let server = Server::new(true);
    let h = mount(&server, &[]);
    *server.endpoint.lock().unwrap() = ("http://127.0.0.1:5000".to_owned(), "new".to_owned());
    h.tui.keymap.dispatch("stats.open", None);
    h.wait_for("best streak");
    let sent = server.sent("/session/stats");
    let (seen, url) = &sent[0];
    assert!(url.starts_with("http://127.0.0.1:5000/api/experimental/session/stats?"), "{url}");
    assert_eq!(seen.header("authorization"), Some(format!("Basic {}", Auth::password("new").token())));
}

// Expected: a bare `/btw` opens the prompt, whose answer asks the session's question; `c` copies the answer and shows
// `✓ copied` in place, where the answer stays scrolled.
#[test]
fn a_bare_btw_prompts_and_copying_keeps_the_answer_scrolled() {
    let capture = opencode_tui::features::links::testing::capture();
    let server = Server::new(true);
    let h = mount(&server, &[]);
    h.tui.keymap.dispatch("session.aside", None);
    h.wait_for("Ask anything");
    h.app.type_text("long");
    h.app.press("return");
    h.wait_for("item 01");
    let generated = server.sent("/api/session/ses_a/generate");
    assert!(generated[0].0.body["prompt"].as_str().unwrap().ends_with("\n\nlong"), "{:?}", generated[0].0.body);
    assert!(h.app.text().contains("copy response c"));
    for _ in 0..3 {
        h.app.press("down");
    }
    h.wait_gone("item 01");
    h.app.press("c");
    h.wait_for("✓ copied");
    let screen = h.app.text();
    assert!(!screen.contains("item 01") && screen.contains("item 04"), "{screen}");
    assert_eq!(*capture.0.copied.borrow(), [answer("long").trim().to_owned()]);
}

// Expected: two questions are pending at once, with the `/btw` spinner until both are answered; each answer opens.
#[test]
fn two_btw_questions_can_be_pending_at_once() {
    let server = Server::new(false);
    let h = mount(&server, &[]);
    h.tui.keymap.dispatch("session.aside", Some("one"));
    h.tui.keymap.dispatch("session.aside", Some("two"));
    h.wait("both questions to go out", || server.sent("/generate").len() == 2);
    h.wait_for("/btw");
    server.release();
    h.wait_for("answer to one");
    h.app.press("escape");
    h.wait_gone("answer to one");
    assert!(h.app.text().contains("/btw"), "one question is still pending:\n{}", h.app.text());
    server.release();
    h.wait_for("answer to two");
    h.app.press("escape");
    h.wait_gone("/btw");
}

// Expected: a reply that arrives after its plugin was disabled reaches nothing: no answer opens.
#[test]
fn a_slow_btw_reply_across_a_disable_delivers_nothing() {
    let server = Server::new(false);
    let h = mount(&server, &[]);
    h.tui.keymap.dispatch("session.aside", Some("one"));
    h.wait("the question to go out", || server.sent("/generate").len() == 1);
    h.wait_for("/btw");
    // The spinner's claim stays mounted until the route mounts again, and it holds the plugin's state.
    h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "opencode.btw", false);
    server.release();
    h.app.wait_until(Duration::from_millis(300), || false);
    assert!(!h.app.text().contains("answer to one"), "{}", h.app.text());
    h.tui.navigate(h.tui.route());
    h.wait_gone("/btw");
}

// Expected: closing an answer frees its body and handlers; four answers opened and closed leave none behind.
#[test]
fn a_closed_btw_answer_is_freed() {
    let server = Server::new(true);
    let h = mount(&server, &[]);
    let marker = std::rc::Rc::new(());
    for question in ["one", "two", "three", "four"] {
        h.tui.keymap.dispatch("session.aside", Some(question));
        h.wait_for(&format!("answer to {question}"));
        opencode_tui::plugins::panel::testing::mark(&h.tui, &marker);
        h.app.press("escape");
        h.wait_gone(&format!("answer to {question}"));
    }
    h.app.render();
    assert_eq!(std::rc::Rc::strong_count(&marker), 1, "a closed answer's body is still held");
}

// Expected: the answer's box follows the screen as TS's `maxHeight` does, so after the terminal gets shorter the
// header and the footer stay on screen.
#[test]
fn a_btw_answer_fits_a_shorter_terminal() {
    let server = Server::new(true);
    let h = mount(&server, &[]);
    h.app.resize(100, 50);
    h.tui.keymap.dispatch("session.aside", Some("long"));
    h.wait_for("item 01");
    h.app.resize(100, 20);
    h.app.render();
    let screen = h.app.text();
    assert!(screen.contains("/btw") && screen.contains("copy response"), "{screen}");
}

// Expected: a copy that completes after its answer closed does not open the answer again.
#[test]
fn a_late_btw_copy_does_not_reopen_a_closed_answer() {
    let server = Server::new(true);
    let h = mount(&server, &[]);
    h.tui.keymap.dispatch("session.aside", Some("one"));
    h.wait_for("answer to one");
    h.app.press("escape");
    h.wait_gone("answer to one");
    h.tui.keymap.dispatch("btw.copied", None);
    h.app.wait_until(Duration::from_millis(100), || false);
    assert!(!h.app.text().contains("answer to one"), "{}", h.app.text());
}

// Expected (carbon-4, bigboi-7): the stats route asks for the stats as it mounts, however it opens, as TS's
// `StatsPage` does: as the first route (`OPENCODE_ROUTE`), through another plugin's navigation, and afresh on each
// visit; `/stats` while the route shows asks nothing more.
#[test]
fn the_stats_route_fetches_as_it_mounts_however_it_opens() {
    let server = Server::new(true);
    let stats = abi::Route::Plugin { id: "opencode.stats".into(), name: "stats".into() };
    let deps = Deps {
        config: support::config(support::still()),
        route: Route::Plugin { id: "opencode.stats".into(), name: "stats".into() },
        ..support::deps(Arc::new(server.clone()))
    };
    let h = support::mount(100, 40, deps);
    h.wait_for("best streak");
    assert_eq!(server.sent("/session/stats").len(), 1);
    h.tui.keymap.dispatch("stats.open", None);
    h.app.wait_until(Duration::from_millis(100), || false);
    assert_eq!(server.sent("/session/stats").len(), 1, "/stats on the route asks again");
    h.wait_for("best streak");

    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("Fix the parser");
    opencode_plugin::Host::navigate(&*h.tui, "other.plugin", &stats);
    h.wait_for("best streak");
    assert_eq!(server.sent("/session/stats").len(), 2, "a revisit asks afresh");
}
