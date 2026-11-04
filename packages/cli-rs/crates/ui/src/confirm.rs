//! Confirm dialog (U.3): `packages/tui/src/ui/dialog-confirm.tsx`.

use crate::dialog::{DialogCx, FooterAction, FooterProps, HeaderProps, header, layout};
use crate::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;
use std::cell::Cell;
use std::rc::Rc;

/// `DialogConfirmProps`.
#[derive(Clone, Default)]
pub struct ConfirmProps {
    pub title: String,
    pub message: String,
    pub on_confirm: Option<Rc<dyn Fn()>>,
    pub on_cancel: Option<Rc<dyn Fn()>>,
    /// Button labels; `confirm` and `cancel` by default.
    pub confirm_label: Option<String>,
    pub cancel_label: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Choice {
    Confirm,
    Cancel,
}

/// `DialogConfirm`. The legacy footer has `Cancel` and `Confirm` buttons that Left and Right move between, with
/// Confirm active first; under `new-designs` Enter confirms and Escape cancels.
pub fn confirm(cx: &Rc<DialogCx>, props: ConfirmProps) -> View {
    let theme = cx.theme.clone();
    let active = Rc::new(Cell::new(Choice::Confirm));
    let choose: Rc<dyn Fn(Choice)> = {
        let dialogs = cx.dialogs.clone();
        let props = props.clone();
        Rc::new(move |choice| {
            let run = match choice {
                Choice::Confirm => &props.on_confirm,
                Choice::Cancel => &props.on_cancel,
            };
            if let Some(run) = run {
                run();
            }
            dialogs.clear();
        })
    };
    let label = |choice: Choice| match choice {
        Choice::Confirm => props.confirm_label.as_deref().unwrap_or("confirm"),
        Choice::Cancel => props.cancel_label.as_deref().unwrap_or("cancel"),
    };

    let buttons: Vec<(Choice, View, Text)> = [Choice::Cancel, Choice::Confirm]
        .into_iter()
        .map(|choice| {
            let text = Text::new(&cx.app, titlecase(label(choice)));
            let button = View::new(&cx.app).padding_x(1).child(&text);
            let choose = choose.clone();
            button.on_mouse(move |_cx, event| {
                if matches!(event.kind, MouseEventKind::Up(_)) {
                    choose(choice);
                }
            });
            (choice, button, text)
        })
        .collect();
    let paint: Rc<dyn Fn()> = {
        let active = active.clone();
        let buttons = buttons.clone();
        Rc::new(move || {
            for (choice, button, text) in &buttons {
                let on = *choice == active.get();
                button.bg(if on {
                    theme.background.action.primary.focused
                } else {
                    Color::TRANSPARENT
                });
                text.fg(if on {
                    theme.text.action.primary.focused
                } else {
                    theme.text.muted
                });
            }
        })
    };
    paint();

    let commands = if cx.new_designs {
        let (yes, no) = (choose.clone(), choose.clone());
        vec![
            TuiCommand::inline("return", move |_, _| yes(Choice::Confirm))
                .title("Confirm")
                .group("Dialog"),
            TuiCommand::inline("escape", move |_, _| no(Choice::Cancel))
                .title("Cancel")
                .group("Dialog"),
        ]
    } else {
        let toggle = {
            let active = active.clone();
            let paint = paint.clone();
            move || {
                active.set(match active.get() {
                    Choice::Confirm => Choice::Cancel,
                    Choice::Cancel => Choice::Confirm,
                });
                paint();
            }
        };
        let (submit, active) = (choose.clone(), active.clone());
        let (left, right) = (toggle.clone(), toggle);
        vec![
            TuiCommand::inline("return", move |_, _| submit(active.get()))
                .title("Confirm dialog selection")
                .group("Dialog"),
            TuiCommand::inline("left", move |_, _| left())
                .title("Previous dialog option")
                .group("Dialog"),
            TuiCommand::inline("right", move |_, _| right())
                .title("Next dialog option")
                .group("Dialog"),
        ]
    };
    cx.layer(KeymapLayer {
        commands,
        ..KeymapLayer::default()
    });

    let legacy = View::new(&cx.app).row().justify(Justify::End);
    for (_, button, _) in &buttons {
        legacy.add(button);
    }
    let (no, yes) = (choose.clone(), choose);
    layout(
        cx,
        &header(
            cx,
            HeaderProps {
                title: props.title.clone(),
                ..HeaderProps::default()
            },
        ),
        &Text::new(&cx.app, props.message.as_str()).fg(cx.theme.text.muted),
        Some(FooterProps {
            // Footer labels are lowercase; the legacy buttons title-case the same labels.
            primary: vec![
                FooterAction::new(label(Choice::Cancel).to_lowercase())
                    .key("esc")
                    .on_trigger(move || no(Choice::Cancel)),
                FooterAction::new(label(Choice::Confirm).to_lowercase())
                    .key("enter")
                    .on_trigger(move || yes(Choice::Confirm)),
            ],
            ..FooterProps::default()
        }),
        Some(legacy),
    )
}

/// `Locale.titlecase`: upper-cases the first letter of each word.
pub fn titlecase(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = false;
    for char in text.chars() {
        let is_word = char.is_ascii_alphanumeric() || char == '_';
        out.push(if is_word && !word {
            char.to_ascii_uppercase()
        } else {
            char
        });
        word = is_word;
    }
    out
}
