use serde_json::{Map, Value};

use crate::tool_info::{
    EditInput, LspInput, SearchInput, ShellInput, SubagentInput, ToolInput, ToolKind, WebFetchInput, WebSearchInput,
    finite_number, web_search_provider_label,
};

#[derive(Debug, Default, PartialEq)]
pub struct Presentation {
    pub icon: &'static str,
    pub title: String,
    pub lines: Vec<String>,
    pub diff: Option<String>,
    pub patch: Option<String>,
    pub file: Option<String>,
}

/// `permissionPresentation`: what the prompt shows for a request, from the request and its tool call.
pub fn presentation(
    action: &str,
    resources: &[String],
    request_metadata: Option<&indexmap::IndexMap<String, Value>>,
    input: &Value,
    tool_metadata: &Value,
    format_path: &dyn Fn(&str) -> String,
) -> Presentation {
    let input = ToolInput::json(input);
    let mut metadata = dict(tool_metadata);
    if let Some(extra) = request_metadata {
        metadata.extend(extra.iter().map(|(key, value)| (key.clone(), value.clone())));
    }
    let text = |map: &Map<String, Value>, key: &str| -> String {
        map.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
    };
    let first = resources.first().cloned().unwrap_or_default();
    let or = |value: &str, fallback: &str| {
        if value.is_empty() { fallback.to_owned() } else { value.to_owned() }
    };
    let some = |value: String| (!value.is_empty()).then_some(value);
    let path = input.any_path().unwrap_or_default();

    match ToolKind::of(action) {
        ToolKind::Edit => {
            let file = or(path, &first);
            let files = metadata.get("files").and_then(Value::as_array);
            let changed = dict(files.and_then(|files| files.first()).unwrap_or(&Value::Null));
            let diff = some(or(&or(&text(&changed, "patch"), &text(&changed, "diff")), &text(&metadata, "diff")));
            Presentation {
                icon: "→",
                title: format!("Edit {}", format_path(&file)),
                patch: if diff.is_some() { None } else { EditInput(input).patch_text().non_empty().map(str::to_owned) },
                diff,
                file: Some(file),
                ..Presentation::default()
            }
        }
        kind @ (ToolKind::Read | ToolKind::List) => {
            let value = or(path, &first);
            let title = if kind == ToolKind::Read { "Read" } else { "List" };
            Presentation {
                icon: "→",
                title: format!("{title} {}", format_path(&value)),
                lines: some(value).map(|value| vec![format!("Path: {}", format_path(&value))]).unwrap_or_default(),
                ..Presentation::default()
            }
        }
        kind @ (ToolKind::Glob | ToolKind::Grep) => {
            let pattern = or(SearchInput(input).pattern().text(), &first);
            let title = if kind == ToolKind::Glob { "Glob" } else { "Grep" };
            Presentation {
                icon: "✱",
                title: format!("{title} \"{pattern}\""),
                lines: some(pattern).map(|pattern| vec![format!("Pattern: {pattern}")]).unwrap_or_default(),
                ..Presentation::default()
            }
        }
        ToolKind::Shell => Presentation {
            icon: "#",
            title: "Shell command".to_owned(),
            lines: match ShellInput(input).command().non_empty() {
                Some(command) => vec![format!("$ {command}")],
                None => resources.iter().map(|item| format!("- {item}")).collect(),
            },
            ..Presentation::default()
        },
        ToolKind::Subagent => {
            let input = SubagentInput(input);
            let agent = input.agent().non_empty().or(input.subagent_type().non_empty()).unwrap_or("general");
            Presentation {
                icon: "#",
                title: format!("{} Subagent", crate::tool_info::titlecase(agent)),
                lines: input
                    .description()
                    .non_empty()
                    .map(|description| vec![format!("◉ {description}")])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        ToolKind::WebFetch => {
            let url = or(WebFetchInput(input).url().text(), &text(&metadata, "url"));
            Presentation {
                icon: "%",
                title: format!("WebFetch {url}"),
                lines: some(url).map(|url| vec![format!("URL: {url}")]).unwrap_or_default(),
                ..Presentation::default()
            }
        }
        ToolKind::WebSearch => {
            let query = or(WebSearchInput(input).query().text(), &text(&metadata, "query"));
            let title = web_search_provider_label(metadata.get("provider").unwrap_or(&Value::Null));
            Presentation {
                icon: "◈",
                title: if query.is_empty() { title } else { format!("{title} \"{query}\"") },
                lines: some(query).map(|query| vec![format!("Query: {query}")]).unwrap_or_default(),
                ..Presentation::default()
            }
        }
        ToolKind::Lsp => {
            let lsp = LspInput(input);
            let operation = or(lsp.operation().text(), "request");
            let number = |value: Option<&Value>| value.and_then(finite_number);
            let position = number(lsp.line().value())
                .zip(number(lsp.character().value()))
                .map(|(line, character)| format!("{line}:{character}"));
            let mut title = format!("LSP {operation}");
            let mut lines = Vec::new();
            if lsp.operation().truthy() {
                lines.push(format!("Operation: {operation}"));
            }
            if !path.is_empty() {
                title.push_str(&format!(" {}", format_path(path)));
                if let Some(position) = &position {
                    title.push_str(&format!(":{position}"));
                }
                lines.push(format!("Path: {}", format_path(path)));
            }
            if let Some(position) = position {
                lines.push(format!("Position: {position}"));
            }
            Presentation { icon: "→", title, lines, ..Presentation::default() }
        }
        ToolKind::ExternalDirectory => {
            let raw = or(&or(&text(&metadata, "parentDir"), &text(&metadata, "filepath")), &first);
            Presentation {
                icon: "←",
                title: format!("Access external directory {}", format_path(&wildcard_directory(&raw))),
                lines: resources.iter().map(|item| format!("- {item}")).collect(),
                ..Presentation::default()
            }
        }
        ToolKind::DoomLoop => Presentation {
            icon: "⟳",
            title: "Continue after repeated failures".to_owned(),
            lines: vec!["This keeps the session running despite repeated failures.".to_owned()],
            ..Presentation::default()
        },
        _ => Presentation {
            icon: "⚙",
            title: format!("Call tool {action}"),
            lines: vec![format!("Tool: {action}")],
            ..Presentation::default()
        },
    }
}

pub fn always_lines(action: &str, save: &[String]) -> Vec<String> {
    if save.len() == 1 && save[0] == "*" {
        return vec![format!("This will always allow {action} for this project.")];
    }
    std::iter::once("This will always allow the following patterns for this project.".to_owned())
        .chain(save.iter().map(|item| format!("- {item}")))
        .collect()
}

/// The directory before the first wildcard, without trailing separators unless it is a root.
fn wildcard_directory(value: &str) -> String {
    let Some(wildcard) = value.find('*') else { return value.to_owned() };
    let prefix = &value[..wildcard];
    let separators = |text: &str| !text.is_empty() && text.chars().all(|c| c == '/' || c == '\\');
    let drive_root = {
        let bytes = prefix.as_bytes();
        bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\')
    };
    if separators(prefix) || drive_root {
        return prefix.to_owned();
    }
    prefix.trim_end_matches(['/', '\\']).to_owned()
}

fn dict(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}
