//! Clipboard and paste text rules shared by the TUI and mini (`clipboard.ts:24-52`, `decodePasteBytes`,
//! `stripAnsiSequences`).

use std::sync::LazyLock;

use base64::Engine;
use opentui::native::ClipboardOutcome;
use regex::Regex;

/// The clipboard as `clipboard.read` returns it.
#[derive(Clone, Debug, PartialEq)]
pub enum Content {
    /// Base64 image data.
    Image {
        mime: String,
        data: String,
    },
    Text(String),
}

/// `clipboard.read`: PNG as base64, text decoded (nothing for empty text); failed, timed-out, and
/// oversized reads are errors.
pub fn content(outcome: ClipboardOutcome) -> Result<Option<Content>, String> {
    match outcome {
        ClipboardOutcome::Read { mime_type, data } => match mime_type.as_str() {
            "image/png" => Ok(Some(Content::Image {
                data: base64::engine::general_purpose::STANDARD.encode(&data),
                mime: mime_type,
            })),
            "text/plain" if data.is_empty() => Ok(None),
            "text/plain" => Ok(Some(Content::Text(decode_paste_bytes(&data)))),
            other => Err(format!("Unexpected clipboard MIME type: {other}")),
        },
        ClipboardOutcome::Failed { message, .. } => Err(message),
        ClipboardOutcome::TimedOut => Err("Clipboard read timed out".to_owned()),
        ClipboardOutcome::LimitExceeded => {
            Err("Clipboard content exceeded configured read or image conversion limits".to_owned())
        }
        _ => Ok(None),
    }
}

/// `decodePasteBytes`: `TextDecoder` without `fatal`, which also drops a leading BOM.
pub fn decode_paste_bytes(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned()
}

/// `stripAnsiSequences`: ECMA-48 control sequences and strings in ESC and C1 form, cut-off ones too.
pub fn strip_ansi(text: &str) -> String {
    static ANSI: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?:\x1b\[|\x9b)[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]?|(?:\x1b[P\]X^_]|[\x90\x98\x9d-\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[\x20-\x2f]*[\x30-\x7e]?",
        )
        .expect("the ANSI pattern compiles")
    });
    ANSI.replace_all(text, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_outcomes_map_as_typescript_reads_them() {
        let read = |mime: &str, data: &[u8]| ClipboardOutcome::Read { mime_type: mime.into(), data: data.to_vec() };
        assert_eq!(
            content(read("image/png", b"\x89PNG")),
            Ok(Some(Content::Image { mime: "image/png".into(), data: "iVBORw==".into() }))
        );
        assert_eq!(
            content(read("text/plain", "\u{feff}hé\u{ff}".as_bytes())),
            Ok(Some(Content::Text("hé\u{ff}".into())))
        );
        assert_eq!(content(read("text/plain", b"")), Ok(None));
        assert_eq!(content(read("text/plain", b"a\xffb")), Ok(Some(Content::Text("a\u{fffd}b".into()))));
        assert_eq!(content(read("text/html", b"<b>")), Err("Unexpected clipboard MIME type: text/html".into()));
        assert_eq!(content(ClipboardOutcome::TimedOut), Err("Clipboard read timed out".into()));
        assert!(content(ClipboardOutcome::LimitExceeded).is_err());
        assert_eq!(
            content(ClipboardOutcome::Failed { code: 1, message: "no display".into() }),
            Err("no display".into())
        );
        for quiet in [ClipboardOutcome::Empty, ClipboardOutcome::Unsupported, ClipboardOutcome::Cancelled] {
            assert_eq!(content(quiet), Ok(None));
        }
    }

    #[test]
    fn ansi_sequences_are_stripped_like_core() {
        assert_eq!(strip_ansi("\x1b[1;31mred\x1b[0m ok"), "red ok");
        assert_eq!(strip_ansi("\x1b]0;title\x07text"), "text");
        assert_eq!(strip_ansi("\x1b]8;;http://x\x1b\\link"), "link");
        assert_eq!(strip_ansi("a\x1b(Bb"), "ab");
        assert_eq!(strip_ansi("cut\x1b["), "cut");
        assert_eq!(strip_ansi("\u{9b}31mc1"), "c1");
        assert_eq!(strip_ansi("lone\x1b"), "lone");
    }
}
