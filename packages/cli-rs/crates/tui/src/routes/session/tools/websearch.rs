//! The websearch tool (E.7b): `WebSearch` (`routes/session/index.tsx:3264-3287`). One line with the
//! provider and the query.
//!
//! TS fades between provider names when a running search retries with another provider
//! (`RetryProvider`); the Rust row shows the current name at once.

use opencode_ui::tool_info::web_search_provider_name;
use opentui::prelude::*;

use super::dispatch::{Inline, InlineTool, Props};
use crate::routes::session::messages::list::Context;

pub struct WebSearch(InlineTool);

impl WebSearch {
    pub fn new(cx: &Context<'_>) -> Self {
        Self(InlineTool::new(cx))
    }

    pub fn root(&self) -> &View {
        self.0.root()
    }

    pub fn update(&self, _cx: &Context<'_>, props: &Props<'_>) {
        let query = props.input_str("query");
        // `<Show when={stringValue(metadata.provider)}>`: an empty name is no provider.
        let provider =
            props.metadata.get("provider").filter(|value| value.as_str().is_some_and(|value| !value.is_empty()));
        let label = match provider {
            Some(provider) => format!("Web Search via {}", web_search_provider_name(provider)),
            None => "Web Search".to_owned(),
        };
        self.0.set(Inline {
            text: format!("{label} \"{}\"", query.unwrap_or_default()),
            ..Inline::new(props, "◈", "Searching web…", query.is_some_and(|query| !query.is_empty()))
        });
    }
}
