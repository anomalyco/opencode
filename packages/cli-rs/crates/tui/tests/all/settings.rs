//! Settings, experiments, debug, and the DevTools bar (E.18a).
//!
//! - P-COMP: `parity/component/E.18a-settings.tsx` renders the TS dialogs alone; here they open over the whole
//!   TUI, so the comparison covers the dialog panel (the cells with the panel background in the fixture).
//! - P-ORACLE: every field of `SETTINGS` against the TS table, through `parity/oracle/E.18a-settings.ts`.
//! - `TestApp`: changes, the palette's settings rows, the debug dialog, and the bar.
//! - P-FILE: settings writes go to a `cli.json` in a temporary home, and the TS `Config` service reads them
//!   back through `parity/oracle/F.5-config.ts` (skipped without bun and `node_modules`).

use crate::support::{self, WAIT, wait_for};

use std::rc::Rc;

use opencode_local::cli_config::CliConfig;
use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_tui::app::Roots;
use opencode_tui::dialogs::{debug, experiments, settings};

use opentui::prelude::{MouseButton, MouseEventKind};
use opentui::testing::TestApp;
use serde_json::json;

/// Compares the dialog panel with the fixture: every cell inside the bounding box of the cells that carry the
/// panel background (the background under the fixture's first title letter).
#[track_caller]
fn assert_dialog(app: &TestApp, name: &str, title: &str) {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let mut actual = Fixture::from_capture(&app.render());
    let at = (0..expected.height)
        .find_map(|y| {
            let row: String = (0..expected.width).map(|x| expected.cell(x, y).unwrap().symbol.clone()).collect();
            row.find(title).map(|x| (x as u32, y))
        })
        .unwrap_or_else(|| panic!("{title:?} is not in {name}"));
    let panel = expected.cell(at.0, at.1).unwrap().bg;
    let inside: Vec<(u32, u32)> = (0..expected.height)
        .flat_map(|y| (0..expected.width).map(move |x| (x, y)))
        .filter(|&(x, y)| expected.cell(x, y).unwrap().bg == panel)
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
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() {
        let path = std::env::temp_dir().join("opencode-parity").join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
    }
    assert!(comparison.is_equal(), "P-COMP {name} (panel {left}..={right} x {top}..={bottom}): {comparison}");
}

// The P-COMP fixtures show only the first screen and two filters; this compares every field of every row with
// the TS table itself, read live through `parity/oracle/E.18a-settings.ts`.
#[test]
fn settings_table_matches_the_typescript_table() {
    if support::ts_root().is_none() {
        return;
    }
    let parity = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity");
    let output =
        std::process::Command::new("bun").arg("oracle/E.18a-settings.ts").current_dir(&parity).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let expected: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let actual: Vec<serde_json::Value> = settings::SETTINGS
        .iter()
        .zip(expected.as_array().unwrap().iter().chain(std::iter::repeat(&serde_json::Value::Null)))
        .map(|(setting, expected)| {
            let range = setting.range.map(|range| {
                let formatted: Vec<_> = expected["range"]["formatted"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|pair| json!([pair[0], (range.format)(pair[0].as_f64().unwrap())]))
                    .collect();
                json!({ "step": range.step, "min": range.min, "max": range.max, "formatted": formatted })
            });
            json!({
                "title": setting.title,
                "category": setting.category,
                "path": setting.path,
                "description": setting.description,
                "default": setting.default.value(),
                "values": setting.values.iter().map(|value| value.value()).collect::<Vec<_>>(),
                "labels": setting.labels,
                "range": range,
                "keywords": setting.keywords,
            })
        })
        .collect();
    let expected = expected.as_array().unwrap();
    for (actual, expected) in actual.iter().zip(expected) {
        assert!(opencode_local::jsonc::same(actual, expected), "Rust {actual}\nTypeScript {expected}");
    }
    assert_eq!(actual.len(), expected.len(), "SETTINGS has {} rows, TypeScript {}", actual.len(), expected.len());
}

#[test]
fn settings_dialog_matches_typescript() {
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    settings::show(&tui, None);
    wait_for(&app, "Search settings");
    assert_dialog(&app, "E.18a/settings", "Search settings");

    app.press("down");
    app.press("down");
    assert_dialog(&app, "E.18a/settings-down", "Search settings");

    settings::show(&tui, None);
    app.type_text("scroll");
    assert_dialog(&app, "E.18a/settings-filter", "Scrollbar");
}

#[test]
fn settings_dialog_shows_configured_values_as_typescript() {
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(
        &app,
        support::component_info(json!({
            "animations": true,
            "session": { "sidebar": "hide" },
            "scroll": { "speed": 2.5 },
            "leader": { "timeout": 2250 },
        })),
        None,
    );
    settings::show(&tui, None);
    app.type_text("speed");
    assert_dialog(&app, "E.18a/settings-config", "Scroll speed");
}

#[test]
fn experiments_dialog_matches_typescript() {
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    experiments::show(&tui);
    wait_for(&app, "Experiments");
    assert_dialog(&app, "E.18a/experiments", "Experiments");

    let app = TestApp::new(80, 24);
    let tui =
        support::mount_empty(&app, support::component_info(json!({ "experimental": { "client-mcp": true } })), None);
    experiments::show(&tui);
    app.press("down");
    assert_dialog(&app, "E.18a/experiments-on", "Experiments");
}

/// The cell column of `needle` in `line`.
fn column(line: &str, needle: &str) -> u16 {
    line[..line.find(needle).unwrap()].chars().count() as u16
}

/// The footer of the row titled `title`, without the marks of the selected row's `‹ value ›` or `value ↵`.
fn footer(app: &TestApp, title: &str) -> String {
    let screen = app.text();
    // The home behind the dialog shows at the start of some rows (the prompt's `┃`).
    let line = screen
        .lines()
        .find_map(|line| {
            let at = line.find(title)?;
            let gutter = line[..at].trim().trim_end_matches('▪');
            gutter.chars().all(|char| char == '┃' || char.is_whitespace()).then(|| &line[at..])
        })
        .unwrap_or_else(|| panic!("no {title:?} row:\n{screen}"));
    let value = line[title.len()..].trim();
    let value = value.strip_prefix("‹ ").and_then(|value| value.strip_suffix(" ›")).unwrap_or(value);
    value.trim_end_matches(" ↵").to_owned()
}

#[test]
fn left_and_right_cycle_values_and_numbers_step_within_bounds() {
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
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
    assert_eq!(footer(&app, "Verbosity"), "low");
    app.press("left");
    assert_eq!(footer(&app, "Verbosity"), "high");
    app.press("right");
    assert_eq!(footer(&app, "Verbosity"), "low");

    // Numbers step and clamp; the bound is not written again.
    settings::show(&tui, None);
    app.type_text("volume");
    for _ in 0..8 {
        app.press("right");
    }
    assert_eq!(footer(&app, "Volume"), "100%");
    assert_eq!(tui.settings.info().to_value()["attention"]["volume"].as_f64(), Some(1.0));
    settings::show(&tui, None);
    app.type_text("leader");
    app.press("right");
    assert_eq!(footer(&app, "Leader timeout"), "2250 ms");

    // Color mode changes the theme as `cli.json` does.
    settings::show(&tui, Some("theme.mode"));
    app.type_text("color mode");
    app.press("right");
    assert_eq!(footer(&app, "Color mode"), "light");
    assert_eq!(tui.theme.borrow().mode(), opencode_ui::theme::ThemeMode::Light);
}

#[test]
fn the_palette_lists_settings_while_filtering_and_opens_the_one_chosen() {
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    app.press("ctrl+p");
    let palette = wait_for(&app, "Open settings");
    assert!(!palette.contains("Settings · "), "{palette}");
    app.type_text("reasoning");
    let filtered = wait_for(&app, "Settings · Session");
    assert!(filtered.contains("Thinking"), "{filtered}");
    app.press("return");
    wait_for(&app, "Search settings");
    // Opened on Thinking, which Right changes.
    app.press("right");
    assert_eq!(footer(&app, "Thinking"), "show");
    assert!(tui.dialogs.is_open());
}

#[test]
fn experiments_toggle_and_new_designs_graduated() {
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    // The new designs are the only ones: `opencode2` leads the theme list and the experiment is gone.
    assert_eq!(tui.theme.borrow().names()[0], "opencode2");
    experiments::show(&tui);
    wait_for(&app, "TUI tools");
    assert!(!app.text().contains("New designs"));
    app.press("right");
    assert!(tui.settings.experiment("client-mcp"));
    wait_for(&app, "TUI tools");
    assert_eq!(footer(&app, "TUI tools"), "on");
    app.press("return");
    assert!(!tui.settings.experiment("client-mcp"));
}

// Expected (carbon-dialogs-8): Debug names the current model, and a plugin's copy drops NUL as `clipboard.write` does.
#[test]
fn debug_names_the_model_and_plugin_copies_drop_nul() {
    let fake = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
    let deps = opencode_tui::Deps { route: opencode_tui::Route::Home, ..support::deps(std::sync::Arc::new(fake)) };
    let harness = support::mount(100, 30, deps);
    harness.wait_for("Model M");
    let entries = debug::entries(&harness.tui);
    assert_eq!(entries.last(), Some(&("Model", "p/m".to_owned())));

    let capture = opencode_tui::features::links::testing::capture();
    let host = opencode_tui::plugins::host::host(&harness.tui);
    assert!(host.copy("a\0b"));
    assert_eq!(*capture.0.copied.borrow(), ["ab"]);
}

#[test]
fn slash_and_palette_commands_open_settings_and_debug() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    tui.keymap.dispatch("opencode.debug", None);
    let screen = wait_for(&app, "Share this when reporting an issue");
    for label in ["Version", "Date", "OS", "Terminal", "Session ID", "Model"] {
        assert!(screen.contains(label), "{label}: {screen}");
    }
    assert!(screen.contains(&format!("{} (", debug::VERSION)), "{screen}");
    assert!(screen.contains("copy c"), "{screen}");
    // `TestApp` has no terminal, so the copy fails; the PTY run in the step report shows the success path.
    app.press("c");
    wait_for(&app, "Failed to copy to clipboard");
    assert!(app.text().contains("copy c"));
    tui.keymap.dispatch("opencode.settings", None);
    wait_for(&app, "Search settings");
}

#[test]
fn the_devtools_bar_follows_the_setting_and_opens_panels() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({ "debug": { "devtools": true } })), None);
    let screen = wait_for(&app, "Experiments");
    let bar = screen.lines().last().unwrap();
    assert_eq!(bar.trim_end(), " ↻ Server  ○ UI  Theme  Tools  Experiments", "{screen}");

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
    let (y, line) = text.lines().enumerate().find(|(_, line)| line.contains("[ ] Time to first draw")).unwrap();
    app.click(column(line, "["), y as u16);
    wait_for(&app, "[x] Time to first draw");
    assert_eq!(tui.settings.info().debug.and_then(|debug| debug.timing), Some(true));
    assert!(app.text().contains("Time to first draw: "));
    app.press("escape");
    // A click hits what the last frame drew.
    app.render();

    // Experiments opens the dialog; turning the setting off hides the bar.
    app.click(column(bar, "Experiments"), row);
    wait_for(&app, "TUI tools");
    app.press("escape");
    settings::show(&tui, Some("debug.devtools"));
    app.type_text("developer");
    app.press("right");
    app.press("escape");
    assert!(!app.text().contains("Experiments"), "{}", app.text());
}

// Expected (carbon-dialogs-7): the bar hides over `/stats` and comes back on leaving it (`app.tsx:1472`).
#[test]
fn the_devtools_bar_hides_over_stats() {
    let app = TestApp::new(100, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({ "debug": { "devtools": true } })), None);
    wait_for(&app, "Experiments");
    tui.navigate(opencode_tui::Route::Plugin { id: "opencode.stats".into(), name: "stats".into() });
    app.render();
    assert!(!app.text().contains("Experiments"), "{}", app.text());
    tui.navigate(opencode_tui::Route::Home);
    wait_for(&app, "Experiments");
}

// Expected (R2-1): the devtools bar draws its items and panels again on each change, and frees the ones it replaced.
#[test]
fn the_devtools_bar_frees_what_it_draws_again() {
    let app = TestApp::new(100, 30);
    let _tui = support::mount_empty(&app, support::component_info(json!({ "debug": { "devtools": true } })), None);
    let bar = wait_for(&app, "Experiments").lines().last().unwrap().to_owned();
    let marker = Rc::new(());
    // A label and its item.
    support::mark_at(&app, "Theme", 2, &marker);
    app.click(column(&bar, "Tools"), app.size().1 - 1);
    wait_for(&app, "[ ] Time to first draw");
    support::mark_at(&app, "[ ] Time to first draw", 2, &marker);
    app.press("escape");
    // A click hits what the last frame drew.
    app.render();
    app.click(column(&bar, "Theme"), app.size().1 - 1);
    wait_for(&app, "Switch to light");
    app.press("escape");
    app.render();
    assert_eq!(Rc::strong_count(&marker), 1);
}

// Expected (bigboi-5): config changes that redraw the bar between a press and its release do not lose the click.
#[test]
fn a_devtools_click_survives_redraws_between_press_and_release() {
    for (redraws, frames) in [(2, false), (5, false), (2, true), (5, true)] {
        let app = TestApp::new(100, 30);
        let tui = support::mount_empty(&app, support::component_info(json!({ "debug": { "devtools": true } })), None);
        let bar = wait_for(&app, "Experiments").lines().last().unwrap().to_owned();
        let (x, y) = (column(&bar, "Experiments"), app.size().1 - 1);
        app.mouse(MouseEventKind::Down(MouseButton::Left), x, y);
        for redraw in 0..redraws {
            settings::update(&tui, move |draft| {
                settings::set_path(draft, &["debug", "timing"], json!(redraw % 2 == 0))
            });
            if frames {
                app.render();
            }
        }
        app.mouse(MouseEventKind::Up(MouseButton::Left), x, y);
        wait_for(&app, "TUI tools");
    }
}

// P-FILE ------------------------------------------------------------------------------------------------------

const ORIGINAL: &str = "{\n  // my settings\n  \"$schema\": \"https://opencode.ai/v2/cli.json\",\n  \"session\": { \"thinking\": \"hide\" }\n}\n";

#[test]
fn settings_writes_match_typescript_and_typescript_reads_them() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::xdg_paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let file = paths.config.join("cli.json");
    std::fs::write(&file, ORIGINAL).unwrap();
    let info = CliConfig::new(&paths).get().unwrap();
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, info, Some(Roots { paths: paths.clone(), storage_channel: "test".into() }));

    settings::show(&tui, Some("session.thinking"));
    app.type_text("thinking");
    app.press("right");
    // The write runs on a blocking thread; the footer follows when it lands.
    assert!(app.wait_until(WAIT, || footer(&app, "Thinking") == "show"));
    app.press("escape");
    experiments::show(&tui);
    wait_for(&app, "TUI tools");
    app.press("right");
    assert!(app.wait_until(WAIT, || { tui.settings.experiment("client-mcp") }));
    // The bytes TS writes for the same two updates (`Config.update` through the F.5 oracle).
    let text = std::fs::read_to_string(&file).unwrap();
    assert_eq!(
        text,
        "{\n  // my settings\n  \"$schema\": \"https://opencode.ai/v2/cli.json\",\n  \"session\": {\n    \"thinking\": \"show\"\n  },\n  \"experimental\": {\n    \"client-mcp\": true\n  }\n}\n"
    );

    // TS reads what Rust wrote, then writes a setting the Rust dialog shows on its next open.
    let twin = opencode_util::temp::tempdir().unwrap();
    let twin_file = support::xdg_paths(twin.path()).config.join("cli.json");
    std::fs::create_dir_all(twin_file.parent().unwrap()).unwrap();
    std::fs::write(&twin_file, ORIGINAL).unwrap();
    let Some(_) = support::ts_config(twin.path(), json!({ "update": [[["session", "thinking"], "show"]] })) else {
        return;
    };
    support::ts_config(twin.path(), json!({ "update": [[["experimental", "client-mcp"], true]] })).unwrap();
    assert_eq!(std::fs::read_to_string(&twin_file).unwrap(), text);

    let read = support::ts_config(home.path(), json!({ "get": true })).unwrap();
    assert_eq!(read["ok"]["session"]["thinking"], json!("show"), "{read}");
    assert_eq!(read["ok"]["experimental"]["client-mcp"], json!(true), "{read}");
    let written = support::ts_config(home.path(), json!({ "update": [[["mouse"], false]] })).unwrap();
    assert!(written.get("ok").is_some(), "{written}");
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, CliConfig::new(&paths).get().unwrap(), None);
    settings::show(&tui, None);
    app.type_text("mouse capture");
    assert_eq!(footer(&app, "Mouse"), "off");
}

// Expected: TS keeps `saving` while `useTheme()` restyles the open dialog, so a step while the previous one is being
// written is ignored after a theme change too. Holding the config lock keeps the first write from landing.
#[test]
fn a_settings_step_while_saving_is_ignored_after_a_theme_change() {
    use opentui::prelude::Event;
    use opentui::theme::ThemeMode;

    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::xdg_paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let config = CliConfig::new(&paths);
    std::fs::write(config.path(), "{}\n").unwrap();
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(
        &app,
        config.get().unwrap(),
        Some(Roots { paths: paths.clone(), storage_channel: "test".into() }),
    );
    settings::show(&tui, Some("animations"));
    wait_for(&app, "Animations");
    let lock = opencode_local::lock::acquire(
        &paths.state.join("locks"),
        &config.path().to_string_lossy(),
        &opencode_local::lock::Options::default(),
    )
    .unwrap();
    app.press("right");
    assert_eq!(tui.settings.pending_writes(), 1);
    app.event(Event::ThemeMode(ThemeMode::Light));
    app.press("right");
    assert_eq!(tui.settings.pending_writes(), 1, "the step after the theme change was written too");
    lock.release().unwrap();
    assert!(app.wait_until(WAIT, || tui.settings.pending_writes() == 0));
    assert_eq!(footer(&app, "Animations"), "on");
}

// Expected: `DialogExperiments` ignores a change while the previous one is being written (`saving`), and a theme change
// that restyles the dialog keeps it. Holding the config lock keeps the first write from landing.
#[test]
fn an_experiment_change_while_saving_is_ignored_also_after_a_theme_change() {
    use opentui::prelude::Event;
    use opentui::theme::ThemeMode;

    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::xdg_paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let config = CliConfig::new(&paths);
    std::fs::write(config.path(), "{}\n").unwrap();
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(
        &app,
        config.get().unwrap(),
        Some(Roots { paths: paths.clone(), storage_channel: "test".into() }),
    );
    experiments::show(&tui);
    wait_for(&app, "TUI tools");
    let lock = opencode_local::lock::acquire(
        &paths.state.join("locks"),
        &config.path().to_string_lossy(),
        &opencode_local::lock::Options::default(),
    )
    .unwrap();
    app.press("right");
    assert_eq!(tui.settings.pending_writes(), 1);
    app.press("left");
    app.press("return");
    assert_eq!(tui.settings.pending_writes(), 1, "a change while saving was written too");
    app.event(Event::ThemeMode(ThemeMode::Light));
    app.press("right");
    assert_eq!(tui.settings.pending_writes(), 1, "the change after the theme change was written too");
    lock.release().unwrap();
    assert!(app.wait_until(WAIT, || tui.settings.pending_writes() == 0));
    assert!(tui.settings.experiment("client-mcp"));
    app.press("right");
    assert!(app.wait_until(WAIT, || !tui.settings.experiment("client-mcp")), "the guard ends with the write");
}

// Expected (bigboi-fixes-2): a write that lands while the UI queue is full still ends `saving`, so the dialog takes
// the next change, as TS resets it when the update settles.
#[test]
fn an_experiment_write_that_lands_on_a_full_ui_queue_ends_saving() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::xdg_paths(home.path());
    std::fs::create_dir_all(&paths.config).unwrap();
    let config = CliConfig::new(&paths);
    std::fs::write(config.path(), "{}\n").unwrap();
    let app = TestApp::new(80, 24);
    let tui = support::mount_empty(
        &app,
        config.get().unwrap(),
        Some(Roots { paths: paths.clone(), storage_channel: "test".into() }),
    );
    experiments::show(&tui);
    wait_for(&app, "TUI tools");
    let lock = opencode_local::lock::acquire(
        &paths.state.join("locks"),
        &config.path().to_string_lossy(),
        &opencode_local::lock::Options::default(),
    )
    .unwrap();
    app.press("right");
    assert_eq!(tui.settings.pending_writes(), 1);
    let proxy = tui.app.proxy();
    while proxy.post(|_| {}).is_ok() {}
    lock.release().unwrap();
    let written = || config.get().is_ok_and(|info| info.experiment("client-mcp"));
    let start = std::time::Instant::now();
    while !written() && start.elapsed() < WAIT {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(written(), "the write lands");
    // The worker tries to deliver its result while the queue is still full.
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(app.wait_until(WAIT, || tui.settings.pending_writes() == 0), "the write's result is delivered");
    assert!(tui.settings.experiment("client-mcp"));
    app.press("right");
    assert!(app.wait_until(WAIT, || !tui.settings.experiment("client-mcp")), "the guard ends with the write");
}

// Expected (O-89): a theme change from outside an open dialog restyles it in place, as TS `useTheme()` does. Each kind
// (a select, a prompt, Settings), open with a filter or typed text and a moved selection or cursor, draws what it
// draws when opened in the new theme after the same keys, and goes on from there. The change comes from the terminal
// turning light, and from `cli.json` (the write and the outside reload apply a config the same way).
#[test]
fn an_outside_theme_change_restyles_each_kind_of_open_dialog_in_place() {
    use opencode_api::generated::SessionID;
    use opencode_tui::dialogs::rename;
    use opentui::prelude::Event;
    use opentui::theme::ThemeMode;

    type Open = fn(&TestApp, &opencode_tui::app::Tui);
    let cases: [(&str, Open); 3] = [
        ("select", |app, tui| {
            experiments::show(tui);
            app.type_text("e");
            app.press("down");
        }),
        ("prompt", |app, tui| {
            rename::show(tui, SessionID("ses_1".into()), Some("Old title".into()));
            app.type_text(" new");
            app.press("left");
        }),
        ("settings", |app, tui| {
            settings::show(tui, None);
            app.type_text("mo");
            app.press("down");
        }),
    ];
    let info =
        || opencode_local::cli_config::merge(&[Some(json!({ "theme": { "name": "opencode" }, "animations": false }))]);
    // The rows' cells, but the prompt's: the home route mounts again in the new theme with another placeholder.
    let rows = |screen: &opentui::native::Capture| -> Vec<Vec<opentui::native::Cell>> {
        (0..screen.height)
            .filter(|&y| !screen.row(y).contains("Ask anything"))
            .map(|y| (0..screen.width).map(|x| screen.cell(x, y).unwrap().clone()).collect())
            .collect()
    };
    let light = |app: &TestApp, tui: &opencode_tui::app::Tui, file: bool| match file {
        true => settings::update(tui, |draft| settings::set_path(draft, &["theme", "mode"], json!("light"))),
        false => app.event(Event::ThemeMode(ThemeMode::Light)),
    };
    for file in [false, true] {
        for (name, open) in cases {
            let app = TestApp::new(80, 30);
            let tui = support::mount_empty(&app, info(), None);
            open(&app, &tui);
            let dark = app.render();
            light(&app, &tui, file);
            let restyled = app.render();
            assert_ne!(restyled, dark, "{name}: the dialog kept its theme");
            let fresh = TestApp::new(80, 30);
            let twin = support::mount_empty(&fresh, info(), None);
            light(&fresh, &twin, file);
            open(&fresh, &twin);
            assert_eq!(rows(&restyled), rows(&fresh.render()), "{name} (cli.json: {file})");
            app.type_text("x");
            fresh.type_text("x");
            assert_eq!(rows(&app.render()), rows(&fresh.render()), "{name} (cli.json: {file}) after typing");
        }
    }
}

// Expected (r2 review, carbon-ui-3): the open settings dialog takes the theme that changing the color mode chose, as
// TS `useTheme()` restyles it in place; it keeps the setting selected and the filter typed.
#[test]
fn changing_the_color_mode_restyles_the_open_settings_dialog() {
    let app = TestApp::new(80, 30);
    let tui = support::mount_empty(&app, support::component_info(json!({})), None);
    settings::show(&tui, Some("theme.mode"));
    app.type_text("color mode");
    app.press("right");
    assert_eq!(tui.theme.borrow().mode(), opencode_ui::theme::ThemeMode::Light);
    let theme = tui.page().surface(opencode_ui::theme::Surface::Dialog);
    let screen = app.render();
    let y = (0..screen.height).find(|&y| screen.row(y).contains("color mode")).expect("the filter stays");
    let x = column(&screen.row(y), "color mode") as u32;
    let cell = screen.cell(x, y).unwrap();
    assert_eq!((cell.fg, cell.bg), (theme.text.formfield.base, theme.background.formfield.focused));
    let y = (0..screen.height).find(|&y| screen.row(y).contains("Color mode")).unwrap();
    let x = column(&screen.row(y), "Color mode") as u32;
    assert_eq!(screen.cell(x, y).unwrap().bg, theme.background.action.primary.focused);
    assert_eq!(footer(&app, "Color mode"), "light");
}
