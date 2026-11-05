//! Update dialog (E.18b): `packages/tui/src/component/dialog-update.tsx`. `features::update_notification` opens it
//! from `/update` and the home notice, and owns the state it shows.
//!
//! Opening it with `checks` runs a check of the updater. Enter runs the last footer action: `update` to install,
//! `restart` after an install, else `skip`, which dismisses the notice.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_ui::dialog::{DialogCx, DialogOptions, FooterAction, FooterProps, HeaderProps, footer, header};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::motion::Spinner;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;
use crate::features::update_notification::{self as updates, UpdateState};

/// What the dialog shows (`state()` of `DialogUpdate`).
#[derive(Clone, Debug, PartialEq, Eq)]
enum Shown {
    Checking,
    CheckFailed(String),
    Unavailable(String),
    Current,
    Update(UpdateState),
}

/// The dialog's own check (TS `createResource`).
#[derive(Default)]
struct Check {
    loading: bool,
    error: Option<String>,
    unavailable: Option<String>,
}

/// `DialogUpdate`, centered, in place of any open dialog.
pub fn show(tui: &Tui, checks: bool) {
    let check = Rc::new(RefCell::new(Check { loading: checks, ..Check::default() }));
    let weak = tui.weak();
    tui.dialogs.replace(
        {
            let check = check.clone();
            move |cx| {
                cx.dialogs.set_centered(true);
                let Some(tui) = weak.upgrade() else {
                    return View::new(&cx.app);
                };
                let root = View::new(&cx.app);
                let draw: Rc<dyn Fn()> = Rc::new({
                    let (weak, cx, root, check) = (tui.weak(), Rc::downgrade(cx), root.clone(), check.clone());
                    move || {
                        let (Some(tui), Some(cx)) = (weak.upgrade(), cx.upgrade()) else {
                            return;
                        };
                        draw(&tui, &cx, &root, &check.borrow());
                    }
                });
                draw();
                *tui.updates.dialog.borrow_mut() = Some(Rc::downgrade(&draw));
                let enter = {
                    let (weak, check) = (tui.weak(), check.clone());
                    move |_: Option<&str>, _: Option<&KeyEvent>| {
                        let Some(tui) = weak.upgrade() else { return };
                        let shown = shown(&tui, &check.borrow());
                        if let Some(run) = buttons(&tui, &shown).pop().map(|button| button.1) {
                            tui.app.defer(move |_| run());
                        }
                    }
                };
                cx.layer(KeymapLayer {
                    commands: vec![TuiCommand::inline("return", enter).title("Confirm update action").group("Dialog")],
                    ..KeymapLayer::default()
                });
                // The dialog owns the drawing; a check that ends after it closed is dropped.
                let (weak, owner) = (tui.weak(), draw.clone());
                cx.on_close(Disposer::new(move || {
                    drop(owner);
                    if let Some(tui) = weak.upgrade() {
                        tui.updates.generation.set(tui.updates.generation.get() + 1);
                        tui.updates.dialog.borrow_mut().take();
                    }
                }));
                root
            }
        },
        None,
        DialogOptions::default(),
    );
    // After the replace: closing a dialog this one replaces moves the generation on too.
    let generation = tui.updates.generation.get() + 1;
    tui.updates.generation.set(generation);
    if !checks {
        return;
    }
    let weak = tui.weak();
    updates::check(
        tui,
        Box::new(move |result| {
            let Some(tui) = weak.upgrade() else { return };
            if tui.updates.generation.get() != generation {
                return;
            }
            {
                let mut check = check.borrow_mut();
                check.loading = false;
                match result {
                    Ok(unavailable) => check.unavailable = unavailable,
                    Err(error) => check.error = Some(error),
                }
            }
            tui.updates.redraw_dialog();
        }),
    );
}

fn shown(tui: &Tui, check: &Check) -> Shown {
    if let Some(message) = &check.error {
        return Shown::CheckFailed(message.clone());
    }
    let current = tui.updates.state.borrow().clone();
    if let Some(UpdateState::Installing(version)) = current {
        return Shown::Update(UpdateState::Installing(version));
    }
    if check.loading {
        return Shown::Checking;
    }
    if let Some(message) = &check.unavailable {
        return Shown::Unavailable(message.clone());
    }
    current.map_or(Shown::Current, Shown::Update)
}

type Button = (&'static str, Rc<dyn Fn()>);

/// `skip`, then `update` or `restart` when they apply; none while installing.
fn buttons(tui: &Tui, shown: &Shown) -> Vec<Button> {
    if matches!(shown, Shown::Update(UpdateState::Installing(_))) {
        return Vec::new();
    }
    let action = |run: fn(&Tui)| -> Rc<dyn Fn()> {
        let weak = tui.weak();
        Rc::new(move || {
            if let Some(tui) = weak.upgrade() {
                run(&tui);
            }
        })
    };
    let mut buttons: Vec<Button> = vec![(
        "Skip",
        action(|tui| {
            updates::dismiss(tui);
            tui.dialogs.clear();
        }),
    )];
    match shown {
        Shown::Update(UpdateState::Available(_)) => buttons.push(("Update", action(updates::install))),
        Shown::Update(UpdateState::Installed(_)) => buttons.push(("Restart", action(updates::restart))),
        _ => {}
    }
    buttons
}

fn draw(tui: &Tui, cx: &Rc<DialogCx>, root: &View, check: &Check) {
    let app = &cx.app;
    let theme = &cx.theme;
    let shown = shown(tui, check);
    let title = match &shown {
        Shown::Update(UpdateState::Installing(_)) => "Updating OpenCode",
        Shown::Update(UpdateState::Available(_) | UpdateState::Failed(_)) => "Update available",
        _ => "Update",
    };
    let animations = opencode_ui::motion::enabled(tui.settings.info().animations);
    let spinner = |label: String| {
        // `Spinner` draws in the muted color unless told otherwise; the shimmer runs in the base one.
        Spinner::new(app)
            .color(theme.text.muted)
            .shimmer(Some(theme.text.base))
            .label(label)
            .animations(animations)
            .as_any()
    };
    let muted = |text: &str| Text::new(app, text.to_owned()).fg(theme.text.muted).wrap(WrapMode::Word).as_any();
    let body = match &shown {
        Shown::Checking => spinner("Checking for updates…".to_owned()),
        Shown::Update(UpdateState::Available(_)) => {
            muted("An update is available. After installing, you'll be prompted to restart OpenCode.")
        }
        Shown::Update(UpdateState::Installing(version)) => spinner(format!("Installing OpenCode {version}…")),
        Shown::Update(UpdateState::Installed(_)) => {
            muted("Update successful! Restart closes OpenCode, then run opencode to use the new version.")
        }
        Shown::Current => muted("OpenCode is already up to date."),
        Shown::Unavailable(message) => muted(message),
        Shown::Update(UpdateState::Failed(message)) | Shown::CheckFailed(message) => {
            Text::new(app, message.clone()).fg(theme.text.feedback.error.base).as_any()
        }
    };
    let buttons = buttons(tui, &shown);
    let count = buttons.len();
    let primary = buttons
        .into_iter()
        .enumerate()
        .map(|(index, (label, run))| {
            let mut action = FooterAction::new(label.to_lowercase());
            if index + 1 == count {
                action = action.key("enter");
            }
            // A footer action runs inside the footer it replaces, so it waits for the event to end.
            let app = app.clone();
            action.on_trigger = Some(Rc::new(move || {
                let run = run.clone();
                app.defer(move |_| run());
            }));
            action
        })
        .collect();
    root.clear();
    root.add(&opencode_ui::dialog::layout_view(
        cx,
        &header(cx, HeaderProps { title: title.to_owned(), ..HeaderProps::default() }),
        &View::new(app).child(&body),
        Some(&footer(cx, FooterProps { primary, ..FooterProps::default() })),
        opencode_ui::dialog::DIALOG_INSET,
        1,
    ));
}
