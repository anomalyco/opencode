//! Apply live config changes from both settings writes and external file replacements.

use std::path::Path;
use std::rc::Rc;
use std::time::Duration;

use opencode_local::cli_config::{CliConfig, Info};
use opencode_tui::Tui;
use opencode_tui::app::Roots;
use opencode_tui::dialogs::settings;
use opencode_tui::tabs::Tabs;
use opentui::testing::TestApp;
use serde_json::{Value, json};

use crate::support::{self, WAIT};

/// A TUI over a `cli.json` holding `text` in a temporary home.
fn mount_with_file(app: &TestApp, home: &Path, text: &str) -> (Rc<Tui>, std::path::PathBuf) {
    let paths = support::xdg_paths(home);
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, text).unwrap();
    let info = CliConfig::with_content(&paths, None).get().unwrap();
    let tui = support::mount_empty(app, info, Some(Roots { paths, storage_channel: "test".into() }));
    (tui, file)
}

fn set(path: &'static [&'static str], value: Value) -> impl FnOnce(&mut Value) + Send + 'static {
    move |draft| settings::set_path(draft, path, value)
}

#[test]
fn a_settings_write_reaches_the_tabs_and_the_leader_timeout_at_once() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, Info::default(), None);
    assert!(Tabs::enabled(&tui));
    settings::update(&tui, set(&["tabs", "mode"], json!("off")));
    assert!(!Tabs::enabled(&tui), "tabs.mode stayed at its startup value");

    settings::update(&tui, set(&["leader", "timeout"], json!(250)));
    app.press("ctrl+x");
    assert!(tui.keymap.leader_active());
    app.advance(Duration::from_millis(250));
    assert!(!tui.keymap.leader_active(), "the leader waited for the startup timeout");
    settings::update(&tui, set(&["leader", "timeout"], json!(5000)));
    app.press("ctrl+x");
    assert!(tui.keymap.leader_active());
    app.advance(Duration::from_millis(2500));
    assert!(tui.keymap.leader_active());
    app.advance(Duration::from_millis(2500));
    assert!(!tui.keymap.leader_active());
}

/// The leader sequence expires `leader.timeout` after the leader on the app's clock, though the keymap stops the
/// key before `App::on_key`. A key just before then completes the sequence; one at it is typed into the prompt.
#[test]
fn the_leader_sequence_expires_on_the_app_clock() {
    for (config, wait, completes) in [
        ("{}", 1999, true),
        ("{}", 2000, false),
        (r#"{ "leader": { "timeout": 250 } }"#, 249, true),
        (r#"{ "leader": { "timeout": 250 } }"#, 250, false),
    ] {
        let app = TestApp::new(100, 30);
        let tui = support::mount_empty(&app, opencode_local::cli_config::decode_text(config).unwrap(), None);
        app.press("ctrl+x");
        // Reading the pending sequence prunes captures and restarts its timer.
        assert!(tui.keymap.leader_active());
        app.advance(Duration::from_millis(wait));
        assert_eq!(tui.keymap.leader_active(), completes, "{config} after {wait} ms");
        app.press("l");
        let typed = tui.textarea.borrow().as_ref().map(|textarea| textarea.text()).unwrap_or_default();
        assert_eq!((tui.dialogs.is_open(), typed.as_str()), (completes, if completes { "" } else { "l" }), "{config}");
    }
}

#[test]
fn a_keybinds_write_rebinds_and_disables_commands_at_once() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, Info::default(), None);
    assert_eq!(tui.keymap.shortcut("session.list").as_deref(), Some("ctrl+x l"));
    settings::update(&tui, set(&["keybinds", "session.list"], json!("f7")));
    assert_eq!(tui.keymap.shortcut("session.list").as_deref(), Some("f7"));
    app.press("f7");
    assert!(tui.dialogs.is_open(), "f7 did not open the sessions:\n{}", app.text());
    tui.dialogs.clear();
    settings::update(&tui, set(&["keybinds", "session.list"], json!("none")));
    assert_eq!(tui.keymap.shortcut("session.list"), None);
    app.press("f7");
    assert!(!tui.dialogs.is_open(), "f7 still opened the sessions");
}

#[test]
fn closed_settings_dialogs_drop_their_config_listeners() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, Info::default(), None);
    let before = tui.settings.listener_count();
    for _ in 0..3 {
        settings::show(&tui, None);
        app.render();
        tui.dialogs.clear();
        opencode_tui::dialogs::experiments::show(&tui);
        app.render();
        tui.dialogs.clear();
        app.render();
    }
    assert_eq!(tui.settings.listener_count(), before);
}

#[test]
fn an_outside_cli_json_edit_reloads() {
    let home = opencode_util::temp::tempdir().unwrap();
    let app = TestApp::new(100, 30);
    let (tui, file) = mount_with_file(&app, home.path(), "{}\n");
    assert!(Tabs::enabled(&tui));
    // Simulate an editor's atomic replacement.
    let temp = file.with_extension("json.edit");
    std::fs::write(&temp, "{\n  // edited elsewhere\n  \"tabs\": { \"mode\": \"off\" }\n}\n").unwrap();
    std::fs::rename(&temp, &file).unwrap();
    assert!(app.wait_until(WAIT, || !Tabs::enabled(&tui)), "the edit never reloaded");
    assert_eq!(tui.settings.info().to_value()["tabs"], json!({ "mode": "off" }));
}

#[test]
fn two_quick_writes_both_reach_the_file() {
    let home = opencode_util::temp::tempdir().unwrap();
    let app = TestApp::new(100, 30);
    let (tui, file) = mount_with_file(&app, home.path(), "{}\n");
    settings::update(&tui, set(&["session", "scrollbar"], json!(true)));
    settings::update(&tui, set(&["mouse"], json!(false)));
    let both = || {
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        text.contains("\"scrollbar\": true") && text.contains("\"mouse\": false")
    };
    assert!(app.wait_until(WAIT, both), "{}", std::fs::read_to_string(&file).unwrap());
    assert!(app.wait_until(WAIT, || {
        let info = tui.settings.info();
        info.mouse == Some(false) && info.session.and_then(|s| s.scrollbar) == Some(true)
    }));
}

#[test]
fn removing_theme_from_cli_json_reverts_to_opencode() {
    let home = opencode_util::temp::tempdir().unwrap();
    let app = TestApp::new(100, 30);
    let (tui, file) = mount_with_file(&app, home.path(), "{}\n");
    let default_bg = tui.theme.borrow().theme().background.base;
    assert_eq!(tui.theme.borrow().selected(), "opencode");

    let replace = |content: &str| {
        let temp = file.with_extension("json.edit");
        std::fs::write(&temp, content).unwrap();
        std::fs::rename(&temp, &file).unwrap();
    };

    // Adding and removing the entire theme block reverts to the default theme.
    replace("{\n  \"theme\": { \"name\": \"gruvbox\" }\n}\n");
    assert!(app.wait_until(WAIT, || tui.theme.borrow().selected() == "gruvbox"), "gruvbox never loaded");
    assert_ne!(tui.theme.borrow().theme().background.base, default_bg);

    replace("{}\n");
    assert!(app.wait_until(WAIT, || tui.theme.borrow().selected() == "opencode"), "theme removal did not revert");
    assert_eq!(tui.theme.borrow().theme().background.base, default_bg);

    // Removing only theme.name reverts the theme while keeping the pinned mode.
    replace("{\n  \"theme\": { \"name\": \"gruvbox\", \"mode\": \"light\" }\n}\n");
    assert!(app.wait_until(WAIT, || tui.theme.borrow().selected() == "gruvbox"), "gruvbox light never loaded");
    assert_eq!(tui.theme.borrow().mode(), opencode_ui::theme::ThemeMode::Light);
    let gruvbox_light_bg = tui.theme.borrow().theme().background.base;

    replace("{\n  \"theme\": { \"mode\": \"light\" }\n}\n");
    assert!(app.wait_until(WAIT, || tui.theme.borrow().selected() == "opencode"), "theme.name removal did not revert");
    assert_eq!(tui.theme.borrow().mode(), opencode_ui::theme::ThemeMode::Light);
    assert_ne!(tui.theme.borrow().theme().background.base, gruvbox_light_bg);
}
