//! A file's LSP errors under the write and edit tools (E.7a): `Diagnostics` and `parseDiagnostics`
//! (`routes/session/index.tsx:3707-3731`, `:3815-3829`).

use opentui::prelude::*;
use serde_json::{Map, Value};

use crate::routes::session::messages::list::Context;

/// One error: its zero-based start and message.
#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub line: f64,
    pub character: f64,
    pub message: String,
}

/// `parseDiagnostics`: the first three errors (severity 1) the tool's metadata lists for `path`.
pub fn parse(diagnostics: Option<&Value>, path: &str) -> Vec<Diagnostic> {
    let Some(Value::Array(items)) = diagnostics
        .and_then(Value::as_object)
        .and_then(|files| files.get(path))
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let item = item.as_object()?;
            let start = item
                .get("range")
                .and_then(Value::as_object)
                .and_then(|range| range.get("start"))
                .and_then(Value::as_object)?;
            let finite = |key: &str| {
                start
                    .get(key)
                    .and_then(opencode_ui::tool_info::finite_number)
            };
            let message = item.get("message").and_then(Value::as_str)?;
            let error = item.get("severity").and_then(Value::as_f64) == Some(1.0);
            if !error || message.is_empty() {
                return None;
            }
            Some(Diagnostic {
                line: finite("line")?,
                character: finite("character")?,
                message: message.to_owned(),
            })
        })
        .take(3)
        .collect()
}

/// The errors as lines of error text, or `None` when there are none.
pub fn view(cx: &Context<'_>, metadata: &Map<String, Value>, path: &str) -> Option<View> {
    let errors = parse(metadata.get("diagnostics"), path);
    if errors.is_empty() {
        return None;
    }
    let column = View::new(cx.app).column();
    for error in errors {
        let line = format!(
            "Error [{}:{}] {}",
            super::dispatch::number(error.line + 1.0),
            super::dispatch::number(error.character + 1.0),
            error.message
        );
        column.add(&Text::new(cx.app, line).fg(cx.theme.text.feedback.error.base));
    }
    Some(column)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn only_the_first_three_errors_of_the_file_show() {
        let error = |line: u32, message: &str| {
            json!({ "severity": 1, "message": message, "range": { "start": { "line": line, "character": 4 } } })
        };
        let diagnostics = json!({
            "/p/a.rs": [
                error(0, "first"),
                { "severity": 2, "message": "warning", "range": { "start": { "line": 1, "character": 0 } } },
                error(2, ""),
                { "severity": 1, "message": "no range" },
                error(3, "second"),
                error(4, "third"),
                error(5, "fourth"),
            ],
            "/p/b.rs": [error(9, "other file")],
        });
        let parsed = parse(Some(&diagnostics), "/p/a.rs");
        let messages: Vec<_> = parsed.iter().map(|item| item.message.as_str()).collect();
        assert_eq!(messages, ["first", "second", "third"]);
        assert_eq!((parsed[1].line, parsed[1].character), (3.0, 4.0));
        assert!(parse(Some(&diagnostics), "/p/c.rs").is_empty());
        assert!(parse(Some(&json!([])), "/p/a.rs").is_empty());
        assert!(parse(None, "/p/a.rs").is_empty());
    }
}
