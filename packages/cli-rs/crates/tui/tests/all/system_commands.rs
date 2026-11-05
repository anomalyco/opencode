//! System commands, selection and copy, links, console copy, and the working directory dialog (E.20).
//!
//! - `TestApp` over a test sink (`features::links::testing`): copies and opens are recorded, so no test writes
//!   the host clipboard or starts a browser.
//! - P-FILE: the toggles write a `cli.json` in a temporary home, compared byte for byte with what the TS
//!   `Config` service writes for the same updates, and read back by it (`parity/oracle/F.5-config.ts`; skipped
//!   without bun and `node_modules`).
//! - P-APP (`parity/scenarios/E.20/*`) and P-PTY (`E.20/copy.pty.ts`) are in `tests/app.rs` and the PTY runner.

use crate::support::{self, Fake, WAIT, wait_for};

use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_local::cli_config::{CliConfig, Info};
use opencode_tui::app::Roots;
use opencode_tui::features::links::testing;
use opencode_tui::{Deps, Route, Tui};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::{Value, json};

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

fn mount(app: &TestApp, info: Info, roots: Option<Roots>) -> Rc<Tui> {
    // An empty session list and a working reload; anything else is a 404.
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/session" => (200, json!({ "data": [], "cursor": {} })),
        "/api/location/reload" => (204, Value::Null),
        _ => support::not_found(),
    });
    opencode_tui::mount(
        app,
        Deps { config: support::config(info), roots, route: Route::Home, ..support::deps(Arc::new(fake)) },
    )
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
    let _tui = mount(&app, support::component_info(json!({})), None);
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

/// The backdrop asks whether a selection exists when the press lands, as TS does (`ui/dialog.tsx:51-53`).
#[test]
fn a_drag_inside_a_dialog_copies_and_keeps_it_open() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let tui = mount(&app, support::component_info(json!({})), None);
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
    let _tui = mount(&app, support::component_info(json!({ "terminal": { "copy": "manual" } })), None);
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
    let tui = mount(&app, support::component_info(json!({})), None);
    assert!(opencode_tui::features::selection::copy(&tui, "a\0b", "Copied to clipboard"));
    assert_eq!(*capture.0.copied.borrow(), ["ab"]);
}

#[test]
fn the_location_opens_the_working_directory_dialog() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let _tui = mount(&app, support::component_info(json!({})), None);
    let (x, y) = find(&app, "/project");
    app.click(x + 2, y);
    let dialog = wait_for(&app, "Working directory");
    for row in ["Copy path", "Open folder", "in system file manager", "Workspaces", "to another working directory"] {
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

#[test]
fn a_plain_click_opens_a_link_and_modified_clicks_and_drags_do_not() {
    let capture = testing::capture();
    let app = TestApp::new(80, 24);
    let _tui = mount(&app, support::component_info(json!({})), None);
    let link = Text::new(app.app(), "");
    link.set_text(vec![Span::raw("docs").link("https://opencode.ai/docs")]);
    app.app().root().add(&link);
    let screen = app.text();
    let y = screen.lines().position(|line| line.starts_with("docs")).unwrap() as u16;
    app.event(Event::Mouse(MouseEvent {
        kind: MouseEventKind::Down(MouseButton::Left),
        x: 1,
        y,
        modifiers: Modifiers::SHIFT,
    }));
    app.mouse(MouseEventKind::Up(MouseButton::Left), 1, y);
    app.drag((0, y), (3, y));
    assert!(capture.0.opened.borrow().is_empty());
    assert_eq!(opencode_tui::features::links::link_at(app.app(), 1, y).as_deref(), Some("https://opencode.ai/docs"));
    // A plain click opens it.
    app.advance(Duration::from_millis(600));
    app.click(1, y);
    assert_eq!(*capture.0.opened.borrow(), ["https://opencode.ai/docs"]);
}

#[test]
fn system_commands_run_from_their_keys_and_the_palette() {
    let capture = testing::capture();
    let app = TestApp::new(100, 30);
    let tui = mount(&app, support::component_info(json!({})), None);
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
    let tui = mount(&app, support::component_info(json!({})), None);
    app.app().console().log(opentui::console::LogLevel::Info, "hello from the console");
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

#[test]
fn toggles_write_cli_json_as_typescript_does_and_typescript_reads_them() {
    let original = format!(
        "{{\n  // my settings\n  \"keybinds\": {},\n  \"prompt\": {{ \"image_preview\": true }}\n}}\n",
        keybinds()
    );
    let home = tempfile::tempdir().unwrap();
    let paths = support::xdg_paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, &original).unwrap();
    let app = TestApp::new(100, 30);
    let tui = mount(
        &app,
        CliConfig::new(&paths).get().unwrap(),
        Some(Roots { paths: paths.clone(), storage_channel: "test".into() }),
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
        let landed = app.wait_until(WAIT, || {
            let config = tui.settings.info().to_value();
            path.iter().try_fold(&config, |node, key| node.get(*key)) == Some(value)
        });
        assert!(landed, "{key} did not write {path:?}");
    }
    let text = std::fs::read_to_string(&file).unwrap();

    // TS writes the same bytes for the same updates, and reads what Rust wrote.
    let twin = tempfile::tempdir().unwrap();
    let twin_file = support::xdg_paths(twin.path()).config.join("cli.json");
    std::fs::create_dir_all(twin_file.parent().unwrap()).unwrap();
    std::fs::write(&twin_file, &original).unwrap();
    for (_, path, value) in &toggles {
        let Some(result) = support::ts_config(twin.path(), json!({ "update": [[path, value]] })) else {
            return;
        };
        assert!(result.get("ok").is_some(), "{result}");
    }
    assert_eq!(std::fs::read_to_string(&twin_file).unwrap(), text);
    let read = support::ts_config(home.path(), json!({ "get": true })).unwrap();
    let ok = &read["ok"];
    assert_eq!(ok["animations"], json!(false), "{read}");
    assert_eq!(ok["diffs"]["wrap"], json!("none"), "{read}");
    assert_eq!(ok["prompt"]["editor"], json!(false), "{read}");
    assert_eq!(ok["prompt"]["paste"], json!("full"), "{read}");
    assert_eq!(ok["prompt"]["image_preview"], json!(true), "{read}");
    assert_eq!(ok["terminal"]["title"], json!(false), "{read}");

    // A second press turns each back.
    app.press("f6");
    assert!(app.wait_until(WAIT, || { tui.settings.info().to_value()["diffs"]["wrap"] == json!("word") }));
}
