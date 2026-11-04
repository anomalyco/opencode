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
#[derive(Default)]
pub struct Decoder {
    /// Normalized text after the last complete block.
    buffer: String,
    /// `buffer` length in UTF-16 code units.
    units: usize,
    /// Bytes of an incomplete UTF-8 sequence at the end of the last chunk.
    partial: Vec<u8>,
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
        let text = self.decode(chunk, false);
        self.append(text, false)
    }

    /// Ends the stream: an unterminated last block still counts, as in the TypeScript reader.
    pub fn finish(&mut self) -> Result<Vec<String>, Error> {
        let text = self.decode(&[], true);
        self.append(text, true)
    }

    fn append(&mut self, text: String, done: bool) -> Result<Vec<String>, Error> {
        let raw_units = text.encode_utf16().count() + usize::from(self.carriage_return);
        if self.units + raw_units > MAX_EVENT_UNITS {
            return Err(Error::EventTooLarge);
        }
        let mut text = if self.carriage_return {
            format!("\r{text}")
        } else {
            text
        };
        self.carriage_return = !done && text.ends_with('\r');
        if self.carriage_return {
            text.pop();
        }
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        // A boundary may span the old buffer and the new text, so search from the last old character.
        let mut from = self.buffer.len().saturating_sub(1);
        self.units += normalized.encode_utf16().count();
        self.buffer.push_str(&normalized);
        if done && !self.buffer.is_empty() {
            self.buffer.push_str("\n\n");
            self.units += 2;
        }

        let mut payloads = Vec::new();
        let mut start = 0;
        while let Some(offset) = self.buffer[from..].find("\n\n") {
            let end = from + offset;
            let block = &self.buffer[start..end];
            self.units -= block.encode_utf16().count() + 2;
            let data = block
                .split('\n')
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|value| {
                    value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                payloads.push(data);
            }
            start = end + 2;
            from = start;
        }
        self.buffer.drain(..start);
        Ok(payloads)
    }

    /// UTF-8 decoding like `TextDecoder` with `stream`: a split code point waits for the next chunk,
    /// invalid bytes become U+FFFD, and a leading BOM is dropped.
    fn decode(&mut self, chunk: &[u8], done: bool) -> String {
        let mut bytes = std::mem::take(&mut self.partial);
        bytes.extend_from_slice(chunk);
        let mut text = String::with_capacity(bytes.len());
        let mut rest = bytes.as_slice();
        loop {
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    text.push_str(valid);
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    text.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match error.error_len() {
                        Some(length) => {
                            text.push('\u{fffd}');
                            rest = &after[length..];
                        }
                        None if done => {
                            text.push('\u{fffd}');
                            break;
                        }
                        None => {
                            self.partial = after.to_vec();
                            break;
                        }
                    }
                }
            }
        }
        if !self.started && !text.is_empty() {
            self.started = true;
            if let Some(stripped) = text.strip_prefix('\u{feff}') {
                return stripped.to_owned();
            }
        }
        text
    }
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
