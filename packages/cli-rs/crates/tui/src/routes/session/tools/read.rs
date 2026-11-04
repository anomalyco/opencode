//! The read tool (E.7a): `Read` (`routes/session/index.tsx:3205-3241`), one line plus the files the
//! read loaded.

use std::cell::RefCell;

use opentui::prelude::*;
use serde_json::Value;

use super::dispatch::{Inline, InlineTool, Props, Status, finite, format_path, number, truthy};
use crate::routes::session::messages::list::Context;

pub struct Read {
    root: View,
    inline: InlineTool,
    loaded: View,
    shown: RefCell<Option<Vec<String>>>,
}

impl Read {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let loaded = View::new(cx.app).column();
        let root = View::new(cx.app)
            .column()
            .shrink(0.0)
            .child(inline.root())
            .child(&loaded);
        Self {
            root,
            inline,
            loaded,
            shown: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let path = props.input_str("path");
        let mut text = format!("Read {}", format_path(cx, path));
        if props.input.contains_key("offset") || props.input.contains_key("limit") {
            let offset = finite(props.input.get("offset")).unwrap_or(1.0);
            text.push_str(&format!(":{}-", number(offset)));
            if truthy(props.input.get("limit")) {
                let limit = finite(props.input.get("limit")).unwrap_or(0.0);
                text.push_str(&number(offset + limit - 1.0));
            }
        }
        self.inline.set(Inline {
            spinner: props.status() == Status::Running,
            text,
            ..Inline::new(
                props,
                "→",
                "Reading file…",
                path.is_some_and(|path| !path.is_empty()),
            )
        });

        let loaded: Vec<String> = match props.metadata.get("loaded") {
            Some(Value::Array(items)) if props.status() == Status::Completed => items
                .iter()
                .filter_map(Value::as_str)
                .map(|path| format_path(cx, Some(path)))
                .collect(),
            _ => Vec::new(),
        };
        if self.shown.borrow().as_ref() == Some(&loaded) {
            return;
        }
        self.loaded.clear();
        for path in &loaded {
            self.loaded.add(
                &View::new(cx.app).padding_edge(Edge::Left, 6).child(
                    &Text::new(cx.app, format!("↳ Loaded {path}")).fg(cx.theme.text.muted),
                ),
            );
        }
        *self.shown.borrow_mut() = Some(loaded);
    }
}
