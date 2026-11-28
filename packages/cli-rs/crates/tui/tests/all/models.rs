//! Model selection and usage dialogs against recorded cells and server responses.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::model_pref::Model;
use opencode_local::storage::Storage;
use opencode_parity::fixtures_dir;
use opencode_store::{Data, Options as StoreOptions};
use opencode_tui::dialogs::go_upsell::{self, Offer};
use opencode_tui::dialogs::model;
use opencode_tui::dialogs::{agent, speed, usage, usage_model, variant};
use opencode_tui::local::{Files, Local};
use opencode_tui::{Deps, Route};
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opencode_ui::toast::Toasts;
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::{self, Harness, WAIT, deref_harness};

struct Server {
    routes: Value,
    seen: Mutex<Vec<(String, String)>>,
    writes: Mutex<Vec<(String, Value)>>,
    /// Answers `/api/model` with an empty list, as the server does before its providers settle.
    models_empty: std::sync::atomic::AtomicBool,
}

impl Server {
    fn new() -> Arc<Self> {
        let text = std::fs::read_to_string(fixtures_dir().join("E.16/server.json")).unwrap();
        let mut server: Value = serde_json::from_str(&text).unwrap();
        shift_resets(&mut server["routes"]);
        Arc::new(Self {
            routes: server["routes"].clone(),
            seen: Mutex::default(),
            writes: Mutex::default(),
            models_empty: std::sync::atomic::AtomicBool::new(false),
        })
    }

    fn seen(&self) -> Vec<(String, String)> {
        self.seen.lock().unwrap().clone()
    }
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query = request.url.query().map_or(String::new(), |q| format!("?{q}"));
        self.seen.lock().unwrap().push((request.method.to_owned(), format!("{path}{query}")));
        let location = json!({ "directory": "/project" });
        let sent =
            request.body.as_deref().and_then(|body| serde_json::from_slice::<Value>(body).ok()).unwrap_or(Value::Null);
        if request.method != "GET" {
            self.writes.lock().unwrap().push((path.clone(), sent.clone()));
        }
        let (status, body) = match (request.method, path.as_str()) {
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
            ("GET", "/api/model") if self.models_empty.load(std::sync::atomic::Ordering::SeqCst) => {
                (200, json!({ "location": location, "data": [] }))
            }
            ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", path) if self.routes.get(path).is_some() => {
                (200, json!({ "location": location, "data": self.routes[path] }))
            }
            _ => (404, json!({})),
        };
        Box::pin(async move { Ok(support::respond(status, &body)) })
    }
}

/// Shift reset times by the local offset; the fixture records them in UTC.
fn shift_resets(value: &mut Value) {
    match value {
        Value::Object(fields) => fields.iter_mut().for_each(|(key, field)| match field.as_i64() {
            Some(at) if key == "resetsAt" => {
                *field = json!(at - i64::from(opencode_util::time::Zone::Local.offset(at)) * 1000)
            }
            _ => shift_resets(field),
        }),
        Value::Array(items) => items.iter_mut().for_each(shift_resets),
        _ => {}
    }
}

fn preferences() -> Value {
    let text = std::fs::read_to_string(fixtures_dir().join("E.16/server.json")).unwrap();
    serde_json::from_str::<Value>(&text).unwrap()["preferences"].clone()
}

fn theme() -> Theme {
    Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme
}

/// A temporary state directory holding the fixture's `model.json`.
fn state() -> opencode_util::temp::TempDir {
    let dir = opencode_util::temp::tempdir().unwrap();
    std::fs::write(dir.path().join("model.json"), preferences().to_string()).unwrap();
    dir
}

struct Kit {
    app: TestApp,
    local: Rc<Local>,
    data: Data,
    fixture: Arc<Server>,
    _state: opencode_util::temp::TempDir,
}

fn kit(width: u16, height: u16) -> Kit {
    kit_with(width, height, Server::new())
}

fn kit_with(width: u16, height: u16, fixture: Arc<Server>) -> Kit {
    let app = support::dark_app(width, height);
    let keymap = Rc::new(DialogKeymap::new(Keybinds::defaults(), Options::default()));
    route_keys(&app, keymap.clone());
    let toasts = Toasts::new(&app, theme(), &app.root());
    let dialogs = Dialogs::new(&app, keymap, theme());
    let client = Client::with_transport("http://opencode.local", fixture.clone()).unwrap();
    let state = state();
    let data = support::store(&app, client, StoreOptions { directory: "/project".into(), ..StoreOptions::default() });
    let local = Local::new(
        &app,
        data.clone(),
        dialogs,
        toasts,
        Some(Files { state: state.path().to_owned(), storage: None }),
        std::rc::Weak::new(),
    );
    local.load();
    local.load_usage(false);
    let loaded = app.wait_until(WAIT, || {
        local.ready()
            && local.catalog_ready()
            && local.integrations().is_some()
            && matches!(local.usage(), Some(Some(_)))
            && !local.agents().is_empty()
            && !local.providers(|providers| providers.is_empty())
    });
    assert!(loaded, "the catalog never loaded: {:?}", fixture.seen());
    Kit { app, local, data, fixture, _state: state }
}

impl Kit {
    fn wait_for(&self, text: &str) {
        let found = self.app.wait_until(WAIT, || self.app.text().contains(text));
        assert!(found, "{text:?} never showed:\n{}", self.app.text());
    }
}

#[test]
fn a_connection_reads_the_catalogs_again_after_the_server_answered_before_its_providers() {
    // The model route lists "the current snapshot", which may precede the providers' settlement; the
    // `model.updated` that announces the settlement is not replayed to a subscription that opens after it. The
    // client reads the catalogs before the stream connects, so the connection itself reads them again.
    let fixture = Server::new();
    fixture.models_empty.store(true, std::sync::atomic::Ordering::SeqCst);
    let kit = kit_with(90, 34, fixture.clone());
    assert_eq!(kit.local.models(|models| models.len()), 0);
    assert!(kit.local.current().is_none());

    fixture.models_empty.store(false, std::sync::atomic::Ordering::SeqCst);
    kit.local.sync(&opencode_store::Changes::everything(&kit.data));
    let loaded = kit.app.wait_until(WAIT, || !kit.local.models(|models| models.is_empty()));
    assert!(loaded, "the catalogs were not read again: {:?}", fixture.seen());
    let reads =
        fixture.seen().iter().filter(|(method, path)| method == "GET" && path.starts_with("/api/model")).count();
    assert_eq!(reads, 2, "{:?}", fixture.seen());
}

#[test]
fn model_dialog_matches_typescript_opened_and_filtered() {
    let kit = kit(90, 60);
    model::show(&kit.local, None);
    kit.wait_for("favorite");
    support::wait_fixture(&kit.app, "E.16/model");
    kit.app.type_text("gpt");
    kit.wait_for("GPT-5 mini");
    support::wait_fixture(&kit.app, "E.16/model-filter");
}

#[test]
fn agent_and_variant_dialogs_match_typescript() {
    let kit = kit(90, 34);
    agent::show(&kit.local);
    kit.wait_for("plan");
    support::wait_fixture(&kit.app, "E.16/agent");
    variant::show(&kit.local);
    kit.wait_for("high");
    support::wait_fixture(&kit.app, "E.16/variant");
}

#[test]
fn speed_dialog_matches_typescript() {
    let kit = kit(90, 34);
    speed::show(&kit.local);
    kit.wait_for("Standard");
    support::wait_fixture(&kit.app, "E.16/speed");
}

#[test]
fn usage_dialogs_match_typescript() {
    let kit = kit(90, 34);
    usage::show(&kit.local);
    kit.wait_for("left");
    support::wait_fixture(&kit.app, "E.16/usage");
    kit.app.press("down");
    kit.wait_for("Grok Code");
    support::wait_fixture(&kit.app, "E.16/usage-down");
    let sonnet = kit.local.models(|models| models[0].clone());
    usage_model::show(&kit.local, sonnet);
    kit.wait_for("remaining");
    support::wait_fixture(&kit.app, "E.16/usage-model");
}

/// A limit on whole vendors names them as a list, and its price floor in dollars.
#[test]
fn a_vendor_limit_names_its_vendors_and_its_price_floor() {
    let mut server = Arc::into_inner(Server::new()).unwrap();
    let budgets = server.routes["/api/experimental/usage/limits"]["budgets"].as_array_mut().unwrap();
    let mut vendors = budgets[1].clone();
    vendors["id"] = json!("vendors");
    vendors["per"] = json!("set");
    vendors["vendors"] = json!(["Anthropic", "OpenAI", "xAI"]);
    vendors["inputPriceAtLeast"] = json!(1234.5);
    budgets.push(vendors);
    let kit = kit_with(90, 34, Arc::new(server));
    let sonnet = kit.local.models(|models| models[0].clone());
    usage_model::show(&kit.local, sonnet);
    let words = || kit.app.text().split_whitespace().collect::<Vec<_>>().join(" ");
    let named =
        kit.app.wait_until(WAIT, || words().contains("Anthropic, OpenAI, and xAI models over $1,234.50 per 1M"));
    assert!(named, "{}", kit.app.text());
}

#[test]
fn go_upsell_matches_typescript_when_compact() {
    let kit = kit(80, 20);
    go_upsell::show(
        &kit.local,
        Offer { reset: Some("3:00 PM".into()), can_continue: Rc::new(|| true), on_subscribe: Rc::new(|| {}) },
    );
    kit.wait_for("subscribe");
    support::wait_fixture(&kit.app, "E.16/go-upsell");
}

#[test]
fn go_upsell_art_moves_while_animations_run() {
    let kit = kit(90, 34);
    go_upsell::show(
        &kit.local,
        Offer { reset: Some("3:00 PM".into()), can_continue: Rc::new(|| true), on_subscribe: Rc::new(|| {}) },
    );
    kit.wait_for("subscribe");
    let first = opencode_parity::Fixture::from_capture(&kit.app.render());
    kit.app.advance(Duration::from_millis(500));
    let later = opencode_parity::Fixture::from_capture(&kit.app.render());
    assert!(!opencode_parity::compare(&first, &later).is_equal());
}

#[test]
fn go_upsell_art_matches_typescript_when_still() {
    let kit = kit(90, 34);
    opencode_ui::motion::set_running(&kit.app, false);
    go_upsell::show(
        &kit.local,
        Offer { reset: Some("3:00 PM".into()), can_continue: Rc::new(|| true), on_subscribe: Rc::new(|| {}) },
    );
    kit.wait_for("subscribe");
    support::wait_fixture(&kit.app, "E.16/go-upsell-art");
    // Without truecolor the reference uses full blocks for the logo; this renderer keeps its half blocks.
    let fixtures = opencode_parity::fixtures_dir();
    let expected = opencode_parity::Fixture::load(fixtures.join("E.16/go-upsell-art-256.json")).unwrap();
    let comparison = opencode_parity::compare(&expected, &opencode_parity::Fixture::from_capture(&kit.app.render()));
    assert!(fixtures.join("../deviations/DLG07-go-upsell-art.md").exists());
    assert_eq!(comparison.differences.len(), 7, "{comparison}");
    assert!(
        comparison.differences.iter().all(|&(x, y)| expected.cell(x, y).is_some_and(|cell| cell.symbol == "█")),
        "{comparison}"
    );
    opencode_ui::motion::set_running(&kit.app, true);
}

#[test]
fn dialogs_send_reads_only() {
    let kit = kit(90, 34);
    model::show(&kit.local, None);
    kit.wait_for("favorite");
    usage::show(&kit.local);
    kit.wait_for("left");
    let seen = kit.fixture.seen();
    assert!(seen.iter().all(|(method, _)| method == "GET"), "{seen:?}");
    assert!(seen.iter().all(|(_, path)| !path.contains("session/stats")), "{seen:?}");
    let paths: Vec<&str> = seen.iter().map(|(_, path)| path.split('?').next().unwrap()).collect();
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
    assert!(
        seen.iter().all(|(_, path)| path.contains("location%5Bdirectory%5D=%2Fproject")
            || path.contains("location[directory]=/project")),
        "{seen:?}"
    );
}

struct Models {
    harness: Harness,
    fixture: Arc<Server>,
    state: PathBuf,
    _home: opencode_util::temp::TempDir,
}

deref_harness!(Models);

fn mount() -> Models {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    std::fs::write(paths.state.join("model.json"), preferences().to_string()).unwrap();
    let state = paths.state.clone();
    let fixture = Server::new();
    let deps = Deps { roots: support::roots(paths, "test"), route: Route::Home, ..support::deps(fixture.clone()) };
    let harness = support::mount(100, 34, deps);
    let local = harness.tui.local.clone();
    let loaded = harness.app.wait_until(WAIT, || {
        local.ready() && local.catalog_ready() && local.integrations().is_some() && !local.agents().is_empty()
    });
    assert!(loaded, "the catalog never loaded: {:?}", fixture.seen());
    // Keys go to the home prompt once it shows its agent and model.
    let harness = Models { harness, fixture, state, _home: home };
    harness.wait_for("Build · Claude Sonnet");
    harness.app.wait_until(Duration::from_millis(100), || false);
    harness
}

impl Models {
    fn model_json(&self) -> Value {
        serde_json::from_str(&std::fs::read_to_string(self.state.join("model.json")).unwrap()).unwrap()
    }

    /// Waits until `model.json` satisfies `check` (writes run on a worker thread).
    fn wait_file(&self, check: impl Fn(&Value) -> bool) -> Value {
        let mut last = Value::Null;
        let found = self.app.wait_until(WAIT, || {
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
    assert_eq!(local.current(), Some(Model::new("anthropic", "claude-sonnet")));
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
    assert!(!h.tui.dialogs.is_open(), "no variants, so the dialog closes");
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5-mini")));
    assert_no_writes(&h.fixture);
}

#[test]
fn the_model_picker_shows_no_usage_with_the_limits_loaded() {
    let kit = kit(90, 60);
    model::show(&kit.local, None);
    kit.wait_for("favorite ctrl+f");
    let screen = kit.app.text();
    for text in ["usage ctrl+u", "per 1M", "left"] {
        assert!(!screen.contains(text), "{text:?} showed:\n{screen}");
    }
    kit.app.press("ctrl+u");
    kit.app.wait_until(Duration::from_millis(100), || false);
    assert!(kit.app.text().contains("Search models"), "ctrl+u left the picker:\n{}", kit.app.text());
}

#[test]
fn a_search_with_spaces_ranks_by_its_words_across_title_and_provider() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("m");
    h.wait_for("Search models");
    // fuzzysort's default score sums each word's best key: "Grok Code" (OpenCode) before "Claude Haiku".
    h.app.type_text("o c");
    let screen = h.wait_for("Grok Code");
    let at = |name: &str| screen.find(name).unwrap_or_else(|| panic!("no {name}:\n{screen}"));
    assert!(at("Grok Code") < at("Claude Haiku"), "{screen}");
    assert!(at("Claude Haiku") < at("Claude Sonnet"), "{screen}");
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
    h.wait_for("GPT-5 mini");
    h.app.type_text("hello");
    h.app.press("return");
    let created =
        h.app.wait_until(WAIT, || h.fixture.writes.lock().unwrap().iter().any(|(path, _)| path == "/api/session"));
    let writes = h.fixture.writes.lock().unwrap().clone();
    assert!(created, "no session was created: {writes:?}");
    let (_, body) = writes.iter().find(|(path, _)| path == "/api/session").unwrap();
    assert_eq!(body["model"], json!({ "providerID": "openai", "id": "gpt-5-mini" }), "{body}");
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
    h.app.press("f2");
    assert_eq!(local.current(), Some(Model::new("anthropic", "claude-haiku")));
    h.tui.keymap.dispatch("model.cycle_favorite", None);
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5")));
    h.wait_file(|file| file["recent"][0] == model_ref("openai", "gpt-5"));
    h.tui.keymap.dispatch("variant.list", None);
    h.wait_for("No variants available");
    h.tui.keymap.dispatch("agent.cycle", None);
    assert_eq!(local.agent().map(|agent| agent.id.0).as_deref(), Some("plan"));
    h.tui.keymap.dispatch("agent.cycle.reverse", None);
    assert_eq!(local.agent().map(|agent| agent.id.0).as_deref(), Some("build"));
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
fn a_reload_that_read_the_file_before_a_pending_write_keeps_the_change() {
    let h = mount();
    let local = h.tui.local.clone();
    // Holding the lock keeps the variant's write from landing.
    let file = h.state.join("model.json");
    let lock = opencode_local::lock::acquire(
        &h.state.join("locks"),
        &file.to_string_lossy(),
        &opencode_local::lock::Options::default(),
    )
    .unwrap();
    h.app.press("ctrl+t");
    assert_eq!(local.variant(), None);
    // Another writer touches the file: the watcher reloads it, without the variant.
    let before = h.model_json();
    std::fs::write(&file, before.to_string()).unwrap();
    h.app.wait_until(Duration::from_millis(500), || false);
    assert_eq!(local.variant(), None, "the reload kept the pending change");
    lock.release().unwrap();
    h.wait_file(|file| file["variant"]["anthropic/claude-sonnet"] == "default");
    assert!(h.app.wait_until(WAIT, || local.variant().is_none()));
    // Once the write landed, a reload applies again.
    let mut changed = h.model_json();
    changed["variant"]["anthropic/claude-sonnet"] = json!("low");
    std::fs::write(&file, changed.to_string()).unwrap();
    assert!(h.app.wait_until(WAIT, || local.variant().as_deref() == Some("low")));
}

#[test]
fn a_speed_switches_the_model_and_shows_beside_its_name() {
    let h = mount();
    let local = h.tui.local.clone();
    let sonnet = |id: &str| Some(Model::new("anthropic", id));
    assert_eq!(local.speed(), None);
    let slash = h.tui.keymap.commands().into_iter().find(|command| command.id == "speed.list").and_then(|c| c.slash);
    assert_eq!(slash.map(|slash| (slash.name, slash.aliases)), Some(("speed".to_owned(), vec!["fast".to_owned()])));

    h.tui.keymap.dispatch("speed.list", None);
    h.wait_for("Select speed");
    h.app.press("down");
    h.app.press("return");
    // The speed is a model of its own; the name shown stays the model's, with its variant.
    assert_eq!(local.current(), sonnet("claude-sonnet-fast"));
    assert_eq!(local.speed().as_deref(), Some("fast"));
    assert_eq!(local.standard(), sonnet("claude-sonnet"));
    assert_eq!(local.variant().as_deref(), Some("high"));
    h.wait_for("Claude Sonnet Anthropic · high · fast");
    h.wait_file(|file| file["speed"]["anthropic/claude-sonnet"] == "fast");

    // Slowest, standard, fastest, around.
    h.tui.keymap.dispatch("speed.cycle", None);
    assert_eq!(local.current(), sonnet("claude-sonnet-flex"));
    h.tui.keymap.dispatch("speed.cycle", None);
    assert_eq!(local.current(), sonnet("claude-sonnet"));
    h.wait_file(|file| file["speed"].as_object().is_some_and(|speed| speed.is_empty()));

    // A model without speeds has no speed commands.
    local.set(&Model::new("openai", "gpt-5"), false);
    assert!(h.tui.keymap.commands().iter().all(|command| !command.id.starts_with("speed.")));
    assert_no_writes(&h.fixture);
}

#[test]
fn a_model_runs_at_its_last_speed_and_lists_name_it_once() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let fast = model_ref("anthropic", "claude-sonnet-fast");
    let preferences = json!({
        "recent": [model_ref("anthropic", "claude-sonnet-flex"), model_ref("anthropic", "claude-sonnet")],
        "favorite": [fast, model_ref("anthropic", "claude-sonnet")],
        "variant": {},
        "speed": { "anthropic/claude-sonnet": "fast", "openai/gpt-5": "fast" },
    });
    std::fs::write(paths.state.join("model.json"), preferences.to_string()).unwrap();
    let deps = Deps { roots: support::roots(paths, "test"), route: Route::Home, ..support::deps(Server::new()) };
    let h = support::mount(100, 34, deps);
    let local = h.tui.local.clone();
    assert!(h.app.wait_until(WAIT, || local.ready() && local.catalog_ready() && !local.agents().is_empty()));
    assert_eq!(local.current(), Some(Model::new("anthropic", "claude-sonnet-fast")));
    assert_eq!(local.recent(), [Model::new("anthropic", "claude-sonnet")]);
    assert_eq!(local.favorite(), [Model::new("anthropic", "claude-sonnet")]);
    // A speed the model does not have is its standard speed.
    local.set(&Model::new("openai", "gpt-5"), false);
    assert_eq!(local.current(), Some(Model::new("openai", "gpt-5")));
    // Removing the favorite removes the entry saved at another speed too.
    local.toggle_favorite(&Model::new("anthropic", "claude-sonnet"));
    assert!(local.favorite().is_empty());
}

#[test]
fn a_speed_switch_uses_the_targets_legacy_variant_instead_of_its_siblings() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    // Saved before speeds shared their model's variant.
    let preferences = json!({
        "recent": [],
        "favorite": [],
        "variant": { "anthropic/claude-sonnet-flex": "low", "anthropic/claude-sonnet-fast": "high" },
        "speed": {},
    });
    std::fs::write(paths.state.join("model.json"), preferences.to_string()).unwrap();
    let deps = Deps { roots: support::roots(paths, "test"), route: Route::Home, ..support::deps(Server::new()) };
    let h = support::mount(100, 34, deps);
    let local = h.tui.local.clone();
    assert!(h.app.wait_until(WAIT, || local.ready() && local.catalog_ready() && !local.agents().is_empty()));
    assert_eq!(local.current(), Some(Model::new("anthropic", "claude-sonnet")));
    assert_eq!(local.variant().as_deref(), Some("low"));
    local.set_speed(Some("fast"));
    assert_eq!(local.current(), Some(Model::new("anthropic", "claude-sonnet-fast")));
    assert_eq!(local.variant().as_deref(), Some("high"));
}

#[test]
fn a_session_switched_to_a_hidden_agent_reports_it_as_current_without_listing_it() {
    use opencode_api::memory::{Memory, Route as MemoryRoute};
    let dir = "/project";
    let location = json!({ "directory": dir, "project": { "id": "p", "directory": dir, "canonical": dir } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let session = json!({
        "id": "ses_hidden", "title": "Hidden", "agent": "helper", "projectID": "p", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 }, "location": { "directory": dir },
    });
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [session], "cursor": {} })),
        MemoryRoute::json(
            "GET",
            "/api/agent",
            200,
            &list(json!([
                support::agent("build", "primary", false),
                support::agent("plan", "primary", false),
                support::agent("helper", "primary", true),
            ])),
        ),
        MemoryRoute::json("GET", "/api/provider", 200, &list(json!([{ "id": "demo", "name": "Demo" }]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([support::model("demo", "first", "First")]))),
        MemoryRoute::body("POST", "/api/session/ses_hidden/agent", 204, None, ""),
        MemoryRoute::body("POST", "/api/session/ses_hidden/model", 204, None, ""),
    ];
    routes.extend(support::session_routes(&session));
    let deps = Deps {
        directory: dir.into(),
        route: support::session_route("ses_hidden"),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    h.wait("hidden agent is active", || h.tui.local.agent().is_some_and(|agent| agent.id.0 == "helper"));
    let listed: Vec<String> = h.tui.local.agents().into_iter().map(|agent| agent.id.0).collect();
    assert_eq!(listed, ["build", "plan"]);
    h.tui.local.move_agent(1);
    assert_eq!(h.tui.local.agent().map(|agent| agent.id.0).as_deref(), Some("build"));
}

#[test]
fn leader_a_switches_the_agent() {
    let h = mount();
    h.app.press("ctrl+x");
    h.app.press("a");
    let screen = h.wait_for("Search agents");
    assert!(!screen.contains("general"), "subagents are hidden:\n{screen}");
    h.app.press("down");
    h.app.press("return");
    assert_eq!(h.tui.local.agent().map(|agent| agent.id.0).as_deref(), Some("plan"));
    assert!(!h.tui.dialogs.is_open());
}

#[test]
fn usage_opens_from_its_command_and_a_row_opens_its_limits() {
    let h = mount();
    h.tui.keymap.dispatch("usage.show", None);
    h.wait_for("$0.50 left");
    h.app.press("return");
    let screen = h.wait_for("Usage › Claude Sonnet");
    assert!(screen.contains("$9.50 used of $10"), "{screen}");
    assert!(screen.contains("Only you"), "{screen}");
    assert_no_writes(&h.fixture);
}

#[test]
fn model_json_is_shared_with_the_typescript_client() {
    let Some(oracle) = support::oracle("E.16-model-json.ts") else { return };
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
    let read = run(&oracle, &["load", h.state.to_str().unwrap()]);
    assert_eq!(
        read,
        json!({
            "recent": [model_ref("anthropic", "claude-haiku")],
            "favorite": [model_ref("anthropic", "claude-haiku"), model_ref("openai", "gpt-5")],
            "variant": { "anthropic/claude-sonnet": "default" },
            "speed": {},
        })
    );
    // An independent writer uses the same lock; the TUI should pick up its update through the watcher.
    run(&oracle, &["recent", h.state.to_str().unwrap(), "openai", "gpt-5-mini"]);
    let local = h.tui.local.clone();
    let reloaded = h.app.wait_until(WAIT, || local.recent().first() == Some(&Model::new("openai", "gpt-5-mini")));
    assert!(reloaded, "the watcher never reloaded: {:?}", local.recent());
    assert_eq!(local.favorite().len(), 2);
}

#[test]
fn go_upsell_is_offered_once_a_day_and_remembers_dont_show() {
    let h = mount();
    let local = h.tui.local.clone();
    let storage = Storage::new(&h.state, "test").unwrap();
    let offer = || Offer { reset: None, can_continue: Rc::new(|| true), on_subscribe: Rc::new(|| {}) };
    let now = 1_800_000_000_000.0;
    go_upsell::offer(&local, offer(), now);
    h.wait_for("Free limit reached");
    let stored = storage.load("go-upsell", &json!({})).unwrap();
    assert_eq!(stored, json!({ "lastSeenAt": now as i64 }));
    h.app.press("left");
    h.app.press("return");
    assert!(!h.tui.dialogs.is_open());
    go_upsell::offer(&local, offer(), now + 1000.0);
    h.app.wait_until(Duration::from_millis(200), || false);
    assert!(!h.tui.dialogs.is_open());
    go_upsell::offer(&local, offer(), now + 86_400_000.0);
    h.wait_for("Free limit reached");
    h.app.press("left");
    h.app.press("left");
    h.app.press("return");
    let saved = h.app.wait_until(WAIT, || storage.load("go-upsell", &json!({})).unwrap()["dontShow"] == true);
    assert!(saved, "{}", storage.load("go-upsell", &json!({})).unwrap());
    assert_no_writes(&h.fixture);
}

#[test]
fn lists_every_provider_of_the_integration_just_connected() {
    let dir = "/tmp/opencode/app";
    let fake = support::Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/location") => (200, support::location(dir)),
        ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/integration") => (
            200,
            support::list(
                dir,
                json!([{
                    "id": "opencode",
                    "name": "OpenCode",
                    "methods": [{ "type": "oauth", "id": "oauth", "label": "OpenCode account" }],
                    "connections": [{ "type": "credential", "id": "cred_1", "label": "Personal", "method": "oauth" }],
                }]),
            ),
        ),
        ("GET", "/api/provider") => (
            200,
            support::list(
                dir,
                json!([
                    {
                        "id": "opencode", "name": "Personal / OpenCode", "integrationID": "opencode",
                        "activation": "enabled", "package": "opencode",
                    },
                    {
                        "id": "opencode-go", "name": "OpenCode Go", "integrationID": "opencode",
                        "activation": "enabled", "package": "opencode",
                    },
                    { "id": "ollama", "name": "Ollama", "activation": "enabled", "package": "openai-compatible" },
                ]),
            ),
        ),
        ("GET", "/api/model") => (
            200,
            support::list(
                dir,
                json!([
                    support::model("opencode", "zen", "Zen Model"),
                    support::model("opencode-go", "go", "Go Model"),
                    support::model("ollama", "local", "Local Model"),
                ]),
            ),
        ),
        _ => support::base(seen, dir),
    });
    let home = opencode_util::temp::tempdir().unwrap();
    let deps = Deps {
        directory: dir.into(),
        roots: support::roots(support::home_paths(home.path()), "test"),
        route: Route::Home,
        ..support::deps(Arc::new(fake))
    };
    let h = support::mount(100, 34, deps);
    let local = h.tui.local.clone();
    assert!(h.app.wait_until(WAIT, || local.ready() && local.catalog_ready() && local.connected()));
    model::show(&local, Some("opencode".into()));
    let screen = h.wait_for("Search models");
    assert!(screen.contains("Zen Model"), "{screen}");
    assert!(screen.contains("Go Model"), "{screen}");
    assert!(!screen.contains("Local Model"), "{screen}");
}

#[test]
fn lists_models_of_a_provider_declared_only_in_config() {
    let dir = "/tmp/opencode/app";
    let free = support::merge(
        support::model("opencode", "free", "Free Model"),
        json!({ "cost": [{ "input": 0, "output": 0, "cache": { "read": 0, "write": 0 } }] }),
    );
    let local_model = support::model("ollama", "local", "Local Model");
    let fake = support::Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/location") => (200, support::location(dir)),
        ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/integration") => (
            200,
            support::list(
                dir,
                json!([{
                    "id": "ollama",
                    "name": "Ollama",
                    "methods": [{ "type": "key" }],
                    "connections": [],
                }]),
            ),
        ),
        ("GET", "/api/provider") => (
            200,
            support::list(
                dir,
                json!([
                    { "id": "opencode", "name": "OpenCode", "activation": "auto", "package": "opencode" },
                    { "id": "ollama", "name": "Ollama", "activation": "enabled", "package": "openai-compatible" },
                ]),
            ),
        ),
        ("GET", "/api/model") => (200, support::list(dir, json!([free.clone(), local_model.clone()]))),
        _ => support::base(seen, dir),
    });
    let home = opencode_util::temp::tempdir().unwrap();
    let deps = Deps {
        directory: dir.into(),
        roots: support::roots(support::home_paths(home.path()), "test"),
        route: Route::Home,
        ..support::deps(Arc::new(fake))
    };
    let h = support::mount(100, 34, deps);
    let local = h.tui.local.clone();
    assert!(h.app.wait_until(WAIT, || {
        local.ready()
            && local.catalog_ready()
            && local.integrations().is_some()
            && !local.providers(|providers| providers.is_empty())
    }));
    model::show(&local, None);
    let screen = h.wait_for("Local Model");
    assert!(!screen.contains("Free models"), "{screen}");
}

#[test]
fn opens_the_free_models_list_without_a_connection_or_a_configured_provider() {
    let dir = "/tmp/opencode/app";
    let free = support::merge(
        support::model("opencode", "free", "Free Model"),
        json!({ "cost": [{ "input": 0, "output": 0, "cache": { "read": 0, "write": 0 } }] }),
    );
    let fake = support::Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/location") => (200, support::location(dir)),
        ("GET", "/api/session") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/provider") => (
            200,
            support::list(
                dir,
                json!([{ "id": "opencode", "name": "OpenCode", "activation": "auto", "package": "opencode" }]),
            ),
        ),
        ("GET", "/api/model") => (200, support::list(dir, json!([free.clone()]))),
        _ => support::base(seen, dir),
    });
    let home = opencode_util::temp::tempdir().unwrap();
    let deps = Deps {
        directory: dir.into(),
        roots: support::roots(support::home_paths(home.path()), "test"),
        route: Route::Home,
        ..support::deps(Arc::new(fake))
    };
    let h = support::mount(100, 34, deps);
    let local = h.tui.local.clone();
    assert!(h.app.wait_until(WAIT, || {
        local.ready()
            && local.catalog_ready()
            && local.integrations().is_some()
            && !local.providers(|providers| providers.is_empty())
    }));
    model::show(&local, None);
    h.wait_for("Free models");
}

#[test]
fn a_closed_go_upsell_is_freed() {
    let h = mount();
    let offer = Offer { reset: None, can_continue: Rc::new(|| true), on_subscribe: Rc::new(|| {}) };
    go_upsell::offer(&h.tui.local, offer, 1_800_000_000_000.0);
    h.wait_for("Free limit reached");
    let marker = Rc::new(());
    assert!(support::mark(&h.app, h.tui.dialogs.host(), 2, &marker) > 0);
    let (x, y) = h.find("dismiss");
    h.app.hover(x, y);
    h.app.click(x, y);
    assert!(!h.tui.dialogs.is_open());
    h.app.render();
    assert_eq!(Rc::strong_count(&marker), 1);
}

fn assert_no_writes(fixture: &Server) {
    let seen = fixture.seen();
    assert!(seen.iter().all(|(method, _)| method == "GET"), "a dialog sent a mutating request: {seen:?}");
    assert!(seen.iter().all(|(_, path)| !path.contains("session/stats")));
}

fn run(script: &Path, args: &[&str]) -> Value {
    let cache = std::env::temp_dir().join("opencode-rs-e16-bun-cache");
    support::bun_json(Command::new("bun").arg(script).args(args).env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", cache), None)
}
