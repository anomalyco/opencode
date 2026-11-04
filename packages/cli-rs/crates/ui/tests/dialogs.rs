//! P-COMP proofs of the dialog kit (U.3): each test opens the Rust dialog the way the matching
//! `parity/component/U.3-*.tsx` script opens the TypeScript one, sends the same keys, and compares the cells with
//! the fixture that script wrote.

use opencode_parity::assert_fixture;
use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opencode_ui::{alert, confirm};
use opentui::prelude::*;
use opentui::testing::TestApp;
use std::cell::RefCell;
use std::rc::Rc;

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
