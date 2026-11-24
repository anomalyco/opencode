use super::dispatch::{Inline, InlineTool, Props, ToolView, finite, format_path, number};
use crate::routes::session::messages::list::Context;
use opencode_ui::tool_info::{SearchInput, SkillInput, WebFetchInput, WebSearchInput, web_search_provider_name};
use opentui::prelude::View;

type Line = fn(&Context<'_>, &Props<'_>) -> Inline;

pub(super) fn row(cx: &Context<'_>, line: Line) -> Box<dyn ToolView> {
    Box::new(Row(InlineTool::new(cx), line))
}

struct Row(InlineTool, Line);

impl ToolView for Row {
    fn root(&self) -> &View {
        self.0.root()
    }
    fn restyle(&self, _: &Context<'_>) {
        self.0.restyle();
    }
    fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        self.0.set((self.1)(cx, props));
    }
}

pub(super) fn glob(cx: &Context<'_>, props: &Props<'_>) -> Inline {
    let count = finite(props.metadata.get("count"));
    search(cx, props, "Glob", "Finding files…", count)
}

/// The line Glob and Grep share: `Glob "<pattern>" in <path> (<n> matches)`.
fn search(cx: &Context<'_>, props: &Props<'_>, name: &str, pending: &str, matches: Option<f64>) -> Inline {
    let pattern = SearchInput(props.input).pattern().str();
    let mut text = format!("{name} \"{}\" ", pattern.unwrap_or_default());
    if let Some(path) = props.input.path().non_empty() {
        text.push_str(&format!("in {} ", format_path(cx, Some(path))));
    }
    if let Some(matches) = matches {
        let noun = if matches == 1.0 { "match" } else { "matches" };
        text.push_str(&format!("({} {noun})", number(matches)));
    }
    Inline { text, ..Inline::new(props, "✱", pending, pattern.is_some_and(|pattern| !pattern.is_empty())) }
}

pub(super) fn grep(cx: &Context<'_>, props: &Props<'_>) -> Inline {
    let matches = finite(props.metadata.get("matches"));
    search(cx, props, "Grep", "Searching content…", matches)
}

pub(super) fn webfetch(_cx: &Context<'_>, props: &Props<'_>) -> Inline {
    let url = WebFetchInput(props.input).url().str();
    Inline {
        text: format!("WebFetch {}", url.unwrap_or_default()),
        ..Inline::new(props, "%", "Fetching from the web…", url.is_some_and(|url| !url.is_empty()))
    }
}

pub(super) fn websearch(_cx: &Context<'_>, props: &Props<'_>) -> Inline {
    let query = WebSearchInput(props.input).query().str();
    // `<Show when={stringValue(metadata.provider)}>`: an empty name is no provider.
    let provider = props.metadata.get("provider").filter(|value| value.as_str().is_some_and(|value| !value.is_empty()));
    let label = match provider {
        Some(provider) => format!("Web Search via {}", web_search_provider_name(provider)),
        None => "Web Search".to_owned(),
    };
    Inline {
        text: format!("{label} \"{}\"", query.unwrap_or_default()),
        ..Inline::new(props, "◈", "Searching web…", query.is_some_and(|query| !query.is_empty()))
    }
}

pub(super) fn skill(_cx: &Context<'_>, props: &Props<'_>) -> Inline {
    let name = props.metadata.get("name").and_then(serde_json::Value::as_str).or(SkillInput(props.input).id().str());
    Inline {
        text: format!("Skill \"{}\"", name.unwrap_or_default()),
        ..Inline::new(props, "→", "Loading skill…", name.is_some_and(|name| !name.is_empty()))
    }
}
