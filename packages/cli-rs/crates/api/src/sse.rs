//! SSE `data:` lines join with newlines; blank lines end a block. The 16 MiB buffer limit counts UTF-16 code units.
//! Every chunk, including a keepalive, signals activity.

use std::collections::VecDeque;
use std::fmt;

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use serde::de::DeserializeOwned;

/// The largest buffered event, as `maxSseEventBytes` in the TypeScript client.
pub const MAX_EVENT_UNITS: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// Reading the body failed. Displays as the TypeScript `ClientError` does: `Transport: <cause>`.
    #[error("Transport: {0}")]
    Transport(String),
    /// A `data:` payload is not valid JSON for the event type.
    #[error("MalformedResponse: {0}")]
    MalformedResponse(String),
    #[error("SseEventTooLarge")]
    EventTooLarge,
}

/// Buffers bytes until a complete line is available, so a UTF-8 code point split across chunks is decoded only once.
#[derive(Default)]
pub struct Decoder {
    /// Bytes of the unterminated last line.
    line: Vec<u8>,
    /// `data:` values of the open block, joined with newlines.
    data: String,
    /// Whether the open block has a `data:` line, so an empty value still adds a newline.
    has_data: bool,
    /// Length of the open block's complete lines, newlines included, in bytes.
    block_bytes: usize,
    /// The same length in UTF-16 code units.
    block_units: usize,
    /// A trailing CR held back because the next chunk may start with LF.
    carriage_return: bool,
    started: bool,
}

impl Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a chunk and appends the payloads of the blocks it completes to `payloads`.
    pub fn push(&mut self, chunk: &[u8], payloads: &mut VecDeque<String>) -> Result<(), Error> {
        // As the TypeScript reader, check the open text plus the raw chunk before normalizing it. A UTF-16
        // unit count never exceeds the byte count, so the units are counted only when the bytes pass the limit.
        let carriage_return = usize::from(self.carriage_return);
        if self.block_bytes + self.line.len() + carriage_return + chunk.len() > MAX_EVENT_UNITS
            && self.block_units + utf16_units(&self.line) + carriage_return + utf16_units(chunk) > MAX_EVENT_UNITS
        {
            return Err(Error::EventTooLarge);
        }
        let mut rest = chunk;
        if self.carriage_return && !rest.is_empty() {
            self.carriage_return = false;
            rest = rest.strip_prefix(b"\n").unwrap_or(rest);
            self.end_line(&[], payloads);
        }
        while let Some(index) = memchr::memchr2(b'\n', b'\r', rest) {
            if rest[index] == b'\r' && index + 1 == rest.len() {
                self.line.extend_from_slice(&rest[..index]);
                self.carriage_return = true;
                return Ok(());
            }
            let crlf = rest[index] == b'\r' && rest[index + 1] == b'\n';
            self.end_line(&rest[..index], payloads);
            rest = &rest[index + 1 + usize::from(crlf)..];
        }
        self.line.extend_from_slice(rest);
        Ok(())
    }

    /// Ends the stream: an unterminated last block still counts, as in the TypeScript reader.
    pub fn finish(&mut self, payloads: &mut VecDeque<String>) {
        if std::mem::take(&mut self.carriage_return) || !self.line.is_empty() {
            self.end_line(&[], payloads);
        }
        self.dispatch(payloads);
    }

    /// Ends the line made of the buffered bytes and `tail`, keeping the buffer's capacity.
    fn end_line(&mut self, tail: &[u8], payloads: &mut VecDeque<String>) {
        if self.line.is_empty() {
            return self.decode_line(tail, payloads);
        }
        let mut line = std::mem::take(&mut self.line);
        line.extend_from_slice(tail);
        self.decode_line(&line, payloads);
        line.clear();
        self.line = line;
    }

    /// Decodes a complete line: an empty one ends the block, a `data:` line adds to it.
    fn decode_line(&mut self, line: &[u8], payloads: &mut VecDeque<String>) {
        let mut bytes = line;
        if !std::mem::replace(&mut self.started, true) {
            bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
        }
        if bytes.is_empty() {
            self.dispatch(payloads);
            return;
        }
        self.block_bytes += line.len() + 1;
        self.block_units += utf16_units(line) + 1;
        // The prefix is ASCII, so decoding only the value gives the same text as decoding the whole line.
        if let Some(value) = bytes.strip_prefix(b"data:") {
            let value = String::from_utf8_lossy(value);
            if std::mem::replace(&mut self.has_data, true) {
                self.data.push('\n');
            }
            self.data.push_str(value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}'));
        }
    }

    fn dispatch(&mut self, payloads: &mut VecDeque<String>) {
        self.block_bytes = 0;
        self.block_units = 0;
        self.has_data = false;
        if !self.data.is_empty() {
            payloads.push_back(std::mem::take(&mut self.data));
        }
    }
}

/// UTF-16 code units of UTF-8 bytes, counted per lead byte so a split code point counts once.
fn utf16_units(bytes: &[u8]) -> usize {
    if bytes.is_ascii() {
        return bytes.len();
    }
    bytes
        .iter()
        .map(|byte| match byte {
            0x80..=0xbf => 0,
            0xf0.. => 2,
            _ => 1,
        })
        .sum()
}

/// Decodes a response body into events. `activity` runs for every chunk, including keepalive comments
/// that yield no event. The stream ends after the first error.
pub fn events<T, S, E>(body: S, activity: impl FnMut() + Send + 'static) -> impl Stream<Item = Result<T, Error>> + Send
where
    T: DeserializeOwned + Send,
    S: Stream<Item = Result<Bytes, E>> + Send + Unpin,
    E: fmt::Display,
{
    struct State<S, A> {
        body: S,
        activity: A,
        decoder: Decoder,
        ready: VecDeque<String>,
        ended: bool,
    }
    let state = State { body, activity, decoder: Decoder::new(), ready: VecDeque::new(), ended: false };
    futures_util::stream::unfold(state, |mut state| async move {
        loop {
            if let Some(data) = state.ready.pop_front() {
                let item = serde_json::from_str(&data).map_err(|error| Error::MalformedResponse(error.to_string()));
                if item.is_err() {
                    state.ended = true;
                    state.ready.clear();
                }
                return Some((item, state));
            }
            if state.ended {
                return None;
            }
            let decoded = match state.body.next().await {
                Some(Ok(chunk)) => {
                    (state.activity)();
                    state.decoder.push(&chunk, &mut state.ready)
                }
                Some(Err(error)) => Err(Error::Transport(error.to_string())),
                None => {
                    state.ended = true;
                    state.decoder.finish(&mut state.ready);
                    Ok(())
                }
            };
            if let Err(error) = decoded {
                state.ended = true;
                return Some((Err(error), state));
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push(decoder: &mut Decoder, chunk: &[u8]) -> Result<Vec<String>, Error> {
        let mut payloads = VecDeque::new();
        decoder.push(chunk, &mut payloads).map(|()| payloads.into())
    }

    #[test]
    fn the_size_limit_counts_utf16_units_of_the_open_event() {
        // 4-byte code points are 2 UTF-16 units each, so this is 2 units per 4 bytes.
        let mut decoder = Decoder::new();
        let emoji = "\u{1f600}".repeat(MAX_EVENT_UNITS / 2 - 3);
        assert!(push(&mut decoder, format!("data:{emoji}").as_bytes()).is_ok());
        assert_eq!(push(&mut decoder, b"xx"), Err(Error::EventTooLarge));
        // Completed blocks no longer count.
        let mut decoder = Decoder::new();
        let half = "x".repeat(MAX_EVENT_UNITS / 2);
        assert!(push(&mut decoder, format!("data:{half}\n\n").as_bytes()).is_ok());
        assert!(push(&mut decoder, format!("data:{half}\n\n").as_bytes()).is_ok());
    }

    #[test]
    fn a_chunk_that_reaches_the_limit_exactly_is_accepted() {
        // A complete line, an open line, and a held CR count; the CR brings the open event to the limit.
        let quarter = MAX_EVENT_UNITS / 4;
        let mut decoder = Decoder::new();
        assert!(push(&mut decoder, format!("data:{}\n", "x".repeat(quarter - 6)).as_bytes()).is_ok());
        assert!(push(&mut decoder, format!("data:{}", "x".repeat(MAX_EVENT_UNITS - quarter - 6)).as_bytes()).is_ok());
        assert_eq!(push(&mut decoder, b"\r"), Ok(Vec::new()));
        assert_eq!(push(&mut decoder, b"\n"), Err(Error::EventTooLarge));
        // Past the limit in bytes but not in units: 2-byte code points are 1 unit each.
        let mut decoder = Decoder::new();
        assert!(push(&mut decoder, format!("data:{}\n", "\u{e9}".repeat(quarter * 2 - 6)).as_bytes()).is_ok());
        let rest = MAX_EVENT_UNITS - quarter * 2 - 5;
        let open = format!("data:{}", "\u{e9}".repeat(rest));
        let (first, second) = open.as_bytes().split_at(open.len() / 2 + 1);
        assert!(push(&mut decoder, first).is_ok());
        assert!(push(&mut decoder, second).is_ok());
        assert_eq!(push(&mut decoder, b"\n"), Err(Error::EventTooLarge));
    }
}
