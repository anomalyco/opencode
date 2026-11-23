use base64::Engine;
use opentui::input::decode_paste_bytes;
use opentui::native::ClipboardOutcome;

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

/// `clipboard.read`: PNG as base64, text decoded (nothing for empty text); failed, timed-out, unsupported, and
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
        ClipboardOutcome::Unsupported => Err("Clipboard read is not supported on this system".to_owned()),
        ClipboardOutcome::LimitExceeded => {
            Err("Clipboard content exceeded configured read or image conversion limits".to_owned())
        }
        _ => Ok(None),
    }
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
            content(ClipboardOutcome::Unsupported),
            Err("Clipboard read is not supported on this system".into())
        );
        assert_eq!(
            content(ClipboardOutcome::Failed { code: 1, message: "no display".into() }),
            Err("no display".into())
        );
        for quiet in [ClipboardOutcome::Empty, ClipboardOutcome::Cancelled] {
            assert_eq!(content(quiet), Ok(None));
        }
    }
}
