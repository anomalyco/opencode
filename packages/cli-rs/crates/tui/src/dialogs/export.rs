//! Export dialogs (E.10a, rows DLG31 and DLG32): `ui/dialog-export-options.tsx` and `ui/dialog-export-result.tsx`.
//! The options pick a format (Markdown with or without thinking and tools, or JSON, sanitized or not) and an
//! action (copy or save to a file); the result shows where the file went.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_ui::dialog::{
    DIALOG_INSET, DialogCx, DialogOptions, FooterAction, FooterProps, HeaderProps, header, layout,
    layout_with,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::select::{
    self, ActionRun, FooterHint, Group, SelectAction, SelectOption, SelectProps, Side,
};
use opencode_ui::theme::Theme;
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

/// `DialogExportOptions.show`: the list under `new-designs`, else the legacy form.
pub fn options(tui: &Tui, default_thinking: bool, on_confirm: OnConfirm) {
    let weak = tui.weak();
    let confirm: Rc<dyn Fn(Choice)> = Rc::new(move |choice| {
        if let Some(tui) = weak.upgrade() {
            on_confirm(&tui, choice);
        }
    });
    tui.dialogs.replace(
        move |cx| {
            let state = Rc::new(State {
                format: Cell::new(Format::Markdown),
                thinking: Cell::new(default_thinking),
                tools: Cell::new(true),
                sanitize: Cell::new(false),
            });
            if cx.new_designs {
                list(cx, state, confirm)
            } else {
                legacy(cx, state, confirm)
            }
        },
        None,
        DialogOptions::default(),
    );
}

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

/// The focusable parts of the legacy form, in Tab order.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Active {
    Markdown,
    Json,
    Thinking,
    Tools,
    Sanitize,
    Copy,
    Export,
}

/// `LegacyDialogExportOptions`: radio buttons, check boxes, and the Copy and Export buttons. Tab and Shift+Tab
/// move, Enter activates.
fn legacy(cx: &Rc<DialogCx>, state: Rc<State>, confirm: Rc<dyn Fn(Choice)>) -> View {
    let app = &cx.app;
    let theme = cx.theme.clone();
    let active = Rc::new(Cell::new(Active::Markdown));
    let mark = |label: &str| (Text::new(app, ""), Text::new(app, label));
    let row = |(mark, label): &(Text, Text)| View::new(app).row().gap(1).child(mark).child(label);
    let markdown = mark("Markdown");
    let json = mark("JSON");
    let thinking = mark("Include thinking");
    let tools = mark("Include tools");
    let sanitize = mark("Sanitize sensitive data");
    let markdown_row = row(&markdown).padding_x(1);
    let json_row = row(&json).padding_x(1);
    let thinking_row = row(&thinking);
    let tools_row = row(&tools);
    let sanitize_row = row(&sanitize);
    let button = |label: &str| {
        let text = Text::new(app, label);
        (View::new(app).padding_x(4).child(&text), text)
    };
    let copy = button("Copy");
    let export = button("Export");

    let paint: Rc<dyn Fn()> = {
        let (state, active) = (state.clone(), active.clone());
        let (markdown, json, thinking, tools, sanitize) = (
            markdown.clone(),
            json.clone(),
            thinking.clone(),
            tools.clone(),
            sanitize.clone(),
        );
        let (thinking_row, tools_row, sanitize_row) = (
            thinking_row.clone(),
            tools_row.clone(),
            sanitize_row.clone(),
        );
        let (copy, export) = (copy.clone(), export.clone());
        Rc::new(move || {
            let now = active.get();
            let format = state.format.get();
            let field = |(mark, label): &(Text, Text), part: Active, checked: bool, glyph: &str| {
                let on = now == part;
                mark.set_text(glyph);
                mark.fg(mark_color(&theme, on, checked));
                label.fg(label_color(&theme, on));
            };
            let radio = |checked: bool| if checked { "◉" } else { "○" };
            let check = |checked: bool| if checked { "[x]" } else { "[ ]" };
            field(
                &markdown,
                Active::Markdown,
                format == Format::Markdown,
                radio(format == Format::Markdown),
            );
            field(
                &json,
                Active::Json,
                format == Format::Json,
                radio(format == Format::Json),
            );
            field(
                &thinking,
                Active::Thinking,
                state.thinking.get(),
                check(state.thinking.get()),
            );
            field(
                &tools,
                Active::Tools,
                state.tools.get(),
                check(state.tools.get()),
            );
            field(
                &sanitize,
                Active::Sanitize,
                state.sanitize.get(),
                check(state.sanitize.get()),
            );
            thinking_row.visible(format == Format::Markdown);
            tools_row.visible(format == Format::Markdown);
            sanitize_row.visible(format == Format::Json);
            for ((view, text), part) in [(&copy, Active::Copy), (&export, Active::Export)] {
                let on = now == part;
                let action = &theme.background.action.primary;
                view.bg(if on { action.focused } else { action.base });
                let action = &theme.text.action.primary;
                text.fg(if on { action.focused } else { action.base });
            }
        })
    };
    paint();

    let activate = {
        let (state, active, paint, confirm) = (
            state.clone(),
            active.clone(),
            paint.clone(),
            confirm.clone(),
        );
        move || {
            match active.get() {
                Active::Markdown => state.format.set(Format::Markdown),
                Active::Json => state.format.set(Format::Json),
                Active::Thinking => state.thinking.set(!state.thinking.get()),
                Active::Tools => state.tools.set(!state.tools.get()),
                Active::Sanitize => state.sanitize.set(!state.sanitize.get()),
                Active::Copy => return confirm(state.choice(Action::Copy)),
                Active::Export => return confirm(state.choice(Action::Export)),
            }
            paint();
        }
    };
    let step = |offset: isize| {
        let (state, active, paint) = (state.clone(), active.clone(), paint.clone());
        move || {
            let order: &[Active] = match state.format.get() {
                Format::Markdown => &[
                    Active::Markdown,
                    Active::Json,
                    Active::Thinking,
                    Active::Tools,
                    Active::Copy,
                    Active::Export,
                ],
                Format::Json => &[
                    Active::Markdown,
                    Active::Json,
                    Active::Sanitize,
                    Active::Copy,
                    Active::Export,
                ],
            };
            // A part that is gone (Sanitize after switching to Markdown) counts as index -1, as `indexOf` does.
            let index = order
                .iter()
                .position(|part| *part == active.get())
                .map_or(-1, |index| index as isize);
            let len = order.len() as isize;
            active.set(order[(index + offset + len).rem_euclid(len) as usize]);
            paint();
        }
    };
    cx.layer(KeymapLayer {
        commands: vec![
            TuiCommand::inline("tab", {
                let next = step(1);
                move |_, _| next()
            })
            .title("Next export option")
            .group("Dialog"),
            TuiCommand::inline("shift+tab", {
                let previous = step(-1);
                move |_, _| previous()
            })
            .title("Previous export option")
            .group("Dialog"),
            TuiCommand::inline("return", move |_, _| activate())
                .title("Select export option")
                .group("Dialog"),
        ],
        ..KeymapLayer::default()
    });

    let click = |view: &View, run: Rc<dyn Fn()>| {
        view.on_mouse(move |_, event| {
            if matches!(event.kind, MouseEventKind::Up(_)) {
                run();
            }
        });
    };
    for (view, part) in [(&markdown_row, Active::Markdown), (&json_row, Active::Json)] {
        let (state, active, paint) = (state.clone(), active.clone(), paint.clone());
        click(
            view,
            Rc::new(move || {
                state.format.set(if part == Active::Markdown {
                    Format::Markdown
                } else {
                    Format::Json
                });
                active.set(part);
                paint();
            }),
        );
    }
    for (view, part) in [
        (&thinking_row, Active::Thinking),
        (&tools_row, Active::Tools),
        (&sanitize_row, Active::Sanitize),
    ] {
        let (state, active, paint) = (state.clone(), active.clone(), paint.clone());
        click(
            view,
            Rc::new(move || {
                active.set(part);
                let flag = match part {
                    Active::Thinking => &state.thinking,
                    Active::Tools => &state.tools,
                    _ => &state.sanitize,
                };
                flag.set(!flag.get());
                paint();
            }),
        );
    }
    for ((view, _), action) in [(&copy, Action::Copy), (&export, Action::Export)] {
        let (state, confirm) = (state.clone(), confirm.clone());
        click(view, Rc::new(move || confirm(state.choice(action))));
    }

    let formats = View::new(app)
        .row()
        .gap(1)
        .child(&markdown_row)
        .child(&json_row);
    let body = View::new(app)
        .gap(1)
        .child(
            &View::new(app)
                .row()
                .gap(1)
                .child(&Text::new(app, "Export as:").fg(cx.theme.text.base))
                .child(&formats),
        )
        .child(&thinking_row)
        .child(&tools_row)
        .child(&sanitize_row);
    let footer = View::new(app)
        .row()
        .justify(Justify::End)
        .gap(1)
        .child(&copy.0)
        .child(&export.0);
    layout(
        cx,
        &header(
            cx,
            HeaderProps {
                title: "Export session".into(),
                ..HeaderProps::default()
            },
        ),
        &body,
        None,
        Some(footer),
    )
}

/// The form's field styling, as the question form has it: only the focused row is highlighted, and the mark alone
/// shows what is checked.
fn mark_color(theme: &Theme, active: bool, checked: bool) -> Color {
    if active {
        theme.text.formfield.focused
    } else if checked {
        theme.text.formfield.selected
    } else {
        theme.text.muted
    }
}

fn label_color(theme: &Theme, active: bool) -> Color {
    if active {
        theme.text.formfield.focused
    } else {
        theme.text.formfield.base
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Row {
    Format,
    Thinking,
    Tools,
    Sanitize,
}

/// `DialogExportOptionsList` (`new-designs`): one row per value. Up and Down move; Left, Right, and Space change
/// the value; Enter saves to a file and `c` copies.
fn list(cx: &Rc<DialogCx>, state: Rc<State>, confirm: Rc<dyn Fn(Choice)>) -> View {
    let theme = cx.theme.clone();
    let selected = Rc::new(Cell::new(Row::Format));
    let options: Rc<dyn Fn() -> Vec<SelectOption<Row>>> = {
        let (state, selected) = (state.clone(), selected.clone());
        Rc::new(move || {
            let choice = |row: Row, title: &str, value: &str| {
                let active = selected.get() == row;
                let mut option = SelectOption::new(title, row).footer(if active {
                    format!("‹ {value} ›")
                } else {
                    format!("  {value}  ")
                });
                option.footer_color = Some(if active {
                    theme.text.action.primary.focused
                } else {
                    theme.text.muted
                });
                option
            };
            let include = |value: bool| if value { "include" } else { "exclude" };
            let format = state.format.get();
            let mut options = vec![choice(
                Row::Format,
                "Format",
                if format == Format::Markdown {
                    "markdown"
                } else {
                    "json"
                },
            )];
            match format {
                Format::Markdown => options.extend([
                    choice(Row::Thinking, "Thinking", include(state.thinking.get()))
                        .category("Options"),
                    choice(Row::Tools, "Tools", include(state.tools.get())).category("Options"),
                ]),
                Format::Json => options.push(
                    choice(
                        Row::Sanitize,
                        "Sanitize",
                        if state.sanitize.get() { "on" } else { "off" },
                    )
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
        TuiCommand::inline(key, move |_, _| change())
            .title(title)
            .group("Dialog")
    };
    let mut props = SelectProps::new("Export session", options());
    props.render_filter = false;
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
    props.footer_hints = vec![FooterHint {
        title: "save to file".into(),
        label: "enter".into(),
        side: Side::Left,
        group: Some(Group::Primary),
    }];
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
}

/// `DialogExportResult.show`: "Session exported" with the path. Enter closes; under `new-designs`, `c` copies the
/// path and the footer action turns into "✓ copied".
pub fn result(tui: &Tui, path: String) {
    result_with(tui, path, false);
}

fn result_with(tui: &Tui, path: String, copied: bool) {
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let close: Rc<dyn Fn()> = {
                let dialogs = cx.dialogs.clone();
                Rc::new(move || dialogs.clear())
            };
            let copy: Rc<dyn Fn()> = {
                let path = path.clone();
                Rc::new(move || {
                    let Some(tui) = weak.upgrade() else { return };
                    if tui.app.copy_to_clipboard(&path) {
                        result_with(&tui, path.clone(), true);
                    } else {
                        tui.toasts.error("Failed to copy to clipboard");
                    }
                })
            };
            let mut commands = vec![
                TuiCommand::inline("return", {
                    let close = close.clone();
                    move |_, _| close()
                })
                .title("Close export result")
                .group("Dialog"),
            ];
            if cx.new_designs {
                let copy = copy.clone();
                commands.push(
                    TuiCommand::inline("c", move |_, _| copy())
                        .title("Copy export path")
                        .group("Dialog"),
                );
            }
            cx.layer(KeymapLayer {
                commands,
                ..KeymapLayer::default()
            });
            let theme = &cx.theme;
            let body = Text::new(app, "").fg(theme.text.base);
            if cx.new_designs {
                body.set_text(vec![
                    Span::raw("Saved to "),
                    Span::styled(path.clone(), Style::new().fg(theme.text.muted).underline()),
                ]);
            } else {
                body.set_text(path.as_str());
            }
            let header = header(
                cx,
                HeaderProps {
                    title: "Session exported".into(),
                    on_close: Some(close.clone()),
                    ..HeaderProps::default()
                },
            );
            let button = View::new(app)
                .padding_x(3)
                .bg(theme.background.action.primary.focused)
                .child(&Text::new(app, "Close").fg(theme.text.action.primary.focused));
            button.on_mouse(move |_, event| {
                if matches!(event.kind, MouseEventKind::Up(_)) {
                    close();
                }
            });
            let legacy = View::new(app)
                .row()
                .justify(Justify::End)
                .gap(1)
                .child(&button);
            let action = if copied {
                FooterAction {
                    color: Some(theme.text.feedback.success.base),
                    ..FooterAction::new("copied").key("✓")
                }
            } else {
                FooterAction::new("copy path").key("c")
            };
            layout_with(
                cx,
                &header,
                &body,
                Some(FooterProps {
                    primary: vec![action.on_trigger(move || copy())],
                    ..FooterProps::default()
                }),
                Some(legacy),
                DIALOG_INSET,
                2,
            )
        },
        None,
        DialogOptions::default(),
    );
}
