//! The webfetch tool (E.7b): `WebFetch` (`routes/session/index.tsx:3256-3262`). One line with the URL.

use opentui::prelude::*;

use super::dispatch::{Inline, InlineTool, Props};
use crate::routes::session::messages::list::Context;

pub struct WebFetch(InlineTool);

impl WebFetch {
    pub fn new(cx: &Context<'_>) -> Self {
        Self(InlineTool::new(cx))
    }

    pub fn root(&self) -> &View {
        self.0.root()
    }

    pub fn update(&self, _cx: &Context<'_>, props: &Props<'_>) {
        let url = props.input_str("url");
        self.0.set(Inline {
            text: format!("WebFetch {}", url.unwrap_or_default()),
            ..Inline::new(
                props,
                "%",
                "Fetching from the web…",
                url.is_some_and(|url| !url.is_empty()),
            )
        });
    }
}
