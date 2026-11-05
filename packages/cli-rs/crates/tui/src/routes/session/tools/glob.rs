//! The glob tool (E.7a): `Glob` (`routes/session/index.tsx:3192-3203`).

use super::dispatch::{Inline, InlineTool, Props, finite, format_path, number};
use crate::routes::session::messages::list::Context;

pub struct Glob(InlineTool);

impl Glob {
    pub fn new(cx: &Context<'_>) -> Self {
        Self(InlineTool::new(cx))
    }

    pub fn root(&self) -> &opentui::prelude::View {
        self.0.root()
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let count = finite(props.metadata.get("count"));
        self.0.set(search(cx, props, "Glob", "Finding files…", count));
    }
}

/// The line Glob and Grep share: `Glob "<pattern>" in <path> (<n> matches)`.
pub fn search(cx: &Context<'_>, props: &Props<'_>, name: &str, pending: &str, matches: Option<f64>) -> Inline {
    let pattern = props.input_str("pattern");
    let mut text = format!("{name} \"{}\" ", pattern.unwrap_or_default());
    if let Some(path) = props.input_str("path").filter(|path| !path.is_empty()) {
        text.push_str(&format!("in {} ", format_path(cx, Some(path))));
    }
    if let Some(matches) = matches {
        let noun = if matches == 1.0 { "match" } else { "matches" };
        text.push_str(&format!("({} {noun})", number(matches)));
    }
    Inline { text, ..Inline::new(props, "✱", pending, pattern.is_some_and(|pattern| !pattern.is_empty())) }
}
