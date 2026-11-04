//! Error details dialog (E.18b): `packages/tui/src/component/dialog-error-details.tsx`.
//!
//! E.17b added [`view`] for the MCP dialog's failed servers. It has no `source` path line yet (TS
//! `FilePath`); E.18b adds it for the plugin manager.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_ui::dialog::{DialogCx, FooterAction, FooterProps, HeaderProps, footer, header};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

/// `DialogErrorDetails` props.
pub struct Props {
    pub title: String,
    pub error: String,
    pub context: Option<String>,
    pub diagnostic_ref: Option<String>,
    /// Escape and the close label run it.
    pub on_back: Rc<dyn Fn()>,
}

/// The footer drawing, reached weakly from the footer's own action.
type Hook = RefCell<Option<Weak<dyn Fn()>>>;

/// Builds the details inside the dialog of `cx`.
pub fn view(tui: &Tui, cx: &Rc<DialogCx>, props: Props) -> View {
    let app = &cx.app;
    let theme = &cx.theme;
    let details = details(&props);
    let weak = tui.weak();

    let copied = Rc::new(Cell::new(false));
    let hook: Rc<Hook> = Rc::default();
    let copy: Rc<dyn Fn()> = {
        let (weak, copied, text, hook) = (weak.clone(), copied.clone(), details.text, hook.clone());
        Rc::new(move || {
            let Some(tui) = weak.upgrade() else { return };
            if !tui.app.copy_to_clipboard(&text) {
                tui.toasts.error("Failed to copy to clipboard");
                return;
            }
            copied.set(true);
            // A footer action runs inside the footer it replaces, so the redraw waits.
            if let Some(draw) = hook.borrow().as_ref().and_then(Weak::upgrade) {
                tui.app.defer(move |_| draw());
            }
        })
    };
    let investigate: Rc<dyn Fn()> = {
        let (weak, prompt) = (weak.clone(), details.prompt);
        Rc::new(move || {
            let Some(tui) = weak.upgrade() else { return };
            let prompt = prompt.clone();
            let weak = tui.weak();
            tui.app.defer(move |_| {
                let Some(tui) = weak.upgrade() else { return };
                tui.dialogs.clear();
                // `route.navigate({ type: "home", prompt })`: the new home prompt takes the text.
                tui.navigate(Route::Home);
                if let Some(textarea) = tui.textarea.borrow().as_ref() {
                    textarea.set_text(&prompt);
                    textarea.set_cursor_offset(u32::MAX);
                }
            });
        })
    };

    let slot = View::new(app);
    let draw: Rc<dyn Fn()> = {
        let (cx, slot, copied) = (Rc::downgrade(cx), slot.clone(), copied.clone());
        let (copy, investigate) = (copy.clone(), investigate.clone());
        Rc::new(move || {
            let Some(cx) = cx.upgrade() else { return };
            let mut actions = vec![FooterAction::new("investigate").key("i")];
            actions[0].on_trigger = Some(investigate.clone());
            let mut copy_action = if copied.get() {
                let mut action = FooterAction::new("✓ copied");
                action.color = Some(cx.theme.text.feedback.success.base);
                action
            } else {
                FooterAction::new("copy details").key("c")
            };
            copy_action.on_trigger = Some(copy.clone());
            actions.push(copy_action);
            let props = if cx.new_designs {
                FooterProps {
                    primary: actions,
                    ..FooterProps::default()
                }
            } else {
                FooterProps {
                    secondary: actions,
                    primary: vec![FooterAction::new("scroll").key("↑/↓")],
                    ..FooterProps::default()
                }
            };
            slot.clear();
            slot.add(&footer(&cx, props));
        })
    };
    draw();
    *hook.borrow_mut() = Some(Rc::downgrade(&draw));

    let scroll = ScrollBox::new(app).scrollbars(false).max_height(20);
    scroll.add(
        &Text::new(app, props.error.clone())
            .fg(theme.text.base)
            .wrap(WrapMode::Word),
    );
    let body = View::new(app).child(&scroll);
    if let Some(reference) = &props.diagnostic_ref {
        body.add(&Text::new(app, format!("Reference: {reference}")).fg(theme.text.muted));
    }

    let scroll_by = |rows: f64| {
        let scroll = scroll.clone();
        move |_: Option<&str>, _: Option<&KeyEvent>| {
            scroll.scroll_by(0.0, rows);
        }
    };
    let on_back = props.on_back.clone();
    let (copy_key, investigate_key) = (copy.clone(), investigate.clone());
    let top = scroll.clone();
    let bottom = scroll.clone();
    cx.layer(KeymapLayer {
        commands: vec![
            TuiCommand::inline("escape", move |_, _| on_back())
                .title("Back")
                .group("Dialog"),
            TuiCommand::inline("c", move |_, _| copy_key())
                .title("Copy details")
                .group("Dialog"),
            TuiCommand::inline("i", move |_, _| investigate_key())
                .title("Investigate error")
                .group("Dialog"),
            TuiCommand::inline("up", scroll_by(-1.0)).group("Dialog"),
            TuiCommand::inline("down", scroll_by(1.0)).group("Dialog"),
            TuiCommand::inline("pageup", scroll_by(-20.0)).group("Dialog"),
            TuiCommand::inline("pagedown", scroll_by(20.0)).group("Dialog"),
            TuiCommand::inline("home", move |_, _| {
                top.scroll_to(0.0, 0.0);
            })
            .group("Dialog"),
            TuiCommand::inline("end", move |_, _| {
                bottom.scroll_to(0.0, f64::MAX);
            })
            .group("Dialog"),
        ],
        ..KeymapLayer::default()
    });

    let title = Text::new(app, props.title.clone())
        .fg(theme.text.base)
        .bold()
        .grow(1.0)
        .basis(Length::Auto)
        .min_width(0)
        .wrap(WrapMode::None)
        .truncate(true);
    let on_back = props.on_back.clone();
    let head = header(
        cx,
        HeaderProps {
            title_view: Some(title.as_any()),
            gap: Some(2),
            on_close: Some(on_back),
            ..HeaderProps::default()
        },
    );
    let root = opencode_ui::dialog::layout(cx, &head, &body, None, None);
    root.add(&slot);
    root
}

/// `errorDetails`: the copied text and the investigation prompt.
pub struct Details {
    pub text: String,
    pub prompt: String,
}

pub fn details(props: &Props) -> Details {
    let mut lines = vec![props.title.clone()];
    lines.extend(props.context.clone());
    lines.push(format!("Error: {}", props.error));
    lines.extend(
        props
            .diagnostic_ref
            .as_ref()
            .map(|reference| format!("Reference: {reference}")),
    );
    let text = lines.join("\n");
    let mut prompt = vec![
        "Investigate why this OpenCode component failed in the current project.".to_owned(),
        text.clone(),
    ];
    prompt.extend(props.diagnostic_ref.as_ref().map(|reference| {
        format!(
            "Find the server log entry matching reference {reference} and inspect its original cause. If the server logs are not accessible from this session, say so and ask for the matching log entry; do not infer the cause from the reference alone."
        )
    }));
    prompt.push("Inspect the relevant project and global OpenCode configuration, startup or loading behavior, required environment variables or credentials, dependencies, and logs. Identify the root cause and recommend a fix. Do not expose credentials.".to_owned());
    Details {
        text,
        prompt: prompt.join("\n\n"),
    }
}
