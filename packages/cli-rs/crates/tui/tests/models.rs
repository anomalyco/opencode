//! Models and usage (E.16) over the fixture server of `parity/fixtures/E.16/server.json`:
//!
//! - P-COMP: each dialog against the cells `parity/component/E.16-models.tsx` wrote from the TS dialog;
//! - P-REQ: the dialogs and commands send reads only, never `/api/experimental/session/stats`;
//! - P-FILE: `model.json` as the TS model preference repository reads and writes it, in a temp dir;
//! - the commands and keys through the whole TUI.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_local::model_pref::Model;
use opencode_local::paths::Paths;
use opencode_local::storage::Storage;
use opencode_parity::{assert_fixture, fixtures_dir};
use opencode_tui::app::Roots;
use opencode_tui::dialogs::go_upsell::{self, Offer};
use opencode_tui::dialogs::model::{self, Files, Local};
use opencode_tui::dialogs::{agent, usage, usage_model, variant};
use opencode_tui::{Deps, Route, Tui};
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opencode_ui::toast::Toasts;
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// Serves the E.16 routes and records every request (method and path with query).
struct Server {
    routes: Value,
    seen: Mutex<Vec<(String, String)>>,
    /// The bodies of mutating requests, by path.
    writes: Mutex<Vec<(String, Value)>>,
    /// Holds the usage limits back, as OpenCode Console can.
    slow_usage: std::sync::atomic::AtomicBool,
}

impl Server {
    fn new() -> Arc<Self> {
        let text = std::fs::read_to_string(fixtures_dir().join("E.16/server.json")).unwrap();
        let server: Value = serde_json::from_str(&text).unwrap();
        Arc::new(Self {
            routes: server["routes"].clone(),
            seen: Mutex::default(),
            writes: Mutex::default(),
            slow_usage: Default::default(),
        })
    }

    fn seen(&self) -> Vec<(String, String)> {
        self.seen.lock().unwrap().clone()
    }
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query = request
            .url
            .query()
            .map_or(String::new(), |q| format!("?{q}"));
        self.seen
            .lock()
            .unwrap()
            .push((request.method.to_owned(), format!("{path}{query}")));
        let location = json!({ "directory": "/project" });
        let sent = request
            .body
            .as_deref()
            .and_then(|body| serde_json::from_slice::<Value>(body).ok())
            .unwrap_or(Value::Null);
        if request.method != "GET" {
            self.writes
                .lock()
                .unwrap()
                .push((path.clone(), sent.clone()));
        }
        let (status, body) = match (request.method, path.as_str()) {
            // A prompt from home creates its session, then sends to it.
            ("POST", "/api/session") => (
                200,
                json!({ "data": {
                    "id": sent["id"], "projectID": "project", "cost": 0,
                    "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                    "time": { "created": 1, "updated": 1 }, "location": location,
                } }),
            ),
            ("POST", path) if path.ends_with("/prompt") => (
                200,
                json!({ "data": {
                    "id": sent["id"], "sessionID": path.split('/').nth(3), "time": { "created": 1 },
                    "type": "user", "payload": { "text": sent["text"] }, "delivery": "steer",
                } }),
            ),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", path) if self.routes.get(path).is_some() => (
                200,
                json!({ "location": location, "data": self.routes[path] }),
            ),
            _ => (404, json!({})),
        };
        let body = serde_json::to_vec(&body).unwrap();
        let slow = path == "/api/experimental/usage/limits"
            && self.slow_usage.load(std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move {
            if slow {
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn preferences() -> Value {
    let text = std::fs::read_to_string(fixtures_dir().join("E.16/server.json")).unwrap();
    serde_json::from_str::<Value>(&text).unwrap()["preferences"].clone()
}

fn theme() -> Theme {
    Catalog::default()
        .load("opencode", ThemeMode::Dark)
        .unwrap()
        .theme
}

/// A temporary state directory holding the fixture's `model.json`.
fn state() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("model.json"), preferences().to_string()).unwrap();
    dir
}

/// The dialog kit and [`Local`] on a bare app, the way the P-COMP script mounts the TS dialogs.
struct Kit {
    app: TestApp,
    local: Rc<Local>,
    fixture: Arc<Server>,
    _state: tempfile::TempDir,
}

fn kit(width: u16, height: u16) -> Kit {
    let app = TestApp::with_options(
        width,
        height,
        AppOptions {
            theme: opentui::theme::Theme {
                background: theme().background.base,
                ..opentui::theme::Theme::default()
            },
            light_theme: None,
            ..AppOptions::default()
        },
    );
    let keymap = Rc::new(DialogKeymap::new(Keybinds::defaults(), Options::default()));
    route_keys(&app, keymap.clone());
    let toasts = Toasts::new(&app, theme(), &app.root());
    let dialogs = Dialogs::new(&app, keymap, theme());
    let fixture = Server::new();
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let state = state();
    let local = Local::new(
        &app,
        client,
        "/project".into(),
        dialogs,
        toasts,
        Some(Files {
            state: state.path().to_owned(),
            storage: None,
        }),
        Rc::new(|| None),
    );
    local.load();
    local.load_usage(false);
    let loaded = app.wait_until(Duration::from_secs(5), || {
        local.ready()
            && local.catalog_ready()
            && local.integrations().is_some()
            && matches!(local.usage(), Some(Some(_)))
            && !local.agents().is_empty()
            && !local.providers().is_empty()
    });
    assert!(loaded, "the catalog never loaded: {:?}", fixture.seen());
    Kit {
        app,
        local,
        fixture,
        _state: state,
    }
}

impl Kit {
    fn settle(&self, text: &str) {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        assert!(found, "{text:?} never showed:\n{}", self.app.text());
        // Let deferred row updates and refreshes land.
        self.app.wait_until(Duration::from_millis(100), || false);
    }
}

#[test]
fn model_dialog_matches_typescript_opened_and_filtered() {
    // Tall enough for the whole list (parity/deviations/DLG13-model-scroll.md).
    let kit = kit(90, 60);
    model::show(&kit.local, None);
    kit.settle("usage");
    assert_fixture(&kit.app.render(), "E.16/model");
    kit.app.type_text("gpt");
    kit.settle("GPT-5 mini");
    assert_fixture(&kit.app.render(), "E.16/model-filter");
}

#[test]
fn agent_and_variant_dialogs_match_typescript() {
    let kit = kit(90, 34);
    agent::show(&kit.local);
    kit.settle("plan");
    assert_fixture(&kit.app.render(), "E.16/agent");
    variant::show(&kit.local);
    kit.settle("high");
    assert_fixture(&kit.app.render(), "E.16/variant");
}

#[test]
fn usage_dialogs_match_typescript() {
    let kit = kit(90, 34);
    usage::show(&kit.local);
    kit.settle("left");
    assert_fixture(&kit.app.render(), "E.16/usage");
    kit.app.press("down");
    kit.settle("Grok Code");
    assert_fixture(&kit.app.render(), "E.16/usage-down");
    let sonnet = kit.local.models().into_iter().next().unwrap();
    usage_model::show(&kit.local, sonnet);
    kit.settle("remaining");
    assert_fixture(&kit.app.render(), "E.16/usage-model");
}

#[test]
fn go_upsell_matches_typescript_when_compact() {
    let kit = kit(80, 20);
    go_upsell::show(
        &kit.local,
        Offer {
            reset: Some("3:00 PM".into()),
            can_continue: Rc::new(|| true),
            on_subscribe: Rc::new(|| {}),
        },
    );
    kit.settle("subscribe");
    assert_fixture(&kit.app.render(), "E.16/go-upsell");
}

#[test]
fn dialogs_send_reads_only() {
    let kit = kit(90, 34);
    model::show(&kit.local, None);
    kit.settle("usage");
    usage::show(&kit.local);
    kit.settle("left");
    let seen = kit.fixture.seen();
    assert!(seen.iter().all(|(method, _)| method == "GET"), "{seen:?}");
    assert!(
        seen.iter().all(|(_, path)| !path.contains("session/stats")),
        "{seen:?}"
    );
    let paths: Vec<&str> = seen
        .iter()
        .map(|(_, path)| path.split('?').next().unwrap())
        .collect();
    for read in [
        "/api/model",
        "/api/provider",
        "/api/agent",
        "/api/integration",
        "/api/config",
        "/api/experimental/usage/limits",
    ] {
        assert!(paths.contains(&read), "{read} was not read: {seen:?}");
    }
    // Every read names the location.
    assert!(
        seen.iter().all(
            |(_, path)| path.contains("location%5Bdirectory%5D=%2Fproject")
                || path.contains("location[directory]=/project")
        ),
        "{seen:?}"
    );
}

// The whole TUI, with real roots in a temp dir.

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    fixture: Arc<Server>,
    state: PathBuf,
    _home: tempfile::TempDir,
}

fn mount() -> Harness {
    let home = tempfile::tempdir().unwrap();
    let root = home.path().to_owned();
    let paths =
        Paths::from_vars(|name| (name == "HOME").then(|| root.clone().into_os_string())).unwrap();
    std::fs::create_dir_all(&paths.state).unwrap();
    std::fs::write(paths.state.join("model.json"), preferences().to_string()).unwrap();
    let state = paths.state.clone();
    let fixture = Server::new();
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let app = TestApp::new(100, 34);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: Some(Roots {
                paths,
                storage_channel: "test".into(),
            }),
            route: Route::Home,
            continue_: false,
            events: false,
        },
    );
    let local = tui.local.clone();
    let loaded = app.wait_until(Duration::from_secs(5), || {
        local.ready()
            && local.catalog_ready()
            && local.integrations().is_some()
            && !local.agents().is_empty()
    });
    assert!(loaded, "the catalog never loaded: {:?}", fixture.seen());
    // Keys go to the home prompt once it shows its agent and model.
    let harness = Harness {
        app,
        tui,
        fixture,
        state,
        _home: home,
    };
    harness.wait_for("Build · Claude Sonnet");
    harness.app.wait_until(Duration::from_millis(100), || false);
    harness
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(5), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn model_json(&self) -> Value {
        serde_json::from_str(&std::fs::read_to_string(self.state.join("model.json")).unwrap())
            .unwrap()
    }

    /// Waits until `model.json` satisfies `check` (writes run on a worker thread).
    fn wait_file(&self, check: impl Fn(&Value) -> bool) -> Value {
        let mut last = Value::Null;
        let found = self.app.wait_until(Duration::from_secs(5), || {
            last = self.model_json();
            check(&last)
        });
        assert!(found, "model.json never matched: {last}");
        last
    }
}

fn model_ref(provider: &str, model: &str) -> Value {
    json!({ "providerID": provider, "modelID": model })
}

#[test]
fn leader_m_picks_a_model_and_saves_it_as_recent() {
    let h = mount();
    let local = h.tui.local.clone();
    // On home the build agent's configured model and variant apply.
    assert_eq!(
        local.current(),
        Some(Model::new("anthropic", "claude-sonnet"))
    );
    assert_eq!(local.variant().as_deref(), Some("high"));
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    h.app.type_text("mini");
    h.wait_for("GPT-5 mini");
    h.app.press("return");
    let file = h.wait_file(|file| file["recent"][0] == model_ref("openai", "gpt-5-mini"));
    assert_eq!(file["recent"][1], model_ref("anthropic", "claude-haiku"));
    assert_eq!(file["favorite"], json!([model_ref("openai", "gpt-5")]));
    assert!(
        !h.tui.dialogs.is_open(),
        "no variants, so the dialog closes"
    );
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5-mini")));
    assert_no_writes(&h.fixture);
}

#[test]
fn a_filter_typed_before_the_limits_arrive_stays() {
    let h = mount();
    h.fixture
        .slow_usage
        .store(true, std::sync::atomic::Ordering::SeqCst);
    // The limits load when the dialog opens; the dialog opens again to show the usage action.
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    h.app.type_text("mini");
    h.wait_for("GPT-5 mini");
    assert!(
        !h.app.text().contains("ctrl+u"),
        "the limits came too early"
    );
    let screen = h.wait_for("ctrl+u");
    assert!(screen.contains("GPT-5 mini"), "{screen}");
    assert!(
        !screen.contains("Claude Haiku"),
        "the filter was lost:\n{screen}"
    );
}

#[test]
fn the_prompt_shows_and_submits_the_model_picked_in_the_dialog() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    h.app.type_text("mini");
    h.wait_for("GPT-5 mini");
    h.app.press("return");
    // The home prompt's metadata row follows the choice.
    h.wait_for("GPT-5 mini");
    h.app.type_text("hello");
    h.app.press("return");
    let created = h.app.wait_until(Duration::from_secs(5), || {
        h.fixture
            .writes
            .lock()
            .unwrap()
            .iter()
            .any(|(path, _)| path == "/api/session")
    });
    let writes = h.fixture.writes.lock().unwrap().clone();
    assert!(created, "no session was created: {writes:?}");
    let (_, body) = writes
        .iter()
        .find(|(path, _)| path == "/api/session")
        .unwrap();
    assert_eq!(
        body["model"],
        json!({ "providerID": "openai", "id": "gpt-5-mini" }),
        "{body}"
    );
    assert_eq!(body["agent"], "build", "{body}");
}

#[test]
fn ctrl_f_favorites_the_selected_model() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    h.app.type_text("haiku");
    h.wait_for("Claude Haiku");
    h.app.press("ctrl+f");
    h.wait_file(|file| file["favorite"][0] == model_ref("anthropic", "claude-haiku"));
    // The favorite shows in the list at once: the row's action turns into unfavorite.
    h.wait_for("unfavorite");
    assert_no_writes(&h.fixture);
}

#[test]
fn cycle_commands_move_through_recents_favorites_agents_and_variants() {
    let h = mount();
    let local = h.tui.local.clone();
    // F2: the first recent model, since the current one is not recent.
    h.app.press("f2");
    assert_eq!(
        local.current(),
        Some(Model::new("anthropic", "claude-haiku"))
    );
    // A favorite cycle moves to the favorite and records it as recent.
    h.tui.keymap.dispatch("model.cycle_favorite", None);
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5")));
    h.wait_file(|file| file["recent"][0] == model_ref("openai", "gpt-5"));
    // GPT-5 has no variants.
    h.tui.keymap.dispatch("variant.list", None);
    h.wait_for("No variants available");
    // The agent cycle: build, then plan, whose model is the one chosen for a new session.
    h.tui.keymap.dispatch("agent.cycle", None);
    assert_eq!(
        local.agent().map(|agent| agent.id.0).as_deref(),
        Some("plan")
    );
    h.tui.keymap.dispatch("agent.cycle.reverse", None);
    assert_eq!(
        local.agent().map(|agent| agent.id.0).as_deref(),
        Some("build")
    );
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5")));
    assert_no_writes(&h.fixture);
}

#[test]
fn ctrl_t_cycles_the_variant_and_saves_it() {
    let h = mount();
    let local = h.tui.local.clone();
    assert_eq!(local.variants(), ["low", "high"]);
    // `high` is the last variant, so the cycle goes back to the default.
    h.app.press("ctrl+t");
    assert_eq!(local.variant(), None);
    h.wait_file(|file| file["variant"]["anthropic/claude-sonnet"] == "default");
    h.app.press("ctrl+t");
    assert_eq!(local.variant().as_deref(), Some("low"));
    h.wait_file(|file| file["variant"]["anthropic/claude-sonnet"] == "low");
}

#[test]
fn leader_a_switches_the_agent() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("a");
    let screen = h.wait_for("Search agents");
    assert!(
        !screen.contains("general"),
        "subagents are hidden:\n{screen}"
    );
    h.app.press("down");
    h.app.press("return");
    assert_eq!(
        h.tui.local.agent().map(|agent| agent.id.0).as_deref(),
        Some("plan")
    );
    assert!(!h.tui.dialogs.is_open());
}

#[test]
fn usage_opens_from_the_model_dialog_and_a_row_opens_its_limits() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("usage");
    h.app.press("ctrl+u");
    h.wait_for("$0.50 left");
    h.app.press("return");
    let screen = h.wait_for("Usage › Claude Sonnet");
    assert!(screen.contains("$9.50 used of $10"), "{screen}");
    assert!(screen.contains("Only you"), "{screen}");
    assert_no_writes(&h.fixture);
}

#[test]
fn model_json_is_shared_with_the_typescript_client() {
    let Some(oracle) = oracle() else { return };
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    h.app.type_text("haiku");
    h.wait_for("Claude Haiku");
    h.app.press("ctrl+f");
    h.wait_file(|file| file["favorite"][0] == model_ref("anthropic", "claude-haiku"));
    h.app.press("escape");
    h.app.press("ctrl+t");
    h.wait_file(|file| file["variant"]["anthropic/claude-sonnet"] == "default");
    // TS reads what Rust wrote.
    let read = run(&oracle, &["load", h.state.to_str().unwrap()]);
    assert_eq!(
        read,
        json!({
            "recent": [model_ref("anthropic", "claude-haiku")],
            "favorite": [model_ref("anthropic", "claude-haiku"), model_ref("openai", "gpt-5")],
            "variant": { "anthropic/claude-sonnet": "default" },
        })
    );
    // TS writes under the same lock, and the running Rust TUI picks it up through its watcher.
    run(
        &oracle,
        &["recent", h.state.to_str().unwrap(), "openai", "gpt-5-mini"],
    );
    let local = h.tui.local.clone();
    let reloaded = h.app.wait_until(Duration::from_secs(5), || {
        local.recent().first() == Some(&Model::new("openai", "gpt-5-mini"))
    });
    assert!(reloaded, "the watcher never reloaded: {:?}", local.recent());
    assert_eq!(local.favorite().len(), 2);
}

#[test]
fn go_upsell_is_offered_once_a_day_and_remembers_dont_show() {
    let h = mount();
    let local = h.tui.local.clone();
    let storage = Storage::new(&h.state, "test").unwrap();
    let offer = || Offer {
        reset: None,
        can_continue: Rc::new(|| true),
        on_subscribe: Rc::new(|| {}),
    };
    let now = 1_800_000_000_000.0;
    go_upsell::offer(&local, offer(), now);
    h.wait_for("Free limit reached");
    let stored = storage.load("go-upsell", &json!({})).unwrap();
    assert_eq!(stored, json!({ "lastSeenAt": now as i64 }));
    // "dismiss" closes it; within the day it is not offered again.
    h.app.press("left");
    h.app.press("return");
    assert!(!h.tui.dialogs.is_open());
    go_upsell::offer(&local, offer(), now + 1000.0);
    h.app.wait_until(Duration::from_millis(200), || false);
    assert!(!h.tui.dialogs.is_open());
    // A day later it is; "don't show again" is saved for every client.
    go_upsell::offer(&local, offer(), now + 86_400_000.0);
    h.wait_for("Free limit reached");
    h.app.press("left");
    h.app.press("left");
    h.app.press("return");
    let saved = h.app.wait_until(Duration::from_secs(5), || {
        storage.load("go-upsell", &json!({})).unwrap()["dontShow"] == true
    });
    assert!(saved, "{}", storage.load("go-upsell", &json!({})).unwrap());
    assert_no_writes(&h.fixture);
}

fn assert_no_writes(fixture: &Server) {
    let seen = fixture.seen();
    assert!(
        seen.iter().all(|(method, _)| method == "GET"),
        "a dialog sent a mutating request: {seen:?}"
    );
    assert!(seen.iter().all(|(_, path)| !path.contains("session/stats")));
}

// The TypeScript side of P-FILE, when bun and the workspace's node_modules are there.
fn oracle() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = root.join("parity/oracle/E.16-model-json.ts");
    let present = root.join("../../node_modules").is_dir()
        && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        eprintln!("skipped: needs bun and the workspace node_modules");
        return None;
    }
    Some(script)
}

fn run(script: &Path, args: &[&str]) -> Value {
    let output = Command::new("bun")
        .arg(script)
        .args(args)
        .env(
            "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
            std::env::temp_dir().join("opencode-rs-e16-bun-cache"),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_str(
        String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .last()
            .unwrap(),
    )
    .unwrap()
}
