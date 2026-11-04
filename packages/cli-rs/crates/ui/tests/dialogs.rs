//! P-COMP proofs of the dialog kit (U.3): each test opens the Rust dialog the way the matching
//! `parity/component/U.3-*.tsx` script opens the TypeScript one, sends the same keys, and compares the cells with
//! the fixture that script wrote.

use opencode_parity::assert_fixture;
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::select::{self, SelectAction, SelectOption, SelectProps};
use opencode_ui::theme::{Catalog, Theme, ThemeError, ThemeMode};
use opencode_ui::{alert, confirm, toast};
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
        .load("opencode", ThemeMode::Dark, false)
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
fn confirm_matches_typescript_before_and_after_left() {
    let kit = kit(70, 16);
    let log = Rc::default();
    open_confirm(&kit, &log);
    assert_fixture(&kit.app.render(), "U.3/confirm");
    kit.app.press("left");
    assert_fixture(&kit.app.render(), "U.3/confirm-left");
    kit.app.press("return");
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
