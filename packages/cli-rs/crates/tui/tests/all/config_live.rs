//! The live config (`rs-ms34-config`): settings writes and outside `cli.json` edits reach every reader at once,
//! as TS's reactive `ConfigProvider` does (`packages/tui/src/config/index.tsx:354-371`), and writes queue
//! instead of dropping.

use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{CliConfig, Info, Resolved};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::dialogs::settings;
use opencode_tui::tabs::Tabs;
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::wait::WAIT;

/// An empty session list; anything else is a 404.
struct Empty;

impl Transport for Empty {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let (status, body) = match request.url.path() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            _ => (404, json!({})),
        };
        let body = serde_json::to_vec(&body).unwrap();
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

fn mount(app: &TestApp, info: Info, roots: Option<Roots>) -> Rc<Tui> {
    let client = Client::with_transport("http://opencode.local", Arc::new(Empty)).unwrap();
    opencode_tui::mount(
        app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(info, |_| None),
            roots,
            route: Route::Home,
            continue_: false,
            events: false,
        },
    )
}

fn paths(home: &Path) -> Paths {
    let vars = [
        ("HOME", home.to_path_buf()),
        ("XDG_CONFIG_HOME", home.join("config")),
        ("XDG_STATE_HOME", home.join("state")),
        ("XDG_DATA_HOME", home.join("data")),
        ("XDG_CACHE_HOME", home.join("cache")),
    ];
    Paths::from_vars(|name| {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.clone().into_os_string())
    })
    .unwrap()
}

/// A TUI over a `cli.json` holding `text` in a temporary home.
fn mount_with_file(app: &TestApp, home: &Path, text: &str) -> (Rc<Tui>, std::path::PathBuf) {
    let paths = paths(home);
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, text).unwrap();
    let info = CliConfig::with_content(&paths, None).get().unwrap();
    let tui = mount(
        app,
        info,
        Some(Roots {
            paths,
            storage_channel: "test".into(),
        }),
    );
    (tui, file)
}

fn set(path: &'static [&'static str], value: Value) -> impl FnOnce(&mut Value) + Send + 'static {
    move |draft| settings::set_path(draft, path, value)
}

#[test]
fn a_settings_write_reaches_the_tabs_and_the_leader_timeout_at_once() {
    let app = TestApp::new(100, 30);
    let tui = mount(&app, Info::default(), None);
    assert!(Tabs::enabled(&tui));
    settings::update(&tui, set(&["tabs", "mode"], json!("off")));
    assert!(
        !Tabs::enabled(&tui),
        "tabs.mode stayed at its startup value"
    );

    // `leader.timeout` shortens the next leader. The leader's deadline is in real time, not the test clock, so
    // the expiry is checked at instants past the press.
    settings::update(&tui, set(&["leader", "timeout"], json!(250)));
    app.press("ctrl+x");
    let pressed = Instant::now();
    assert!(tui.keymap.leader_active());
    assert!(
        tui.keymap
            .expire_leader(pressed + Duration::from_millis(300)),
        "the leader waited for the startup timeout"
    );
    assert!(!tui.keymap.leader_active());
    // And lengthens it.
    settings::update(&tui, set(&["leader", "timeout"], json!(5000)));
    app.press("ctrl+x");
    let pressed = Instant::now();
    assert!(
        !tui.keymap
            .expire_leader(pressed + Duration::from_millis(2500))
    );
    assert!(tui.keymap.leader_active());
    assert!(
        tui.keymap
            .expire_leader(pressed + Duration::from_millis(5100))
    );
    assert!(!tui.keymap.leader_active());
}

#[test]
fn an_outside_cli_json_edit_reloads() {
    let home = tempfile::tempdir().unwrap();
    let app = TestApp::new(100, 30);
    let (tui, file) = mount_with_file(&app, home.path(), "{}\n");
    assert!(Tabs::enabled(&tui));
    // As the TS TUI or an editor would: a new file renamed over the old one.
    let temp = file.with_extension("json.edit");
    std::fs::write(
        &temp,
        "{\n  // edited elsewhere\n  \"tabs\": { \"mode\": \"off\" }\n}\n",
    )
    .unwrap();
    std::fs::rename(&temp, &file).unwrap();
    assert!(
        app.wait_until(WAIT, || !Tabs::enabled(&tui)),
        "the edit never reloaded"
    );
    assert_eq!(
        tui.settings.info().to_value()["tabs"],
        json!({ "mode": "off" })
    );
}

#[test]
fn two_quick_writes_both_reach_the_file() {
    let home = tempfile::tempdir().unwrap();
    let app = TestApp::new(100, 30);
    let (tui, file) = mount_with_file(&app, home.path(), "{}\n");
    settings::update(&tui, set(&["session", "scrollbar"], json!(true)));
    settings::update(&tui, set(&["mouse"], json!(false)));
    let both = || {
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        text.contains("\"scrollbar\": true") && text.contains("\"mouse\": false")
    };
    assert!(
        app.wait_until(WAIT, both),
        "{}",
        std::fs::read_to_string(&file).unwrap()
    );
    assert!(app.wait_until(WAIT, || {
        let info = tui.settings.info();
        info.mouse == Some(false) && info.session.and_then(|s| s.scrollbar) == Some(true)
    }));
}
