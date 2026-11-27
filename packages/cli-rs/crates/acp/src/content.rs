use base64::Engine as _;
use opencode_util::json_object;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptPart {
    Text { text: String, synthetic: bool, ignored: bool },
    File { url: String, filename: Option<String>, mime: String },
}

impl PromptPart {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into(), synthetic: false, ignored: false }
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
            let audience =
                block.get("annotations").and_then(|annotations| annotations.get("audience")).and_then(Value::as_array);
            let only = |who: &str| audience.is_some_and(|audience| audience.len() == 1 && audience[0] == who);
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
                return vec![PromptPart::File { url, filename: Some(filename), mime: mime.to_owned() }];
            }
            vec![resource_link_to_part(&url, Some(&filename), Some(mime))]
        }
        Some("resource_link") => {
            vec![resource_link_to_part(text("uri").unwrap_or_default(), text("name"), text("mimeType"))]
        }
        Some("resource") => {
            let resource = block.get("resource").cloned().unwrap_or(Value::Null);
            let field = |key: &str| resource.get(key).and_then(Value::as_str);
            let uri = field("uri").unwrap_or_default();
            if let Some(body) = field("text") {
                let parsed = opencode_api::js::parse_url(uri).ok();
                let decoded = parsed.as_ref().filter(|parsed| parsed.scheme() == "file").and_then(|parsed| {
                    parsed.to_file_path().ok().map(|path| path.to_string_lossy().into_owned()).or_else(|| {
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
                    .map(|rest| rest.chars().take_while(char::is_ascii_digit).collect::<String>())
                    .filter(|digits| !digits.is_empty());
                let suffix = line.map(|line| format!(":{line}")).unwrap_or_default();
                let filepath = if cfg!(windows) { filepath.replace('\\', "/") } else { filepath };
                return vec![PromptPart::text(format!("[{filepath}{suffix}]\n{body}"))];
            }
            let filename = filename_from_uri(Some(uri)).unwrap_or_else(|| "file".to_owned());
            // ACP makes `mimeType` optional, so infer it from the name rather than dropping the bytes.
            let mime = field("mimeType")
                .filter(|mime| !mime.is_empty())
                .unwrap_or_else(|| opencode_util::mime::from_filename(&filename));
            let url = if uri.starts_with("data:") {
                uri.to_owned()
            } else {
                format!("data:{mime};base64,{}", field("blob").unwrap_or("undefined"))
            };
            vec![PromptPart::File { url, filename: Some(filename), mime: mime.to_owned() }]
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
        PromptPart::Text { text, synthetic, ignored } => {
            if text.is_empty() {
                return None;
            }
            let audience = if *synthetic { Some("assistant") } else { ignored.then_some("user") };
            let annotations = audience.map(|audience| json!({ "audience": [audience] }));
            return Some(
                json!({ "content": json_object! { "type": "text", "text": text, "annotations"?: annotations } }),
            );
        }
        PromptPart::File { url, filename, mime } => (url, filename.as_deref(), mime),
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
        let bytes = base64::engine::general_purpose::STANDARD.decode(data).unwrap_or_default();
        json!({ "uri": uri, "mimeType": mime, "text": String::from_utf8_lossy(&bytes) })
    } else {
        json!({ "uri": uri, "mimeType": mime, "blob": data })
    };
    Some(json!({ "content": { "type": "resource", "resource": resource } }))
}

fn resource_link_to_part(uri: &str, name: Option<&str>, mime: Option<&str>) -> PromptPart {
    let name = name.filter(|name| !name.is_empty());
    let mime = mime.unwrap_or("text/plain").to_owned();
    let parsed = opencode_api::js::parse_url(uri).ok();
    // `file:/path` and `file:///path` name the same file; the parsed URL spells both as the latter.
    if parsed.as_ref().is_some_and(|parsed| parsed.scheme() == "file") || uri.starts_with("file://") {
        let url = parsed.as_ref().map_or(uri, url::Url::as_str).to_owned();
        return PromptPart::File {
            url,
            filename: Some(
                name.map(str::to_owned).or_else(|| filename_from_uri(Some(uri))).unwrap_or_else(|| "file".to_owned()),
            ),
            mime,
        };
    }
    if let Some(parsed) = parsed.as_ref().filter(|parsed| parsed.scheme() == "zed")
        && let Some(pathname) = query_param(parsed, "path").filter(|path| !path.is_empty())
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
    url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
}

fn filename_from_uri(uri: Option<&str>) -> Option<String> {
    let uri = uri.filter(|uri| !uri.is_empty() && !uri.starts_with("data:"))?;
    let base = match opencode_api::js::parse_url(uri) {
        Ok(url) => {
            // Zed's `path` query is already decoded; a URL path is not.
            if url.scheme() == "zed"
                && let Some(pathname) = query_param(&url, "path").filter(|path| !path.is_empty())
            {
                js_basename(&pathname)
            } else {
                decode_component(&js_basename(url.path()))
            }
        }
        Err(_) => js_basename(uri),
    };
    (!base.is_empty()).then_some(base)
}

fn decode_component(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return value.to_owned();
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    percent_encoding::percent_decode_str(value).decode_utf8().map_or_else(|_| value.to_owned(), |s| s.into_owned())
}

/// Node's `path.basename`: the last segment, ignoring trailing separators.
pub fn js_basename(path: &str) -> String {
    opencode_util::path::Flavor::NATIVE.basename(path).to_owned()
}

/// Node's `pathToFileURL(path).href`: resolved against the working directory.
pub fn path_to_file_url(path: &str) -> String {
    let absolute = crate::paths::resolve_lexical(path);
    url::Url::from_file_path(&absolute).map(String::from).unwrap_or_else(|()| format!("file://{absolute}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn text(text: &str) -> PromptPart {
        PromptPart::text(text)
    }

    #[test]
    fn non_ascii_hosts_from_the_client_do_not_panic() {
        for uri in ["https://Bücher.example", "file://Bücher.example/a.txt"] {
            assert_eq!(
                opencode_api::js::parse_url(uri).unwrap_err().to_string(),
                format!("{uri}: {}", opencode_api::js::ASCII_HOST)
            );
        }
        let rows = [
            (
                json!({ "type": "resource_link", "uri": "https://Bücher.example", "name": "" }),
                vec![text("https://Bücher.example")],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "https://Bücher.example", "text": "body" } }),
                vec![text("[https://Bücher.example]\nbody")],
            ),
            (
                json!({ "type": "resource_link", "uri": "file://Bücher.example/a.txt" }),
                vec![PromptPart::File {
                    url: "file://Bücher.example/a.txt".to_owned(),
                    filename: Some("a.txt".to_owned()),
                    mime: "text/plain".to_owned(),
                }],
            ),
            (
                json!({ "type": "resource", "resource": { "uri": "https://Bücher.example/a.bin", "mimeType": "application/octet-stream", "blob": "AAE=" } }),
                vec![PromptPart::File {
                    url: "data:application/octet-stream;base64,AAE=".to_owned(),
                    filename: Some("a.bin".to_owned()),
                    mime: "application/octet-stream".to_owned(),
                }],
            ),
        ];
        for (block, expected) in rows {
            assert_eq!(prompt_content_to_parts(std::slice::from_ref(&block)), expected, "{block}");
        }
    }

    /// An absolute path on this platform and its file URL.
    fn absolute(path: &str) -> (String, String) {
        if cfg!(windows) {
            (format!("C:{path}"), format!("file:///C:{path}"))
        } else {
            (path.to_owned(), format!("file://{path}"))
        }
    }

    #[test]
    fn a_windows_file_resource_shows_forward_slashes() {
        let block = json!({ "type": "resource", "resource": { "uri": "file:///C:/src/a.ts#L12", "text": "body" } });
        let label = if cfg!(windows) { "[C:/src/a.ts:12]\nbody" } else { "[/C:/src/a.ts:12]\nbody" };
        assert_eq!(prompt_content_to_parts(&[block]), vec![text(label)]);
    }

    #[test]
    fn attaches_embedded_blob_without_mime_type_and_decodes_filenames() {
        assert_eq!(
            prompt_content_to_parts(&[
                json!({ "type": "resource", "resource": { "uri": "mcp://context/report.pdf", "blob": "JVBERi0xLjQK" } }),
                json!({ "type": "resource", "resource": { "uri": "mcp://context/blob", "blob": "AAAA" } }),
            ]),
            vec![
                PromptPart::File {
                    url: "data:application/pdf;base64,JVBERi0xLjQK".to_owned(),
                    filename: Some("report.pdf".to_owned()),
                    mime: "application/pdf".to_owned(),
                },
                PromptPart::File {
                    url: "data:application/octet-stream;base64,AAAA".to_owned(),
                    filename: Some("blob".to_owned()),
                    mime: "application/octet-stream".to_owned(),
                },
            ]
        );
        for uri in ["file:/tmp/a.txt", "file:///tmp/a.txt"] {
            assert_eq!(
                prompt_content_to_parts(&[
                    json!({ "type": "resource_link", "uri": uri, "name": "a.txt", "mimeType": "text/plain" }),
                ]),
                vec![PromptPart::File {
                    url: "file:///tmp/a.txt".to_owned(),
                    filename: Some("a.txt".to_owned()),
                    mime: "text/plain".to_owned(),
                }]
            );
        }
        let parts = prompt_content_to_parts(&[
            json!({ "type": "image", "data": "", "mimeType": "image/png", "uri": "file:///tmp/photo%201.png" }),
            json!({ "type": "resource", "resource": { "uri": "file:///tmp/caf%C3%A9%20%231.bin", "mimeType": "application/octet-stream", "blob": "AAAA" } }),
            json!({ "type": "image", "data": "", "mimeType": "image/png", "uri": "zed:///agent/file?path=%2Ftmp%2Fodd%2520name.png" }),
        ]);
        let names: Vec<Option<&str>> = parts
            .iter()
            .map(|part| match part {
                PromptPart::File { filename, .. } => filename.as_deref(),
                PromptPart::Text { .. } => None,
            })
            .collect();
        assert_eq!(names, vec![Some("photo 1.png"), Some("café #1.bin"), Some("odd%20name.png")]);
    }

    #[test]
    fn replayed_parts_to_chunks() {
        let notes = absolute("/notes.txt");
        let chunks = parts_to_content_chunks(&[
            ReplayPart::Prompt(PromptPart::Text { text: "hidden".to_owned(), synthetic: true, ignored: false }),
            ReplayPart::Reasoning(String::new()),
            ReplayPart::Prompt(PromptPart::File {
                url: "file:///a.ts".to_owned(),
                filename: None,
                mime: "text/plain".to_owned(),
            }),
            ReplayPart::Prompt(PromptPart::File {
                url: "data:text/plain;base64,aGk=".to_owned(),
                filename: Some(notes.0),
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
                { "content": { "type": "resource", "resource": { "uri": notes.1, "mimeType": "text/plain", "text": "hi" } } },
            ])
        );
    }
}
