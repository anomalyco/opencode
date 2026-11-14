//! Dropping the TUI frees it, its keymap and every plugin instance, whatever is open (plugins-pt R3-b): an open dialog
//! held the dialog stack, which held the keymap, whose layers held each plugin's commands.

use std::cell::RefCell;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use opencode_plugin::abi;
use opencode_tui::{Deps, Route};

use crate::support::{self, Fake, Harness};

/// What is open as the TUI drops.
#[derive(Clone, Copy, Debug)]
enum Open {
    Nothing,
    Help,
    Palette,
    Prompt,
    Select,
    Confirm,
    Alert,
    Panel,
    /// The plugin asked for a prompt, and no frame ran it yet.
    Pending,
    Route,
    /// The diff viewer docked beside the session.
    SidePanel,
}

thread_local! {
    /// The probe's activation, which only its registrations hold.
    static TOKEN: RefCell<Weak<()>> = const { RefCell::new(Weak::new()) };
}

/// A plugin whose commands ask for each dialog kind, with a route.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    let token = Rc::new(());
    TOKEN.set(Rc::downgrade(&token));
    let action = || abi::Action::Command { name: "drop.run".to_owned(), input: None };
    let title = |text: &str| vec![abi::Span::new(text)];
    let dialogs = [
        ("drop.prompt", abi::Dialog::Prompt { title: "Drop prompt".to_owned(), placeholder: None, action: action() }),
        (
            "drop.select",
            abi::Dialog::Select(abi::Select {
                title: "Drop select".to_owned(),
                placeholder: None,
                options: vec![abi::SelectOption::new("Drop option", "option")],
                current: None,
                action: action(),
            }),
        ),
        (
            "drop.confirm",
            abi::Dialog::Confirm(abi::Confirm {
                title: "Drop confirm".to_owned(),
                message: String::new(),
                label: abi::ConfirmLabel::default(),
                action: action(),
            }),
        ),
        (
            "drop.alert",
            abi::Dialog::Alert(abi::Alert {
                title: "Drop alert".to_owned(),
                message: String::new(),
                action: Some(action()),
            }),
        ),
        (
            "drop.panel",
            abi::Dialog::Panel(abi::Panel {
                key: "panel".to_owned(),
                size: abi::PanelSize::Medium,
                title: title("Drop panel"),
                subtitle: None,
                body: abi::Node::text(title("body")),
                actions: vec![abi::PanelAction {
                    title: "Run".to_owned(),
                    key: Some("r".to_owned()),
                    color: None,
                    close: false,
                    action: action(),
                }],
                binds: Vec::new(),
                bleed: false,
                centered: false,
            }),
        ),
    ];
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    let held = token.clone();
    setup.command(command("drop.run"), move |_, _| {
        let _ = &held;
    });
    for (name, dialog) in dialogs {
        let held = token.clone();
        setup.command(command(name), move |host, _| {
            let _ = &held;
            host.dialog(dialog.clone());
        });
    }
    setup.route("drop", move |_, _| {
        let _ = &token;
        abi::Render::Show(abi::Node::text([abi::Span::new("Drop route")]))
    });
    Ok(())
}

/// Opens `open` on a TUI with the probe, drops the TUI, and returns what outlived it.
fn outlived(open: Open) -> Vec<&'static str> {
    let transport = Fake::new(|seen| support::base(seen, support::DIRECTORY));
    let h = support::mount(140, 30, Deps { route: Route::Home, ..support::deps(Arc::new(transport)) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "drop", setup: probe }.into());
    h.app.render();
    let shown = |command: &str, text: &str| {
        h.tui.keymap.dispatch(command, None);
        h.wait_for(text);
    };
    match open {
        Open::Nothing => {}
        Open::Help => shown("help.show", "Help"),
        Open::Palette => shown("command.palette.show", "Search commands"),
        Open::Prompt => shown("drop.prompt", "Drop prompt"),
        Open::Select => shown("drop.select", "Drop option"),
        Open::Confirm => shown("drop.confirm", "Drop confirm"),
        Open::Alert => shown("drop.alert", "Drop alert"),
        Open::Panel => shown("drop.panel", "Drop panel"),
        Open::Pending => {
            h.tui.keymap.dispatch("drop.prompt", None);
        }
        Open::Route => {
            h.tui.navigate(Route::Plugin { id: "drop".to_owned(), name: "drop".to_owned() });
            h.wait_for("Drop route");
        }
        Open::SidePanel => {
            h.tui.navigate(support::session_route("ses_a"));
            h.wait_for("Fix the parser");
            h.tui.keymap.dispatch("diff.open", None);
            h.app.render();
            assert!(h.tui.panels.current().is_some(), "the diff viewer did not dock");
        }
    }
    let held = [
        ("tui", Rc::downgrade(&h.tui) as Weak<dyn std::any::Any>),
        ("keymap", Rc::downgrade(&h.tui.keymap) as Weak<dyn std::any::Any>),
        ("probe", TOKEN.with_borrow(Weak::clone) as Weak<dyn std::any::Any>),
    ];
    drop::<Harness>(h);
    held.iter().filter(|(_, weak)| weak.strong_count() > 0).map(|(name, _)| *name).collect()
}

// Expected (plugins-pt R3-b): dropping the TUI with any of its dialogs open frees the TUI, its keymap and the
// plugin's activation, as it does with none open.
#[test]
fn a_dialog_open_at_the_drop_frees_the_tui_and_its_plugins() {
    for open in [Open::Nothing, Open::Help, Open::Palette] {
        assert_eq!(outlived(open), Vec::<&str>::new(), "dropped with {open:?} open");
    }
}

// Expected (plugins-pt R3-b): the same with each kind of plugin dialog open, and with one a plugin asked for that no
// frame showed yet.
#[test]
fn a_plugin_dialog_open_at_the_drop_frees_the_tui_and_its_plugins() {
    for open in [Open::Prompt, Open::Select, Open::Confirm, Open::Alert, Open::Pending] {
        assert_eq!(outlived(open), Vec::<&str>::new(), "dropped with {open:?} open");
    }
}

// Expected (plugins-pt R3-b): the same with a plugin's live panel open, with a plugin route shown, and with the diff
// viewer docked beside a session.
#[test]
fn a_panel_or_route_open_at_the_drop_frees_the_tui_and_its_plugins() {
    for open in [Open::Panel, Open::Route, Open::SidePanel] {
        assert_eq!(outlived(open), Vec::<&str>::new(), "dropped with {open:?} open");
    }
}
