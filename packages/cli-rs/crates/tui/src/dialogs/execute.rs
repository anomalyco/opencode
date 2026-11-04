//! Execute dialog (E.7b): `DialogExecute` (`routes/session/dialog-execute.tsx`). The code and the
//! output of a code-mode `execute` call, with copy actions. It follows the call while it runs: the
//! transcript row passes each new state to [`Live::set`].

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::{
    SessionMessageAssistantTool, SessionMessageAssistantToolState, ToolContent,
};
use opencode_ui::dialog::{
    DIALOG_INSET, DialogCx, DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps,
    footer, header,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opencode_ui::tool_info::tool_display_metadata;
use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use serde_json::Value;

use crate::app::Tui;
use crate::routes::session::messages::footer::duration;
use crate::routes::session::messages::shell::strip_ansi;

/// The open dialog: the call it shows and how to redraw it.
pub struct Live {
    part: RefCell<SessionMessageAssistantTool>,
    copied: Cell<Option<Copied>>,
    draw: RefCell<Option<Rc<dyn Fn()>>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Copied {
    Code,
    Output,
}

impl Live {
    /// Shows the call's new state.
    pub fn set(&self, part: SessionMessageAssistantTool) {
        if *self.part.borrow() == part {
            return;
        }
        *self.part.borrow_mut() = part;
        self.redraw();
    }

    fn redraw(&self) {
        let draw = self.draw.borrow().clone();
        if let Some(draw) = draw {
            draw();
        }
    }
}

/// Opens the dialog for `part` in place of any open dialog. The handle lives while the dialog is open.
pub fn show(tui: &Tui, part: SessionMessageAssistantTool) -> Weak<Live> {
    let live = Rc::new(Live {
        part: RefCell::new(part),
        copied: Cell::new(None),
        draw: RefCell::default(),
    });
    let handle = Rc::downgrade(&live);
    let page = tui.page();
    let weak = tui.weak();
    let keep = live.clone();
    tui.dialogs.replace(
        move |cx| view(cx, weak, &live, page),
        Some(Box::new(move || drop(keep))),
        DialogOptions {
            size: DialogSize::XLarge,
            key: Some("execute".to_owned()),
        },
    );
    tui.dialogs.set_centered(true);
    handle
}

fn view(cx: &Rc<DialogCx>, tui: Weak<Tui>, live: &Rc<Live>, page: Theme) -> View {
    let app = &cx.app;
    let syntax = opencode_ui::code::syntax_theme(&page);
    let max_height = (u32::from(app.size().1) * 7 / 10).saturating_sub(6).max(3);

    let copy: Rc<dyn Fn(Copied)> = {
        let (tui, live) = (tui.clone(), Rc::downgrade(live));
        Rc::new(move |kind| {
            let (Some(tui), Some(live)) = (tui.upgrade(), live.upgrade()) else {
                return;
            };
            let shown = Shown::new(&live.part.borrow());
            let Some(text) = (match kind {
                Copied::Code => shown.code,
                Copied::Output => shown.text,
            }) else {
                return;
            };
            if !tui.app.copy_to_clipboard(&text) {
                tui.toasts.error("Failed to copy to clipboard");
                return;
            }
            live.copied.set(Some(kind));
            // A footer action runs inside the footer it replaces, so the redraw waits.
            let live = Rc::downgrade(&live);
            tui.app.defer(move |_| {
                if let Some(live) = live.upgrade() {
                    live.redraw();
                }
            });
        })
    };

    let title = Text::new(app, "execute")
        .fg(cx.theme.text.base)
        .bold()
        .grow(1.0);
    let status = Text::new(app, "");
    let head = header(
        cx,
        HeaderProps {
            title_view: Some(
                View::new(app)
                    .row()
                    .gap(2)
                    .grow(1.0)
                    .child(&title)
                    .child(&status)
                    .as_any(),
            ),
            gap: Some(2),
            ..HeaderProps::default()
        },
    );
    let scroll = ScrollBox::new(app).scrollbars(false);
    // The scroll box paints no background of its own; the bleed box around it does.
    let body = View::new(app)
        .bg(page.background.raised.high)
        .margin_edge(Edge::Left, -(DIALOG_INSET as i32))
        .margin_edge(Edge::Right, -(DIALOG_INSET as i32))
        .child(&scroll);
    let foot = View::new(app);

    let draw: Rc<dyn Fn()> = {
        let (cx, live) = (Rc::downgrade(cx), Rc::downgrade(live));
        let (status, scroll, foot, copy) =
            (status.clone(), scroll.clone(), foot.clone(), copy.clone());
        Rc::new(move || {
            let (Some(cx), Some(live)) = (cx.upgrade(), live.upgrade()) else {
                return;
            };
            let shown = Shown::new(&live.part.borrow());
            status.set_text(shown.status.clone());
            status.fg(if shown.failed {
                cx.theme.text.feedback.error.base
            } else {
                cx.theme.text.muted
            });
            let width = cx
                .dialogs
                .size()
                .width()
                .min(u32::from(cx.width()).saturating_sub(2))
                .saturating_sub(2 * DIALOG_INSET)
                .max(20) as usize;
            scroll.height(shown.height(width).min(max_height as usize) as u32);
            scroll.content_view().clear();
            scroll
                .content_view()
                .add(&content(&cx.app, &page, &syntax, &shown, width));
            foot.clear();
            foot.add(&footer(
                &cx,
                FooterProps {
                    primary: [
                        (Copied::Code, "copy code", "c"),
                        (Copied::Output, "copy output", "o"),
                    ]
                    .into_iter()
                    .map(|(kind, title, key)| {
                        let mut action = if live.copied.get() == Some(kind) {
                            let mut action = FooterAction::new("✓ copied");
                            action.color = Some(cx.theme.text.feedback.success.base);
                            action
                        } else {
                            FooterAction::new(title).key(key)
                        };
                        let copy = copy.clone();
                        action.on_trigger = Some(Rc::new(move || copy(kind)));
                        action
                    })
                    .collect(),
                    ..FooterProps::default()
                },
            ));
        })
    };
    *live.draw.borrow_mut() = Some(draw.clone());
    draw();

    let scroll_by = |rows: f64| {
        let scroll = scroll.clone();
        move |_: Option<&str>, _: Option<&KeyEvent>| {
            scroll.scroll_by(0.0, rows);
        }
    };
    let copy_command = |kind: Copied| {
        let copy = copy.clone();
        move |_: Option<&str>, _: Option<&KeyEvent>| copy(kind)
    };
    let (top, bottom) = (scroll.clone(), scroll.clone());
    let page_rows = f64::from(max_height);
    cx.layer(KeymapLayer {
        commands: vec![
            TuiCommand::inline("up", scroll_by(-1.0))
                .title("Scroll up")
                .group("Execute"),
            TuiCommand::inline("down", scroll_by(1.0))
                .title("Scroll down")
                .group("Execute"),
            TuiCommand::inline("pageup", scroll_by(-page_rows))
                .title("Previous page")
                .group("Execute"),
            TuiCommand::inline("pagedown", scroll_by(page_rows))
                .title("Next page")
                .group("Execute"),
            TuiCommand::inline("home", move |_, _| {
                top.scroll_to(0.0, 0.0);
            })
            .title("Scroll to code")
            .group("Execute"),
            TuiCommand::inline("end", move |_, _| {
                bottom.scroll_to(0.0, f64::MAX);
            })
            .title("Scroll to output")
            .group("Execute"),
            TuiCommand::inline("c", copy_command(Copied::Code))
                .title("Copy code")
                .group("Execute"),
            TuiCommand::inline("o", copy_command(Copied::Output))
                .title("Copy output")
                .group("Execute"),
        ],
        ..KeymapLayer::default()
    });

    opencode_ui::dialog::layout_view(cx, &head, &body, Some(&foot), DIALOG_INSET, 1)
}

/// What the dialog shows of a call.
struct Shown {
    code: Option<String>,
    /// The output text, or the error message.
    text: Option<String>,
    /// The output split into its JSON result and the warnings and logs after it.
    highlighted: Option<(String, Option<String>)>,
    failed: bool,
    completed: bool,
    status: String,
}

impl Shown {
    fn new(part: &SessionMessageAssistantTool) -> Self {
        let state = &part.state;
        let input = serde_json::to_value(state).unwrap_or_default();
        let code = input
            .get("input")
            .and_then(|input| input.get("code"))
            .and_then(Value::as_str)
            .filter(|code| !code.is_empty())
            .map(str::to_owned);
        let text = match state {
            SessionMessageAssistantToolState::Error(state) => {
                Some(strip_ansi(&state.error.message)).filter(|text| !text.is_empty())
            }
            SessionMessageAssistantToolState::Completed(state) => Some(strip_ansi(
                state
                    .content
                    .iter()
                    .filter_map(|item| match item {
                        ToolContent::Text(text) => Some(text.text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim(),
            ))
            .filter(|text| !text.is_empty()),
            _ => None,
        };
        let failed = match state {
            SessionMessageAssistantToolState::Error(_) => true,
            SessionMessageAssistantToolState::Streaming(_) => false,
            state => tool_display_metadata(state).get("error") == Some(&Value::Bool(true)),
        };
        let took = part
            .time
            .completed
            .filter(|completed| *completed != 0.0)
            .map(|completed| {
                format!(
                    " · {}",
                    duration(completed - part.time.ran.unwrap_or(part.time.created))
                )
            })
            .unwrap_or_default();
        let status = match state {
            SessionMessageAssistantToolState::Streaming(_) => "Receiving code…".to_owned(),
            SessionMessageAssistantToolState::Running(_) => "Running".to_owned(),
            _ if failed => format!("Failed{took}"),
            _ => format!("Completed{took}"),
        };
        Self {
            highlighted: text.as_deref().and_then(highlighted),
            code,
            text,
            failed,
            completed: matches!(state, SessionMessageAssistantToolState::Completed(_)),
            status,
        }
    }

    /// The width of the shared line-number gutter.
    fn digits(&self) -> usize {
        let lines = |text: Option<&str>| text.map_or(0, |text| text.split('\n').count());
        lines(self.code.as_deref())
            .max(lines(
                self.highlighted.as_ref().map(|(json, _)| json.as_str()),
            ))
            .max(1)
            .to_string()
            .len()
    }

    /// The scroll box's height before the dialog's cap: code and JSON wrap by character, so it is known.
    fn height(&self, width: usize) -> usize {
        let code_width = width.saturating_sub(self.digits() + 1).max(1);
        let output = match &self.highlighted {
            Some((json, rest)) => {
                wrapped_rows(Some(json), code_width) + wrapped_rows(rest.as_deref(), code_width)
            }
            None => wrapped_rows(self.text.as_deref(), width).max(1),
        };
        wrapped_rows(self.code.as_deref(), code_width).max(1) + output + 5
    }
}

/// The scroll box's content: the code, then the output.
fn content(app: &App, theme: &Theme, syntax: &SyntaxTheme, shown: &Shown, width: usize) -> View {
    let digits = shown.digits();
    let code_width = width.saturating_sub(digits + 1).max(1);
    let heading = |label: &str| Text::new(app, label).fg(theme.text.muted).bold();
    let code = View::new(app).column().child(&heading("Code"));
    match &shown.code {
        Some(value) => code.add(&guttered(
            app,
            theme,
            syntax,
            value,
            "typescript",
            digits,
            code_width,
        )),
        None => code.add(&Text::new(app, "Waiting for code…").fg(theme.text.muted)),
    };
    let output = View::new(app).column().child(&heading("Output"));
    let text_fg = if shown.failed {
        theme.text.feedback.error.base
    } else {
        theme.text.base
    };
    match &shown.highlighted {
        Some((json, rest)) => {
            output.add(&guttered(
                app, theme, syntax, json, "json", digits, code_width,
            ));
            if let Some(rest) = rest {
                output.add(
                    &View::new(app)
                        .padding_edge(Edge::Left, (digits + 1) as u32)
                        .child(
                            &Text::new(app, rest.clone())
                                .fg(text_fg)
                                .wrap(WrapMode::Word),
                        ),
                );
            }
        }
        None => {
            let (text, fg) = match &shown.text {
                Some(text) => (text.clone(), text_fg),
                None if shown.completed => ("No output".to_owned(), theme.text.muted),
                None => ("Waiting for output…".to_owned(), theme.text.muted),
            };
            output.add(&Text::new(app, text).fg(fg).wrap(WrapMode::Word));
        }
    }
    View::new(app)
        .column()
        .gap(1)
        .padding_x(DIALOG_INSET)
        .padding_y(1)
        .child(&code)
        .child(&output)
}

/// `GutteredCode`: highlighted code, wrapped by character, after one left-aligned gutter of line numbers
/// that leaves continuation rows unnumbered.
fn guttered(
    app: &App,
    theme: &Theme,
    syntax: &SyntaxTheme,
    content: &str,
    filetype: &str,
    digits: usize,
    width: usize,
) -> View {
    let gutter = content
        .split('\n')
        .enumerate()
        .flat_map(|(index, line)| {
            let rows = line.chars().count().div_ceil(width).max(1);
            std::iter::once(format!("{:<digits$}", index + 1))
                .chain(std::iter::repeat_n(" ".repeat(digits), rows - 1))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let code = opencode_ui::code::view(app, theme, syntax, Some(filetype), content)
        .wrap(WrapMode::Char)
        .grow(1.0)
        .shrink(1.0)
        .min_width(0);
    View::new(app)
        .row()
        .gap(1)
        .width(Length::Percent(100.0))
        .child(
            &Text::new(app, gutter)
                .fg(theme.text.muted)
                .shrink(0.0)
                .width(digits as u32),
        )
        .child(&code)
}

/// `highlightedOutput`: a JSON result, optionally followed by `Warnings:` and `Logs:` sections.
fn highlighted(text: &str) -> Option<(String, Option<String>)> {
    if !text.starts_with('{') && !text.starts_with('[') {
        return None;
    }
    let end = ["\n\nWarnings:\n", "\n\nLogs:\n"]
        .iter()
        .filter_map(|marker| text.find(marker))
        .min()
        .unwrap_or(text.len());
    let json = &text[..end];
    serde_json::from_str::<Value>(json).ok()?;
    let rest = text[end..].trim();
    Some((json.to_owned(), (!rest.is_empty()).then(|| rest.to_owned())))
}

/// `wrappedRows`: the rows `text` takes when each line breaks every `width` characters.
fn wrapped_rows(text: Option<&str>, width: usize) -> usize {
    let Some(text) = text.filter(|text| !text.is_empty()) else {
        return 0;
    };
    text.split('\n')
        .map(|line| line.chars().count().div_ceil(width.max(1)).max(1))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::{highlighted, wrapped_rows};

    #[test]
    fn highlighted_output_splits_the_json_from_the_logs() {
        assert_eq!(highlighted("plain"), None);
        assert_eq!(highlighted("{ not json"), None);
        assert_eq!(
            highlighted("{\"a\":1}\n\nLogs:\nhello\n"),
            Some(("{\"a\":1}".to_owned(), Some("Logs:\nhello".to_owned())))
        );
        assert_eq!(highlighted("[1]"), Some(("[1]".to_owned(), None)));
    }

    #[test]
    fn wrapped_rows_break_by_character() {
        assert_eq!(wrapped_rows(None, 10), 0);
        assert_eq!(wrapped_rows(Some(""), 10), 0);
        assert_eq!(wrapped_rows(Some("abc\n\n12345678901"), 10), 4);
    }
}
