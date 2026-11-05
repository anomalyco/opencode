//! Attachments, shared by the TUI and mini (E.4, rows P06 and P10): pasted or dropped paths of images, PDFs, and
//! SVGs become prompt files (`component/prompt/local-attachment.ts`), labelled `[Image N]` or `[PDF N]`
//! (`prompt/attachment.ts`).
//!
//! [`may_attach`] decides from the text alone whether a paste names attachable files, so plain text pastes
//! insert at once; only then does [`resolve`] read the files, on a blocking thread.

use std::path::Path;

use base64::Engine;
use serde_json::{Value, json};

/// Bounds filesystem work per paste; the byte budget also bounds the staged data.
const MAX_PASTED_FILEPATHS: usize = 32;
pub const MAX_LOCAL_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;

/// A pasted file, ready to become a prompt part.
#[derive(Clone, Debug, PartialEq)]
pub enum Resolved {
    /// An SVG: its text is pasted as `[SVG: name]`.
    Text { content: String, filename: String },
    /// An image or PDF as a `data:` URI, with the absolute path it came from.
    File { uri: String, filename: String, path: String },
}

/// Whether `text` names files [`resolve`] could attach: one path with an attachable extension, or several
/// that all have one. Reads nothing.
pub fn may_attach(text: &str, windows: bool) -> bool {
    let pasted = text.trim();
    let filepath = normalize_pasted_filepath(pasted, windows);
    if is_web_url(&filepath) {
        return false;
    }
    if mime(&filepath).is_some() {
        return true;
    }
    let paths = parse_pasted_filepaths(pasted, windows);
    paths.len() > 1 && paths.iter().all(|path| mime(path).is_some())
}

/// `resolvePastedAttachments`: the files `text` names, or `None` when it is not a paste of attachable files.
/// Several paths attach only when every one of them reads, within one shared byte budget.
pub fn resolve(text: &str, windows: bool) -> Option<Vec<Resolved>> {
    let pasted = text.trim();
    let filepath = normalize_pasted_filepath(pasted, windows);
    if is_web_url(&filepath) {
        return None;
    }
    let attachments = match read_local_attachment(&filepath, MAX_LOCAL_ATTACHMENT_BYTES) {
        Some(attachment) => vec![(filepath, attachment)],
        None => {
            let paths = parse_pasted_filepaths(pasted, windows);
            if paths.len() <= 1 {
                return None;
            }
            let mut remaining = MAX_LOCAL_ATTACHMENT_BYTES;
            let mut attachments = Vec::new();
            for path in paths {
                let next = read_local_attachment(&path, remaining)?;
                remaining -= next.len() as u64;
                attachments.push((path, next));
            }
            attachments
        }
    };
    Some(
        attachments
            .into_iter()
            .map(|(filepath, attachment)| {
                let filename = Path::new(&filepath)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                match attachment {
                    Local::Text(content) => Resolved::Text { content, filename },
                    Local::Binary(mime, content) => Resolved::File {
                        uri: format!(
                            "data:{mime};base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(content)
                        ),
                        filename,
                        path: std::path::absolute(&filepath)
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or(filepath),
                    },
                }
            })
            .collect(),
    )
}

/// `promptFilesForServer`: the files a submit sends. The captured bytes go either way, since a server may not
/// reach the source file; a local server also gets the file's URL.
pub fn files_for_server(entry: &Value, local: bool) -> Value {
    let Some(files) = entry.get("files").and_then(Value::as_array) else {
        return entry.get("files").cloned().unwrap_or(Value::Null);
    };
    Value::Array(
        files
            .iter()
            .map(|file| {
                let mut file = file.clone();
                let path = file
                    .as_object_mut()
                    .and_then(|file| file.remove("path"))
                    .and_then(|path| path.as_str().map(str::to_owned));
                if let Some(path) = path.filter(|_| local)
                    && let Ok(url) = url::Url::from_file_path(&path)
                {
                    file["source"] = json!({ "type": "uri", "uri": url.as_str() });
                }
                file
            })
            .collect(),
    )
}

/// `promptAttachmentLabel`: an image already attached with the same URI and metadata keeps its label;
/// otherwise the next `[Image N]` or `[PDF N]`.
pub fn label(files: &[Value], uri: &str, name: Option<&str>) -> Result<String, String> {
    let kind = if uri.starts_with("data:image/") {
        "Image"
    } else if uri.starts_with("data:application/pdf;") {
        "PDF"
    } else {
        return Err(format!("Unsupported inline attachment: {uri}"));
    };
    let metadata =
        |file: &Value| (file["name"].as_str().map(str::to_owned), file["description"].as_str().map(str::to_owned));
    let wanted = (name.map(str::to_owned), None);
    if kind == "Image"
        && let Some(existing) = files
            .iter()
            .filter(|file| file["uri"] == uri && metadata(file) == wanted)
            .find_map(|file| file["mention"]["text"].as_str().filter(|text| !text.is_empty()))
    {
        return Ok(existing.to_owned());
    }
    let prefix = format!("[{kind} ");
    let count = files
        .iter()
        .filter_map(|file| {
            let text = file["mention"]["text"].as_str()?;
            let digits = text.strip_prefix(&prefix)?.strip_suffix(']')?;
            (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| digits.parse::<u64>().ok())
                .flatten()
        })
        .max()
        .unwrap_or(0);
    Ok(format!("[{kind} {}]", count + 1))
}

/// The prompt's inline images, each image pasted twice under one label shown once (`deduplicatePromptImages`,
/// then the `data:image/` filter of `imageAttachments`): `(uri, mention text)`.
pub fn images(prompt: &Value) -> Vec<(String, Option<String>)> {
    let files = prompt["files"].as_array().cloned().unwrap_or_default();
    let mut seen = Vec::new();
    files
        .iter()
        .filter(|file| {
            let uri = file["uri"].as_str().unwrap_or_default();
            let mention = file["mention"]["text"].as_str().filter(|text| !text.is_empty());
            let Some(mention) = mention.filter(|_| files.len() >= 2 && uri.starts_with("data:image/")) else {
                return true;
            };
            let key = (file["name"].clone(), file["description"].clone(), mention.to_owned(), uri.to_owned());
            if seen.contains(&key) {
                return false;
            }
            seen.push(key);
            true
        })
        .filter_map(|file| {
            let uri = file["uri"].as_str()?;
            uri.starts_with("data:image/")
                .then(|| (uri.to_owned(), file["mention"]["text"].as_str().map(str::to_owned)))
        })
        .collect()
}

/// A file read for attaching.
enum Local {
    Text(String),
    Binary(&'static str, Vec<u8>),
}

impl Local {
    fn len(&self) -> usize {
        match self {
            Local::Text(content) => content.len(),
            Local::Binary(_, content) => content.len(),
        }
    }
}

/// `readLocalAttachment`: images and PDFs by extension, within `max` bytes; SVGs as text.
fn read_local_attachment(path: &str, max: u64) -> Option<Local> {
    let mime = mime(path)?;
    let bytes = read_bounded(path, max)?;
    if mime == "image/svg+xml" {
        let content = String::from_utf8_lossy(&bytes).into_owned();
        return (!content.is_empty() && content.len() as u64 <= max).then_some(Local::Text(content));
    }
    Some(Local::Binary(mime, bytes))
}

fn read_bounded(path: &str, max: u64) -> Option<Vec<u8>> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    (bytes.len() as u64 <= max).then_some(bytes)
}

/// The attachable types by extension; anything else is `application/octet-stream`, which never attaches.
fn mime(path: &str) -> Option<&'static str> {
    let extension = Path::new(path).extension()?.to_string_lossy().to_lowercase();
    Some(match extension.as_str() {
        "avif" => "image/avif",
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => return None,
    })
}

fn is_web_url(path: &str) -> bool {
    path.starts_with("http://") || path.starts_with("https://")
}

/// `normalizePastedFilepath`: quotes trimmed, a `file://` URL decoded, and shell escapes undone.
pub fn normalize_pasted_filepath(value: &str, windows: bool) -> String {
    let raw = value.trim_matches(['\'', '"']);
    if let Some(path) = decode_file_url(raw, windows) {
        return path;
    }
    if windows {
        return raw.to_owned();
    }
    // `raw.replace(/\\(.)/g, "$1")`: `.` stops at line terminators.
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\\'
            && let Some(&next) = chars.peek()
            && !matches!(next, '\n' | '\r' | '\u{2028}' | '\u{2029}')
        {
            out.push(next);
            chars.next();
            continue;
        }
        out.push(character);
    }
    out
}

/// A local `file://` URL as a path; `None` for other hosts or encoded separators.
fn decode_file_url(value: &str, windows: bool) -> Option<String> {
    if !value.starts_with("file://") {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    let encoded = url.path();
    let lower = encoded.to_ascii_lowercase();
    if lower.contains("%2f") || lower.contains("%5c") {
        return None;
    }
    let pathname = decode_uri_component(encoded)?;
    let host = url.host_str().filter(|host| !host.is_empty());
    if !windows {
        if host.is_some_and(|host| host != "localhost") {
            return None;
        }
        return Some(pathname);
    }
    let drive = pathname.len() >= 3
        && pathname.as_bytes()[0] == b'/'
        && pathname.as_bytes()[1].is_ascii_alphabetic()
        && pathname.as_bytes()[2] == b':';
    let local = if drive { &pathname[1..] } else { &pathname[..] }.replace('/', "\\");
    match host.filter(|host| *host != "localhost") {
        Some(host) => Some(format!("\\\\{host}{local}")),
        None => Some(local),
    }
}

/// `decodeURIComponent`: `None` on a malformed escape or bytes that are not UTF-8.
fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }
        let hex = value.get(index + 1..index + 3)?;
        out.push(u8::from_str_radix(hex, 16).ok()?);
        index += 3;
    }
    String::from_utf8(out).ok()
}

/// `parsePastedFilepaths`: whitespace-separated paths with shell quoting and escapes; comment lines of a
/// `file://` list skipped. Empty for an open quote or more than 32 paths.
pub fn parse_pasted_filepaths(value: &str, windows: bool) -> Vec<String> {
    let input = if value.contains("file://") {
        value
            .split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .filter(|line| !line.trim_start().starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        value.to_owned()
    };
    let mut result = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let push = |current: &mut String, result: &mut Vec<String>| {
        if current.is_empty() {
            return;
        }
        let path = std::mem::take(current);
        result.push(decode_file_url(&path, windows).unwrap_or(path));
    };
    let mut chars = input.chars().peekable();
    while let Some(character) = chars.next() {
        if let Some(open) = quote {
            if character == open {
                quote = None;
                continue;
            }
            if character == '\\' && !windows && open == '"' && chars.peek().is_some() {
                current.extend(chars.next());
                continue;
            }
            current.push(character);
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
            continue;
        }
        if character == '\\' && !windows && chars.peek().is_some() {
            current.extend(chars.next());
            continue;
        }
        if character.is_whitespace() {
            push(&mut current, &mut result);
            if result.len() > MAX_PASTED_FILEPATHS {
                return Vec::new();
            }
            continue;
        }
        current.push(character);
    }
    if quote.is_some() {
        return Vec::new();
    }
    push(&mut current, &mut result);
    if result.len() > MAX_PASTED_FILEPATHS {
        return Vec::new();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasted_paths_normalize_like_typescript() {
        let cases = [
            ("'/tmp/a b.png'", "/tmp/a b.png"),
            ("\"/tmp/x.png\"", "/tmp/x.png"),
            ("/tmp/a\\ b.png", "/tmp/a b.png"),
            ("file:///tmp/a%20b.png", "/tmp/a b.png"),
            ("file://localhost/tmp/c.png", "/tmp/c.png"),
            // Another host is not a local path; the text stays as typed.
            ("file://server/tmp/c.png", "file://server/tmp/c.png"),
            ("file:///tmp/a%2Fb.png", "file:///tmp/a%2Fb.png"),
        ];
        for (input, expected) in cases {
            assert_eq!(normalize_pasted_filepath(input, false), expected, "{input}");
        }
        assert_eq!(normalize_pasted_filepath("file:///C:/Users/a.png", true), "C:\\Users\\a.png");
        assert_eq!(normalize_pasted_filepath("file://host/share/a.png", true), "\\\\host\\share\\a.png");
    }

    #[test]
    fn pasted_path_lists_split_on_whitespace_and_quotes() {
        assert_eq!(
            parse_pasted_filepaths("/a.png '/b c.png' \"/d\\\"e.png\" /f\\ g.png", false),
            ["/a.png", "/b c.png", "/d\"e.png", "/f g.png"]
        );
        assert_eq!(
            parse_pasted_filepaths("# comment\nfile:///a.png\r\nfile:///b%20c.png", false),
            ["/a.png", "/b c.png"]
        );
        assert!(parse_pasted_filepaths("'/open.png", false).is_empty());
        let many = (0..33).map(|i| format!("/{i}.png")).collect::<Vec<_>>().join(" ");
        assert!(parse_pasted_filepaths(&many, false).is_empty());
        let limit = (0..32).map(|i| format!("/{i}.png")).collect::<Vec<_>>().join(" ");
        assert_eq!(parse_pasted_filepaths(&limit, false).len(), 32);
    }

    #[test]
    fn only_attachable_names_go_to_the_filesystem() {
        assert!(may_attach("/tmp/shot.PNG", false));
        assert!(may_attach("/a.png /b.pdf", false));
        assert!(!may_attach("/a.png notes.txt", false));
        assert!(!may_attach("https://example.com/a.png", false));
        assert!(!may_attach("hello world", false));
    }

    #[test]
    fn files_resolve_within_the_byte_budget() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("a b.png");
        std::fs::write(&png, b"\x89PNG").unwrap();
        let svg = dir.path().join("logo.svg");
        std::fs::write(&svg, "<svg/>").unwrap();
        let quoted = format!("'{}'", png.display());
        assert_eq!(
            resolve(&quoted, false),
            Some(vec![Resolved::File {
                uri: "data:image/png;base64,iVBORw==".into(),
                filename: "a b.png".into(),
                path: png.display().to_string(),
            }])
        );
        let both = format!("{} {}", quoted, svg.display());
        assert_eq!(
            resolve(&both, false).unwrap()[1],
            Resolved::Text { content: "<svg/>".into(), filename: "logo.svg".into() }
        );
        // One missing file drops the whole list.
        assert_eq!(resolve(&format!("{quoted} /missing.png"), false), None);
    }

    #[test]
    fn labels_count_up_and_reuse_an_identical_image() {
        let files = vec![
            json!({ "uri": "data:image/png;base64,AA", "name": "clipboard", "mention": { "text": "[Image 1]" } }),
            json!({ "uri": "data:application/pdf;base64,AA", "mention": { "text": "[PDF 3]" } }),
        ];
        assert_eq!(label(&files, "data:image/png;base64,AA", Some("clipboard")), Ok("[Image 1]".into()));
        assert_eq!(label(&files, "data:image/png;base64,BB", Some("clipboard")), Ok("[Image 2]".into()));
        assert_eq!(label(&files, "data:application/pdf;base64,AA", None), Ok("[PDF 4]".into()));
        assert!(label(&files, "https://x", None).is_err());
    }

    #[test]
    fn server_files_drop_the_path_and_a_local_server_gets_its_url() {
        let entry = json!({ "files": [{ "uri": "data:image/png;base64,AA", "path": "/tmp/a b.png" }] });
        assert_eq!(
            files_for_server(&entry, true),
            json!([{ "uri": "data:image/png;base64,AA", "source": { "type": "uri", "uri": "file:///tmp/a%20b.png" } }])
        );
        assert_eq!(files_for_server(&entry, false), json!([{ "uri": "data:image/png;base64,AA" }]));
    }

    #[test]
    fn images_show_a_repeated_paste_once() {
        let prompt = json!({ "files": [
            { "uri": "data:image/png;base64,AA", "mention": { "text": "[Image 1]" } },
            { "uri": "data:image/png;base64,AA", "mention": { "text": "[Image 1]" } },
            { "uri": "data:application/pdf;base64,AA", "mention": { "text": "[PDF 1]" } },
            { "uri": "data:image/png;base64,BB", "mention": { "text": "[Image 2]" } },
        ] });
        assert_eq!(
            images(&prompt),
            [
                ("data:image/png;base64,AA".to_owned(), Some("[Image 1]".to_owned())),
                ("data:image/png;base64,BB".to_owned(), Some("[Image 2]".to_owned())),
            ]
        );
    }
}
