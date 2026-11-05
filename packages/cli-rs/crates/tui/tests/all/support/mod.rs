//! Shared setup for the TUI integration tests: a fake server with a baseline route table, a mount with default
//! [`Deps`], and the wait and screen helpers.

pub mod ide;

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

/// One request the fake server saw.
#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    /// The raw query, without `?`.
    pub query: String,
    /// The JSON body, or `null`.
    pub body: Value,
    pub headers: Vec<(String, String)>,
}

impl Seen {
    /// The path with its query.
    pub fn url(&self) -> String {
        if self.query.is_empty() { self.path.clone() } else { format!("{}?{}", self.path, self.query) }
    }

    /// The value of one query parameter, or an empty string.
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

/// The requests in `log` as `METHOD path` lines.
pub fn lines(log: &Log) -> Vec<String> {
    log.lock().unwrap().iter().map(|seen| format!("{} {}", seen.method, seen.path)).collect()
}

type Handler = Box<dyn Fn(&Seen) -> Reply + Send + Sync>;

/// A fake server: logs each request, then answers it with the handler's reply.
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

/// A JSON response; a 204 has no body.
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

/// An empty session list; anything else is a 404.
pub fn empty() -> Fake {
    Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, json!({ "data": [], "cursor": {} })),
        _ => not_found(),
    })
}

/// The routes most fixtures serve, for a location at `directory`: session `ses_a` with no messages, the `build`
/// agent and "Model M", empty catalogs and request lists, an echo of each prompt, and 204 for model and agent
/// writes. Anything else is a 404.
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
        ("POST", _) if path.ends_with("/prompt") => (200, prompted(seen, "steer")),
        ("POST", _) if path.ends_with("/model") || path.ends_with("/agent") => (204, Value::Null),
        _ => not_found(),
    }
}

/// The server's answer to a prompt: the user message of the session the path names, in `delivery`.
pub fn prompted(seen: &Seen, delivery: &str) -> Value {
    json!({ "data": {
        "id": seen.body["id"], "sessionID": seen.path.split('/').nth(3), "time": { "created": 1 }, "type": "user",
        "payload": { "text": seen.body["text"] }, "delivery": delivery,
    } })
}

/// A location-scoped list response.
pub fn list(directory: &str, data: Value) -> Value {
    json!({ "location": { "directory": directory }, "data": data })
}

/// `/api/location` for a project rooted at `directory`.
pub fn location(directory: &str) -> Value {
    json!({ "directory": directory, "project": { "id": "project", "directory": directory, "canonical": directory } })
}

/// A session at [`DIRECTORY`] with no agent or model.
pub fn session(id: &str, title: &str) -> Value {
    json!({
        "id": id, "title": title, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": DIRECTORY },
    })
}

/// A session at [`DIRECTORY`] in project `proj_test`, as the in-memory route tables serve it.
pub fn test_session(id: &str, title: &str) -> Value {
    merge(session(id, title), json!({ "projectID": "proj_test" }))
}

/// In-memory routes for `session`: itself, no messages, and empty inbox, permission and form lists.
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

/// `ses_a` "Fix the parser" on the `build` agent and Model M, as [`base`] serves it.
pub fn catalog_session() -> Value {
    merge(session("ses_a", "Fix the parser"), json!({ "agent": "build", "model": { "providerID": "p", "id": "m" } }))
}

/// `value` with each field of `extra` set.
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

/// The TUI's inputs over `transport`: [`DIRECTORY`], the default config, no roots, session `ses_a`, and no
/// event stream.
pub fn deps(transport: Arc<dyn Transport>) -> Deps {
    Deps {
        client: Client::with_transport("http://opencode.local", transport).unwrap(),
        directory: DIRECTORY.into(),
        config: config(Info::default()),
        roots: None,
        route: session_route("ses_a"),
        continue_: false,
        events: false,
    }
}

pub fn config(info: Info) -> Resolved {
    Resolved::new(info, |_| None)
}

/// A config from `cli.json` text.
pub fn decode(text: &str) -> Info {
    cli_config::decode_text(text).unwrap()
}

/// [`Info`] with animations off.
pub fn still() -> Info {
    Info { animations: Some(false), ..Info::default() }
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

/// The roots a real run with `HOME=home` uses.
pub fn home_paths(home: &Path) -> Paths {
    let home = home.to_owned();
    Paths::from_vars(|name| (name == "HOME").then(|| home.clone().into_os_string())).unwrap()
}

pub fn roots(paths: Paths, channel: &str) -> Option<Roots> {
    Some(Roots { paths, storage_channel: channel.into() })
}

/// An app that clears with the dark `opencode` theme's page background, as the TS screens do, so a dialog's
/// backdrop blends over the same color.
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

/// The TypeScript checkout the P-FILE tests run: `OPENCODE_TS_ROOT`, else this one.
pub fn ts_root() -> Option<PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.."));
    let present =
        root.join("node_modules").is_dir() && std::process::Command::new("bun").arg("--version").output().is_ok();
    if !present {
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", root.display());
    }
    present.then_some(root)
}

/// The harness config of `parity/lib/component.tsx` (the dark `opencode` theme, no animations) plus `extra`.
pub fn component_info(extra: Value) -> Info {
    cli_config::merge(&[
        Some(json!({ "theme": { "name": "opencode", "mode": "dark" }, "animations": false })),
        Some(extra),
    ])
}

/// The variables that put every root of a run under `home`.
fn xdg_env(home: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        ("HOME", home.to_path_buf()),
        ("XDG_CONFIG_HOME", home.join("config")),
        ("XDG_STATE_HOME", home.join("state")),
        ("XDG_DATA_HOME", home.join("data")),
        ("XDG_CACHE_HOME", home.join("cache")),
    ]
}

/// The roots a run with [`xdg_env`] uses, as the TS `Config` service in [`ts_config`] sees them.
pub fn xdg_paths(home: &Path) -> Paths {
    let vars = xdg_env(home);
    Paths::from_vars(|name| vars.iter().find(|(key, _)| *key == name).map(|(_, value)| value.clone().into_os_string()))
        .unwrap()
}

/// One op of the F.5 oracle's `config` command in `home`, or `None` without bun and `node_modules`.
pub fn ts_config(home: &Path, op: Value) -> Option<Value> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap();
    if !root.join("node_modules").is_dir() || Command::new("bun").arg("--version").output().is_err() {
        eprintln!("skipped the TypeScript side: needs bun and node_modules");
        return None;
    }
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.5-config.ts");
    let mut command = Command::new("bun");
    command
        .arg("--cwd")
        .arg(root.join("packages/cli"))
        .arg(script)
        .arg(&root)
        .arg("config")
        .env_remove("OPENCODE_CLI_CONFIG_CONTENT")
        .env_remove("OPENCODE_CONFIG_DIR")
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", std::env::temp_dir().join("opencode-rs-f5-bun-cache"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in xdg_env(home) {
        command.env(name, value);
    }
    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(json!([op]).to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8(output.stdout).unwrap();
    let mut results: Vec<Value> = serde_json::from_str(stdout.lines().last().unwrap()).unwrap();
    Some(results.remove(0))
}

/// A mounted TUI and its app.
pub struct Harness {
    pub app: TestApp,
    pub tui: Rc<Tui>,
}

pub fn mount(width: u16, height: u16, deps: Deps) -> Harness {
    mount_on(TestApp::new(width, height), deps, Args::default())
}

/// Home over [`empty`], with `info` and `roots`.
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

    /// The prompt's text.
    pub fn text(&self) -> String {
        self.textarea().text()
    }

    /// The cell where `needle` first starts on screen.
    #[track_caller]
    pub fn find(&self, needle: &str) -> (u16, u16) {
        let screen = self.app.text();
        at(&screen, needle).unwrap_or_else(|| panic!("{needle:?} is not on screen:\n{screen}"))
    }

    /// Runs a keymap command and lets it draw.
    pub fn dispatch(&self, command: &str) {
        self.tui.keymap.dispatch(command, None);
        self.app.advance(Duration::from_millis(1));
    }

    pub fn leader(&self, key: &str) {
        self.app.press("ctrl+x");
        self.app.press(key);
    }

    /// Hides everything but the dialog host, as the TS scripts render a dialog alone.
    pub fn only_dialog(&self) {
        let host = self.tui.dialogs.host().id();
        for child in self.app.root().children() {
            if child.id() != host {
                child.visible(false);
            }
        }
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

/// The cell where `needle` first starts in `screen`.
pub fn at(screen: &str, needle: &str) -> Option<(u16, u16)> {
    screen.lines().enumerate().find_map(|(y, line)| {
        let byte = line.find(needle)?;
        Some((line[..byte].chars().count() as u16, y as u16))
    })
}
