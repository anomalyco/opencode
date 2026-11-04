//! Settings, experiments, debug, and the DevTools bar (E.18a).
//!
//! - P-COMP: `parity/component/E.18a-settings.tsx` renders the TS dialogs alone; here they open over the whole
//!   TUI, so the comparison covers the dialog panel (the cells with the panel background in the fixture).
//! - `TestApp`: changes, the palette's settings rows, the debug dialog, and the bar.
//! - P-FILE: settings writes go to a `cli.json` in a temporary home, and the TS `Config` service reads them
//!   back through `parity/oracle/F.5-config.ts` (skipped without bun and `node_modules`).

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
use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_tui::app::Roots;
use opencode_tui::dialogs::{debug, experiments, settings};
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

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

/// The harness config of `parity/lib/component.tsx` plus `extra`.
fn info(extra: Value) -> Info {
    merge(&[
        Some(json!({ "theme": { "name": "opencode", "mode": "dark" }, "animations": false })),
        Some(extra),
    ])
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

fn wait_for(app: &TestApp, text: &str) -> String {
    let found = app.wait_until(Duration::from_secs(5), || app.text().contains(text));
    let screen = app.text();
    assert!(found, "{text:?} never showed:\n{screen}");
    screen
}

/// Compares the dialog panel with the fixture: every cell inside the bounding box of the cells that carry the
/// panel background (the background under the fixture's first title letter).
#[track_caller]
fn assert_dialog(app: &TestApp, name: &str, title: &str) {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let mut actual = Fixture::from_capture(&app.render());
    let at = (0..expected.height)
        .find_map(|y| {
            let row: String = (0..expected.width)
                .map(|x| expected.cell(x, y).unwrap().symbol.clone())
                .collect();
            row.find(title).map(|x| (x as u32, y))
        })
        .unwrap_or_else(|| panic!("{title:?} is not in {name}"));
    let panel = expected.cell(at.0, at.1).unwrap().bg;
    let inside: Vec<(u32, u32)> = (0..expected.height)
        .flat_map(|y| (0..expected.width).map(move |x| (x, y)))
        .filter(|&(x, y)| expected.cell(x, y).unwrap().bg == panel)
        .collect();
    let (left, right) = (
        inside.iter().map(|p| p.0).min().unwrap(),
        inside.iter().map(|p| p.0).max().unwrap(),
    );
    let (top, bottom) = (
        inside.iter().map(|p| p.1).min().unwrap(),
        inside.iter().map(|p| p.1).max().unwrap(),
    );
    for y in 0..expected.height {
        for x in 0..expected.width {
            if !(left..=right).contains(&x) || !(top..=bottom).contains(&y) {
                *actual.cell_mut(x, y).unwrap() = expected.cell(x, y).unwrap().clone();
            }
        }
    }
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() {
        let path = std::env::temp_dir()
            .join("opencode-parity")
            .join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
    }
    assert!(
        comparison.is_equal(),
        "P-COMP {name} (panel {left}..={right} x {top}..={bottom}): {comparison}"
    );
}

#[test]
fn settings_dialog_matches_typescript() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})), None);
    settings::show(&tui, None);
    wait_for(&app, "Settings");
    assert_dialog(&app, "E.18a/settings", "Settings");

    app.press("down");
    app.press("down");
    assert_dialog(&app, "E.18a/settings-down", "Settings");

    settings::show(&tui, None);
    app.type_text("scroll");
    assert_dialog(&app, "E.18a/settings-filter", "Settings");
}

#[test]
fn settings_dialog_shows_configured_values_as_typescript() {
    let app = TestApp::new(80, 30);
    let tui = mount(
        &app,
        info(json!({
            "animations": true,
            "session": { "sidebar": "hide" },
            "scroll": { "speed": 2.5 },
            "leader": { "timeout": 2250 },
        })),
        None,
    );
    settings::show(&tui, None);
    app.type_text("speed");
    assert_dialog(&app, "E.18a/settings-config", "Settings");
}

#[test]
fn experiments_dialog_matches_typescript() {
    let app = TestApp::new(80, 24);
    let tui = mount(&app, info(json!({})), None);
    experiments::show(&tui);
    wait_for(&app, "Experiments");
    assert_dialog(&app, "E.18a/experiments", "Experiments");

    let app = TestApp::new(80, 24);
    let tui = mount(
        &app,
        info(json!({ "experimental": { "client-mcp": true } })),
        None,
    );
    experiments::show(&tui);
    app.press("down");
    assert_dialog(&app, "E.18a/experiments-on", "Experiments");
}

/// The cell column of `needle` in `line`.
fn column(line: &str, needle: &str) -> u16 {
    line[..line.find(needle).unwrap()].chars().count() as u16
}

/// The footer of the row titled `title`.
fn footer(app: &TestApp, title: &str) -> String {
    let screen = app.text();
    let line = screen
        .lines()
        .map(|line| line.trim_start().trim_start_matches("● "))
        .find(|line| line.starts_with(title))
        .unwrap_or_else(|| panic!("no {title:?} row:\n{screen}"));
    line[title.len()..].trim().to_owned()
}

#[test]
fn left_and_right_cycle_values_and_numbers_step_within_bounds() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})), None);
    settings::show(&tui, Some("animations"));
    wait_for(&app, "Animations");
    assert_eq!(footer(&app, "Animations"), "off");
    app.press("right");
    assert_eq!(footer(&app, "Animations"), "on");
    assert_eq!(tui.settings.info().animations, Some(true));
    app.press("return");
    assert_eq!(footer(&app, "Animations"), "off");

    // Three values wrap both ways.
    settings::show(&tui, Some("session.verbosity"));
    app.type_text("verbosity");
    assert_eq!(footer(&app, "Verbosity"), "medium");
    app.press("left");
    app.press("left");
    assert_eq!(footer(&app, "Verbosity"), "high");

    // Numbers step and clamp; the bound is not written again.
    settings::show(&tui, None);
    app.type_text("volume");
    for _ in 0..8 {
        app.press("right");
    }
    assert_eq!(footer(&app, "Volume"), "100%");
    assert_eq!(
        tui.settings.info().to_value()["attention"]["volume"].as_f64(),
        Some(1.0)
    );
    settings::show(&tui, None);
    app.type_text("leader");
    app.press("right");
    assert_eq!(footer(&app, "Leader timeout"), "2250 ms");

    // Color mode changes the theme as `cli.json` does.
    settings::show(&tui, Some("theme.mode"));
    app.type_text("color mode");
    app.press("right");
    assert_eq!(footer(&app, "Color mode"), "light");
    assert_eq!(
        tui.theme.borrow().mode(),
        opencode_ui::theme::ThemeMode::Light
    );
}

#[test]
fn the_palette_lists_settings_while_filtering_and_opens_the_one_chosen() {
    let app = TestApp::new(80, 30);
    let tui = mount(&app, info(json!({})), None);
    app.press("ctrl+p");
    let palette = wait_for(&app, "Open settings");
    assert!(!palette.contains("Settings · "), "{palette}");
    app.type_text("reasoning");
    let filtered = wait_for(&app, "Settings · Session");
    assert!(filtered.contains("Thinking"), "{filtered}");
    app.press("return");
    let dialog = wait_for(&app, "change ←/→");
    assert!(dialog.contains("Settings"), "{dialog}");
    // Opened on Thinking, which Right changes.
    app.press("right");
    assert_eq!(footer(&app, "Thinking"), "show");
    assert!(tui.dialogs.is_open());
}

#[test]
fn experiments_toggle_and_new_designs_switch_the_theme_list() {
    let app = TestApp::new(80, 24);
    let tui = mount(&app, info(json!({})), None);
    assert!(!tui.theme.borrow().names().contains(&"opencode2".to_owned()));
    experiments::show(&tui);
    wait_for(&app, "New designs");
    app.press("right");
    assert!(tui.settings.experiment("new-designs"));
    assert_eq!(tui.theme.borrow().names()[0], "opencode2");
    // Under new designs the footer hint is gone; the dialog keeps working.
    app.press("down");
    app.press("return");
    assert!(tui.settings.experiment("client-mcp"));
    wait_for(&app, "TUI tools");
    assert_eq!(footer(&app, "TUI tools"), "on");
}

#[test]
fn slash_and_palette_commands_open_settings_and_debug() {
    let app = TestApp::new(100, 30);
    let tui = mount(&app, info(json!({})), None);
    tui.keymap.dispatch("opencode.debug", None);
    let screen = wait_for(&app, "Share this when reporting an issue.");
    for label in ["Version", "Date", "OS", "Terminal", "Session ID", "Model"] {
        assert!(screen.contains(label), "{label}: {screen}");
    }
    assert!(
        screen.contains(&format!("{} (", debug::VERSION)),
        "{screen}"
    );
    assert!(screen.contains("copy enter"), "{screen}");
    // `TestApp` has no terminal, so the copy fails; the PTY run in the step report shows the success path.
    app.press("return");
    wait_for(&app, "Failed to copy to clipboard");
    assert!(app.text().contains("copy enter"));
    tui.keymap.dispatch("opencode.settings", None);
    wait_for(&app, "change ←/→");
}

#[test]
fn the_devtools_bar_follows_the_setting_and_opens_panels() {
    let app = TestApp::new(100, 30);
    let tui = mount(&app, info(json!({ "debug": { "devtools": true } })), None);
    let screen = wait_for(&app, "Experiments");
    let bar = screen.lines().last().unwrap();
    assert_eq!(
        bar.trim_end(),
        " ↻ Server  ○ UI  Theme  Tools  Experiments",
        "{screen}"
    );

    // A click on Theme opens its panel above the item; Escape closes it.
    let row = app.size().1 - 1;
    app.click(column(bar, "Theme"), row);
    let panel = wait_for(&app, "Name");
    assert!(panel.contains("opencode"), "{panel}");
    assert!(panel.contains("Switch to light"), "{panel}");
    app.press("escape");
    assert!(!app.text().contains("Switch to light"));

    // Tools writes the render switches into the config.
    app.click(column(bar, "Tools"), row);
    wait_for(&app, "[ ] Time to first draw");
    let text = app.text();
    let (y, line) = text
        .lines()
        .enumerate()
        .find(|(_, line)| line.contains("[ ] Time to first draw"))
        .unwrap();
    app.click(column(line, "["), y as u16);
    wait_for(&app, "[x] Time to first draw");
    assert_eq!(
        tui.settings.info().debug.and_then(|debug| debug.timing),
        Some(true)
    );
    assert!(app.text().contains("Time to first draw: "));
    app.press("escape");

    // Experiments opens the dialog; turning the setting off hides the bar.
    app.click(column(bar, "Experiments"), row);
    wait_for(&app, "New designs");
    app.press("escape");
    settings::show(&tui, Some("debug.devtools"));
    app.type_text("developer");
    app.press("right");
    app.press("escape");
    assert!(!app.text().contains("Experiments"), "{}", app.text());
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

const ORIGINAL: &str = "{\n  // my settings\n  \"$schema\": \"https://opencode.ai/v2/cli.json\",\n  \"session\": { \"thinking\": \"hide\" }\n}\n";

#[test]
fn settings_writes_match_typescript_and_typescript_reads_them() {
    let home = tempfile::tempdir().unwrap();
    let paths = paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, ORIGINAL).unwrap();
    let info = CliConfig::new(&paths).get().unwrap();
    let app = TestApp::new(80, 30);
    let tui = mount(
        &app,
        info,
        Some(Roots {
            paths: paths.clone(),
            storage_channel: "test".into(),
        }),
    );

    settings::show(&tui, Some("session.thinking"));
    app.type_text("thinking");
    app.press("right");
    // The write runs on a blocking thread; the footer follows when it lands.
    assert!(
        app.wait_until(Duration::from_secs(5), || footer(&app, "Thinking")
            == "show")
    );
    app.press("escape");
    experiments::show(&tui);
    wait_for(&app, "New designs");
    app.press("right");
    assert!(app.wait_until(Duration::from_secs(5), || {
        tui.settings.experiment("new-designs")
    }));
    // The bytes TS writes for the same two updates (`Config.update` through the F.5 oracle).
    let text = std::fs::read_to_string(&file).unwrap();
    assert_eq!(
        text,
        "{\n  // my settings\n  \"$schema\": \"https://opencode.ai/v2/cli.json\",\n  \"session\": {\n    \"thinking\": \"show\"\n  },\n  \"experimental\": {\n    \"new-designs\": true\n  }\n}\n"
    );

    // TS reads what Rust wrote, then writes a setting the Rust dialog shows on its next open.
    let twin = tempfile::tempdir().unwrap();
    let twin_file = self::paths(twin.path()).config.join("cli.json");
    std::fs::create_dir_all(twin_file.parent().unwrap()).unwrap();
    std::fs::write(&twin_file, ORIGINAL).unwrap();
    let Some(_) = ts_config(
        twin.path(),
        json!({ "update": [[["session", "thinking"], "show"]] }),
    ) else {
        return;
    };
    ts_config(
        twin.path(),
        json!({ "update": [[["experimental", "new-designs"], true]] }),
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(&twin_file).unwrap(), text);

    let read = ts_config(home.path(), json!({ "get": true })).unwrap();
    assert_eq!(read["ok"]["session"]["thinking"], json!("show"), "{read}");
    assert_eq!(
        read["ok"]["experimental"]["new-designs"],
        json!(true),
        "{read}"
    );
    let written = ts_config(home.path(), json!({ "update": [[["mouse"], false]] })).unwrap();
    assert!(written.get("ok").is_some(), "{written}");
    let app = TestApp::new(80, 30);
    let tui = mount(&app, CliConfig::new(&paths).get().unwrap(), None);
    settings::show(&tui, None);
    app.type_text("mouse capture");
    assert_eq!(footer(&app, "Mouse"), "off");
}
