//! `run -f` attachments (`prepareFile` in `packages/cli/src/run/run.ts` and `noninteractive.ts`): read the
//! file, type it, and send text inline in the prompt and anything else as a data URL.

use std::io::Read;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

const ATTACH_FILE_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// What the prompt gets for one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Prepared {
    /// `<file name="…">` and the content, appended to the prompt text.
    Text(String),
    /// A `files` attachment: the data URL and the file name.
    Attachment { uri: String, name: String },
}

/// Reads `input`, relative to `root`. The errors are the TS messages.
pub fn prepare(input: &str, root: &Path) -> Result<Prepared, String> {
    let file = resolve(root, input);
    let mut handle = std::fs::File::open(&file).map_err(|_| format!("File not found: {input}"))?;
    let metadata = handle
        .metadata()
        .map_err(|_| format!("File not found: {input}"))?;
    if !metadata.is_file() || metadata.len() > ATTACH_FILE_MAX_BYTES {
        return Err(format!(
            "Cannot attach a directory, special file, or file larger than 10 MiB: {input}"
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    // At most the size `stat` reported, as the TS read loop does.
    (&mut handle)
        .take(metadata.len())
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(classify(&file.to_string_lossy(), name, bytes))
}

fn classify(path: &str, name: String, bytes: Vec<u8>) -> Prepared {
    let detected = mime_type(path);
    // Valid UTF-8 is exactly what survives `Buffer.toString` and back unchanged.
    let mime = if detected.starts_with("image/") || detected == "application/pdf" {
        detected
    } else if !is_binary(&bytes) && std::str::from_utf8(&bytes).is_ok() {
        "text/plain"
    } else {
        detected
    };
    // Any `text/plain` file goes inline, decoded with replacement characters when it is not UTF-8.
    if mime == "text/plain" {
        let text = String::from_utf8_lossy(&bytes);
        return Prepared::Text(format!("<file name=\"{name}\">\n{text}\n</file>"));
    }
    Prepared::Attachment {
        uri: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
        name,
    }
}

/// `path.resolve(root, input)`: absolute, with `.` and `..` resolved lexically.
fn resolve(root: &Path, input: &str) -> std::path::PathBuf {
    let joined = root.join(input);
    let mut out = std::path::PathBuf::from("/");
    for part in joined.components() {
        match part {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::Normal(part) => out.push(part),
            _ => {}
        }
    }
    out
}

/// `FSUtil.mimeType`: `mime-types`' `lookup`, else `application/octet-stream`.
pub fn mime_type(path: &str) -> &'static str {
    lookup(path).unwrap_or("application/octet-stream")
}

// `extname("x." + path)`: the extension of the last segment, unless its only dot leads.
fn lookup(path: &str) -> Option<&'static str> {
    let base = format!("x.{path}");
    let base = base.rsplit('/').next().unwrap_or_default();
    let dot = base.rfind('.').filter(|at| *at > 0)?;
    let extension = base[dot + 1..].to_lowercase();
    super::mime::TYPES
        .binary_search_by(|(key, _)| (*key).cmp(extension.as_str()))
        .ok()
        .map(|index| super::mime::TYPES[index].1)
}

fn is_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.contains(&0) {
        return true;
    }
    let control = bytes
        .iter()
        .filter(|byte| **byte < 9 || (**byte > 13 && **byte < 32))
        .count();
    control as f64 / bytes.len() as f64 > 0.3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_follow_mime_types() {
        // From `bun -e 'console.log(require("mime-types").lookup(p))'`.
        for (path, expected) in [
            ("/a/b.png", "image/png"),
            ("/a/B.PDF", "application/pdf"),
            ("/a/notes.md", "text/markdown"),
            ("/a/data.json", "application/json"),
            ("/a/x.tar.gz", "application/gzip"),
            ("/a/Makefile", "application/octet-stream"),
            ("/a/.bashrc", "application/octet-stream"),
            ("/a/trailing.", "application/octet-stream"),
            ("png", "image/png"),
        ] {
            assert_eq!(mime_type(path), expected, "{path}");
        }
    }

    #[test]
    fn text_goes_inline_and_the_rest_as_data_urls() {
        let text = classify("/w/a.md", "a.md".into(), b"# hi\n".to_vec());
        assert_eq!(
            text,
            Prepared::Text("<file name=\"a.md\">\n# hi\n\n</file>".into())
        );
        // An image stays an image even when its bytes are text.
        let image = classify("/w/a.png", "a.png".into(), b"abc".to_vec());
        assert_eq!(
            image,
            Prepared::Attachment {
                uri: "data:image/png;base64,YWJj".into(),
                name: "a.png".into()
            }
        );
        let binary = classify("/w/a.bin", "a.bin".into(), vec![0, 1, 2]);
        assert_eq!(
            binary,
            Prepared::Attachment {
                uri: "data:application/octet-stream;base64,AAEC".into(),
                name: "a.bin".into()
            }
        );
        // Invalid UTF-8 keeps the detected type: a `.txt` file goes inline with a replacement character,
        // anything else as a data URL.
        let latin1 = classify("/w/a.txt", "a.txt".into(), vec![b'h', 0xe9]);
        assert_eq!(
            latin1,
            Prepared::Text("<file name=\"a.txt\">\nh\u{fffd}\n</file>".into())
        );
        let csv = classify("/w/a.csv", "a.csv".into(), vec![b'h', 0xe9]);
        assert_eq!(
            csv,
            Prepared::Attachment {
                uri: "data:text/csv;base64,aOk=".into(),
                name: "a.csv".into()
            }
        );
        assert!(is_binary(&[1, 2, 3, b'a']));
        assert!(!is_binary(b"\t\r\n"));
    }

    #[test]
    fn paths_resolve_like_node() {
        assert_eq!(
            resolve(Path::new("/w/x"), "../a/./b.txt"),
            Path::new("/w/a/b.txt")
        );
        assert_eq!(resolve(Path::new("/w"), "/abs/c"), Path::new("/abs/c"));
    }
}
