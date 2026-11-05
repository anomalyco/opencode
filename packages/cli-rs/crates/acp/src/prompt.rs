//! An ACP prompt as an OpenCode submission (`packages/cli/src/acp/prompt.ts`).

use opencode_api::generated::CommandInfo;
use serde_json::Value;

use crate::catalog::{Catalog, Start, builtin};
use crate::content::{PromptPart, link_reference, prompt_content_to_parts};
use crate::error::Failure;
use crate::translate::{StartKind, TurnStart};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    pub uri: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slash {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone)]
pub struct Prepared {
    pub start: TurnStart,
    pub text: String,
    pub files: Vec<File>,
    pub synthetic: Vec<String>,
    pub slash: Option<Slash>,
    pub command: Option<CommandInfo>,
}

pub async fn prepare(catalog: &Catalog, content: &[Value]) -> Result<Prepared, Failure> {
    let empty = |block: &Value, key: &str| block.get(key).and_then(Value::as_str).is_none_or(str::is_empty);
    if content.iter().any(|block| {
        block.get("type").and_then(Value::as_str) == Some("image") && empty(block, "data") && empty(block, "uri")
    }) {
        return Err(Failure::invalid_request("image content has no data or uri", Some("prompt")));
    }
    let parts =
        futures_util::future::join_all(prompt_content_to_parts(content).into_iter().map(reference_unreadable_file))
            .await;
    let visible: Vec<&PromptPart> = parts
        .iter()
        .filter(|part| {
            !matches!(part, PromptPart::Text { synthetic: true, .. } | PromptPart::Text { ignored: true, .. })
        })
        .collect();
    let text = visible
        .iter()
        .filter_map(|part| match part {
            PromptPart::Text { text, .. } => Some(text.as_str()),
            PromptPart::File { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let slash = detect_slash_command(&text);
    let id = opencode_api::id::message();
    let kind = match slash.as_ref().and_then(|slash| builtin(&slash.name)) {
        Some(Start::Compaction) => StartKind::Compaction,
        None => StartKind::Input,
    };
    Ok(Prepared {
        start: TurnStart { kind, id },
        files: visible
            .iter()
            .filter_map(|part| match part {
                PromptPart::File { url, filename, .. } => Some(File { uri: url.clone(), name: filename.clone() }),
                PromptPart::Text { .. } => None,
            })
            .collect(),
        synthetic: parts
            .iter()
            .filter_map(|part| match part {
                PromptPart::Text { text, synthetic: true, .. } => Some(text.clone()),
                _ => None,
            })
            .collect(),
        command: slash
            .as_ref()
            .and_then(|slash| catalog.commands.iter().find(|command| command.name == slash.name).cloned()),
        slash,
        text,
    })
}

/// A `file:` part that cannot be read becomes a text reference to its URI.
async fn reference_unreadable_file(part: PromptPart) -> PromptPart {
    let PromptPart::File { url, filename, .. } = &part else {
        return part;
    };
    if !url.starts_with("file://") {
        return part;
    }
    let readable = match url::Url::parse(url).ok().and_then(|url| url.to_file_path().ok()) {
        Some(path) => tokio::task::spawn_blocking(move || readable(&path)).await.unwrap_or(false),
        None => false,
    };
    if readable {
        return part;
    }
    link_reference(filename.as_deref(), url)
}

/// `access(path, R_OK)`: directories count as readable.
fn readable(path: &std::path::Path) -> bool {
    if path.is_dir() {
        return std::fs::read_dir(path).is_ok();
    }
    std::fs::File::open(path).is_ok()
}

fn detect_slash_command(text: &str) -> Option<Slash> {
    let value = text.trim();
    let rest = value.strip_prefix('/')?;
    let name = rest.split(char::is_whitespace).next().filter(|name| !name.is_empty())?;
    let args = rest[name.len()..].split_whitespace().collect::<Vec<_>>().join(" ");
    Some(Slash { name: name.to_owned(), args: args.trim().to_owned() })
}
