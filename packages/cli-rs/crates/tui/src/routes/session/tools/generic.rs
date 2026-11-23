//! Fallback view for unrecognized tools.

use opencode_ui::tool_info::call_summary;

use super::dispatch::{ICON_WIDTH, Inline, InlineTool, Props, Status};
use crate::prelude::*;
use crate::routes::session::messages::list::Context;
use opentui::input::strip_ansi_sequences;

pub struct Generic(Rc<Inner>);

struct Inner {
    app: App,
    root: View,
    inline: InlineTool,
    details: View,
    theme: Live,
    expanded: Cell<bool>,
    entries: RefCell<Option<Details>>,
}

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
            theme: cx.tui.live_theme(),
            expanded: Cell::new(false),
            entries: RefCell::default(),
        });
        inner.inline.on_click(bind!(inner, |inner| {
            inner.expanded.set(!inner.expanded.get());
            inner.paint();
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn restyle(&self, _cx: &Context<'_>) {
        self.0.inline.restyle();
        self.0.paint();
    }

    pub fn update(&self, _cx: &Context<'_>, props: &Props<'_>) {
        let inner = &self.0;
        let output = strip_ansi_sequences(props.output.as_deref().unwrap_or_default().trim());
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
            text: call_summary(tool, props.input.iter()),
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
        let Some((inputs, output)) = entries.as_ref() else { return };
        let theme = self.theme.get();
        let rows = inputs
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .chain((!output.is_empty()).then_some(("output", output.as_str())));
        for (key, value) in rows {
            self.details.add(
                &View::new(&self.app)
                    .row()
                    .child(&Text::new(&self.app, format!("{key}: ")).shrink(0.0).fg(theme.text.muted))
                    .child(&Text::new(&self.app, value).grow(1.0).fg(theme.text.base)),
            );
        }
    }
}
