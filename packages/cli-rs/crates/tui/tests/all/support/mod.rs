//! Shared setup for the TUI integration tests: a fake server with a baseline route table, a mount with default
//! [`Deps`], and the wait and screen helpers.

pub mod heap;
pub mod ide;
pub mod model;
pub mod probe;

use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::memory;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{self, Info, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::{Args, Deps, Route, Tui};
use opentui::AppOptions;
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// The ceiling for [`TestApp::wait_until`]. A wait returns as soon as its condition holds, so this only bounds
/// a failing test; it is long because a loaded machine (other builds and test runs on it) can take seconds to
/// deliver a fixture response or a file write.
pub const WAIT: Duration = Duration::from_secs(30);

/// The directory the tests open, unless a test names another.
pub const DIRECTORY: &str = "/project";

/// A status and a JSON body. A 204 is sent without a body.
pub type Reply = (u16, Value);

#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    /// The raw query, without `?`.
    pub query: String,
    pub body: Value,
    pub headers: Vec<(String, String)>,
}

impl Seen {
    pub fn url(&self) -> String {
        if self.query.is_empty() { self.path.clone() } else { format!("{}?{}", self.path, self.query) }
    }

    pub fn param(&self, name: &str) -> String {
        url::form_urlencoded::parse(self.query.as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default()
    }

    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone())
    }
}

/// Every request a [`Fake`] saw, in order.
pub type Log = Arc<Mutex<Vec<Seen>>>;

pub fn lines(log: &Log) -> Vec<String> {
    log.lock().unwrap().iter().map(|seen| format!("{} {}", seen.method, seen.path)).collect()
}

type Handler = Box<dyn Fn(&Seen) -> Reply + Send + Sync>;

pub struct Fake {
    log: Log,
    handler: Handler,
}

impl Fake {
    pub fn new(handler: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Self {
        Self { log: Log::default(), handler: Box::new(handler) }
    }

    pub fn log(&self) -> Log {
        self.log.clone()
    }
}

impl Transport for Fake {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let seen = Seen {
            method: request.method.to_owned(),
            path: request.url.path().to_owned(),
            query: request.url.query().unwrap_or_default().to_owned(),
            body: request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null),
            headers: request.headers.clone(),
        };
        self.log.lock().unwrap().push(seen.clone());
        let (status, body) = (self.handler)(&seen);
        Box::pin(async move { Ok(respond(status, &body)) })
    }
}

pub fn respond(status: u16, body: &Value) -> Response {
    let bytes = if status == 204 { Vec::new() } else { serde_json::to_vec(body).unwrap() };
    Response {
        status,
        headers: vec![("content-type".into(), "application/json".into())],
        body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(bytes))])),
    }
}

pub fn not_found() -> Reply {
    (404, json!({}))
}

pub fn empty() -> Fake {
    Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, json!({ "data": [], "cursor": {} })),
        _ => not_found(),
    })
}

pub fn base(seen: &Seen, directory: &str) -> Reply {
    let path = seen.path.as_str();
    match (seen.method.as_str(), path) {
        ("GET", "/api/session") => (200, json!({ "data": [catalog_session()], "cursor": {} })),
        ("GET", "/api/session/ses_a") => (200, json!({ "data": catalog_session() })),
        ("GET", "/api/session/ses_a/message") => (200, json!({ "data": [], "cursor": {} })),
        ("GET", "/api/agent") => (200, list(directory, json!([agent("build", "primary", false)]))),
        ("GET", "/api/model") => (200, list(directory, json!([model("p", "m", "Model M")]))),
        ("GET", "/api/location") => (200, location(directory)),
        (
            "GET",
            "/api/provider"
            | "/api/integration"
            | "/api/form"
            | "/api/permission/request"
            | "/api/command"
            | "/api/skill"
            | "/api/reference",
        ) => (200, list(directory, json!([]))),
        ("GET", _) if path.ends_with("/form") || path.ends_with("/permission") => (200, json!({ "data": [] })),
        ("GET", "/api/config") => (200, json!([])),
        // Report migration complete; a fixture 404 would produce an unrelated delayed toast.
        ("GET", "/api/experimental/migration/v1") => (200, json!({ "status": "completed" })),
        ("POST", _) if path.ends_with("/prompt") => (200, prompted(seen, "steer")),
        ("POST", _) if path.ends_with("/model") || path.ends_with("/agent") => (204, Value::Null),
        _ => not_found(),
    }
}

pub fn prompted(seen: &Seen, delivery: &str) -> Value {
    json!({ "data": {
        "id": seen.body["id"], "sessionID": seen.path.split('/').nth(3), "time": { "created": 1 }, "type": "user",
        "payload": { "text": seen.body["text"] }, "delivery": delivery,
    } })
}

pub fn list(directory: &str, data: Value) -> Value {
    json!({ "location": { "directory": directory }, "data": data })
}

pub fn location(directory: &str) -> Value {
    json!({ "directory": directory, "project": { "id": "project", "directory": directory, "canonical": directory } })
}

/// The durable event `kind` of `session`, number `seq` in its aggregate.
pub fn event(session: &str, kind: &str, seq: u64, data: Value) -> opencode_api::generated::V2Event {
    serde_json::from_value(json!({
        "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
        "durable": { "aggregateID": session, "seq": seq, "version": 1 },
        "data": data,
    }))
    .unwrap()
}

/// A user message.
pub fn user(id: &str, created: u64, text: &str) -> Value {
    json!({ "id": id, "type": "user", "text": text, "time": { "created": created } })
}

pub fn session(id: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    })
}

pub fn test_session(id: &str, title: &str) -> Value {
    merge(session(id, title), json!({ "projectID": "proj_test" }))
}

pub fn session_routes(session: &Value) -> Vec<memory::Route> {
    let path = format!("/api/session/{}", session["id"].as_str().unwrap());
    let mut routes = vec![
        memory::Route::json("GET", &path, 200, &json!({ "data": session })),
        memory::Route::json("GET", &format!("{path}/message"), 200, &json!({ "data": [], "cursor": {} })),
    ];
    for list in ["inbox", "permission", "form"] {
        routes.push(memory::Route::json("GET", &format!("{path}/{list}"), 200, &json!({ "data": [] })));
    }
    routes
}

pub fn catalog_session() -> Value {
    merge(session("ses_a", "Fix the parser"), json!({ "agent": "build", "model": { "providerID": "p", "id": "m" } }))
}

pub fn merge(mut value: Value, extra: Value) -> Value {
    for (key, field) in extra.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

pub fn agent(id: &str, mode: &str, hidden: bool) -> Value {
    json!({
        "id": id, "name": id, "mode": mode, "hidden": hidden, "permissions": [],
        "request": { "settings": {}, "headers": {}, "body": {} },
    })
}

pub fn model(provider: &str, id: &str, name: &str) -> Value {
    json!({
        "id": id, "modelID": id, "providerID": provider, "name": name,
        "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
        "variants": [], "time": { "released": 0 }, "cost": [], "status": "active",
        "enabled": true, "limit": { "context": 1000, "output": 100 },
    })
}

pub fn deps(transport: Arc<dyn Transport>) -> Deps {
    Deps {
        client: Client::with_transport("http://opencode.local", transport).unwrap(),
        directory: DIRECTORY.into(),
        config: config(Info::default()),
        roots: None,
        route: session_route("ses_a"),
        continue_: false,
        events: false,
        builtins: vec![opencode_mermaid::plugin().into(), opencode_latex::plugin().into()],
    }
}

pub fn config(info: Info) -> Resolved {
    Resolved::new(info, |_| None)
}

pub fn decode(text: &str) -> Info {
    cli_config::decode_text(text).unwrap()
}

pub fn still() -> Info {
    Info { animations: Some(false), ..Info::default() }
}

/// Run the test body in UTC, spawning the same test in a child when needed.
pub fn in_utc() -> bool {
    if std::env::var("TZ").as_deref() == Ok("UTC") {
        return true;
    }
    let name = std::thread::current().name().map(str::to_owned).expect("a test runs on a thread named by its path");
    let output = std::process::Command::new(std::env::current_exe().expect("the test binary"))
        .args(["--exact", &name, "--test-threads=1", "--nocapture"])
        .env("TZ", "UTC")
        .output()
        .expect("the test binary runs again");
    let (stdout, stderr) = (String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    print!("{stdout}");
    eprint!("{stderr}");
    assert!(output.status.success() && stdout.contains("1 passed"), "{name} failed in UTC");
    false
}

pub fn session_route(id: &str) -> Route {
    Route::Session { id: SessionID(id.into()) }
}

/// Every root directly under `home`: `home/state`, `home/config`, and so on.
pub fn paths(home: &Path) -> Paths {
    Paths {
        home: home.to_owned(),
        data: home.join("data"),
        cache: home.join("cache"),
        config: home.join("config"),
        state: home.join("state"),
        tmp: home.join("tmp"),
        bin: home.join("bin"),
        log: home.join("log"),
        repos: home.join("repos"),
    }
}

pub fn home_paths(home: &Path) -> Paths {
    let home = home.to_owned();
    Paths::from_vars(|name| (name == "HOME").then(|| home.clone().into_os_string())).unwrap()
}

pub fn roots(paths: Paths, channel: &str) -> Option<Roots> {
    Some(Roots { paths, storage_channel: channel.into() })
}

/// Clear with the dark page background so dialog backdrop blending matches the fixture.
/// A store the thread of `app` owns, drained in `app`'s turns.
pub fn store(app: &App, client: Client, options: opencode_store::Options) -> opencode_store::Data {
    struct Mail;
    let proxy = app.proxy();
    let data = opencode_store::Data::new(client, options, app.runtime(), move || match proxy.send(Mail) {
        Ok(()) => Ok(()),
        Err(opentui::app::ProxyError::Full) => Err(opencode_store::Unwoken::Busy),
        Err(opentui::app::ProxyError::Closed) => Err(opencode_store::Unwoken::Gone),
    });
    let owner = data.clone();
    app.on_message(move |_, _: &Mail| owner.drain());
    data
}

pub fn dark_app(width: u16, height: u16) -> TestApp {
    let theme =
        opencode_ui::theme::Catalog::default().load("opencode", opencode_ui::theme::ThemeMode::Dark).unwrap().theme;
    TestApp::with_options(
        width,
        height,
        AppOptions {
            theme: opentui::theme::Theme { background: theme.background.base, ..opentui::theme::Theme::default() },
            light_theme: None,
            ..AppOptions::default()
        },
    )
}

pub fn ts_root() -> Option<PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.."));
    let present =
        root.join("node_modules").is_dir() && std::process::Command::new("bun").arg("--version").output().is_ok();
    if !present {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT",
            root.display()
        );
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", root.display());
    }
    present.then_some(root)
}

/// The parity oracle `parity/oracle/<name>`, or `None` without the TypeScript test dependencies.
pub fn oracle(name: &str) -> Option<PathBuf> {
    ts_root()?;
    Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle").join(name))
}

/// Runs the TUI oracle `name` under Solid's preload with the checkout `root`, then `args`, `input` on its stdin.
pub fn solid_oracle(name: &str, root: &Path, args: &[&Path], input: &Value) -> Value {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle").join(name);
    bun_json(
        std::process::Command::new("bun")
            .arg("--cwd")
            .arg(root.join("packages/tui"))
            .args(["--preload", "@opentui/solid/preload"])
            .arg(script)
            .arg(root)
            .args(args),
        Some(input),
    )
}

/// Runs a Bun oracle with `input` on its stdin and parses the last line it prints as JSON.
pub fn bun_json(command: &mut std::process::Command, input: Option<&Value>) -> Value {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    if let Some(input) = input {
        stdin.write_all(input.to_string().as_bytes()).unwrap();
    }
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_str(String::from_utf8_lossy(&output.stdout).lines().last().unwrap_or_default()).unwrap()
}

pub fn component_info(extra: Value) -> Info {
    cli_config::merge(&[
        Some(json!({ "theme": { "name": "opencode", "mode": "dark" }, "animations": false })),
        Some(extra),
    ])
}

fn xdg_env(home: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        ("HOME", home.to_path_buf()),
        ("XDG_CONFIG_HOME", home.join("config")),
        ("XDG_STATE_HOME", home.join("state")),
        ("XDG_DATA_HOME", home.join("data")),
        ("XDG_CACHE_HOME", home.join("cache")),
    ]
}

pub fn xdg_paths(home: &Path) -> Paths {
    let vars = xdg_env(home);
    Paths::from_vars(|name| vars.iter().find(|(key, _)| *key == name).map(|(_, value)| value.clone().into_os_string()))
        .unwrap()
}

/// Compares the screen with the P-COMP fixture `name` inside the bounding box of the fixture cells `inside` picks; the
/// cells outside it are taken from the fixture. A mismatch writes the screen to `<temp>/opencode-parity/<name>.json`.
pub fn panel_diff(
    app: &TestApp,
    name: &str,
    expected: &opencode_parity::Fixture,
    inside: impl Fn(&opentui::native::Cell) -> bool,
) -> Result<(), String> {
    let mut actual = opencode_parity::Fixture::from_capture(&app.render());
    let inside: Vec<(u32, u32)> = (0..expected.height)
        .flat_map(|y| (0..expected.width).map(move |x| (x, y)))
        .filter(|&(x, y)| inside(expected.cell(x, y).unwrap()))
        .collect();
    let (left, right) = (inside.iter().map(|p| p.0).min().unwrap(), inside.iter().map(|p| p.0).max().unwrap());
    let (top, bottom) = (inside.iter().map(|p| p.1).min().unwrap(), inside.iter().map(|p| p.1).max().unwrap());
    for y in 0..expected.height {
        for x in 0..expected.width {
            if !(left..=right).contains(&x) || !(top..=bottom).contains(&y) {
                *actual.cell_mut(x, y).unwrap() = expected.cell(x, y).unwrap().clone();
            }
        }
    }
    let comparison = opencode_parity::compare(expected, &actual);
    if comparison.is_equal() {
        return Ok(());
    }
    let path = std::env::temp_dir().join("opencode-parity").join(format!("{name}.json"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, actual.to_json()).unwrap();
    Err(format!("P-COMP {name} (panel {left}..={right} x {top}..={bottom}): {comparison}"))
}

/// Run one reference configuration operation in `home`, or return `None` without the TypeScript test dependencies.
pub fn ts_config(home: &Path, op: Value) -> Option<Value> {
    let root = ts_root()?.canonicalize().unwrap();
    let mut results = bun_json(
        std::process::Command::new("bun")
            .arg("--cwd")
            .arg(root.join("packages/cli"))
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.5-config.ts"))
            .arg(&root)
            .arg("config")
            .env_remove("OPENCODE_CLI_CONFIG_CONTENT")
            .env_remove("OPENCODE_CONFIG_DIR")
            .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", std::env::temp_dir().join("opencode-rs-f5-bun-cache"))
            .envs(xdg_env(home)),
        Some(&json!([op])),
    );
    Some(results[0].take())
}

pub struct Harness {
    pub app: TestApp,
    pub tui: Rc<Tui>,
}

pub fn mount(width: u16, height: u16, deps: Deps) -> Harness {
    mount_on(TestApp::new(width, height), deps, Args::default())
}

/// [`mount`] with the plugin monitor's clock stopped, for rows that count views or compare frames: on a slow runner the
/// real clock can make a built-in slow mid-row, which tells every plugin and draws its claims again, or puts a "Plugin
/// is slow" toast over one of two frames (previews 44303912167 and 44312154568, Windows). A row that measures time sets
/// its own clock.
pub fn mount_still(width: u16, height: u16, deps: Deps) -> Harness {
    let harness = mount(width, height, deps);
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    harness
}

pub fn mount_empty(app: &TestApp, info: Info, roots: Option<Roots>) -> Rc<Tui> {
    opencode_tui::mount(app, Deps { config: config(info), roots, route: Route::Home, ..deps(Arc::new(empty())) })
}

pub fn mount_on(app: TestApp, deps: Deps, args: Args) -> Harness {
    let tui = opencode_tui::mount_with(&app, deps, args);
    Harness { app, tui }
}

/// Lets a test's own setup struct use the [`Harness`] it holds in `harness`.
macro_rules! deref_harness {
    ($name:ty) => {
        impl std::ops::Deref for $name {
            type Target = crate::support::Harness;
            fn deref(&self) -> &crate::support::Harness {
                &self.harness
            }
        }
    };
}
pub(crate) use deref_harness;

impl Harness {
    /// Waits until the screen shows `text`, and returns the screen.
    #[track_caller]
    pub fn wait_for(&self, text: &str) -> String {
        wait_for(&self.app, text)
    }

    /// Waits until the screen shows every one of `texts`, and returns the screen. Use it when the texts come from
    /// different reads or events, so one of them can show in a frame before another.
    #[track_caller]
    pub fn wait_for_all(&self, texts: &[&str]) -> String {
        wait_for_all(&self.app, texts)
    }

    #[track_caller]
    pub fn wait_gone(&self, text: &str) {
        let gone = self.app.wait_until(WAIT, || !self.app.text().contains(text));
        assert!(gone, "{text:?} stayed:\n{}", self.app.text());
    }

    /// Waits for `done`, naming `what` if it never holds.
    #[track_caller]
    pub fn wait(&self, what: &str, done: impl Fn() -> bool) {
        assert!(self.app.wait_until(WAIT, done), "{what}:\n{}", self.app.text());
    }

    pub fn textarea(&self) -> Textarea {
        self.tui.textarea.borrow().clone().unwrap()
    }

    pub fn text(&self) -> String {
        self.textarea().text()
    }

    /// The cell where `needle` first starts on screen.
    #[track_caller]
    pub fn find(&self, needle: &str) -> (u16, u16) {
        let screen = self.app.text();
        at(&screen, needle).unwrap_or_else(|| panic!("{needle:?} is not on screen:\n{screen}"))
    }

    pub fn dispatch(&self, command: &str) {
        self.tui.keymap.dispatch(command, None);
        self.app.advance(Duration::from_millis(1));
    }

    pub fn leader(&self, key: &str) {
        self.app.press("ctrl+x");
        self.app.press(key);
    }

    pub fn only_dialog(&self) {
        let host = self.tui.dialogs.host().id();
        for child in self.app.root().children() {
            if child.id() != host {
                child.visible(false);
            }
        }
    }
}

/// Gives each widget on screen under `root` a handler that holds `marker`, leaving out the `keep` levels below `root`
/// that outlive what they show. Once those widgets are freed, `marker` is the only reference left. Returns how many
/// widgets it marked.
pub fn mark(app: &TestApp, root: &impl Widget, keep: usize, marker: &Rc<()>) -> usize {
    app.render();
    let (width, height) = app.app().size();
    let mut marked = std::collections::HashSet::new();
    for (x, y) in (0..height).flat_map(|y| (0..width).map(move |x| (x, y))) {
        let chain: Vec<AnyWidget> =
            std::iter::successors(app.app().widget_at(x, y), |widget| widget.parent()).collect();
        let Some(level) = chain.iter().position(|widget| widget.id() == root.id()) else { continue };
        for widget in &chain[..level.saturating_sub(keep)] {
            if marked.insert(widget.id()) {
                let marker = marker.clone();
                widget.on_resize(move |_, _| {
                    let _ = &marker;
                });
            }
        }
    }
    marked.len()
}

#[track_caller]
pub fn mark_at(app: &TestApp, needle: &str, levels: usize, marker: &Rc<()>) {
    let (x, y) = at(&app.text(), needle).unwrap_or_else(|| panic!("{needle:?} is not on screen:\n{}", app.text()));
    for widget in std::iter::successors(app.app().widget_at(x, y), |widget| widget.parent()).take(levels) {
        let marker = marker.clone();
        widget.on_resize(move |_, _| {
            let _ = &marker;
        });
    }
}

/// Waits until `app` shows `text`, and returns the screen.
#[track_caller]
pub fn wait_for(app: &TestApp, text: &str) -> String {
    let found = app.wait_until(WAIT, || app.text().contains(text));
    let screen = app.text();
    assert!(found, "{text:?} never showed:\n{screen}");
    screen
}

/// Waits until `app` shows every one of `texts`, and returns the screen.
#[track_caller]
pub fn wait_for_all(app: &TestApp, texts: &[&str]) -> String {
    let found = app.wait_until(WAIT, || {
        let screen = app.text();
        texts.iter().all(|text| screen.contains(text))
    });
    let screen = app.text();
    let missing: Vec<_> = texts.iter().filter(|text| !screen.contains(*text)).collect();
    assert!(found, "{missing:?} never showed:\n{screen}");
    screen
}

/// Waits until `app` draws `parity/fixtures/<name>.json`, then compares it: a frame that shows the text a test waited
/// for can still lack rows that land later.
#[track_caller]
pub fn wait_fixture(app: &TestApp, name: &str) {
    let expected = opencode_parity::Fixture::load(opencode_parity::fixtures_dir().join(format!("{name}.json")))
        .unwrap_or_else(|error| panic!("{error}"));
    app.wait_until(WAIT, || {
        opencode_parity::compare(&expected, &opencode_parity::Fixture::from_capture(&app.render())).is_equal()
    });
    opencode_parity::assert_fixture(&app.render(), name);
}

const SWITCHED: &str = "tokyonight";

/// A mounted TUI and its app, as a test's own harness holds them.
pub trait Mounted {
    fn app(&self) -> &TestApp;
    fn tui(&self) -> &Rc<Tui>;
}

impl<H: std::ops::Deref<Target = Harness>> Mounted for H {
    fn app(&self) -> &TestApp {
        &self.app
    }

    fn tui(&self) -> &Rc<Tui> {
        &self.tui
    }
}

fn switch_theme(harness: &impl Mounted, remount: bool) {
    let tui = harness.tui();
    assert!(tui.theme.borrow_mut().set(SWITCHED));
    tui.theme_changed();
    if remount {
        tui.navigate(Route::clone(&tui.route()));
    }
    harness.app().advance(Duration::from_millis(1));
}

/// Compares a screen restyled in place with one mounted in the new theme. `ready` must name the state to compare,
/// including what a mount's last request draws: a dialog closing is not enough while the content behind it loads.
/// Both screens are waited on together, so neither can drift after its own wait while the other catches up.
#[track_caller]
pub fn assert_restyles_in_place<H: Mounted>(open: impl Fn() -> H, prepare: impl Fn(&H), ready: impl Fn(&str) -> bool) {
    let in_place = open();
    prepare(&in_place);
    switch_theme(&in_place, false);
    let mounted = open();
    switch_theme(&mounted, true);
    prepare(&mounted);
    let shown = in_place.app().wait_until(WAIT, || ready(&in_place.app().text()) && ready(&mounted.app().text()));
    assert!(shown, "the state never showed in place:\n{}\nmounted:\n{}", in_place.app().text(), mounted.app().text());
    let (switched, expected) = (in_place.app().render(), mounted.app().render());
    let differ: Vec<_> = (0..expected.height)
        .flat_map(|y| (0..expected.width).map(move |x| (x, y)))
        .filter(|&(x, y)| switched.cell(x, y) != expected.cell(x, y))
        .collect();
    let first = differ.first().map(|&(x, y)| (x, y, switched.cell(x, y).cloned(), expected.cell(x, y).cloned()));
    assert!(
        differ.is_empty(),
        "{} cells differ from a mount in {SWITCHED}, first {first:?}\nin place:\n{}\nmounted:\n{}",
        differ.len(),
        switched.text(),
        expected.text()
    );
}

/// The cell where `needle` first starts in `screen`.
pub fn at(screen: &str, needle: &str) -> Option<(u16, u16)> {
    screen.lines().enumerate().find_map(|(y, line)| {
        let byte = line.find(needle)?;
        Some((line[..byte].chars().count() as u16, y as u16))
    })
}

/// Temporarily lift host limits for fixtures that measure work above the default limits.
pub fn unlimited() -> opencode_plugin::limits::Restore {
    let most = u64::MAX;
    opencode_plugin::limits::set(opencode_plugin::limits::Limits {
        nodes: most,
        rows: most,
        text: most,
        hunks: most,
        image_bytes: most,
        image_side: most,
        plugin_nodes: most,
        all_nodes: most,
        plugin_content: most,
        all_content: most,
        plugin_images: most,
        all_images: most,
        frame_rows: most,
    })
}
