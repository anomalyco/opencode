//! What a permission request shows (`util/permission.ts`), shared by the TUI's permission prompt and mini's
//! permission footer.

use serde_json::{Map, Value};

use crate::tool_info::{canonical_tool_name, finite_number, web_search_provider_label};

/// `PermissionPresentation`.
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
    let canonical = canonical_tool_name(action);
    let input = normalize_input(canonical, input);
    let mut metadata = dict(tool_metadata);
    if let Some(extra) = request_metadata {
        metadata.extend(
            extra
                .iter()
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }
    let text = |map: &Map<String, Value>, key: &str| -> String {
        map.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let first = resources.first().cloned().unwrap_or_default();
    let or = |value: String, fallback: &str| {
        if value.is_empty() {
            fallback.to_owned()
        } else {
            value
        }
    };
    let some = |value: String| (!value.is_empty()).then_some(value);

    match canonical {
        "edit" => {
            let file = or(text(&input, "path"), &first);
            let files = metadata.get("files").and_then(Value::as_array);
            let changed = dict(
                files
                    .and_then(|files| files.first())
                    .unwrap_or(&Value::Null),
            );
            let diff = some(or(
                or(text(&changed, "patch"), &text(&changed, "diff")),
                &text(&metadata, "diff"),
            ));
            Presentation {
                icon: "→",
                title: format!("Edit {}", format_path(&file)),
                patch: if diff.is_some() {
                    None
                } else {
                    some(text(&input, "patchText"))
                },
                diff,
                file: Some(file),
                ..Presentation::default()
            }
        }
        "read" | "list" => {
            let value = or(text(&input, "path"), &first);
            let title = if canonical == "read" { "Read" } else { "List" };
            Presentation {
                icon: "→",
                title: format!("{title} {}", format_path(&value)),
                lines: some(value)
                    .map(|value| vec![format!("Path: {}", format_path(&value))])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        "glob" | "grep" => {
            let pattern = or(text(&input, "pattern"), &first);
            let title = if canonical == "glob" { "Glob" } else { "Grep" };
            Presentation {
                icon: "✱",
                title: format!("{title} \"{pattern}\""),
                lines: some(pattern)
                    .map(|pattern| vec![format!("Pattern: {pattern}")])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        "shell" => {
            let command = text(&input, "command");
            Presentation {
                icon: "#",
                title: "Shell command".to_owned(),
                lines: match some(command) {
                    Some(command) => vec![format!("$ {command}")],
                    None => resources.iter().map(|item| format!("- {item}")).collect(),
                },
                ..Presentation::default()
            }
        }
        "subagent" => {
            let agent = or(text(&input, "agent"), "general");
            Presentation {
                icon: "#",
                title: format!("{} Subagent", crate::confirm::titlecase(&agent)),
                lines: some(text(&input, "description"))
                    .map(|description| vec![format!("◉ {description}")])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        "webfetch" => {
            let url = or(text(&input, "url"), &text(&metadata, "url"));
            Presentation {
                icon: "%",
                title: format!("WebFetch {url}"),
                lines: some(url)
                    .map(|url| vec![format!("URL: {url}")])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        "websearch" => {
            let query = or(text(&input, "query"), &text(&metadata, "query"));
            let title = web_search_provider_label(metadata.get("provider").unwrap_or(&Value::Null));
            Presentation {
                icon: "◈",
                title: if query.is_empty() {
                    title
                } else {
                    format!("{title} \"{query}\"")
                },
                lines: some(query)
                    .map(|query| vec![format!("Query: {query}")])
                    .unwrap_or_default(),
                ..Presentation::default()
            }
        }
        "lsp" => {
            let file = text(&input, "path");
            let operation = or(text(&input, "operation"), "request");
            let number = |key: &str| input.get(key).and_then(finite_number);
            let position = number("line")
                .zip(number("character"))
                .map(|(line, character)| format!("{line}:{character}"));
            let mut title = format!("LSP {operation}");
            let mut lines = Vec::new();
            if input.get("operation").is_some_and(truthy) {
                lines.push(format!("Operation: {operation}"));
            }
            if !file.is_empty() {
                title.push_str(&format!(" {}", format_path(&file)));
                if let Some(position) = &position {
                    title.push_str(&format!(":{position}"));
                }
                lines.push(format!("Path: {}", format_path(&file)));
            }
            if let Some(position) = position {
                lines.push(format!("Position: {position}"));
            }
            Presentation {
                icon: "→",
                title,
                lines,
                ..Presentation::default()
            }
        }
        "external_directory" => {
            let raw = or(
                or(text(&metadata, "parentDir"), &text(&metadata, "filepath")),
                &first,
            );
            Presentation {
                icon: "←",
                title: format!(
                    "Access external directory {}",
                    format_path(&wildcard_directory(&raw))
                ),
                lines: resources.iter().map(|item| format!("- {item}")).collect(),
                ..Presentation::default()
            }
        }
        "doom_loop" => Presentation {
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

/// `permissionAlwaysLines`.
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
    let Some(wildcard) = value.find('*') else {
        return value.to_owned();
    };
    let prefix = &value[..wildcard];
    let separators = |text: &str| !text.is_empty() && text.chars().all(|c| c == '/' || c == '\\');
    let drive_root = {
        let bytes = prefix.as_bytes();
        bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\')
    };
    if separators(prefix) || drive_root {
        return prefix.to_owned();
    }
    prefix.trim_end_matches(['/', '\\']).to_owned()
}

fn normalize_input(action: &str, value: &Value) -> Map<String, Value> {
    let mut input = dict(value);
    let text = |key: &str| {
        input
            .get(key)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    let path = text("path")
        .or_else(|| text("filePath"))
        .or_else(|| text("filepath"));
    let agent = text("agent").or_else(|| text("subagent_type"));
    if let Some(path) = path.filter(|_| matches!(action, "read" | "edit" | "list" | "lsp")) {
        input.insert("path".to_owned(), Value::String(path));
    }
    if let Some(agent) = agent.filter(|_| action == "subagent") {
        input.insert("agent".to_owned(), Value::String(agent));
    }
    input
}

fn dict(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

/// JavaScript truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
