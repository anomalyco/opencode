//! The code-mode execute tool (E.7b): `Execute` and `ExecuteCallView`
//! (`routes/session/index.tsx:3352-3450`). One line for the call, one line per nested tool call
//! (a click lists its inputs), and the error output under a failed run. A click on the call opens
//! the execute dialog.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::SessionMessageAssistantTool;
use opencode_ui::theme::Theme;
use opencode_ui::tool_info::{ExecuteCall, ExecuteStatus, execute_call_summary, execute_calls};
use opentui::prelude::*;
use serde_json::Value;

use super::dispatch::{ICON_WIDTH, Inline, InlineTool, Props, Status, content_width};
use crate::app::Tui;
use crate::dialogs::execute::{self, Live};
use crate::routes::session::messages::list::Context;
use crate::routes::session::messages::shell::{collapse_tool_output, strip_ansi};

pub struct Execute(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    root: View,
    inline: InlineTool,
    calls: View,
    rows: RefCell<Vec<Call>>,
    output: View,
    shown_output: RefCell<Option<String>>,
    /// The call as the row last saw it, which the dialog opens with.
    part: RefCell<Option<SessionMessageAssistantTool>>,
    /// The open dialog, which follows the call while it runs.
    dialog: RefCell<Weak<Live>>,
}

impl Execute {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let calls = View::new(cx.app).column();
        let output = View::new(cx.app).column().padding_edge(Edge::Left, 3).visible(false);
        let root = View::new(cx.app).column().shrink(0.0).child(inline.root()).child(&calls).child(&output);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            root,
            inline,
            calls,
            rows: RefCell::default(),
            output,
            shown_output: RefCell::default(),
            part: RefCell::default(),
            dialog: RefCell::default(),
        });
        let (weak, tui): (Weak<Inner>, Weak<Tui>) = (Rc::downgrade(&inner), cx.tui.weak());
        inner.inline.on_click(move || {
            let (Some(inner), Some(tui)) = (weak.upgrade(), tui.upgrade()) else {
                return;
            };
            let Some(part) = inner.part.borrow().clone() else {
                return;
            };
            // The dialog takes the focus the click is still delivering to.
            let weak = Rc::downgrade(&inner);
            let tui_weak = tui.weak();
            tui.app.defer(move |_| {
                let (Some(inner), Some(tui)) = (weak.upgrade(), tui_weak.upgrade()) else {
                    return;
                };
                *inner.dialog.borrow_mut() = execute::show(&tui, part);
            });
        });
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let inner = &self.0;
        let status = props.status();
        let failed = props.metadata.get("error") == Some(&Value::Bool(true)) || status == Status::Error;
        inner.inline.set(Inline {
            color: failed.then_some(cx.theme.text.feedback.error.base),
            spinner: matches!(status, Status::Streaming | Status::Running),
            text: "execute".to_owned(),
            clickable: true,
            error_click: true,
            ..Inline::new(
                props,
                if failed {
                    "✗"
                } else if status == Status::Completed {
                    "✓"
                } else {
                    "│"
                },
                "execute",
                true,
            )
        });

        let calls = execute_calls(props.metadata.get("toolCalls").unwrap_or(&Value::Null));
        let mut rows = inner.rows.borrow_mut();
        // `Index` drops rows from the end; the column is rebuilt when it shrinks.
        if calls.len() < rows.len() {
            rows.truncate(calls.len());
            inner.calls.clear();
            for row in rows.iter() {
                inner.calls.add(row.root());
            }
        }
        for (index, call) in calls.into_iter().enumerate() {
            match rows.get(index) {
                Some(row) => row.set(call),
                None => {
                    let row = Call::new(&inner.app, &inner.theme, call);
                    inner.calls.add(row.root());
                    rows.push(row);
                }
            }
        }
        drop(rows);

        let output = strip_ansi(props.output.as_deref().unwrap_or_default().trim());
        let preview = (failed && !output.is_empty()).then(|| {
            let width = (content_width(cx) - 6).max(20) as usize;
            collapse_tool_output(&output, 4, 4 * width).0
        });
        if *inner.shown_output.borrow() != preview {
            inner.output.clear();
            inner.output.visible(preview.is_some());
            for (index, line) in preview.iter().flat_map(|text| text.split('\n')).enumerate() {
                // TS sets `paddingLeft={3}` on the text too, but Core lays a text out without it.
                inner.output.add(
                    &Text::new(&inner.app, format!("{}{line}", if index == 0 { "↳ " } else { "  " })).fg(inner
                        .theme
                        .text
                        .feedback
                        .error
                        .base),
                );
            }
            *inner.shown_output.borrow_mut() = preview;
        }

        *inner.part.borrow_mut() = Some(props.part.clone());
        if let Some(dialog) = inner.dialog.borrow().upgrade() {
            dialog.set(props.part.clone());
        }
    }
}

/// `ExecuteCallView`: `› summary`, or `✗` for a failed call; a click lists its inputs.
struct Call(Rc<CallInner>);

struct CallInner {
    app: App,
    theme: Theme,
    root: View,
    icon: Text,
    text: Text,
    details: View,
    call: RefCell<ExecuteCall>,
    expanded: Cell<bool>,
    hover: Cell<bool>,
}

impl Call {
    fn new(app: &App, theme: &Theme, call: ExecuteCall) -> Self {
        let icon = Text::new(app, "").width(ICON_WIDTH).shrink(0.0);
        let text = Text::new(app, "").grow(1.0).wrap(WrapMode::None).truncate(true);
        let details = View::new(app)
            .column()
            .padding_edge(Edge::Left, 1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.decrease(&theme.text.muted, 1))
            .visible(false);
        let root = View::new(app)
            .column()
            .padding_edge(Edge::Left, 3)
            .child(&View::new(app).row().child(&icon).child(&text))
            .child(&details);
        let inner = Rc::new(CallInner {
            app: app.clone(),
            theme: theme.clone(),
            root,
            icon,
            text,
            details,
            call: RefCell::new(call),
            expanded: Cell::new(false),
            hover: Cell::new(false),
        });
        let weak = Rc::downgrade(&inner);
        inner.root.on_hover(move |_, hovered| {
            let Some(inner) = weak.upgrade() else { return };
            inner.hover.set(hovered && inner.expandable());
            inner.paint();
        });
        let weak = Rc::downgrade(&inner);
        inner.root.on_click(move |cx, _| {
            let Some(inner) = weak.upgrade() else { return };
            if !inner.expandable() || cx.app().selected_text().is_some_and(|text| !text.is_empty()) {
                return;
            }
            inner.expanded.set(!inner.expanded.get());
            inner.paint();
        });
        inner.paint();
        Self(inner)
    }

    fn root(&self) -> &View {
        &self.0.root
    }

    fn set(&self, call: ExecuteCall) {
        if *self.0.call.borrow() == call {
            return;
        }
        *self.0.call.borrow_mut() = call;
        self.0.paint();
    }
}

impl CallInner {
    fn expandable(&self) -> bool {
        self.call.borrow().input.as_ref().is_some_and(|input| !input.is_empty())
    }

    fn paint(&self) {
        let call = self.call.borrow();
        let theme = &self.theme;
        let expanded = self.expanded.get();
        let expanded_color = theme.decrease(&theme.text.muted, 1);
        let color = if call.status == ExecuteStatus::Error {
            theme.text.feedback.error.base
        } else if self.hover.get() {
            theme.text.base
        } else if expanded {
            expanded_color
        } else {
            theme.text.muted
        };
        self.icon.fg(color);
        self.icon.set_text(if call.status == ExecuteStatus::Error { "✗" } else { "›" });
        self.text.fg(color);
        self.text.set_text(if expanded { call.tool.clone() } else { execute_call_summary(&call) });
        self.details.clear();
        self.details.visible(expanded);
        if !expanded {
            return;
        }
        for (key, value) in call.input.iter().flatten() {
            let value = match value {
                Value::String(text) => text.clone(),
                value => serde_json::to_string_pretty(value).unwrap_or_default(),
            };
            self.details.add(
                &View::new(&self.app)
                    .row()
                    .child(&Text::new(&self.app, format!("{key}: ")).shrink(0.0).fg(theme.text.muted))
                    .child(&Text::new(&self.app, value).grow(1.0).wrap(WrapMode::Word).fg(theme.text.base)),
            );
        }
    }
}
