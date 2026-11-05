//! Export dialogs (E.10a, rows DLG31 and DLG32): `ui/dialog-export-options.tsx` and `ui/dialog-export-result.tsx`,
//! as they look under `new-designs`. The options pick a format (Markdown with or without thinking and tools, or
//! JSON, sanitized or not) and an action (copy or save to a file); the result shows where the file went.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_ui::bind;
use opencode_ui::dialog::{DIALOG_INSET, DialogOptions, FooterAction, FooterProps, HeaderProps, header, layout_with};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::select::{self, ActionRun, FooterHint, Group, SelectAction, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::app::Tui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Markdown,
    Json,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Copy,
    Export,
}

/// What the options dialog confirms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Choice {
    pub action: Action,
    pub format: Format,
    pub thinking: bool,
    pub tools: bool,
    pub sanitize: bool,
}

pub type OnConfirm = Rc<dyn Fn(&Tui, Choice)>;

struct State {
    format: Cell<Format>,
    thinking: Cell<bool>,
    tools: Cell<bool>,
    sanitize: Cell<bool>,
}

impl State {
    fn choice(&self, action: Action) -> Choice {
        Choice {
            action,
            format: self.format.get(),
            thinking: self.thinking.get(),
            tools: self.tools.get(),
            sanitize: self.sanitize.get(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Row {
    Format,
    Thinking,
    Tools,
    Sanitize,
}

/// `DialogExportOptions.show` (`DialogExportOptionsList`): one row per value. Up and Down move; Left, Right, and
/// Space change the value; Enter saves to a file and `c` copies.
pub fn options(tui: &Tui, default_thinking: bool, on_confirm: OnConfirm) {
    let confirm: Rc<dyn Fn(Choice)> = Rc::new(bind!(tui, |tui, choice| on_confirm(&tui, choice)));
    tui.dialogs.replace(
        move |cx| {
            let state = Rc::new(State {
                format: Cell::new(Format::Markdown),
                thinking: Cell::new(default_thinking),
                tools: Cell::new(true),
                sanitize: Cell::new(false),
            });
            let selected = Rc::new(Cell::new(Row::Format));
            // `DialogSelectChoice`: the selected row shows `‹ value ›`; the others pad the value to the same width.
            let options: Rc<dyn Fn() -> Vec<SelectOption<Row>>> = {
                let state = state.clone();
                Rc::new(move || {
                    let choice = |row: Row, title: &str, value: &str| {
                        let mut option = SelectOption::new(title, row);
                        option.choice = Some(select::Choice { value: value.to_owned(), open: false });
                        option
                    };
                    let include = |value: bool| if value { "include" } else { "exclude" };
                    let format = state.format.get();
                    let mut options = vec![choice(
                        Row::Format,
                        "Format",
                        match format {
                            Format::Markdown => "markdown",
                            Format::Json => "json",
                        },
                    )];
                    match format {
                        Format::Markdown => options.extend([
                            choice(Row::Thinking, "Thinking", include(state.thinking.get())).category("Options"),
                            choice(Row::Tools, "Tools", include(state.tools.get())).category("Options"),
                        ]),
                        Format::Json => options.push(
                            choice(Row::Sanitize, "Sanitize", if state.sanitize.get() { "on" } else { "off" })
                                .category("Options"),
                        ),
                    }
                    options
                })
            };
            let handle: Rc<RefCell<Option<select::Select<Row>>>> = Rc::default();
            let refresh = {
                let (handle, options) = (handle.clone(), options.clone());
                move || {
                    if let Some(select) = handle.borrow().as_ref() {
                        select.set_options(options());
                    }
                }
            };
            let change = {
                let (state, selected, refresh) = (state.clone(), selected.clone(), refresh.clone());
                Rc::new(move || {
                    match selected.get() {
                        Row::Format => state.format.set(match state.format.get() {
                            Format::Markdown => Format::Json,
                            Format::Json => Format::Markdown,
                        }),
                        Row::Thinking => state.thinking.set(!state.thinking.get()),
                        Row::Tools => state.tools.set(!state.tools.get()),
                        Row::Sanitize => state.sanitize.set(!state.sanitize.get()),
                    }
                    refresh();
                })
            };
            let binding = |key: &str, title: &str| {
                let change = change.clone();
                TuiCommand::inline(key, move |_, _| change()).title(title).group("Dialog")
            };
            let mut props = SelectProps::new("Export session", options());
            props.render_filter = false;
            props.footer_gap = 2;
            props.on_move = Some(Rc::new({
                let (selected, refresh) = (selected.clone(), refresh.clone());
                move |option: &SelectOption<Row>| {
                    if selected.replace(option.value) != option.value {
                        refresh();
                    }
                }
            }));
            props.on_select = Some(Rc::new({
                let change = change.clone();
                move |_: &SelectOption<Row>| change()
            }));
            props.actions = vec![SelectAction {
                bind: Some("c".into()),
                group: Some(Group::Primary),
                run: ActionRun::Dialog(Rc::new({
                    let (state, confirm) = (state.clone(), confirm.clone());
                    move || confirm(state.choice(Action::Copy))
                })),
                ..SelectAction::new("dialog.export.copy", "copy", |_| {})
            }];
            props.footer_hints =
                vec![FooterHint { title: "save to file".into(), label: "enter".into(), group: Some(Group::Primary) }];
            props.bindings = vec![
                binding("left", "Previous value"),
                binding("right", "Next value"),
                binding("space", "Change export option"),
                TuiCommand::inline("return", move |_, _| confirm(state.choice(Action::Export)))
                    .title("Save to file")
                    .group("Dialog"),
            ];
            let (view, select) = select::select(cx, props);
            *handle.borrow_mut() = Some(select);
            view
        },
        None,
        DialogOptions::default(),
    );
}

/// `DialogExportResult.show`: "Session exported", then "Saved to <path>". Enter closes; `c` copies the path, and
/// the footer action turns into "✓ copied".
pub fn result(tui: &Tui, path: String) {
    result_with(tui, path, false);
}

fn result_with(tui: &Tui, path: String, copied: bool) {
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let theme = &cx.theme;
            let close: Rc<dyn Fn()> = {
                let dialogs = cx.dialogs.clone();
                Rc::new(move || dialogs.clear())
            };
            let copy: Rc<dyn Fn()> = {
                let path = path.clone();
                Rc::new(bind!(weak, |tui| {
                    if tui.app.copy_to_clipboard(&path) {
                        result_with(&tui, path.clone(), true);
                    } else {
                        tui.toasts.error("Failed to copy to clipboard");
                    }
                }))
            };
            cx.layer(KeymapLayer::new(vec![
                TuiCommand::inline("return", {
                    let close = close.clone();
                    move |_, _| close()
                })
                .title("Close export result")
                .group("Dialog"),
                TuiCommand::inline("c", {
                    let copy = copy.clone();
                    move |_, _| copy()
                })
                .title("Copy export path")
                .group("Dialog"),
            ]));
            let body = Text::new(app, "").fg(theme.text.base);
            body.set_text(vec![
                Span::raw("Saved to "),
                Span::styled(path.clone(), Style::new().fg(theme.text.muted).underline()),
            ]);
            let action = if copied {
                FooterAction { color: Some(theme.text.feedback.success.base), ..FooterAction::new("copied").key("✓") }
            } else {
                FooterAction::new("copy path").key("c")
            };
            layout_with(
                cx,
                &header(cx, HeaderProps { on_close: Some(close), ..HeaderProps::new("Session exported") }),
                &body,
                Some(FooterProps { primary: vec![action.on_trigger(move || copy())], ..FooterProps::default() }),
                DIALOG_INSET,
                2,
            )
        },
        None,
        DialogOptions::default(),
    );
}
