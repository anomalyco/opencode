//! P-COMP proofs of the dialog kit (U.3): each test opens the Rust dialog the way the matching
//! `parity/component/U.3-*.tsx` script opens the TypeScript one, sends the same keys, and compares the cells with
//! the fixture that script wrote.

use opencode_parity::assert_fixture;
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::select::{self, SelectAction, SelectOption, SelectProps};
use opencode_ui::theme::{Catalog, Theme, ThemeError, ThemeMode};
use opencode_ui::{alert, confirm, help, palette, path, prompt, toast};
use opentui::prelude::*;
use opentui::testing::TestApp;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

struct Kit {
    app: TestApp,
    dialogs: Dialogs,
    keymap: Rc<DialogKeymap>,
}

fn theme() -> Theme {
    Catalog::default()
        .load("opencode", ThemeMode::Dark)
        .unwrap()
        .theme
}

// Inside the TUI providers the TypeScript screen has the page background (`context/theme.tsx:317`), which the
// backdrop blends over, so the app clears with it too.
fn kit(width: u16, height: u16) -> Kit {
    let app = TestApp::with_options(
        width,
        height,
        AppOptions {
            theme: opentui::theme::Theme {
                background: theme().background.base,
                ..opentui::theme::Theme::default()
            },
            light_theme: None,
            ..AppOptions::default()
        },
    );
    let keymap = Rc::new(DialogKeymap::new(Keybinds::defaults(), Options::default()));
    route_keys(&app, keymap.clone());
    let dialogs = Dialogs::new(&app, keymap.clone(), theme());
    Kit {
        app,
        dialogs,
        keymap,
    }
}

#[test]
fn alert_matches_typescript() {
    let kit = kit(60, 12);
    alert::show(
        &kit.dialogs,
        alert::AlertProps {
            title: "Heads up".into(),
            message: "The session was compacted.".into(),
            on_confirm: None,
        },
    );
    assert_eq!(kit.keymap.mode(), "modal");
    assert_fixture(&kit.app.render(), "U.3/alert");
}

#[test]
fn alert_confirms_on_enter_and_closes() {
    let kit = kit(60, 12);
    let confirmed = Rc::new(RefCell::new(0));
    let count = confirmed.clone();
    alert::show(
        &kit.dialogs,
        alert::AlertProps {
            title: "Heads up".into(),
            message: "Done.".into(),
            on_confirm: Some(Rc::new(move || *count.borrow_mut() += 1)),
        },
    );
    kit.app.press("return");
    assert_eq!(*confirmed.borrow(), 1);
    assert!(!kit.dialogs.is_open());
    assert_eq!(kit.keymap.mode(), "base");
    assert!(kit.app.render().text().trim().is_empty());
}

fn open_confirm(kit: &Kit, log: &Rc<RefCell<Vec<&'static str>>>) {
    let (yes, no) = (log.clone(), log.clone());
    kit.dialogs.replace(
        |cx| {
            confirm::confirm(
                cx,
                confirm::ConfirmProps {
                    title: "Delete session".into(),
                    message: "This permanently deletes the session.".into(),
                    confirm_label: Some("delete".into()),
                    on_confirm: Some(Rc::new(move || yes.borrow_mut().push("confirm"))),
                    on_cancel: Some(Rc::new(move || no.borrow_mut().push("cancel"))),
                    ..confirm::ConfirmProps::default()
                },
            )
        },
        None,
        Default::default(),
    );
}

#[test]
fn confirm_matches_typescript_and_enter_confirms_after_left() {
    let kit = kit(70, 16);
    let log = Rc::default();
    open_confirm(&kit, &log);
    assert_fixture(&kit.app.render(), "U.3/confirm");
    // Left moved between the legacy buttons; the footer has no choice to move.
    kit.app.press("left");
    assert_fixture(&kit.app.render(), "U.3/confirm-left");
    kit.app.press("return");
    assert_eq!(*log.borrow(), ["confirm"]);
    assert!(!kit.dialogs.is_open());
}

#[test]
fn confirm_cancels_on_escape() {
    let kit = kit(70, 16);
    let log = Rc::default();
    open_confirm(&kit, &log);
    kit.app.press("escape");
    assert_eq!(*log.borrow(), ["cancel"]);
    assert!(!kit.dialogs.is_open());
}

#[test]
fn escape_closes_the_dialog_and_calls_its_close_handler() {
    let kit = kit(70, 16);
    let log = Rc::new(RefCell::new(Vec::new()));
    let closed = log.clone();
    kit.dialogs.replace(
        |cx| {
            alert::alert(
                cx,
                alert::AlertProps {
                    title: "A".into(),
                    message: "B".into(),
                    on_confirm: None,
                },
            )
        },
        Some(Box::new(move || closed.borrow_mut().push("closed"))),
        Default::default(),
    );
    kit.app.press("escape");
    assert_eq!(*log.borrow(), ["closed"]);
    assert!(!kit.dialogs.is_open());
    assert_eq!(kit.keymap.mode(), "base");
}

#[test]
fn replace_closes_the_previous_dialog_and_restores_focus_after_the_last() {
    let kit = kit(70, 16);
    let input = Input::new(&kit.app);
    kit.app.root().add(&input);
    input.focus();
    let log = Rc::new(RefCell::new(Vec::new()));
    for name in ["first", "second"] {
        let closed = log.clone();
        kit.dialogs.replace(
            |cx| {
                alert::alert(
                    cx,
                    alert::AlertProps {
                        title: name.into(),
                        message: String::new(),
                        on_confirm: None,
                    },
                )
            },
            Some(Box::new(move || closed.borrow_mut().push(name))),
            Default::default(),
        );
        assert!(!input.is_focused());
    }
    assert_eq!(*log.borrow(), ["first"]);
    assert_eq!(kit.dialogs.len(), 1);
    kit.dialogs.clear();
    assert_eq!(*log.borrow(), ["first", "second"]);
    assert!(input.is_focused());
}

fn toasts(kit: &Kit) -> toast::Toasts {
    toast::Toasts::new(&kit.app, theme(), &kit.app.root())
}

#[test]
fn theme_error_toast_matches_typescript() {
    let kit = kit(70, 12);
    let toasts = toasts(&kit);
    toasts.theme_error(ThemeError {
        name: "mine".into(),
        message: "Color reference \"missing\" not found in defs or theme".into(),
    });
    assert_fixture(&kit.app.render(), "U.3/toast-theme");
}

#[test]
fn toast_without_title_wraps_as_typescript_does() {
    let kit = kit(50, 10);
    let toasts = toasts(&kit);
    toasts.show(toast::ToastOptions::new(
        toast::Variant::Success,
        "Copied the session link to the clipboard so you can share it",
    ));
    assert_fixture(&kit.app.render(), "U.3/toast");
}

#[test]
fn toasts_time_out_queue_while_paused_and_run_their_action() {
    let kit = kit(70, 12);
    let toasts = toasts(&kit);
    toasts.show(toast::ToastOptions::new(toast::Variant::Info, "one"));
    // Showing while nothing waits replaces the current toast, as in TypeScript.
    toasts.show(toast::ToastOptions::new(toast::Variant::Info, "two").title("Two"));
    assert_eq!(toasts.current().unwrap().message, "two");
    assert_eq!(toasts.pending(), 0);
    kit.app.advance(Duration::from_millis(4999));
    assert!(toasts.current().is_some());
    kit.app.advance(Duration::from_millis(1));
    assert!(toasts.current().is_none());

    let ran = Rc::new(RefCell::new(0));
    let count = ran.clone();
    toasts.show(
        toast::ToastOptions::new(toast::Variant::Warning, "first")
            .duration(Duration::from_millis(1000))
            .action("Open", move || *count.borrow_mut() += 1),
    );
    kit.app.advance(Duration::from_millis(400));
    toasts.pause();
    toasts.show(toast::ToastOptions::new(toast::Variant::Info, "second"));
    assert_eq!(toasts.pending(), 1);
    assert!(kit.app.render().text().contains("+1 more"));
    kit.app.advance(Duration::from_secs(10));
    assert_eq!(toasts.current().unwrap().message, "first");
    toasts.resume();
    kit.app.advance(Duration::from_millis(599));
    assert_eq!(toasts.current().unwrap().message, "first");
    toasts.activate();
    assert_eq!(*ran.borrow(), 1);
    assert_eq!(toasts.current().unwrap().message, "second");
    kit.app.advance(Duration::from_millis(5000));
    assert!(toasts.current().is_none());
    assert!(kit.app.render().text().trim().is_empty());
}

fn models() -> Vec<SelectOption<&'static str>> {
    let mut disabled = SelectOption::new("Disabled", "off").category("Anthropic");
    disabled.disabled = true;
    let mut gpt5 = SelectOption::new("GPT-5", "gpt5").category("OpenAI");
    gpt5.details = vec!["/a/very/long/path/that/gets/cut/in/the/middle/model.json".into()];
    vec![
        SelectOption::new("Claude Sonnet", "sonnet")
            .category("Anthropic")
            .footer("Free"),
        SelectOption::new("Claude Opus", "opus")
            .category("Anthropic")
            .description("best"),
        SelectOption::new("Claude Haiku", "haiku").category("Anthropic"),
        disabled,
        gpt5,
        SelectOption::new("GPT-5 mini", "gpt5-mini")
            .category("OpenAI")
            .footer("$0.25"),
        SelectOption::new("o4", "o4").category("OpenAI"),
        SelectOption::new("Codex", "codex")
            .category("OpenAI")
            .search_text("code"),
    ]
}

fn open_models(kit: &Kit) -> Rc<RefCell<Option<select::Select<&'static str>>>> {
    let handle = Rc::new(RefCell::new(None));
    let slot = handle.clone();
    kit.dialogs.replace(
        |cx| {
            let mut props = SelectProps::new("Select model", models());
            props.current = Some("haiku");
            props.actions = vec![SelectAction::new(
                "model.dialog.favorite",
                "favorite",
                |_| {},
            )];
            let (view, select) = select::select(cx, props);
            *slot.borrow_mut() = Some(select);
            view
        },
        None,
        Default::default(),
    );
    kit.app.render();
    handle
}

#[test]
fn select_matches_typescript_when_opened_moved_and_filtered() {
    let kit = self::kit(72, 30);
    let handle = open_models(&kit);
    assert_fixture(&kit.app.render(), "U.3/select");
    kit.app.press("down");
    kit.app.press("down");
    assert_fixture(&kit.app.render(), "U.3/select-down");
    assert_eq!(
        handle.borrow().as_ref().unwrap().selected().unwrap().value,
        "gpt5-mini"
    );

    let kit = self::kit(72, 30);
    open_models(&kit);
    kit.app.type_text("gpt");
    assert_fixture(&kit.app.render(), "U.3/select-filter");

    let kit = self::kit(72, 30);
    open_models(&kit);
    kit.app.type_text("zzz");
    assert_fixture(&kit.app.render(), "U.3/select-empty");
}

// The list of parity/component/U.3-select-scroll.tsx: 30 options in three categories, one with a detail row.
fn open_long(kit: &Kit) {
    let options = ["Alpha", "Beta", "Gamma"]
        .iter()
        .enumerate()
        .flat_map(|(c, category)| {
            (0..10).map(move |i| {
                let mut option = SelectOption::new(format!("{category} {}", i + 1), c * 10 + i)
                    .category(*category);
                if c == 1 && i == 3 {
                    option.details = vec!["/a/detail/row".into()];
                }
                option
            })
        })
        .collect();
    kit.dialogs.replace(
        move |cx| select::select(cx, SelectProps::new("Long list", options)).0,
        None,
        Default::default(),
    );
    kit.app.render();
}

// Sends `key` `count` times, drawing a frame after each when `frames` is set.
fn press(kit: &Kit, key: &str, count: usize, frames: bool) {
    for _ in 0..count {
        kit.app.press(key);
        if frames {
            kit.app.render();
        }
    }
}

#[test]
fn select_scrolls_as_typescript() {
    for count in [5, 10, 20] {
        for frames in [false, true] {
            let kit = self::kit(72, 30);
            open_long(&kit);
            press(&kit, "down", count, frames);
            let suffix = if frames { "-frames" } else { "" };
            assert_fixture(
                &kit.app.render(),
                &format!("U.3/select-scroll-{count}{suffix}"),
            );
        }
    }

    let kit = self::kit(72, 30);
    open_long(&kit);
    press(&kit, "down", 20, false);
    kit.app.render();
    press(&kit, "up", 8, false);
    assert_fixture(&kit.app.render(), "U.3/select-scroll-up");

    let kit = self::kit(72, 30);
    open_long(&kit);
    press(&kit, "down", 20, true);
    press(&kit, "up", 8, true);
    assert_fixture(&kit.app.render(), "U.3/select-scroll-up-frames");
}

#[test]
fn palette_scrolls_as_typescript_at_80x20() {
    for (fixture, moves) in [("U.3/palette-20", 0), ("U.3/palette-20-end", 5)] {
        let kit = kit(80, 20);
        palette_commands(&kit);
        palette::show(&kit.dialogs, Vec::new());
        kit.app.render();
        press(&kit, "down", moves, false);
        assert_fixture(&kit.app.render(), fixture);
    }
}

/// P-ORACLE: `parity/fixtures/U.3/fuzzy.json` holds fuzzysort's order for DialogSelect's call over the keybind
/// corpus (`parity/oracle/U.3-fuzzy.ts`); the port must give the same order, ties included.
#[test]
fn fuzzy_order_matches_fuzzysort() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/fixtures/U.3/fuzzy.json")).unwrap();
    let options: Vec<[String; 3]> = fixture["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| {
            ["title", "category", "searchText"].map(|key| option[key].as_str().unwrap().to_owned())
        })
        .collect();
    let mut failures = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let query = case["query"].as_str().unwrap();
        let threshold = case["threshold"].as_f64().unwrap();
        let expected: Vec<usize> = case["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|index| index.as_u64().unwrap() as usize)
            .collect();
        let actual = select::fuzzy::go(
            &query.to_lowercase(),
            &options,
            |option| option.each_ref().map(|key| Some(key.as_str())),
            |scores| scores[0] * 2.0 + scores[1] + scores[2],
            threshold,
        );
        if actual != expected {
            failures.push(format!(
                "{query:?} @ {threshold}: expected {expected:?}\n  actual {actual:?}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// The global layer of parity/component/U.3-palette.tsx; returns the commands that ran.
fn palette_commands(kit: &Kit) -> Rc<RefCell<Vec<String>>> {
    let ran = Rc::new(RefCell::new(Vec::new()));
    let command = |id: &str, title: &str, group: &str| {
        let ran = ran.clone();
        let name = id.to_owned();
        TuiCommand::new(id, move |_, _| ran.borrow_mut().push(name.clone()))
            .title(title)
            .group(group)
    };
    let layer = kit.keymap.layer(KeymapLayer {
        mode: Some("global".into()),
        commands: vec![
            command("command.palette.show", "Show command palette", "System"),
            command("session.new", "New session", "Session")
                .palette()
                .suggested(true),
            command("session.list", "Switch session", "Session").palette(),
            command("session.rename", "Rename session", "Session")
                .description("Give the session a name")
                .palette(),
            command("theme.switch", "Switch theme", "System").palette(),
            command("app.exit", "Exit the app", "System").palette(),
        ],
        ..KeymapLayer::default()
    });
    layer.unwrap().forget();
    ran
}

#[test]
fn palette_matches_typescript_and_runs_the_chosen_command() {
    let kit = kit(80, 36);
    let ran = palette_commands(&kit);
    palette::show(&kit.dialogs, Vec::new());
    assert_fixture(&kit.app.render(), "U.3/palette");
    kit.app.type_text("rename");
    assert!(kit.app.render().text().contains("Rename session"));
    kit.app.press("return");
    assert!(!kit.dialogs.is_open());
    assert_eq!(*ran.borrow(), ["session.rename"]);
}

#[test]
fn help_matches_typescript() {
    let kit = kit(80, 14);
    palette_commands(&kit);
    help::show(&kit.dialogs);
    assert_fixture(&kit.app.render(), "U.3/help");
    kit.app.press("return");
    assert!(!kit.dialogs.is_open());
}

fn open_prompt(kit: &Kit, props: prompt::PromptProps) -> Rc<RefCell<Option<prompt::Prompt>>> {
    let handle = Rc::new(RefCell::new(None));
    let slot = handle.clone();
    kit.dialogs.replace(
        |cx| {
            let (view, prompt) = prompt::prompt(cx, props);
            *slot.borrow_mut() = Some(prompt);
            view
        },
        None,
        Default::default(),
    );
    handle
}

#[test]
fn prompt_matches_typescript_and_submits_on_enter() {
    let kit = kit(70, 16);
    let submitted = Rc::new(RefCell::new(Vec::<String>::new()));
    let generated = Rc::new(RefCell::new(0));
    let (log, count) = (submitted.clone(), generated.clone());
    open_prompt(
        &kit,
        prompt::PromptProps {
            title: "Rename session".into(),
            value: Some("My session".into()),
            actions: vec![prompt::PromptAction {
                title: "generate".into(),
                command: "dialog.worktree.generate".into(),
                command_title: None,
                run: Rc::new(move |prompt| {
                    *count.borrow_mut() += 1;
                    prompt.set_value("generated");
                }),
            }],
            on_confirm: Some(Rc::new(move |value| {
                log.borrow_mut().push(value.to_owned())
            })),
            ..Default::default()
        },
    );
    assert_fixture(&kit.app.render(), "U.3/prompt");
    kit.app.type_text("!");
    kit.app.press("return");
    assert_eq!(*submitted.borrow(), ["My session!"]);
    kit.app.press("tab");
    assert_eq!(*generated.borrow(), 1);
    kit.app.press("return");
    assert_eq!(*submitted.borrow(), ["My session!", "generated"]);
    // Ctrl+C clears the text first, then closes.
    kit.app.press("ctrl+c");
    assert!(kit.dialogs.is_open());
    kit.app.press("ctrl+c");
    assert!(!kit.dialogs.is_open());
}

#[test]
fn prompt_placeholder_and_busy_match_typescript() {
    let kit = kit(70, 16);
    open_prompt(
        &kit,
        prompt::PromptProps {
            title: "Worktree name".into(),
            placeholder: Some("feature-branch".into()),
            ..Default::default()
        },
    );
    assert_fixture(&kit.app.render(), "U.3/prompt-empty");

    let kit = self::kit(70, 16);
    let submitted = Rc::new(RefCell::new(0));
    let count = submitted.clone();
    let handle = open_prompt(
        &kit,
        prompt::PromptProps {
            title: "Connecting".into(),
            value: Some("token".into()),
            busy: true,
            busy_text: Some("Checking…".into()),
            on_confirm: Some(Rc::new(move |_| *count.borrow_mut() += 1)),
            ..Default::default()
        },
    );
    assert_fixture(&kit.app.render(), "U.3/prompt-busy");
    kit.app.press("return");
    assert_eq!(*submitted.borrow(), 0);
    handle.borrow().as_ref().unwrap().set_busy(false);
    kit.app.press("return");
    assert_eq!(*submitted.borrow(), 1);
}

/// P-ORACLE: `parity/fixtures/U.3/path.json` holds the TypeScript `formatPath` and `abbreviateHome` results
/// (`parity/oracle/U.3-path.ts`). `abbreviateHome` of a relative input resolves against the process's working
/// directory, which differs between the two runs, so those cases are skipped.
#[test]
fn path_formatting_matches_typescript() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/fixtures/U.3/path.json")).unwrap();
    let mut failures = Vec::new();
    for case in fixture.as_array().unwrap() {
        let text = |key: &str| case[key].as_str().unwrap();
        let (input, base, home) = (text("input"), text("base"), text("home"));
        let forward = case["forwardSlashes"].as_bool().unwrap();
        let format = path::format_path(input, base, (!home.is_empty()).then_some(home), forward);
        if format != text("format") {
            failures.push(format!(
                "format {input:?} base {base:?} home {home:?} /{forward}: {:?} != {format:?}",
                text("format")
            ));
        }
        let windows_home = home.starts_with("\\\\") || home.get(1..2) == Some(":");
        let rooted = if windows_home {
            input.starts_with(['/', '\\']) || input.get(1..2) == Some(":")
        } else {
            input.starts_with('/')
        };
        if !forward && (rooted || home.is_empty()) {
            let abbreviate = path::abbreviate_home(input, home);
            if abbreviate != text("abbreviate") {
                failures.push(format!(
                    "abbreviate {input:?} home {home:?}: {:?} != {abbreviate:?}",
                    text("abbreviate")
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn clicks_select_rows_and_the_backdrop_closes_the_dialog() {
    let kit = kit(72, 30);
    let chosen = Rc::new(RefCell::new(Vec::new()));
    let log = chosen.clone();
    kit.dialogs.replace(
        |cx| {
            let mut props = SelectProps::new("Select model", models());
            props.on_select = Some(Rc::new(move |option| log.borrow_mut().push(option.value)));
            select::select(cx, props).0
        },
        None,
        Default::default(),
    );
    let screen = kit.app.render();
    let row = (0..30u16)
        .find(|&y| screen.row(y as u32).contains("Claude Opus"))
        .unwrap();
    kit.app.click(20, row);
    assert_eq!(*chosen.borrow(), ["opus"]);
    assert!(kit.dialogs.is_open());
    kit.app.click(0, 0);
    assert!(!kit.dialogs.is_open());
}
