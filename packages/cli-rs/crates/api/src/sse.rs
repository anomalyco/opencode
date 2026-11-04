//! Server-sent events reader (F.3).
//!
//! A port of the SSE reader of the generated TypeScript client
//! (`packages/client/src/promise/generated/client.ts:417-473`): blocks end at a blank line, `data:` lines
//! join with newlines, CRLF and CR normalize to LF, comments and other fields are ignored, and the
//! buffered text may not exceed 16 MiB (counted in UTF-16 code units, as JavaScript counts
//! `string.length`). Each received chunk, keepalive comments included, reports activity.

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

/// Decodes a stream of body chunks into `data:` payloads.
///
/// It buffers raw bytes and splits lines on the LF, CRLF and CR bytes, which never occur inside a
/// UTF-8 sequence, so only complete lines are decoded and a code point split across chunks waits for
/// the rest of its line. Decoding a complete line with replacement gives the same text as the
/// TypeScript streaming `TextDecoder`.
#[derive(Default)]
pub struct Decoder {
    /// Bytes of the unterminated last line.
    line: Vec<u8>,
    /// `line` length in UTF-16 code units.
    line_units: usize,
    /// `data:` values of the open block.
    data: Vec<String>,
    /// Length of the open block's complete lines, newlines included, in UTF-16 code units.
    block_units: usize,
    /// A trailing CR held back because the next chunk may start with LF.
    carriage_return: bool,
    started: bool,
}

impl Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a chunk and returns the payloads of the blocks it completes.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, Error> {
        // As the TypeScript reader, check the open text plus the raw chunk before normalizing it.
        let open = self.block_units + self.line_units + usize::from(self.carriage_return);
        if open + utf16_units(chunk) > MAX_EVENT_UNITS {
            return Err(Error::EventTooLarge);
        }
        let mut payloads = Vec::new();
        let mut rest = chunk;
        if self.carriage_return && !rest.is_empty() {
            self.carriage_return = false;
            rest = rest.strip_prefix(b"\n").unwrap_or(rest);
            self.end_line(&mut payloads);
        }
        while let Some(index) = rest.iter().position(|byte| matches!(byte, b'\n' | b'\r')) {
            self.extend_line(&rest[..index]);
            let crlf = rest[index] == b'\r' && rest.get(index + 1) == Some(&b'\n');
            if rest[index] == b'\r' && index + 1 == rest.len() {
                self.carriage_return = true;
                return Ok(payloads);
            }
            rest = &rest[index + 1 + usize::from(crlf)..];
            self.end_line(&mut payloads);
        }
        self.extend_line(rest);
        Ok(payloads)
    }

    /// Ends the stream: an unterminated last block still counts, as in the TypeScript reader.
    pub fn finish(&mut self) -> Result<Vec<String>, Error> {
        let mut payloads = Vec::new();
        if std::mem::take(&mut self.carriage_return) || !self.line.is_empty() {
            self.end_line(&mut payloads);
        }
        self.dispatch(&mut payloads);
        Ok(payloads)
    }

    fn extend_line(&mut self, bytes: &[u8]) {
        self.line.extend_from_slice(bytes);
        self.line_units += utf16_units(bytes);
    }

    /// Decodes the buffered line: an empty one ends the block, a `data:` line adds to it.
    fn end_line(&mut self, payloads: &mut Vec<String>) {
        let mut bytes = std::mem::take(&mut self.line);
        if !std::mem::replace(&mut self.started, true) && bytes.starts_with(b"\xef\xbb\xbf") {
            bytes.drain(..3);
        }
        if bytes.is_empty() {
            self.line_units = 0;
            self.dispatch(payloads);
            return;
        }
        self.block_units += std::mem::take(&mut self.line_units) + 1;
        let line = String::from_utf8_lossy(&bytes);
        if let Some(value) = line.strip_prefix("data:") {
            let value = value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
            self.data.push(value.to_owned());
        }
    }

    fn dispatch(&mut self, payloads: &mut Vec<String>) {
        self.block_units = 0;
        let data = std::mem::take(&mut self.data).join("\n");
        if !data.is_empty() {
            payloads.push(data);
        }
    }
}

/// UTF-16 code units of UTF-8 bytes, counted per lead byte so a split code point counts once.
fn utf16_units(bytes: &[u8]) -> usize {
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
pub fn events<T, S, E>(
    body: S,
    activity: impl FnMut() + Send + 'static,
) -> impl Stream<Item = Result<T, Error>> + Send
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
    let state = State {
        body,
        activity,
        decoder: Decoder::new(),
        ready: VecDeque::new(),
        ended: false,
    };
    futures_util::stream::unfold(state, |mut state| async move {
        loop {
            if let Some(data) = state.ready.pop_front() {
                let item = serde_json::from_str(&data)
                    .map_err(|error| Error::MalformedResponse(error.to_string()));
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
                    state.decoder.push(&chunk)
                }
                Some(Err(error)) => Err(Error::Transport(error.to_string())),
                None => {
                    state.ended = true;
                    state.decoder.finish()
                }
            };
            match decoded {
                Ok(payloads) => state.ready.extend(payloads),
                Err(error) => {
                    state.ended = true;
                    return Some((Err(error), state));
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn body(chunks: Vec<Vec<u8>>) -> impl Stream<Item = Result<Bytes, String>> + Send + Unpin {
        futures_util::stream::iter(chunks.into_iter().map(|chunk| Ok(Bytes::from(chunk))))
    }

    fn frame(event: &Value) -> String {
        format!("data: {event}\n\n")
    }

    async fn collect(chunks: Vec<Vec<u8>>) -> Vec<Result<Value, Error>> {
        events(body(chunks), || {}).collect().await
    }

    fn connected(id: &str) -> Value {
        json!({ "id": id, "created": 1, "type": "server.connected", "data": {} })
    }

    #[tokio::test]
    async fn exposes_the_event_stream_wire_projection() {
        let selected = json!({ "id": "evt_model", "created": 1_717_171_717_000_i64, "type": "session.model.selected", "data": {} });
        let text = format!(
            ": heartbeat\n\n{}{}",
            frame(&connected("evt_connected")),
            frame(&selected)
        );
        let received = collect(vec![text.into_bytes()]).await;
        assert_eq!(received, vec![Ok(connected("evt_connected")), Ok(selected)]);
    }

    #[tokio::test]
    async fn delivers_every_event_from_one_chunk() {
        let events = (0..4)
            .map(|index| connected(&format!("evt_burst_{index}")))
            .collect::<Vec<_>>();
        let text = events.iter().map(frame).collect::<String>();
        let received = collect(vec![text.into_bytes()]).await;
        assert_eq!(received, events.into_iter().map(Ok).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn parses_split_json_and_a_split_multibyte_code_point() {
        let event = json!({ "id": "evt_split", "created": 1, "type": "server.connected", "data": { "text": "split snowman \u{2603}\u{2603}\u{2603}" } });
        let encoded = frame(&event).into_bytes();
        let multibyte = encoded
            .iter()
            .position(|byte| *byte == "\u{2603}".as_bytes()[0])
            .unwrap();
        let boundaries = [9, multibyte + 1, multibyte + 2, encoded.len()];
        let chunks = boundaries
            .iter()
            .enumerate()
            .map(|(index, end)| {
                encoded[if index == 0 { 0 } else { boundaries[index - 1] }..*end].to_vec()
            })
            .collect();
        assert_eq!(collect(chunks).await, vec![Ok(event)]);
    }

    #[tokio::test]
    async fn ignores_heartbeat_comments() {
        let text = format!(
            ": heartbeat\n\n{}: heartbeat\n\n",
            frame(&connected("evt_sentinel"))
        );
        assert_eq!(
            collect(vec![text.into_bytes()]).await,
            vec![Ok(connected("evt_sentinel"))]
        );
    }

    #[tokio::test]
    async fn reports_heartbeat_comments_as_activity() {
        let activity = Arc::new(AtomicUsize::new(0));
        let counter = activity.clone();
        let chunks = vec![
            b": heartbeat\n\n".to_vec(),
            frame(&connected("evt_sentinel")).into_bytes(),
            b": heartbeat\n\n".to_vec(),
        ];
        let received: Vec<Result<Value, Error>> = events(body(chunks), move || {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .collect()
        .await;
        assert_eq!(received, vec![Ok(connected("evt_sentinel"))]);
        assert_eq!(activity.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn terminates_on_malformed_data() {
        let received = collect(vec![b"data: {not-json}\n\ndata: {}\n\n".to_vec()]).await;
        assert_eq!(received.len(), 1);
        assert!(matches!(received[0], Err(Error::MalformedResponse(_))));
    }

    #[tokio::test]
    async fn accepts_a_fragmented_event_below_the_size_limit() {
        let event = json!({ "id": "evt_large", "type": "test.large", "data": { "output": "x".repeat(12 * 1024 * 1024) } });
        let encoded = frame(&event).into_bytes();
        let chunks = encoded.chunks(64 * 1024).map(<[u8]>::to_vec).collect();
        assert_eq!(collect(chunks).await, vec![Ok(event)]);
    }

    #[tokio::test]
    async fn rejects_an_event_above_the_size_limit() {
        let text = format!(
            "data: {}",
            json!({ "output": "x".repeat(16 * 1024 * 1024) })
        );
        assert_eq!(
            collect(vec![text.into_bytes()]).await,
            vec![Err(Error::EventTooLarge)]
        );
    }

    #[tokio::test]
    async fn a_transport_failure_ends_the_stream() {
        let chunks = futures_util::stream::iter(vec![
            Ok(Bytes::from(frame(&connected("evt_1")))),
            Err("contract failure".to_owned()),
        ]);
        let received: Vec<Result<Value, Error>> = events(chunks, || {}).collect().await;
        assert_eq!(
            received,
            vec![
                Ok(connected("evt_1")),
                Err(Error::Transport("contract failure".into()))
            ]
        );
        assert_eq!(
            received[1].as_ref().unwrap_err().to_string(),
            "Transport: contract failure"
        );
    }

    // solid-connection.test.ts "a reconnect does not ask the volatile event stream to replay": the reader
    // keeps no `id:` field, so nothing can send a Last-Event-ID.
    #[test]
    fn ignores_fields_other_than_data() {
        let mut decoder = Decoder::new();
        let payloads = decoder
            .push(b"id: timeline-event-7\nevent: x\nretry: 5\ndata: {}\n\n")
            .unwrap();
        assert_eq!(payloads, vec!["{}"]);
    }

    #[test]
    fn normalizes_crlf_and_cr_across_chunks() {
        let mut decoder = Decoder::new();
        assert_eq!(decoder.push(b"data: 1\r").unwrap(), Vec::<String>::new());
        assert_eq!(decoder.push(b"\n\r").unwrap(), Vec::<String>::new());
        assert_eq!(
            decoder.push(b"\ndata: 2\r\rdata: 3\n").unwrap(),
            vec!["1", "2"]
        );
        assert_eq!(decoder.finish().unwrap(), vec!["3"]);
    }

    #[test]
    fn joins_data_lines_and_drops_a_leading_bom() {
        let mut decoder = Decoder::new();
        let payloads = decoder
            .push("\u{feff}data:a\ndata:  b\n\n".as_bytes())
            .unwrap();
        assert_eq!(payloads, vec!["a\nb"]);
    }

    // rs-ms1-accept problem 1: a chunk that ended in a multibyte character panicked on the next chunk.
    #[test]
    fn a_buffer_ending_in_a_multibyte_character_takes_the_next_chunk() {
        let mut decoder = Decoder::new();
        assert_eq!(
            decoder.push("data: \u{2580}".as_bytes()).unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(decoder.push(b"x\n\n").unwrap(), vec!["\u{2580}x"]);
    }

    #[test]
    fn every_split_of_a_multibyte_character_decodes_as_one_chunk() {
        let characters = [
            "\u{e9}",                     // 2 bytes
            "\u{2580}",                   // 3 bytes
            "\u{1f600}",                  // 4 bytes
            "\u{1f469}\u{200d}\u{1f4bb}", // ZWJ sequence
        ];
        let read = |chunks: &[&[u8]]| {
            let mut decoder = Decoder::new();
            let mut payloads = chunks
                .iter()
                .flat_map(|chunk| decoder.push(chunk).unwrap())
                .collect::<Vec<_>>();
            payloads.extend(decoder.finish().unwrap());
            payloads
        };
        for character in characters {
            let text = format!(
                "data: {{\"text\":\"{character}\"}}\n\ndata: a{character}\r\ndata: {character}{character}\r\n\r\ndata: {character}"
            );
            let bytes = text.as_bytes();
            let whole = read(&[bytes]);
            assert_eq!(whole.len(), 3, "{character}");
            for split in 1..bytes.len() {
                let (first, second) = bytes.split_at(split);
                assert_eq!(
                    read(&[first, second]),
                    whole,
                    "{character} split at byte {split}"
                );
            }
        }
    }

    #[test]
    fn invalid_utf8_becomes_a_replacement_character() {
        let mut decoder = Decoder::new();
        assert_eq!(decoder.push(b"data: \xff\n\n").unwrap(), vec!["\u{fffd}"]);
        assert_eq!(
            decoder.push(b"data: \xe2\x98").unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(decoder.finish().unwrap(), vec!["\u{fffd}"]);
    }

    #[test]
    fn the_size_limit_counts_utf16_units_of_the_open_event() {
        // 4-byte code points are 2 UTF-16 units each, so this is 2 units per 4 bytes.
        let mut decoder = Decoder::new();
        let emoji = "\u{1f600}".repeat(MAX_EVENT_UNITS / 2 - 3);
        assert!(decoder.push(format!("data:{emoji}").as_bytes()).is_ok());
        assert_eq!(decoder.push(b"xx"), Err(Error::EventTooLarge));
        // Completed blocks no longer count.
        let mut decoder = Decoder::new();
        let half = "x".repeat(MAX_EVENT_UNITS / 2);
        assert!(decoder.push(format!("data:{half}\n\n").as_bytes()).is_ok());
        assert!(decoder.push(format!("data:{half}\n\n").as_bytes()).is_ok());
    }
}
