//! `/btw` (E.14, row F03, `feature-plugins/prompt/btw.tsx`): `session.aside` asks a one-shot side question with
//! the session's context through `session.generate`, without adding to the conversation, and shows the answer
//! in a large dialog. While answers are pending, a `/btw` spinner shows in `prompt.footer.status`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{SessionGenerateInput, SessionID};
use opencode_plugin::{Definition, Placement, Slotted, slot};
use opencode_store::Changes;
use opencode_ui::bind;
use opencode_ui::dialog::{self, DIALOG_INSET, DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps};
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opencode_ui::motion::Spinner;
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

// `session.generate` exposes the session's tools but runs no tool loop, so a tool call would surface as an
// empty answer.
const INSTRUCTIONS: &str = "The user is asking a quick side question about the conversation so far. \
Answer directly and concisely in markdown from what you already know. \
Do not call any tools and do not take any actions.";

type Action = Rc<dyn Fn()>;

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.btw", |cx| {
        let pending = Rc::new(Cell::new(0u32));
        let shown = pending.clone();
        cx.slot(Placement::append(slot::PROMPT_FOOTER_STATUS), move |tui, _| {
            Box::new(Pending::new(tui, shown.clone()))
        });
        let weak = Rc::downgrade(cx.host());
        cx.layer(KeymapLayer::global(vec![
            TuiCommand::new("session.aside", bind!(weak, |tui, input: Option<&str>, _| aside(&tui, &pending, input)))
                .title("Ask a side question")
                .description("One-shot answer from the session's context without adding to the conversation")
                .group("Session")
                .palette()
                .slash(Slash::new("btw").arguments())
                .bind(Bind::Default),
        ]));
    })
}

/// The `/btw` spinner, shown while any answer is pending.
struct Pending {
    root: View,
    count: Rc<Cell<u32>>,
}

impl Pending {
    fn new(tui: &Tui, count: Rc<Cell<u32>>) -> Self {
        let spinner = Spinner::new(&tui.app)
            .color(tui.page().interactive().step(200))
            .label("/btw")
            .animations(opencode_ui::motion::enabled(tui.config().info.animations));
        let root = View::new(&tui.app).shrink(0.0).child(&spinner).visible(count.get() > 0);
        Self { root, count }
    }
}

impl Slotted<Tui> for Pending {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, _: &Tui, _: &Changes) {
        self.root.visible(self.count.get() > 0);
    }
}

/// `session.aside`: asks the question given with `/btw`, or prompts for one.
fn aside(tui: &Tui, pending: &Rc<Cell<u32>>, input: Option<&str>) {
    let Route::Session { id } = tui.route() else {
        tui.toasts.show(ToastOptions::new(Variant::Warning, "Open a session first"));
        return;
    };
    let question = input.map(str::trim).unwrap_or_default();
    if !question.is_empty() {
        ask(tui, pending, id, question.to_owned());
        return;
    }
    let weak = tui.weak();
    let pending = pending.clone();
    let clear = tui.dialogs.clone();
    tui.dialogs.replace(
        move |cx| {
            let (view, _) = prompt(
                cx,
                PromptProps {
                    title: "/btw".to_owned(),
                    placeholder: Some("Ask anything".to_owned()),
                    on_confirm: Some(Rc::new(bind!(weak, |tui, value: &str| {
                        tui.dialogs.clear();
                        if !value.is_empty() {
                            ask(&tui, &pending, id.clone(), value.to_owned());
                        }
                    }))),
                    on_cancel: Some(Rc::new(move || clear.clear())),
                    ..PromptProps::default()
                },
            );
            view
        },
        None,
        DialogOptions::default(),
    );
}

fn ask(tui: &Tui, pending: &Rc<Cell<u32>>, session: SessionID, question: String) {
    pending.set(pending.get() + 1);
    tui.resync();
    let client = tui.data.client().clone();
    let input = SessionGenerateInput { session_id: session, prompt: format!("{INSTRUCTIONS}\n\n{question}") };
    let weak = tui.weak();
    let pending = pending.clone();
    tui.app.spawn(
        async move { client.session_generate(&input, &RequestOptions::default()).await },
        move |_, result| {
            pending.set(pending.get().saturating_sub(1));
            let Some(tui) = weak.upgrade() else { return };
            tui.resync();
            match result {
                Ok(output) => answer(&tui, question, output.text.trim().to_owned()),
                Err(error) => tui.toasts.error(error.to_string()),
            }
        },
    );
}

/// `Answer`: the question in the header, the answer as Markdown in a scroll box at most 60% of the screen
/// high, and `copy response` (`c`).
fn answer(tui: &Tui, question: String, text: String) {
    let renderers = crate::plugins::host::code_blocks(tui);
    let page = tui.page();
    let conceal = tui
        .config()
        .info
        .session
        .as_ref()
        .and_then(|session| session.markdown)
        .unwrap_or(opencode_local::cli_config::Markdown::Rendered)
        == opencode_local::cli_config::Markdown::Rendered;
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let theme = &cx.theme;
            let height = app.size().1;
            let max = (u32::from(height) * 6 / 10).max(8);
            let syntax = opencode_ui::code::syntax_theme(&page);
            let markdown = opencode_ui::markdown::view(app, &page, &syntax, &renderers, conceal, false);
            markdown.set_markdown(&text);
            let scroll = ScrollBox::new(app).scrollbars(false).height(1);
            let content = View::new(app).shrink(0.0).padding_x(DIALOG_INSET).padding_y(1).child(&markdown);
            // `maxHeight`: the box is as high as the answer and its padding, up to 60% of the screen.
            let fit = scroll.clone();
            markdown.on_resize(move |cx, rect| {
                fit.height((rect.height.ceil() as u32 + 2).clamp(1, max));
                cx.app().request_redraw();
            });
            scroll.add(&content);
            // Copying swaps the action for `✓ copied` in the success color; the key and a click both copy.
            let copy: Rc<RefCell<Option<Action>>> = Rc::default();
            let trigger = {
                let copy = Rc::downgrade(&copy);
                move || {
                    let run = copy.upgrade().and_then(|copy| copy.borrow().clone());
                    if let Some(run) = run {
                        run();
                    }
                }
            };
            let header = dialog::header(
                cx,
                HeaderProps {
                    gap: Some(2),
                    title_view: Some(
                        View::new(app)
                            .row()
                            .gap(2)
                            .grow(1.0)
                            .min_width(0)
                            .child(&Text::new(app, "/btw").fg(theme.text.base).bold().shrink(0.0))
                            .child(
                                &Text::new(app, question.split_whitespace().collect::<Vec<_>>().join(" "))
                                    .fg(theme.text.muted)
                                    .wrap(WrapMode::None)
                                    .truncate(true)
                                    .grow(1.0),
                            )
                            .as_any(),
                    ),
                    ..HeaderProps::default()
                },
            );
            let action = FooterAction::new("copy response").key("c").on_trigger(trigger.clone());
            // `DialogBleed`: the answer's background reaches the dialog's edges.
            let body = View::new(app).margin_x(-(DIALOG_INSET as i32)).bg(page.background.raised.high).child(&scroll);
            let footer = View::new(app)
                .child(&dialog::footer(cx, FooterProps { primary: vec![action], ..FooterProps::default() }));
            let layout = dialog::layout_view(cx, &header, &body, Some(&footer), DIALOG_INSET, 1);
            {
                let footer_cx = cx.clone();
                let footer = footer.clone();
                let success = theme.text.feedback.success.base;
                let text = text.clone();
                let again = trigger.clone();
                *copy.borrow_mut() = Some(Rc::new(bind!(weak, |tui| {
                    if !tui.app.copy_to_clipboard(&text) {
                        tui.toasts.error("Failed to copy to clipboard");
                        return;
                    }
                    let mut done = FooterAction::new("✓ copied").on_trigger(again.clone());
                    done.color = Some(success);
                    footer.clear();
                    footer.add(&dialog::footer(
                        &footer_cx,
                        FooterProps { primary: vec![done], ..FooterProps::default() },
                    ));
                    tui.app.request_redraw();
                })));
                let step = |delta: f64| {
                    let scroll = scroll.clone();
                    move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
                        scroll.scroll_by(0.0, delta);
                    }
                };
                let page_rows = f64::from(max);
                let (top, bottom) = (scroll.clone(), scroll.clone());
                cx.layer(KeymapLayer::new(vec![
                    // The key's layer lives as long as the dialog and keeps the copy action alive.
                    TuiCommand::inline("c", move |_, _| {
                        let run = copy.borrow().clone();
                        if let Some(run) = run {
                            run();
                        }
                    })
                    .title("Copy answer")
                    .group("Dialog"),
                    TuiCommand::inline("up,k", step(-1.0)).group("Dialog"),
                    TuiCommand::inline("down,j", step(1.0)).group("Dialog"),
                    TuiCommand::inline("pageup", step(-page_rows)).group("Dialog"),
                    TuiCommand::inline("pagedown", step(page_rows)).group("Dialog"),
                    TuiCommand::inline("home", move |_, _| {
                        top.scroll_to(0.0, 0.0);
                    })
                    .group("Dialog"),
                    TuiCommand::inline("end", move |_, _| {
                        bottom.scroll_to(0.0, f64::MAX);
                    })
                    .group("Dialog"),
                ]));
            }
            layout
        },
        None,
        DialogOptions::new(DialogSize::Large),
    );
    tui.dialogs.set_centered(true);
}
