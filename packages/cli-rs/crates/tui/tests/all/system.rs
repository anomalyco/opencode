//! System dialogs, plugin management, and update notices.

use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_local::cli_config::Info;
use opencode_parity::{Fixture, fixtures_dir};
use opencode_plugin::abi;
use opencode_tui::dialogs::highlights::Highlight;
use opencode_tui::dialogs::{pair, settings, status, theme_list};
use opencode_tui::features::{highlights, update_notification};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::{self, Fake, Log, WAIT, wait_for};

const DIRECTORY: &str = "/tmp/opencode/app";

type Answer = Box<dyn Fn(&str, &str, &Value) -> Option<(u16, Value)> + Send + Sync>;

fn fake(answer: Answer) -> Fake {
    Fake::new(move |seen| {
        answer(&seen.method, &seen.path, &seen.body).unwrap_or_else(|| match seen.path.as_str() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            _ => support::not_found(),
        })
    })
}

struct Mounted {
    tui: Rc<Tui>,
    log: Log,
}

impl Mounted {
    fn requests(&self, prefix: &str) -> Vec<String> {
        let log = self.log.lock().unwrap();
        log.iter()
            .filter(|seen| seen.url().starts_with(prefix))
            .map(|seen| format!("{} {}", seen.method, seen.url()))
            .collect()
    }
}

fn mount_with(app: &TestApp, info: Info, answer: Answer) -> Mounted {
    mount_on(app, info, answer, false)
}

/// [`mount_with`], with the built-ins' calls across the C ABI's byte shims when `abi` says so.
fn mount_on(app: &TestApp, info: Info, answer: Answer, abi: bool) -> Mounted {
    let fake = fake(answer);
    let log = fake.log();
    let deps = Deps {
        directory: DIRECTORY.into(),
        config: support::config(info),
        route: Route::Home,
        abi_builtins: abi,
        ..support::deps(Arc::new(fake))
    };
    Mounted { tui: opencode_tui::mount(app, deps), log }
}

fn mount(app: &TestApp, info: Info) -> Rc<Tui> {
    mount_with(app, info, Box::new(|_, _, _| None)).tui
}

/// Compares the dialog panel with the fixture: every cell inside the bounding box of the cells whose background is
/// not the backdrop's (the fixture's top-left cell), so the footer band counts. `title` must be in the fixture.
#[track_caller]
fn assert_dialog(app: &TestApp, name: &str, title: &str) {
    app.wait_until(WAIT, || dialog_diff(app, name, title).is_ok());
    if let Err(message) = dialog_diff(app, name, title) {
        panic!("{message}");
    }
}

fn dialog_diff(app: &TestApp, name: &str, title: &str) -> Result<(), String> {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let titled = (0..expected.height).any(|y| {
        let row: String = (0..expected.width).map(|x| expected.cell(x, y).unwrap().symbol.clone()).collect();
        row.contains(title)
    });
    assert!(titled, "{title:?} is not in {name}");
    let backdrop = expected.cell(0, 0).unwrap().bg;
    support::panel_diff(app, name, &expected, |cell| cell.bg != backdrop)
}

fn theme(tui: &Tui) -> String {
    tui.theme.borrow().selected().to_owned()
}

fn configured_theme(tui: &Tui) -> Option<String> {
    tui.settings.info().theme.and_then(|theme| theme.name)
}

#[test]
fn theme_list_matches_typescript_and_previews_in_the_dialog() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, support::component_info(json!({})));
    tui.keymap.dispatch("theme.switch", None);
    wait_for(&app, "Search themes");
    assert_dialog(&app, "E.18b/themes", "Search themes");

    app.press("down");
    app.wait_until(WAIT, || theme(&tui) == "opencode-classic");
    app.render();
    assert_dialog(&app, "E.18b/themes-down", "Search themes");

    // Escape restores the opening theme and writes nothing.
    app.press("escape");
    assert!(!app.text().contains("Search themes"), "{}", app.text());
    assert_eq!(theme(&tui), "opencode");
    assert_eq!(configured_theme(&tui).as_deref(), Some("opencode"));

    // A filter previews its first match; Enter keeps it and writes `theme.name`.
    theme_list::show(&tui, None);
    wait_for(&app, "Search themes");
    app.type_text("tokyo");
    app.wait_until(WAIT, || theme(&tui) == "tokyonight");
    app.render();
    assert_dialog(&app, "E.18b/themes-filter", "tokyo");
    app.press("enter");
    assert!(!app.text().contains("tokyonight"), "{}", app.text());
    assert_eq!(theme(&tui), "tokyonight");
    assert_eq!(configured_theme(&tui).as_deref(), Some("tokyonight"));
}

#[test]
fn clearing_the_filter_previews_the_opening_theme_again() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, support::component_info(json!({})));
    theme_list::show(&tui, None);
    wait_for(&app, "Search themes");
    app.type_text("nord");
    app.wait_until(WAIT, || theme(&tui) == "nord");
    for _ in 0.."nord".len() {
        app.press("backspace");
    }
    app.wait_until(WAIT, || theme(&tui) == "opencode");
    assert_eq!(theme(&tui), "opencode");
    wait_for(&app, "Search themes");
}

#[test]
fn settings_theme_opens_the_list_and_comes_back() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, support::component_info(json!({})));
    settings::show(&tui, Some("theme.name"));
    wait_for(&app, "opencode ↵");
    app.press("enter");
    wait_for(&app, "Search themes");

    app.press("down");
    app.wait_until(WAIT, || theme(&tui) == "opencode-classic");
    app.press("escape");
    wait_for(&app, "Search settings");
    assert_eq!(theme(&tui), "opencode");
    wait_for(&app, "opencode ↵");

    app.press("enter");
    wait_for(&app, "Search themes");
    app.press("down");
    app.wait_until(WAIT, || theme(&tui) == "opencode-classic");
    app.press("enter");
    wait_for(&app, "opencode-classic ↵");
    assert_eq!(configured_theme(&tui).as_deref(), Some("opencode-classic"));
    assert_eq!(theme(&tui), "opencode-classic");
}

fn location() -> Value {
    json!({ "directory": DIRECTORY, "project": { "id": "proj_app", "directory": DIRECTORY, "canonical": DIRECTORY } })
}

fn mcp(list: Value) -> Answer {
    Box::new(move |_, path, _| match path {
        "/api/location" => Some((200, location())),
        "/api/mcp" => Some((200, json!({ "location": location(), "data": list.clone() }))),
        _ => None,
    })
}

#[test]
fn status_matches_typescript() {
    let app = TestApp::new(80, 30);
    let mounted = mount_with(&app, support::component_info(json!({})), mcp(crate::mcp::servers()));
    mounted.tui.keymap.dispatch("opencode.status", None);
    wait_for(&app, "5 MCP servers");
    assert_dialog(&app, "E.18b/status", "Status");
    assert_eq!(mounted.requests("/api/mcp").len(), 1);

    let app = TestApp::new(80, 30);
    let tui = mount_with(&app, support::component_info(json!({})), mcp(json!([]))).tui;
    status::show(&tui);
    wait_for(&app, "No MCP servers");
    assert_dialog(&app, "E.18b/status-empty", "Status");
}

fn server_plugins() -> Value {
    json!([
        {
            "id": "team.plugins",
            "source": { "type": "package", "target": "git+ssh://git@github.com/example/team-plugins.git", "version": "dadba13", "outdated": true },
            "features": { "server": true },
            "state": { "status": "active" },
        },
        {
            "id": "audit",
            "source": { "type": "local", "path": format!("{DIRECTORY}/.opencode/plugins/audit.ts") },
            "features": { "server": true },
            "state": { "status": "failed", "error": "Cannot find module 'zod' from audit.ts", "ref": "err_audit" },
        },
        { "id": "opencode.core", "source": { "type": "builtin" }, "features": { "server": true }, "state": { "status": "active" } },
        { "id": "theme.pack", "source": { "type": "package", "target": "theme-pack" }, "features": { "tui": true }, "state": { "status": "active" } },
    ])
}

fn plugin_server() -> Answer {
    Box::new(|method, path, _| match (method, path) {
        ("GET", "/api/location") => Some((200, location())),
        ("GET", "/api/plugin") => Some((200, json!({ "location": location(), "data": server_plugins() }))),
        ("POST", "/api/plugin/check") => {
            let mut plugins = server_plugins();
            plugins[0]["source"]["outdated"] = json!(false);
            Some((200, json!({ "location": location(), "data": plugins })))
        }
        ("POST", "/api/plugin/update") => Some((204, Value::Null)),
        _ => None,
    })
}

thread_local! {
    static ACTIVATIONS: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

fn team_plugin() -> abi::Plugin {
    fn setup(_: &mut abi::Setup) -> Result<(), String> {
        ACTIVATIONS.set(ACTIVATIONS.get() + 1);
        Ok(())
    }
    abi::Plugin { id: "team.tui", setup }
}

fn plugin_manager(app: &TestApp, extra: Value) -> (Mounted, fn() -> u32) {
    plugin_manager_on(app, extra, false)
}

/// Open the plugin manager linked or through the C ABI.
fn plugin_manager_on(app: &TestApp, extra: Value, abi: bool) -> (Mounted, fn() -> u32) {
    let mounted = mount_on(app, support::component_info(extra), plugin_server(), abi);
    ACTIVATIONS.set(0);
    opencode_tui::plugins::host::add(&mounted.tui, team_plugin().into());
    (mounted, || ACTIVATIONS.get())
}

fn active(tui: &Tui, id: &str) -> bool {
    tui.plugins.entries().iter().any(|entry| entry.id == id && entry.status == opencode_plugin::Status::Active)
}

#[test]
fn plugin_manager_matches_typescript() {
    for abi in crate::support::LOOPBACK {
        plugin_manager_matches_typescript_on(abi);
    }
}

fn plugin_manager_matches_typescript_on(abi: bool) {
    let app = TestApp::new(100, 30);
    let (mounted, _) = plugin_manager_on(&app, json!({}), abi);
    mounted.tui.keymap.dispatch("plugins.list", None);
    wait_for(&app, "team.plugins");
    assert_dialog(&app, "E.18b/plugins", "Plugins");
    assert_eq!(
        mounted.requests("/api/plugin"),
        [
            "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp"
        ]
    );

    app.press("down");
    assert_dialog(&app, "E.18b/plugins-failed", "Plugins");
    app.press("down");
    assert_dialog(&app, "E.18b/plugins-outdated", "Plugins");

    app.press("up");
    app.press("enter");
    wait_for(&app, "Server plugin error");
    assert_dialog(&app, "E.18b/plugins-error", "Server plugin error");
    app.press("escape");
    wait_for(&app, "view error enter");
    assert_dialog(&app, "E.18b/plugins-failed", "Plugins");

    let app = TestApp::new(100, 40);
    let (mounted, _) = plugin_manager_on(&app, json!({}), abi);
    mounted.tui.keymap.dispatch("plugins.list", None);
    wait_for(&app, "team.plugins");
    app.press("ctrl+a");
    wait_for(&app, "hide internal");
    assert_dialog(&app, "E.18b/plugins-internal", "Plugins");
}

#[test]
fn plugin_manager_follows_plugin_updated_under_its_error_view() {
    for abi in crate::support::LOOPBACK {
        plugin_manager_follows_plugin_updated_under_its_error_view_on(abi);
    }
}

fn plugin_manager_follows_plugin_updated_under_its_error_view_on(abi: bool) {
    use opencode_api::memory::{Memory, Route as MemoryRoute};
    let failed = json!([{
        "id": "audit", "source": { "type": "local", "path": format!("{DIRECTORY}/audit.ts") },
        "features": { "server": true }, "state": { "status": "failed", "error": "Cannot find module" },
    }]);
    let memory = Memory::new(vec![
        MemoryRoute::json("GET", "/api/location", 200, &location()),
        MemoryRoute::json("GET", "/api/plugin", 200, &json!({ "location": location(), "data": failed })),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
    ]);
    let app = TestApp::new(100, 30);
    let deps = Deps {
        directory: DIRECTORY.into(),
        config: support::config(support::component_info(json!({}))),
        route: Route::Home,
        events: true,
        abi_builtins: abi,
        ..support::deps(Arc::new(memory.clone()))
    };
    let tui = opencode_tui::mount(&app, deps);
    opencode_tui::features::location::navigate_home(&tui, Some(opencode_store::Location::new("/tmp/other")));
    let reads = || {
        let other = Some(vec!["/tmp/other".to_owned()]);
        memory
            .requests()
            .iter()
            .filter(|seen| seen.path == "/api/plugin" && seen.query.get("location[directory]") == other.as_ref())
            .count()
    };
    tui.keymap.dispatch("plugins.list", None);
    wait_for(&app, "view error enter");
    app.press("enter");
    wait_for(&app, "Server plugin error");
    let before = reads();
    memory.emit(&json!({ "id": "evt_plugins", "created": 1, "type": "plugin.updated", "data": {} }));
    assert!(app.wait_until(WAIT, || reads() > before), "plugin.updated under the error view read nothing");
    app.press("escape");
    wait_for(&app, "view error enter");
    let before = reads();
    memory.emit(&json!({ "id": "evt_plugins_2", "created": 2, "type": "plugin.updated", "data": {} }));
    assert!(app.wait_until(WAIT, || reads() > before), "the list stopped following plugin.updated");
}

#[test]
fn plugin_manager_reads_the_active_location() {
    for abi in crate::support::LOOPBACK {
        let app = TestApp::new(100, 30);
        let (mounted, _) = plugin_manager_on(&app, json!({}), abi);
        plugin_manager_reads_the_active_location_on(&app, &mounted);
    }
}

fn plugin_manager_reads_the_active_location_on(app: &TestApp, mounted: &Mounted) {
    opencode_tui::features::location::navigate_home(&mounted.tui, Some(opencode_store::Location::new("/tmp/other")));
    mounted.tui.keymap.dispatch("plugins.list", None);
    app.wait_until(WAIT, || mounted.requests("/api/plugin").len() == 2);
    assert_eq!(mounted.requests("/api/plugin")[1], "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fother");
}

#[test]
fn the_host_entries_list_and_toggle_like_plugins() {
    let app = TestApp::new(100, 30);
    let (mounted, _) = plugin_manager(&app, json!({}));
    let tui = &mounted.tui;
    let builtins: Vec<String> = tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| entry.source == opencode_plugin::Source::Builtin)
        .map(|entry| entry.id)
        .collect();
    let at = |id: &str| builtins.iter().position(|known| known == id).unwrap();
    assert!(at("opencode.notifications") < at("opencode.plugins") && at("opencode.plugins") < at("opencode.stats"));
    assert_eq!(builtins.last().map(String::as_str), Some("opencode.diffs"));

    let host = opencode_tui::plugins::host::host(tui);
    assert!(tui.plugins.set_active(&host, "opencode.diffs", false));
    assert!(!active(tui, "opencode.diffs"));
    assert!(!matches!(tui.keymap.dispatch("diff.open", None), opentui::keymap::RunResult::Ok));
    assert!(tui.plugins.set_active(&host, "opencode.diffs", true));
    assert!(matches!(tui.keymap.dispatch("diff.open", None), opentui::keymap::RunResult::Ok));
    // The viewer is a plugin, whose navigation is an effect after its command.
    let route = Route::Plugin { id: "opencode.diffs".to_owned(), name: "diff".to_owned() };
    assert!(app.wait_until(WAIT, || tui.route() == route), "{:?}", tui.route());
    app.render();
    assert!(!app.text().contains("Unknown plugin route"), "{}", app.text());
}

#[test]
fn plugin_manager_toggles_checks_and_updates() {
    for abi in crate::support::LOOPBACK {
        plugin_manager_toggles_checks_and_updates_on(abi);
    }
}

fn plugin_manager_toggles_checks_and_updates_on(abi: bool) {
    let app = TestApp::new(100, 30);
    let (mounted, activations) = plugin_manager_on(&app, json!({}), abi);
    let tui = &mounted.tui;
    tui.keymap.dispatch("plugins.list", None);
    wait_for(&app, "disable enter");
    assert_eq!(activations(), 1);

    app.press("enter");
    wait_for(&app, "enable enter");
    assert!(!active(tui, "team.tui"));
    assert!(app.text().contains("inactive"), "{}", app.text());
    app.press("enter");
    wait_for(&app, "disable enter");
    assert!(active(tui, "team.tui"));
    assert_eq!(activations(), 2);

    app.press("down");
    app.press("down");
    wait_for(&app, "update ctrl+u");
    app.press("ctrl+u");
    app.wait_until(WAIT, || mounted.requests("/api/plugin").len() == 4);
    let update = mounted
        .log
        .lock()
        .unwrap()
        .iter()
        .find(|seen| seen.url().starts_with("/api/plugin/update"))
        .map(|seen| seen.body.clone());
    assert_eq!(update, Some(json!({ "targets": ["git+ssh://git@github.com/example/team-plugins.git"] })));

    app.press("ctrl+r");
    wait_for(&app, "dadba13");
    app.wait_until(WAIT, || !app.text().contains("update available"));
    assert!(!app.text().contains("update available"), "{}", app.text());
    assert_eq!(
        mounted.requests("/api/plugin"),
        [
            "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "POST /api/plugin/update?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "GET /api/plugin?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
            "POST /api/plugin/check?location%5Bdirectory%5D=%2Ftmp%2Fopencode%2Fapp",
        ]
    );
}

#[test]
fn a_configured_typescript_plugin_is_listed_as_skipped_with_its_reason() {
    let app = TestApp::new(100, 30);
    let (mounted, _) = plugin_manager(&app, json!({ "plugins": ["./broken.ts"] }));
    mounted.tui.keymap.dispatch("plugins.list", None);
    let screen = wait_for(&app, "skipped, local");
    assert!(screen.contains("./broken.ts"), "{screen}");
    assert!(screen.contains("view error enter"), "{screen}");
    app.press("enter");
    let screen = wait_for(&app, "TUI plugin error");
    assert!(screen.contains(opencode_plugin::SKIPPED), "{screen}");
}

fn pair_server(fails: bool) -> Answer {
    Box::new(move |_, path, _| match path {
        "/api/location" => Some((200, location())),
        "/api/info" => Some((
            200,
            json!({
                "version": "0.0.0-test", "pid": 4242,
                "urls": ["http://127.0.0.1:4096/", "http://192.168.1.20:4096/"], "paths": { "tmp": "/tmp" },
            }),
        )),
        "/api/pair" if fails => Some((503, json!({ "_tag": "ServiceUnavailable", "message": "Pairing is disabled" }))),
        "/api/pair" => Some((200, json!({ "code": "XK7Q2M", "expires_in": 600 }))),
        _ => None,
    })
}

#[test]
fn pair_matches_typescript() {
    let app = TestApp::new(100, 40);
    let mounted = mount_with(&app, support::component_info(json!({})), pair_server(false));
    mounted.tui.keymap.dispatch("server.pair", None);
    wait_for(&app, "expire in");
    assert_dialog(&app, "E.18b/pair", "Pair");
    assert_eq!(mounted.requests("/api/pair"), ["POST /api/pair"]);
    assert_eq!(mounted.requests("/api/info"), ["GET /api/info"]);

    let app = TestApp::new(80, 30);
    let tui = mount_with(&app, support::component_info(json!({})), pair_server(false)).tui;
    pair::show(&tui);
    wait_for(&app, "expire in");
    assert_dialog(&app, "E.18b/pair-narrow", "Pair");

    let app = TestApp::new(100, 40);
    let tui = mount_with(&app, support::component_info(json!({})), pair_server(true)).tui;
    pair::show(&tui);
    wait_for(&app, "Could not load");
    assert_dialog(&app, "E.18b/pair-error", "Pair");
}

#[test]
fn a_pair_link_opens_on_click() {
    let app = TestApp::new(100, 40);
    let tui = mount_with(&app, support::component_info(json!({})), pair_server(false)).tui;
    pair::show(&tui);
    let screen = wait_for(&app, "expire in");
    let capture = opencode_tui::features::links::testing::capture();
    let (x, y) = support::at(&screen, "http://localhost:4096").unwrap();
    app.click(x + 2, y);
    assert_eq!(*capture.0.opened.borrow(), ["http://localhost:4096/auth/connect/XK7Q2M"]);
}

#[test]
fn pair_links_follow_the_server_urls() {
    let server = serde_json::from_value(json!({
        "version": "1", "pid": 1, "urls": ["http://[::1]:4096", "https://box.example:443/"], "paths": { "tmp": "/tmp" },
    }))
    .unwrap();
    let code = serde_json::from_value(json!({ "code": "AB", "expires_in": 90 })).unwrap();
    let value = pair::pairing(&server, &code);
    assert_eq!(value.links, ["http://[::1]:4096/auth/connect/AB", "https://box.example/auth/connect/AB"]);
    assert_eq!(value.localhost.as_deref(), Some("http://localhost:4096/auth/connect/AB"));
    assert_eq!(value.minutes, 2);
    assert!(value.loopback);
}

#[test]
fn pair_links_skip_server_urls_with_non_ascii_hosts() {
    let url = "https://Bücher.example";
    assert!(matches!(opencode_api::js::parse_url(url), Err(opencode_api::js::UrlError::NonAsciiHost(_))));
    let server = serde_json::from_value(json!({
        "version": "1", "pid": 1, "urls": [url, "https://box.example/"], "paths": { "tmp": "/tmp" },
    }))
    .unwrap();
    let code = serde_json::from_value(json!({ "code": "AB", "expires_in": 90 })).unwrap();
    let value = pair::pairing(&server, &code);
    assert_eq!(value.links, ["https://box.example/auth/connect/AB"]);
    assert_eq!(value.localhost, None);
}

#[test]
fn closing_export_frees_its_select_and_callbacks() {
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(&app, Info::default(), None);
    let marker = Rc::new(());
    let held = marker.clone();
    opencode_tui::dialogs::export::options(&tui, false, Rc::new(move |_, _| drop(held.clone())));
    wait_for(&app, "Export session");
    tui.dialogs.clear();
    app.render();
    assert_eq!(Rc::strong_count(&marker), 1, "the closed export dialog kept its confirm");
}

#[test]
fn integration_links_open_only_on_the_web() {
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(&app, Info::default(), None);
    let capture = opencode_tui::features::links::testing::capture();
    let open = tui.local.open_url.borrow().clone();
    assert!(open("file:///etc/passwd").is_err());
    assert!(open("-a Calculator").is_err());
    assert_eq!(open("https://example.com/?a=1&b=%PATH%"), Ok(()));
    assert_eq!(*capture.0.opened.borrow(), ["https://example.com/?a=1&b=%PATH%"]);
}

fn release_highlights() -> Vec<Highlight> {
    let item = |title: &str, body: &str| Highlight { title: title.to_owned(), body: body.to_owned() };
    vec![
        item("Session tabs", "Open sessions side by side and switch with `ctrl+tab`."),
        item("Faster startup", "The TUI connects to the background service before it draws the first frame."),
        item("Pair devices", "Run `/pair` to open this session on your phone, or scan the code."),
    ]
}

#[test]
fn highlights_match_typescript() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, support::component_info(json!({})));
    let release = highlights::Release { version: "2.0.27".to_owned(), items: release_highlights() };
    highlights::install_with(&tui, release, false);
    tui.keymap.dispatch("opencode.highlights", None);
    wait_for(&app, "What's new in 2.0.27");
    assert_dialog(&app, "E.18b/highlights", "What's new");
    app.press("enter");
    assert!(!app.text().contains("What's new"), "{}", app.text());

    let app = TestApp::new(80, 20);
    let tui = mount(&app, support::component_info(json!({})));
    let mut items = release_highlights();
    items.extend(
        release_highlights().into_iter().map(|item| Highlight { title: format!("{} again", item.title), ..item }),
    );
    opencode_tui::dialogs::highlights::show(&tui, "2.0.27", &items);
    wait_for(&app, "What's new in 2.0.27");
    app.press("down");
    app.press("down");
    assert_dialog(&app, "E.18b/highlights-scroll", "What's new");
}

/// A TUI over real roots in a temporary home, so the `highlights` storage and `prompt-history.jsonl` are real.
fn mount_rooted(app: &TestApp, home: &std::path::Path, extra: Value) -> Rc<Tui> {
    let deps = Deps {
        directory: DIRECTORY.into(),
        config: support::config(support::component_info(extra)),
        roots: support::roots(support::xdg_paths(home), "test"),
        route: Route::Home,
        ..support::deps(Arc::new(fake(Box::new(|_, _, _| None))))
    };
    opencode_tui::mount(app, deps)
}

#[test]
fn highlights_open_once_after_an_update_into_an_idle_home() {
    let home = opencode_util::temp::tempdir().unwrap();
    let release = highlights::Release { version: "2.0.27".to_owned(), items: release_highlights() };

    let app = TestApp::new(80, 30);
    let tui = mount_rooted(&app, home.path(), json!({}));
    highlights::startup(&tui, &release, false);
    let storage = tui.storage().unwrap();
    app.wait_until(WAIT, || storage.load("highlights", &json!({})).unwrap() == json!({ "seen": "2.0.27" }));
    assert!(!app.text().contains("What's new"), "{}", app.text());

    // After an update, a user with history sees them once.
    let state = tui.state_dir().unwrap();
    std::fs::write(state.join("prompt-history.jsonl"), "").unwrap();
    let update = highlights::Release { version: "2.0.28".to_owned(), ..release.clone() };
    highlights::startup(&tui, &update, false);
    wait_for(&app, "What's new in 2.0.28");
    app.press("enter");
    highlights::startup(&tui, &update, false);
    app.wait_until(Duration::from_millis(300), || app.text().contains("What's new"));
    assert!(!app.text().contains("What's new"), "{}", app.text());

    let next = highlights::Release { version: "2.0.29".to_owned(), ..release.clone() };
    highlights::startup(&tui, &next, true);
    status::show(&tui);
    highlights::startup(&tui, &next, false);
    tui.dialogs.clear();
    let app = TestApp::new(80, 30);
    let off = mount_rooted(&app, home.path(), json!({ "highlights": false }));
    highlights::startup(&off, &next, false);
    app.wait_until(Duration::from_millis(300), || app.text().contains("What's new"));
    assert!(!app.text().contains("What's new"), "{}", app.text());
    assert_eq!(storage.load("highlights", &json!({})).unwrap(), json!({ "seen": "2.0.28" }));
}

type CheckDone = Box<dyn FnOnce(Result<Option<update_notification::Check>, String>)>;
type ApplyDone = Box<dyn FnOnce(Result<(), String>)>;

/// An updater that keeps its callbacks, so a test finishes each check and install when it wants. It never installs
/// anything.
#[derive(Default)]
struct FakeUpdater {
    checks: std::cell::RefCell<Vec<CheckDone>>,
    applies: std::cell::RefCell<Vec<(String, ApplyDone)>>,
}

impl update_notification::Source for FakeUpdater {
    fn remote(&self) -> bool {
        false
    }

    fn check(&self, _installing: Box<dyn Fn(String)>, done: CheckDone) {
        self.checks.borrow_mut().push(done);
    }

    fn apply(&self, version: &str, done: ApplyDone) {
        self.applies.borrow_mut().push((version.to_owned(), done));
    }
}

impl FakeUpdater {
    fn finish_check(&self, result: Result<Option<update_notification::Check>, String>) {
        let done = self.checks.borrow_mut().pop().expect("a check is running");
        done(result);
    }

    fn finish_apply(&self, result: Result<(), String>) -> String {
        let (version, done) = self.applies.borrow_mut().pop().expect("an install is running");
        done(result);
        version
    }
}

/// Clicks the first cell of `text` in a fresh frame.
fn click_on(app: &TestApp, text: &str) {
    let frame = Fixture::from_capture(&app.render());
    let rows: Vec<String> = (0..frame.height)
        .map(|y| (0..frame.width).map(|x| frame.cell(x, y).unwrap().symbol.clone()).collect())
        .collect();
    let (x, y) = rows
        .iter()
        .enumerate()
        .find_map(|(y, line)| line.find(text).map(|x| (line[..x].chars().count() as u16, y as u16)))
        .unwrap_or_else(|| panic!("{text:?} is not on screen:\n{}", rows.join("\n")));
    app.click(x, y);
}

fn with_updater(app: &TestApp, tui: Option<Rc<Tui>>) -> (Rc<Tui>, Rc<FakeUpdater>) {
    let tui = tui.unwrap_or_else(|| mount(app, support::component_info(json!({}))));
    let updater = Rc::new(FakeUpdater::default());
    update_notification::set_source(&tui, updater.clone());
    (tui, updater)
}

fn available(version: &str) -> update_notification::ClientNotice {
    update_notification::ClientNotice { kind: update_notification::Kind::Available, version: version.to_owned() }
}

#[test]
fn update_dialog_matches_typescript_through_an_install() {
    let app = TestApp::new(80, 30);
    let (tui, updater) = with_updater(&app, None);
    update_notification::client_notice(&tui, available("2.0.28"));
    wait_for(&app, "/update to install v2.0.28");
    update_notification::open(&tui, update_notification::Origin::Notification);
    wait_for(&app, "Update available");
    assert_dialog(&app, "E.18b/update-available", "Update available");
    assert!(updater.checks.borrow().is_empty());

    app.press("enter");
    wait_for(&app, "Installing OpenCode 2.0.28");
    assert_dialog(&app, "E.18b/update-installing", "Updating OpenCode");
    assert_eq!(updater.finish_apply(Ok(())), "2.0.28");
    wait_for(&app, "Update successful");
    assert_dialog(&app, "E.18b/update-installed", "Update");
    let epilogue = opencode_tui::features::epilogue::text(&tui).unwrap_or_default();
    assert!(epilogue.contains("2.0.28"), "{epilogue}");

    let app = TestApp::new(80, 30);
    let (tui, updater) = with_updater(&app, None);
    update_notification::client_notice(&tui, available("2.0.28"));
    update_notification::open(&tui, update_notification::Origin::Notification);
    wait_for(&app, "Skip  Update");
    app.press("enter");
    wait_for(&app, "Installing");
    updater.finish_apply(Err("npm exited with code 1".to_owned()));
    wait_for(&app, "npm exited with code 1");
    assert_dialog(&app, "E.18b/update-failed", "Update available");
}

#[test]
fn update_choices_are_keyboard_navigable_buttons() {
    for (keys, installs) in
        [(&["left"][..], false), (&["shift+tab"], false), (&["left", "tab"], true), (&["right"], false)]
    {
        let app = TestApp::new(80, 30);
        let (tui, updater) = with_updater(&app, None);
        update_notification::client_notice(&tui, available("2.0.28"));
        update_notification::open(&tui, update_notification::Origin::Notification);
        wait_for(&app, "Skip  Update");
        for key in keys {
            app.press(key);
        }
        if keys == ["left"] {
            assert_dialog(&app, "E.18b/update-left", "Update available");
        }
        app.press("enter");
        app.wait_until(WAIT, || !app.text().contains("Update available"));
        assert_eq!(updater.applies.borrow().len(), usize::from(installs), "{keys:?}");
        assert!(!app.text().contains("Update available"), "{keys:?}");
    }
}

#[test]
fn update_checks_show_their_result_as_typescript() {
    let app = TestApp::new(80, 30);
    let (tui, updater) = with_updater(&app, None);
    tui.keymap.dispatch("opencode.update", None);
    wait_for(&app, "Checking for updates");
    assert_dialog(&app, "E.18b/update-checking", "Update");
    updater.finish_check(Ok(None));
    wait_for(&app, "already up to date");
    assert_dialog(&app, "E.18b/update-current", "Update");

    update_notification::open(&tui, update_notification::Origin::Manual);
    wait_for(&app, "Checking");
    updater.finish_check(Ok(Some(update_notification::Check::Unavailable(
        "OpenCode was installed with Homebrew. Run `brew upgrade opencode` to update.".to_owned(),
    ))));
    wait_for(&app, "Homebrew");
    assert_dialog(&app, "E.18b/update-unavailable", "Update");

    // A check that finds an update offers it; a check of a closed dialog is dropped.
    update_notification::open(&tui, update_notification::Origin::Manual);
    wait_for(&app, "Checking");
    updater.finish_check(Ok(Some(update_notification::Check::Notice(available("2.0.29")))));
    wait_for(&app, "Skip  Update");
    assert_eq!(tui.updates.state(), Some(update_notification::UpdateState::Available("2.0.29".to_owned())));

    let app = TestApp::new(80, 30);
    let (tui, updater) = with_updater(&app, None);
    update_notification::open(&tui, update_notification::Origin::Manual);
    wait_for(&app, "Checking");
    tui.dialogs.clear();
    updater.finish_check(Ok(Some(update_notification::Check::Notice(available("2.0.30")))));
    assert_eq!(tui.updates.state(), None);
    assert!(!app.text().contains("Update"), "{}", app.text());
}

#[test]
fn the_home_notice_opens_the_dialog_and_skip_hides_it_for_good() {
    let home = opencode_util::temp::tempdir().unwrap();
    let app = TestApp::new(80, 30);
    let (tui, _updater) = with_updater(&app, Some(mount_rooted(&app, home.path(), json!({}))));
    // Without an updater there is no notice and no `/update`; with one, the client's notice shows.
    update_notification::client_notice(&tui, available("2.0.28"));
    wait_for(&app, "/update to install v2.0.28");
    click_on(&app, "/update");
    wait_for(&app, "Update available");
    assert_dialog(&app, "E.18b/update-available", "Update available");
    click_on(&app, "Skip");
    app.wait_until(WAIT, || !app.text().contains("to install v2.0.28"));
    assert!(!app.text().contains("Update available"), "{}", app.text());
    let storage = tui.storage().unwrap();
    app.wait_until(WAIT, || {
        storage.load("update-notifications", &json!({})).unwrap() == json!({ "versions": ["client:2.0.28"] })
    });
    assert_eq!(storage.load("update-notifications", &json!({})).unwrap(), json!({ "versions": ["client:2.0.28"] }));

    let app = TestApp::new(80, 30);
    let (tui, _updater) = with_updater(&app, Some(mount_rooted(&app, home.path(), json!({}))));
    update_notification::client_notice(&tui, available("2.0.28"));
    app.wait_until(Duration::from_millis(300), || app.text().contains("v2.0.28"));
    assert!(!app.text().contains("v2.0.28"), "{}", app.text());
    update_notification::client_notice(&tui, available("2.0.29"));
    wait_for(&app, "/update to install v2.0.29");
    update_notification::client_notice(
        &tui,
        update_notification::ClientNotice { kind: update_notification::Kind::Installed, version: "2.0.29".to_owned() },
    );
    wait_for(&app, "/exit restart to use v2.0.29");
}

#[test]
fn the_home_notice_frees_the_row_it_replaces() {
    let app = TestApp::new(80, 30);
    let (tui, _updater) = with_updater(&app, Some(mount(&app, support::component_info(json!({})))));
    update_notification::client_notice(&tui, available("2.0.28"));
    wait_for(&app, "to install v2.0.28");
    let marker = Rc::new(());
    support::mark_at(&app, "/update", 3, &marker);
    update_notification::client_notice(&tui, available("2.0.29"));
    wait_for(&app, "to install v2.0.29");
    assert_eq!(Rc::strong_count(&marker), 1);
}

#[test]
fn without_an_updater_there_is_no_update_command_or_notice() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, support::component_info(json!({})));
    update_notification::client_notice(&tui, available("2.0.28"));
    tui.keymap.dispatch("opencode.update", None);
    app.wait_until(Duration::from_millis(300), || app.text().contains("Update"));
    assert!(!app.text().contains("Update"), "{}", app.text());
    assert!(!app.text().contains("2.0.28"), "{}", app.text());
}

#[test]
fn the_prompt_takes_typing_after_a_plugin_manager_toggle() {
    for abi in crate::support::LOOPBACK {
        let h = support::mount(100, 30, carried(abi));
        h.wait_for("Fix the parser");
        toggle_a_plugin(&h);
        h.app.press("escape");
        h.wait_gone("enable enter");
        h.app.type_text("xyz");
        h.wait("the text reaches the prompt", || h.text().contains("xyz"));
    }
}

/// The session fixture's server, with the built-ins on the linked carrier or with `abi` across the C ABI's byte shims.
fn carried(abi: bool) -> Deps {
    let deps = support::deps(Arc::new(Fake::new(|seen| support::base(seen, support::DIRECTORY))));
    Deps { abi_builtins: abi, ..deps }
}

/// Opens `/plugins`, shows the internal plugins, and turns the first off, which mounts the route again under the
/// manager.
pub(crate) fn toggle_a_plugin(h: &support::Harness) {
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("Plugins");
    h.app.press("ctrl+a");
    h.wait_for("hide internal");
    h.app.press("enter");
    h.wait_for("enable enter");
}

#[test]
fn the_plugin_manager_search_finds_built_ins_once_they_show() {
    for abi in crate::support::LOOPBACK {
        let h = support::mount(100, 30, carried(abi));
        h.wait_for("Fix the parser");
        h.tui.keymap.dispatch("plugins.list", None);
        h.wait_for("Plugins");
        h.app.press("ctrl+a");
        h.wait_for("hide internal");
        h.app.type_text("btw");
        h.wait_for("opencode.btw");
        assert!(!h.app.text().contains("No results found"), "{}", h.app.text());
    }
}

#[test]
fn the_manager_actions_take_the_users_keybinds() {
    let updates = |mounted: &Mounted| mounted.requests("/api/plugin/update").len();
    for (binds, pressed, sent) in [
        (json!({ "dialog.plugins.update": "none" }), "ctrl+u", 0),
        (json!({ "dialog.plugins.update": "ctrl+t" }), "ctrl+u", 0),
        (json!({ "dialog.plugins.update": "ctrl+t" }), "ctrl+t", 1),
    ] {
        let app = TestApp::new(100, 30);
        let (mounted, _) = plugin_manager(&app, json!({ "keybinds": binds }));
        mounted.tui.keymap.dispatch("plugins.list", None);
        wait_for(&app, "team.plugins");
        app.press("down");
        app.press("down");
        wait_for(&app, "update available");
        app.press(pressed);
        app.wait_until(Duration::from_millis(300), || updates(&mounted) > 0);
        assert_eq!(updates(&mounted), sent, "{binds} {pressed}");
    }
    for (binds, pressed, toggled) in
        [(json!({ "plugins.toggle": "none" }), "enter", true), (json!({ "plugins.toggle": "ctrl+t" }), "ctrl+t", true)]
    {
        let app = TestApp::new(100, 30);
        let (mounted, _) = plugin_manager(&app, json!({ "keybinds": binds }));
        mounted.tui.keymap.dispatch("plugins.list", None);
        wait_for(&app, "team.tui");
        app.press(pressed);
        app.wait_until(Duration::from_millis(300), || !active(&mounted.tui, "team.tui"));
        assert_eq!(!active(&mounted.tui, "team.tui"), toggled, "{binds} {pressed}");
    }
}
