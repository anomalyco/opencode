//! ACP content blocks to prompt parts and back (`packages/cli/src/acp/content.ts`).

use base64::Engine as _;
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptPart {
    Text {
        text: String,
        synthetic: bool,
        ignored: bool,
    },
    File {
        url: String,
        filename: Option<String>,
        mime: String,
    },
}

impl PromptPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text {
            text: text.into(),
            synthetic: false,
            ignored: false,
        }
    }
}

/// A stored message part replayed to the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayPart {
    Prompt(PromptPart),
    Reasoning(String),
}

pub fn prompt_content_to_parts(content: &[Value]) -> Vec<PromptPart> {
    content.iter().flat_map(content_block_to_parts).collect()
}

fn content_block_to_parts(block: &Value) -> Vec<PromptPart> {
    let text = |key: &str| block.get(key).and_then(Value::as_str);
    match text("type") {
        Some("text") => {
            let value = text("text").unwrap_or_default().to_owned();
            let audience = block
                .get("annotations")
                .and_then(|annotations| annotations.get("audience"))
                .and_then(Value::as_array);
            let only = |who: &str| {
                audience.is_some_and(|audience| audience.len() == 1 && audience[0] == who)
            };
            vec![PromptPart::Text {
                text: value,
                synthetic: only("assistant"),
                ignored: !only("assistant") && only("user"),
            }]
        }
        Some("image") => {
            let mime = text("mimeType").unwrap_or_default();
            let uri = text("uri");
            let url = match text("data").filter(|data| !data.is_empty()) {
                Some(data) => format!("data:{mime};base64,{data}"),
                None => match uri.filter(|uri| !uri.is_empty()) {
                    Some(uri) => uri.to_owned(),
                    None => return Vec::new(),
                },
            };
            let filename = filename_from_uri(uri).unwrap_or_else(|| "image".to_owned());
            if url.starts_with("data:") {
                return vec![PromptPart::File {
                    url,
                    filename: Some(filename),
                    mime: mime.to_owned(),
                }];
            }
            vec![resource_link_to_part(&url, Some(&filename), Some(mime))]
        }
        Some("resource_link") => vec![resource_link_to_part(
            text("uri").unwrap_or_default(),
            text("name"),
            text("mimeType"),
        )],
        Some("resource") => {
            let resource = block.get("resource").cloned().unwrap_or(Value::Null);
            let field = |key: &str| resource.get(key).and_then(Value::as_str);
            let uri = field("uri").unwrap_or_default();
            if let Some(body) = field("text") {
                let parsed = url::Url::parse(uri).ok();
                let decoded = parsed
                    .as_ref()
                    .filter(|parsed| parsed.scheme() == "file")
                    .and_then(|parsed| {
                        parsed
                            .to_file_path()
                            .ok()
                            .map(|path| path.to_string_lossy().into_owned())
                            .or_else(|| {
                                percent_encoding::percent_decode_str(parsed.path())
                                    .decode_utf8()
                                    .ok()
                                    .map(|path| path.into_owned())
                            })
                    });
                let (Some(parsed), Some(filepath)) = (parsed, decoded) else {
                    return vec![PromptPart::text(format!("[{uri}]\n{body}"))];
                };
                let line = parsed
                    .fragment()
                    .and_then(|fragment| fragment.strip_prefix('L'))
                    .map(|rest| {
                        rest.chars()
                            .take_while(char::is_ascii_digit)
                            .collect::<String>()
                    })
                    .filter(|digits| !digits.is_empty());
                let suffix = line.map(|line| format!(":{line}")).unwrap_or_default();
                return vec![PromptPart::text(format!("[{filepath}{suffix}]\n{body}"))];
            }
            let Some(mime) = field("mimeType").filter(|mime| !mime.is_empty()) else {
                return Vec::new();
            };
            let url = if uri.starts_with("data:") {
                uri.to_owned()
            } else {
                format!(
                    "data:{mime};base64,{}",
                    field("blob").unwrap_or("undefined")
                )
            };
            vec![PromptPart::File {
                url,
                filename: Some(filename_from_uri(Some(uri)).unwrap_or_else(|| "file".to_owned())),
                mime: mime.to_owned(),
            }]
        }
        _ => Vec::new(),
    }
}

/// Replayed parts as `ContentChunk`s (`partsToContentChunks`).
pub fn parts_to_content_chunks(parts: &[ReplayPart]) -> Vec<Value> {
    parts.iter().filter_map(part_to_chunk).collect()
}

fn part_to_chunk(part: &ReplayPart) -> Option<Value> {
    let part = match part {
        ReplayPart::Reasoning(text) if text.is_empty() => return None,
        ReplayPart::Reasoning(text) => {
            return Some(json!({ "content": { "type": "text", "text": text } }));
        }
        ReplayPart::Prompt(part) => part,
    };
    let (url, filename, mime) = match part {
        PromptPart::Text {
            text,
            synthetic,
            ignored,
        } => {
            if text.is_empty() {
                return None;
            }
            let mut content = Map::new();
            content.insert("type".to_owned(), json!("text"));
            content.insert("text".to_owned(), json!(text));
            if *synthetic {
                content.insert(
                    "annotations".to_owned(),
                    json!({ "audience": ["assistant"] }),
                );
            } else if *ignored {
                content.insert("annotations".to_owned(), json!({ "audience": ["user"] }));
            }
            return Some(json!({ "content": content }));
        }
        PromptPart::File {
            url,
            filename,
            mime,
        } => (url, filename.as_deref(), mime),
    };
    if url.starts_with("file://") {
        return Some(json!({
            "content": {
                "type": "resource_link",
                "uri": url,
                "name": filename.unwrap_or("file"),
                "mimeType": mime,
            }
        }));
    }
    let rest = url.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    if mime.is_empty() || mime.contains(';') {
        return None;
    }
    if mime.starts_with("image/") {
        return Some(json!({
            "content": {
                "type": "image",
                "mimeType": mime,
                "data": data,
                "uri": path_to_file_url(filename.unwrap_or("image")),
            }
        }));
    }
    let uri = path_to_file_url(filename.unwrap_or("file"));
    let resource = if mime.starts_with("text/") || mime == "application/json" {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .unwrap_or_default();
        json!({ "uri": uri, "mimeType": mime, "text": String::from_utf8_lossy(&bytes) })
    } else {
        json!({ "uri": uri, "mimeType": mime, "blob": data })
    };
    Some(json!({ "content": { "type": "resource", "resource": resource } }))
}

fn resource_link_to_part(uri: &str, name: Option<&str>, mime: Option<&str>) -> PromptPart {
    let name = name.filter(|name| !name.is_empty());
    let mime = mime.unwrap_or("text/plain").to_owned();
    if uri.starts_with("file://") {
        return PromptPart::File {
            url: uri.to_owned(),
            filename: Some(
                name.map(str::to_owned)
                    .or_else(|| filename_from_uri(Some(uri)))
                    .unwrap_or_else(|| "file".to_owned()),
            ),
            mime,
        };
    }
    if uri.starts_with("zed://")
        && let Ok(parsed) = url::Url::parse(uri)
        && let Some(pathname) = query_param(&parsed, "path").filter(|path| !path.is_empty())
    {
        let base = js_basename(&pathname);
        return PromptPart::File {
            url: path_to_file_url(&pathname),
            filename: Some(
                name.map(str::to_owned)
                    .or_else(|| (!base.is_empty()).then_some(base))
                    .unwrap_or_else(|| "file".to_owned()),
            ),
            mime,
        };
    }
    link_reference(name, uri)
}

pub fn link_reference(name: Option<&str>, uri: &str) -> PromptPart {
    match name.filter(|name| !name.is_empty()) {
        Some(name) => PromptPart::text(format!("[{name}]({uri})")),
        None => PromptPart::text(uri),
    }
}

fn query_param(url: &url::Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn filename_from_uri(uri: Option<&str>) -> Option<String> {
    let uri = uri.filter(|uri| !uri.is_empty() && !uri.starts_with("data:"))?;
    let base = match url::Url::parse(uri) {
        Ok(url) => {
            let zed = (url.scheme() == "zed")
                .then(|| query_param(&url, "path"))
                .flatten()
                .filter(|path| !path.is_empty());
            js_basename(&zed.unwrap_or_else(|| url.path().to_owned()))
        }
        Err(_) => js_basename(uri),
    };
    (!base.is_empty()).then_some(base)
}

/// Node's `path.posix.basename`: the last segment, ignoring trailing slashes.
pub fn js_basename(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_owned()
}

/// Node's `pathToFileURL(path).href`: resolved against the working directory.
pub fn path_to_file_url(path: &str) -> String {
    let absolute = crate::paths::resolve_lexical(path);
    url::Url::from_file_path(&absolute)
        .map(String::from)
        .unwrap_or_else(|()| format!("file://{absolute}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn text(text: &str) -> PromptPart {
        PromptPart::text(text)
    }

    #[test]
    fn blocks_to_parts() {
        let rows = [
            (
                json!({ "type": "resource", "resource": { "uri": "file:///src/a.ts#L12", "text": "body" } }),
                vec![text("[/src/a.ts:12]\nbody")],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "file:///context.txt", "mimeType": "text/plain", "text": "embedded" } }),
                vec![text("[/context.txt]\nembedded")],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "untitled:notes", "text": "body" } }),
                vec![text("[untitled:notes]\nbody")],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "not a uri", "text": "body" } }),
                vec![text("[not a uri]\nbody")],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "file:///a.bin", "mimeType": "application/octet-stream", "blob": "AAE=" } }),
                vec![PromptPart::File {
                    url: "data:application/octet-stream;base64,AAE=".to_owned(),
                    filename: Some("a.bin".to_owned()),
                    mime: "application/octet-stream".to_owned(),
                }],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "file:///a.bin", "blob": "AAE=" } }),
                vec![],
            ),
            (
                json!({ "type": "resource_link", "uri": "zed://file?path=/src/main.rs", "name": "" }),
                vec![PromptPart::File {
                    url: "file:///src/main.rs".to_owned(),
                    filename: Some("main.rs".to_owned()),
                    mime: "text/plain".to_owned(),
                }],
            ),
            (
                json!({ "type": "resource_link", "uri": "https://example.com/a", "name": "" }),
                vec![text("https://example.com/a")],
            ),
            (
                json!({ "type": "image", "mimeType": "image/png", "data": "iVBO" }),
                vec![PromptPart::File {
                    url: "data:image/png;base64,iVBO".to_owned(),
                    filename: Some("image".to_owned()),
                    mime: "image/png".to_owned(),
                }],
            ),
            (
                json!({ "type": "text", "text": "seen by user", "annotations": { "audience": ["user"] } }),
                vec![PromptPart::Text {
                    text: "seen by user".to_owned(),
                    synthetic: false,
                    ignored: true,
                }],
            ),
            (
                json!({ "type": "audio", "mimeType": "audio/wav", "data": "AA==" }),
                vec![],
            ),
        ];
        for (block, expected) in rows {
            assert_eq!(
                prompt_content_to_parts(std::slice::from_ref(&block)),
                expected,
                "{block}"
            );
        }
    }

    #[test]
    fn replayed_parts_to_chunks() {
        let chunks = parts_to_content_chunks(&[
            ReplayPart::Prompt(PromptPart::Text {
                text: "hidden".to_owned(),
                synthetic: true,
                ignored: false,
            }),
            ReplayPart::Reasoning(String::new()),
            ReplayPart::Prompt(PromptPart::File {
                url: "file:///a.ts".to_owned(),
                filename: None,
                mime: "text/plain".to_owned(),
            }),
            ReplayPart::Prompt(PromptPart::File {
                url: "data:text/plain;base64,aGk=".to_owned(),
                filename: Some("/notes.txt".to_owned()),
                mime: "text/plain".to_owned(),
            }),
            ReplayPart::Prompt(PromptPart::File {
                url: "https://example.com".to_owned(),
                filename: None,
                mime: "text/html".to_owned(),
            }),
        ]);
        assert_eq!(
            json!(chunks),
            json!([
                { "content": { "type": "text", "text": "hidden", "annotations": { "audience": ["assistant"] } } },
                { "content": { "type": "resource_link", "uri": "file:///a.ts", "name": "file", "mimeType": "text/plain" } },
                { "content": { "type": "resource", "resource": { "uri": "file:///notes.txt", "mimeType": "text/plain", "text": "hi" } } },
            ])
        );
    }
}
