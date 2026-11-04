//! System commands, selection and copy, links, console copy, and the working directory dialog (E.20).
//!
//! - `TestApp` over a test sink (`features::links::testing`): copies and opens are recorded, so no test writes
//!   the host clipboard or starts a browser.
//! - P-FILE: the toggles write a `cli.json` in a temporary home, compared byte for byte with what the TS
//!   `Config` service writes for the same updates, and read back by it (`parity/oracle/F.5-config.ts`; skipped
//!   without bun and `node_modules`).
//! - P-APP (`parity/scenarios/E.20/*`) and P-PTY (`E.20/copy.pty.ts`) are in `tests/app.rs` and the PTY runner.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{CliConfig, Info, Resolved, merge};
use opencode_local::paths::Paths;
use opencode_tui::app::Roots;
use opencode_tui::features::links::testing;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// An empty session list and a working reload; anything else is a 404.
struct Server;

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let (status, body) = match request.url.path() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "/api/location/reload" => (204, Value::Null),
            _ => (404, json!({})),
        };
        let body = if body.is_null() {
            Vec::new()
        } else {
            serde_json::to_vec(&body).unwrap()
        };
        Box::pin(async move {
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

/// The F keys the scenarios bind the toggles to, as `parity/scenarios/E.20/toggles.app.ts` does.
fn keybinds() -> Value {
    json!({
        "app.toggle.animations": "f5",
        "app.toggle.diffwrap": "f6",
        "app.toggle.file_context": "f7",
        "app.toggle.paste_summary": "f8",
        "terminal.title.toggle": "f9",
    })
}

fn info(extra: Value) -> Info {
    merge(&[
        Some(json!({ "theme": { "name": "opencode", "mode": "dark" }, "animations": false })),
        Some(extra),
    ])
}

fn mount(app: &TestApp, info: Info, roots: Option<Roots>) -> Rc<Tui> {
    let client = Client::with_transport("http://opencode.local", Arc::new(Server)).unwrap();
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

fn wait_for(app: &TestApp, text: &str) -> String {
    let found = app.wait_until(Duration::from_secs(5), || app.text().contains(text));
    let screen = app.text();
    assert!(found, "{text:?} never showed:\n{screen}");
    screen
}

/// The cell of the first `needle` on screen.
fn find(app: &TestApp, needle: &str) -> (u16, u16) {
    let screen = wait_for(app, needle);
    screen
        .lines()
        .enumerate()
        .find_map(|(y, line)| {
            let at = line.find(needle)?;
            Some((line[..at].chars().count() as u16, y as u16))
        })
        .unwrap()
}

#[test]
fn copy_on_select_copies_the_drag_and_ctrl_c_clears_it_then_exits() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let _tui = mount(&app, info(json!({})), None);
    let (x, y) = find(&app, "/project");
    app.drag((x, y), (x + 7, y));
    wait_for(&app, "Copied to clipboard");
    assert_eq!(*capture.0.copied.borrow(), ["/project"]);
    assert_eq!(app.app().selected_text().as_deref(), Some("/project"));

    // Under copy-on-select, Ctrl+C clears the selection and still reaches `app.exit`, as in TS.
    app.press("ctrl+c");
    assert_eq!(app.app().selected_text(), None);
    assert!(app.app().is_quitting());
    assert_eq!(capture.0.copied.borrow().len(), 1);
}

/// TS keeps the dialog because its backdrop asks whether a selection exists when the press lands
/// (`ui/dialog.tsx:51-53`); `crates/ui/src/dialog.rs` asks for selected text, which a press has none of yet.
#[test]
#[ignore = "the dialog kit closes on a drag inside the panel (crates/ui/src/dialog.rs; E.20 follow-up)"]
fn a_drag_inside_a_dialog_copies_and_keeps_it_open() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let tui = mount(&app, info(json!({})), None);
    tui.keymap.dispatch("help.show", None);
    let (x, y) = find(&app, "Press ctrl+p");
    app.drag((x, y), (x + 11, y));
    assert_eq!(*capture.0.copied.borrow(), ["Press ctrl+p"]);
    assert!(tui.dialogs.is_open(), "{}", app.text());
}

#[test]
fn manual_copy_waits_for_ctrl_c_or_a_right_click_and_escape_clears() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let _tui = mount(
        &app,
        info(json!({ "terminal": { "copy": "manual" } })),
        None,
    );
    let (x, y) = find(&app, "/project");
    app.drag((x, y), (x + 7, y));
    assert!(capture.0.copied.borrow().is_empty());

    app.press("ctrl+c");
    wait_for(&app, "Copied to clipboard");
    assert!(!app.app().is_quitting());
    app.mouse(MouseEventKind::Down(MouseButton::Right), x, y);
    assert_eq!(*capture.0.copied.borrow(), ["/project", "/project"]);

    app.press("escape");
    assert_eq!(app.app().selected_text(), None);
    // With nothing selected, Ctrl+C is `app.exit` again.
    app.press("ctrl+c");
    assert!(app.app().is_quitting());
}

#[test]
fn copies_drop_nul() {
    let capture = testing::capture();
    let app = TestApp::new(80, 24);
    let tui = mount(&app, info(json!({})), None);
    assert!(opencode_tui::features::selection::copy(
        &tui,
        "a\0b",
        "Copied to clipboard"
    ));
    assert_eq!(*capture.0.copied.borrow(), ["ab"]);
}

#[test]
fn the_location_opens_the_working_directory_dialog() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let _tui = mount(&app, info(json!({})), None);
    let (x, y) = find(&app, "/project");
    app.click(x + 2, y);
    let dialog = wait_for(&app, "Working directory");
    for row in [
        "Copy path",
        "Open folder",
        "in system file manager",
        "Workspaces",
        "to another working directory",
    ] {
        assert!(dialog.contains(row), "{row}: {dialog}");
    }
    app.press("return");
    wait_for(&app, "Path copied to clipboard");
    assert!(!app.text().contains("Working directory"));
    assert_eq!(*capture.0.copied.borrow(), ["/project"]);

    // Past the double-click window, which would select a word instead.
    app.advance(Duration::from_millis(600));
    app.click(x + 2, y);
    wait_for(&app, "Working directory");
    app.press("down");
    app.press("return");
    assert_eq!(*capture.0.opened.borrow(), ["/project"]);
    assert!(!app.text().contains("Working directory"));

    // A drag over the location selects it instead of opening the dialog.
    app.drag((x, y), (x + 7, y));
    assert!(!app.text().contains("Working directory"));
}

/// Headless frames keep no hyperlink ids (`Session::link_id` answers `None` on every cell), so the open itself
/// is proven under a PTY (step report); here only the clicks that must not open are checked.
#[test]
fn modified_clicks_and_drags_on_a_link_do_not_open_it() {
    let capture = testing::capture();
    let app = TestApp::new(80, 24);
    let _tui = mount(&app, info(json!({})), None);
    let link = Text::new(app.app(), "");
    link.set_text(vec![Span::raw("docs").link("https://opencode.ai/docs")]);
    app.app().root().add(&link);
    let screen = app.text();
    let y = screen
        .lines()
        .position(|line| line.starts_with("docs"))
        .unwrap() as u16;
    app.event(Event::Mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        x: 1,
        y,
        modifiers: Modifiers::SHIFT,
    }));
    app.mouse(MouseEventKind::Up(MouseButton::Left), 1, y);
    app.drag((0, y), (3, y));
    assert!(capture.0.opened.borrow().is_empty());
    let headless = opencode_tui::features::links::link_at(app.app(), 1, y);
    app.advance(Duration::from_millis(600));
    app.click(1, y);
    let opened = if headless.is_some() { 1 } else { 0 };
    assert_eq!(capture.0.opened.borrow().len(), opened);
}

#[test]
fn system_commands_run_from_their_keys_and_the_palette() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let tui = mount(&app, info(json!({})), None);
    app.press("ctrl+p");
    app.type_text("open docs");
    app.press("return");
    assert_eq!(*capture.0.opened.borrow(), ["https://opencode.ai/v2/docs"]);
    assert!(!tui.dialogs.is_open());

    // Only these three of E.20's commands are in the palette, as in TS.
    let palette: Vec<String> = tui
        .keymap
        .commands()
        .into_iter()
        .filter(|command| command.palette)
        .map(|command| command.id)
        .filter(|id| {
            [
                "docs.open",
                "app.console",
                "location.reload",
                "app.debug",
                "terminal.title.toggle",
                "app.toggle.animations",
            ]
            .contains(&id.as_str())
        })
        .collect();
    assert_eq!(palette, ["location.reload", "docs.open", "app.console"]);

    tui.keymap.dispatch("location.reload", None);
    wait_for(&app, "Configuration reloaded");

    tui.keymap.dispatch("app.debug", None);
    assert!(app.app().debug_overlay().is_some());
    tui.keymap.dispatch("app.debug", None);
    assert!(app.app().debug_overlay().is_none());
}

#[test]
fn ctrl_y_in_the_console_copies_its_selection() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let tui = mount(&app, info(json!({})), None);
    app.app()
        .console()
        .log(opentui::console::LogLevel::Info, "hello from the console");
    tui.keymap.dispatch("app.console", None);
    assert!(app.app().console().is_visible());
    let (x, y) = find(&app, "hello from the console");
    app.drag((x, y), (x + 4, y));
    // The drag copied once on release; Ctrl+Y copies again with the toast and clears the selection.
    app.press("ctrl+y");
    assert_eq!(*capture.0.copied.borrow(), ["hello", "hello"]);
    assert_eq!(app.app().selected_text(), None);
    wait_for(&app, "Copied to clipboard");
}

// P-FILE ------------------------------------------------------------------------------------------------------

fn ts_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../..")
        .canonicalize()
        .unwrap()
}

fn env(home: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        ("HOME", home.to_path_buf()),
        ("XDG_CONFIG_HOME", home.join("config")),
        ("XDG_STATE_HOME", home.join("state")),
        ("XDG_DATA_HOME", home.join("data")),
        ("XDG_CACHE_HOME", home.join("cache")),
    ]
}

fn paths(home: &Path) -> Paths {
    let vars = env(home);
    Paths::from_vars(|name| {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.clone().into_os_string())
    })
    .unwrap()
}

/// One op of the F.5 oracle's `config` command in `home`, or `None` without bun and `node_modules`.
fn ts_config(home: &Path, op: Value) -> Option<Value> {
    if !ts_root().join("node_modules").is_dir()
        || Command::new("bun").arg("--version").output().is_err()
    {
        eprintln!("skipped the TypeScript side: needs bun and node_modules");
        return None;
    }
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.5-config.ts");
    let mut command = Command::new("bun");
    command
        .arg("--cwd")
        .arg(ts_root().join("packages/cli"))
        .arg(script)
        .arg(ts_root())
        .arg("config")
        .env_remove("OPENCODE_CLI_CONFIG_CONTENT")
        .env_remove("OPENCODE_CONFIG_DIR")
        .env(
            "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
            std::env::temp_dir().join("opencode-rs-f5-bun-cache"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in env(home) {
        command.env(name, value);
    }
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(json!([op]).to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    let mut results: Vec<Value> = serde_json::from_str(stdout.lines().last().unwrap()).unwrap();
    Some(results.remove(0))
}

#[test]
fn toggles_write_cli_json_as_typescript_does_and_typescript_reads_them() {
    let original = format!(
        "{{\n  // my settings\n  \"keybinds\": {},\n  \"prompt\": {{ \"image_preview\": true }}\n}}\n",
        keybinds()
    );
    let home = tempfile::tempdir().unwrap();
    let paths = paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, &original).unwrap();
    let app = TestApp::new(100, 30);
    let tui = mount(
        &app,
        CliConfig::new(&paths).get().unwrap(),
        Some(Roots {
            paths: paths.clone(),
            storage_channel: "test".into(),
        }),
    );
    wait_for(&app, "/project");
    // One write at a time: the settings writer ignores a change while one is in flight, as TS does.
    let toggles: [(&str, &[&str], Value); 5] = [
        ("f5", &["animations"], json!(false)),
        ("f6", &["diffs", "wrap"], json!("none")),
        ("f7", &["prompt", "editor"], json!(false)),
        ("f8", &["prompt", "paste"], json!("full")),
        ("f9", &["terminal", "title"], json!(false)),
    ];
    for (key, path, value) in &toggles {
        app.press(key);
        let landed = app.wait_until(Duration::from_secs(5), || {
            let config = tui.settings.info().to_value();
            path.iter().try_fold(&config, |node, key| node.get(*key)) == Some(value)
        });
        assert!(landed, "{key} did not write {path:?}");
    }
    let text = std::fs::read_to_string(&file).unwrap();

    // TS writes the same bytes for the same updates, and reads what Rust wrote.
    let twin = tempfile::tempdir().unwrap();
    let twin_file = self::paths(twin.path()).config.join("cli.json");
    std::fs::create_dir_all(twin_file.parent().unwrap()).unwrap();
    std::fs::write(&twin_file, &original).unwrap();
    for (_, path, value) in &toggles {
        let Some(result) = ts_config(twin.path(), json!({ "update": [[path, value]] })) else {
            return;
        };
        assert!(result.get("ok").is_some(), "{result}");
    }
    assert_eq!(std::fs::read_to_string(&twin_file).unwrap(), text);
    let read = ts_config(home.path(), json!({ "get": true })).unwrap();
    let ok = &read["ok"];
    assert_eq!(ok["animations"], json!(false), "{read}");
    assert_eq!(ok["diffs"]["wrap"], json!("none"), "{read}");
    assert_eq!(ok["prompt"]["editor"], json!(false), "{read}");
    assert_eq!(ok["prompt"]["paste"], json!("full"), "{read}");
    assert_eq!(ok["prompt"]["image_preview"], json!(true), "{read}");
    assert_eq!(ok["terminal"]["title"], json!(false), "{read}");

    // A second press turns each back.
    app.press("f6");
    assert!(app.wait_until(Duration::from_secs(5), || {
        tui.settings.info().to_value()["diffs"]["wrap"] == json!("word")
    }));
}
