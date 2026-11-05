//! Any other tool (E.7a): `GenericTool` (`routes/session/index.tsx:2734-2789`). One line with the
//! tool's name and primitive inputs; a click lists every input and the output.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_ui::tool_info::primitive_input_summary;
use opentui::prelude::*;
use serde_json::Value;

use super::dispatch::{ICON_WIDTH, Inline, InlineTool, Props, Status};
use crate::routes::session::messages::list::Context;
use crate::routes::session::messages::shell::strip_ansi;

pub struct Generic(Rc<Inner>);

struct Inner {
    app: App,
    root: View,
    inline: InlineTool,
    details: View,
    muted: Color,
    base: Color,
    expanded: Cell<bool>,
    entries: RefCell<Option<Details>>,
}

/// The inputs (key and printed value) and the output the details list.
type Details = (Vec<(String, String)>, String);

impl Generic {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let details = View::new(cx.app).column().padding_edge(Edge::Left, 3 + ICON_WIDTH).visible(false);
        let root = View::new(cx.app).column().shrink(0.0).child(inline.root()).child(&details);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            root,
            inline,
            details,
            muted: cx.theme.text.muted,
            base: cx.theme.text.base,
            expanded: Cell::new(false),
            entries: RefCell::default(),
        });
        let weak = Rc::downgrade(&inner);
        inner.inline.on_click(move || {
            if let Some(inner) = weak.upgrade() {
                inner.expanded.set(!inner.expanded.get());
                inner.paint();
            }
        });
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(&self, _cx: &Context<'_>, props: &Props<'_>) {
        let inner = &self.0;
        let output = strip_ansi(props.output.as_deref().unwrap_or_default().trim());
        let entries: Vec<(String, String)> = props
            .input
            .iter()
            .map(|(key, value)| {
                let value = match value {
                    Value::String(text) => text.clone(),
                    value => serde_json::to_string_pretty(value).unwrap_or_default(),
                };
                (key.clone(), value)
            })
            .collect();
        let status = props.status();
        let tool = props.part.name.as_str();
        inner.inline.set(Inline {
            spinner: matches!(status, Status::Streaming | Status::Running),
            text: summary(tool, &props.input),
            clickable: !entries.is_empty() || !output.is_empty(),
            ..Inline::new(props, if status == Status::Error { "✗" } else { "✓" }, tool, status == Status::Completed)
        });
        let next = Some((entries, output));
        if *inner.entries.borrow() != next {
            *inner.entries.borrow_mut() = next;
            inner.paint();
        }
    }
}

impl Inner {
    fn paint(&self) {
        self.details.clear();
        self.details.visible(self.expanded.get());
        if !self.expanded.get() {
            return;
        }
        let entries = self.entries.borrow();
        let Some((inputs, output)) = entries.as_ref() else {
            return;
        };
        let rows = inputs
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .chain((!output.is_empty()).then_some(("output", output.as_str())));
        for (key, value) in rows {
            self.details.add(
                &View::new(&self.app)
                    .row()
                    .child(&Text::new(&self.app, format!("{key}: ")).shrink(0.0).fg(self.muted))
                    .child(&Text::new(&self.app, value).grow(1.0).fg(self.base)),
            );
        }
    }
}

/// `genericToolSummary`: the name and the primitive inputs on one line.
pub fn summary(tool: &str, input: &serde_json::Map<String, Value>) -> String {
    let args = primitive_input_summary(input, &[]).split_whitespace().collect::<Vec<_>>().join(" ");
    if args.is_empty() {
        return tool.to_owned();
    }
    format!("{tool} {args}")
}
