//! `run -f` inlines text in the prompt and attaches other files as data URLs.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use opencode_util::path::Flavor;

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
    let file = resolve(Flavor::NATIVE, root, input);
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    // A FIFO must reach the regular-file check without waiting for a writer.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, libc::O_NONBLOCK);
    let mut handle = options.open(&file).map_err(|_| format!("File not found: {input}"))?;
    let metadata = handle.metadata().map_err(|_| format!("File not found: {input}"))?;
    if !metadata.is_file() || metadata.len() > ATTACH_FILE_MAX_BYTES {
        return Err(format!("Cannot attach a directory, special file, or file larger than 10 MiB: {input}"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    // At most the size `stat` reported, as the TS read loop does.
    (&mut handle).take(metadata.len()).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    let name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
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
    Prepared::Attachment { uri: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)), name }
}

/// `path.resolve(root, input)`: absolute, with `.` and `..` resolved lexically. POSIX folds `Path` components, so a
/// directory name that is not UTF-8 keeps its bytes.
fn resolve(flavor: Flavor, root: &Path, input: &str) -> PathBuf {
    if flavor == Flavor::Windows {
        return PathBuf::from(flavor.resolve(&["\\", &root.to_string_lossy(), input]));
    }
    let mut out = PathBuf::from("/");
    for part in root.join(input).components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
            _ => {}
        }
    }
    out
}

/// `FSUtil.mimeType`: `mime-types`' `lookup`, else `application/octet-stream`.
pub fn mime_type(path: &str) -> &'static str {
    opencode_util::mime::mime_type(path)
}

fn is_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.contains(&0) {
        return true;
    }
    let control = bytes.iter().filter(|byte| **byte < 9 || (**byte > 13 && **byte < 32)).count();
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
        assert_eq!(text, Prepared::Text("<file name=\"a.md\">\n# hi\n\n</file>".into()));
        // An image stays an image even when its bytes are text.
        let image = classify("/w/a.png", "a.png".into(), b"abc".to_vec());
        assert_eq!(image, Prepared::Attachment { uri: "data:image/png;base64,YWJj".into(), name: "a.png".into() });
        let binary = classify("/w/a.bin", "a.bin".into(), vec![0, 1, 2]);
        assert_eq!(
            binary,
            Prepared::Attachment { uri: "data:application/octet-stream;base64,AAEC".into(), name: "a.bin".into() }
        );
        // Invalid UTF-8 keeps the detected type: a `.txt` file goes inline with a replacement character,
        // anything else as a data URL.
        let latin1 = classify("/w/a.txt", "a.txt".into(), vec![b'h', 0xe9]);
        assert_eq!(latin1, Prepared::Text("<file name=\"a.txt\">\nh\u{fffd}\n</file>".into()));
        let csv = classify("/w/a.csv", "a.csv".into(), vec![b'h', 0xe9]);
        assert_eq!(csv, Prepared::Attachment { uri: "data:text/csv;base64,aOk=".into(), name: "a.csv".into() });
        assert!(is_binary(&[1, 2, 3, b'a']));
        assert!(!is_binary(b"\t\r\n"));
    }

    #[cfg(unix)]
    #[test]
    fn a_non_utf8_directory_reads_its_own_file() {
        use std::os::unix::ffi::OsStrExt;
        // A lossy directory name would be the second one, which holds another `notes.txt`.
        let dir = opencode_util::temp::tempdir().unwrap();
        let selected = dir.path().join(std::ffi::OsStr::from_bytes(b"sample-\xff"));
        let other = dir.path().join("sample-\u{fffd}");
        for (directory, text) in [(&selected, "selected"), (&other, "other")] {
            std::fs::create_dir(directory).unwrap();
            std::fs::write(directory.join("notes.txt"), text).unwrap();
        }
        let expected = Prepared::Text("<file name=\"notes.txt\">\nselected\n</file>".into());
        assert_eq!(prepare("notes.txt", &selected), Ok(expected));
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_fails_without_a_writer_and_a_symlink_attaches() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let root = dir.path().to_owned();
        assert!(std::process::Command::new("mkfifo").arg(root.join("attachment.txt")).status().unwrap().success());
        std::fs::write(root.join("context.txt"), "attached context").unwrap();
        std::os::unix::fs::symlink(root.join("context.txt"), root.join("linked.txt")).unwrap();
        // A blocking open would wait for a writer forever; the thread lets the test fail instead of hang.
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || sender.send(prepare("attachment.txt", &root)).unwrap());
        let fifo = receiver.recv_timeout(std::time::Duration::from_secs(10)).expect("the FIFO open blocked");
        assert_eq!(
            fifo,
            Err("Cannot attach a directory, special file, or file larger than 10 MiB: attachment.txt".into())
        );
        let expected = Prepared::Text("<file name=\"linked.txt\">\nattached context\n</file>".into());
        assert_eq!(prepare("linked.txt", dir.path()), Ok(expected));
    }

    #[test]
    fn paths_resolve_like_node() {
        let p = Flavor::Posix;
        assert_eq!(resolve(p, Path::new("/w/x"), "../a/./b.txt"), Path::new("/w/a/b.txt"));
        assert_eq!(resolve(p, Path::new("/w"), "/abs/c"), Path::new("/abs/c"));
        let w = Flavor::Windows;
        assert_eq!(resolve(w, Path::new("C:\\w\\x"), "../a/./b.txt"), Path::new("C:\\w\\a\\b.txt"));
        assert_eq!(resolve(w, Path::new("C:\\w"), "D:/abs\\c"), Path::new("D:\\abs\\c"));
        assert_eq!(opencode_util::mime::lookup(w, "C:\\a.b\\Makefile"), None);
        assert_eq!(opencode_util::mime::lookup(w, "C:\\a\\b.png"), Some("image/png"));
    }
}
