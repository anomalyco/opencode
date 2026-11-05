//! Prompt dialog (U.3): `packages/tui/src/ui/dialog-prompt.tsx`.
//!
//! A one-line text field with a title, an optional description, footer actions bound to keymap commands while the
//! field has focus, and a busy state. [`prompt`] returns a [`Prompt`] handle for what TS props change later:
//! the busy state and the value.

use crate::bind;
use crate::dialog::{
    DialogCx, DialogSize, FocusId, FooterAction, FooterProps, HeaderProps, footer, header, layout_view,
};
use crate::keymap::{KeymapLayer, TuiCommand};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use std::cell::Cell;
use std::rc::{Rc, Weak};

/// Builds the content above the field.
pub type Description = Rc<dyn Fn(&DialogCx) -> AnyWidget>;

/// `DialogPromptAction`: a footer action whose command is bound while the field has focus.
#[derive(Clone)]
pub struct PromptAction {
    pub title: String,
    pub command: String,
    /// The command's title in help listings; `title` by default.
    pub command_title: Option<String>,
    pub run: Rc<dyn Fn(&Prompt)>,
}

/// `DialogPromptProps`.
#[derive(Clone, Default)]
pub struct PromptProps {
    pub title: String,
    pub size: DialogSize,
    /// Muted line below the title.
    pub subtitle: Option<String>,
    /// Content above the field.
    pub description: Option<Description>,
    pub placeholder: Option<String>,
    pub value: Option<String>,
    pub busy: bool,
    pub busy_text: Option<String>,
    pub actions: Vec<PromptAction>,
    pub on_confirm: Option<crate::select::OnText>,
    pub on_cancel: Option<Rc<dyn Fn()>>,
}

struct Inner {
    cx: Rc<DialogCx>,
    props: PromptProps,
    busy: Cell<bool>,
    field: Textarea,
    busy_line: Text,
    footer_slot: View,
}

/// The prompt's handle. Cloning is cheap.
#[derive(Clone)]
pub struct Prompt(Rc<Inner>);

/// Builds `DialogPrompt` in `cx`.
pub fn prompt(cx: &Rc<DialogCx>, props: PromptProps) -> (View, Prompt) {
    let app = &cx.app;
    let theme = &cx.theme;
    cx.dialogs.set_size(props.size);
    let field = Textarea::new(app)
        .mouse_pointer(MousePointer::DEFAULT)
        .height(1)
        .wrap(WrapMode::None)
        .placeholder(props.placeholder.as_deref().unwrap_or("Enter text"))
        .placeholder_color(theme.text.muted);
    if let Some(value) = &props.value {
        field.set_text(value);
    }
    let busy_line = Text::new(app, "").fg(theme.text.muted);
    let inner = Rc::new(Inner {
        cx: cx.clone(),
        busy: Cell::new(props.busy),
        props,
        field,
        busy_line,
        footer_slot: View::new(app),
    });
    let owner = inner.clone();
    cx.on_close(Disposer::new(move || drop(owner)));
    let prompt = Prompt(inner);
    prompt.register_layers();

    let props = &prompt.0.props;
    let body = View::new(app).gap(1);
    if let Some(description) = &props.description {
        body.add(&description(cx));
    }
    body.add(&prompt.0.field).add(&prompt.0.busy_line);
    let weak = Rc::downgrade(&prompt.0);
    let on_close: Rc<dyn Fn()> = Rc::new(bind!(weak, |inner| {
        if inner.busy.get() {
            return;
        }
        match &inner.props.on_cancel {
            Some(cancel) => cancel(),
            None => inner.cx.dialogs.clear(),
        }
    }));
    let head = header(
        cx,
        HeaderProps {
            title: props.title.clone(),
            description: props.subtitle.clone(),
            on_close: Some(on_close),
            ..HeaderProps::default()
        },
    );
    let field = prompt.0.field.clone();
    cx.editor(move || {
        if !field.is_focused() || field.text().is_empty() {
            return false;
        }
        field.set_text("");
        true
    });
    prompt.apply_busy();
    if !prompt.busy() {
        cx.focus(&prompt.0.field);
    }
    let root = layout_view(cx, &head, &body, Some(&prompt.0.footer_slot), crate::dialog::DIALOG_INSET, 2);
    (root, prompt)
}

impl Prompt {
    pub fn value(&self) -> String {
        self.0.field.text()
    }

    /// Replaces the value and moves the cursor to its end (the handle actions receive).
    pub fn set_value(&self, value: &str) {
        self.0.field.set_text(value);
    }

    pub fn busy(&self) -> bool {
        self.0.busy.get()
    }

    /// Turns the busy state on or off: the field blurs and greys out, and the footer actions disable.
    pub fn set_busy(&self, busy: bool) {
        self.0.busy.set(busy);
        self.apply_busy();
        let field = &self.0.field;
        if busy && field.is_focused() {
            self.0.cx.app.blur();
        }
        if !busy {
            field.focus();
        }
    }

    pub fn field(&self) -> &Textarea {
        &self.0.field
    }

    fn confirm(&self) {
        if self.0.busy.get() {
            return;
        }
        if let Some(confirm) = &self.0.props.on_confirm {
            confirm(&self.0.field.text());
        }
    }

    fn register_layers(&self) {
        let weak = Rc::downgrade(&self.0);
        let busy = {
            let weak = weak.clone();
            Condition::When(Rc::new(move || weak.upgrade().is_some_and(|inner| !inner.busy.get())))
        };
        let submit = weak.clone();
        let mut commands = vec![
            TuiCommand::new("dialog.prompt.submit", bind!(submit, |inner, _, _| Prompt(inner).confirm()))
                .title("Submit dialog prompt")
                .group("Dialog"),
        ];
        for action in &self.0.props.actions {
            let run = action.run.clone();
            commands.push(
                TuiCommand::new(action.command.clone(), bind!(weak, |inner, _, _| run(&Prompt(inner))))
                    .title(action.command_title.clone().unwrap_or_else(|| action.title.clone()))
                    .group("Dialog"),
            );
        }
        // Dialog form semantics win over the managed textarea input layer.
        self.0.cx.layer(KeymapLayer::<FocusId> {
            target: Some(self.0.field.id()),
            enabled: busy,
            priority: 1,
            commands,
            ..KeymapLayer::default()
        });
        if self.0.props.on_cancel.is_some() {
            self.0.cx.layer(KeymapLayer::<FocusId> {
                priority: 1,
                commands: vec![
                    TuiCommand::inline(
                        "escape",
                        bind!(weak, |inner, _, _| {
                            if inner.cx.app.selected_text().is_some() {
                                inner.cx.app.clear_selection();
                                return;
                            }
                            if !inner.busy.get()
                                && let Some(cancel) = &inner.props.on_cancel
                            {
                                cancel();
                            }
                        }),
                    )
                    .title("Back")
                    .group("Dialog"),
                ],
                ..KeymapLayer::default()
            });
        }
    }

    fn apply_busy(&self) {
        let inner = &self.0;
        let theme = &inner.cx.theme;
        let busy = inner.busy.get();
        let text = if busy { theme.text.formfield.disabled } else { theme.text.formfield.base };
        inner.field.colors(text, Color::TRANSPARENT).focused_colors(text, Color::TRANSPARENT).cursor_color(if busy {
            theme.background.formfield.disabled
        } else {
            theme.text.base
        });
        // The `Spinner` with `animations: false`; the animated frames come with U.6.
        inner.busy_line.set_text(format!("⋯ {}", inner.props.busy_text.as_deref().unwrap_or("Working…"))).visible(busy);
        self.render_footer();
    }

    fn render_footer(&self) {
        let inner = &self.0;
        let cx = &inner.cx;
        let slot = &inner.footer_slot;
        slot.clear();
        let weak: Weak<Inner> = Rc::downgrade(&self.0);
        let submit = FooterAction::new("submit")
            .command("dialog.prompt.submit")
            .on_trigger(bind!(weak, |inner| Prompt(inner).confirm()));
        let extra: Vec<FooterAction> = inner
            .props
            .actions
            .iter()
            .map(|action| {
                let weak = Rc::downgrade(&self.0);
                let run = action.run.clone();
                FooterAction::new(action.title.clone())
                    .command(action.command.clone())
                    .disabled(inner.busy.get())
                    .on_trigger(bind!(weak, |inner| run(&Prompt(inner))))
            })
            .collect();
        let mut primary = extra;
        primary.push(submit.disabled(inner.busy.get()));
        slot.add(&footer(cx, FooterProps { primary, ..FooterProps::default() }));
    }
}
