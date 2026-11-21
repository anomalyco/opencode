//! The event stream reader (`sse::events`), as the TypeScript client's.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use bytes::Bytes;
use futures_util::StreamExt;
use opencode_api::sse::{Error, events};
use serde_json::{Value, json};

/// The events of a body and how many times it signaled activity.
async fn read(chunks: Vec<Result<Vec<u8>, &'static str>>) -> (Vec<Result<Value, Error>>, usize) {
    let activity = Arc::new(AtomicUsize::new(0));
    let counter = activity.clone();
    let body = futures_util::stream::iter(chunks.into_iter().map(|chunk| chunk.map(Bytes::from)));
    let events = events(body, move || {
        counter.fetch_add(1, Ordering::SeqCst);
    });
    (events.collect().await, activity.load(Ordering::SeqCst))
}

/// Every split of a stream reads as the whole: a leading BOM, CRLF, CR and LF line ends, heartbeat comments, fields
/// other than `data` (a volatile stream must not ask for a replay), joined `data` lines, multibyte characters and a
/// ZWJ sequence cut anywhere, invalid UTF-8 and a lone surrogate escape as U+FFFD, and a last event the body ends
/// without a blank line. Every chunk counts as activity, a heartbeat too.
#[tokio::test]
async fn every_split_of_a_stream_reads_as_the_whole() {
    let mut stream = "\u{feff}data: 0\n\n: heartbeat\r\n\r\nid: 7\nevent: x\nretry: 5\ndata: {\"a\":\r\ndata:  \"é▀😀👩\u{200d}💻\"}\r\r"
        .as_bytes()
        .to_vec();
    stream.extend(b"data: {\"b\": \"\xff\\ud83d\"}\n\n: heartbeat\n\ndata: {\"c\": \"\xe2\x98\"}");
    let expected = vec![
        Ok(json!(0)),
        Ok(json!({ "a": "é▀😀👩\u{200d}💻" })),
        Ok(json!({ "b": "\u{fffd}\u{fffd}" })),
        Ok(json!({ "c": "\u{fffd}" })),
    ];
    assert_eq!(read(vec![Ok(stream.clone())]).await, (expected.clone(), 1));
    for split in 1..stream.len() {
        let (first, second) = stream.split_at(split);
        let chunks = vec![Ok(first.to_vec()), Ok(second.to_vec())];
        assert_eq!(read(chunks).await, (expected.clone(), 2), "split at byte {split}");
    }
    let bytes = stream.iter().map(|byte| Ok(vec![*byte])).collect();
    assert_eq!(read(bytes).await, (expected, stream.len()));
}

/// A malformed payload, a failed read or an event over the size limit ends the stream with its error, after the events
/// before it. U+0085 is not white space to `trimStart`.
#[tokio::test]
async fn an_error_ends_the_stream() {
    let (events, _) = read(vec![Ok("data: {}\n\ndata:\u{85}{}\n\n".into()), Ok(b"data: {}\n\n".to_vec())]).await;
    assert!(matches!(&events[..], [Ok(_), Err(Error::MalformedResponse(_))]), "{events:?}");
    let chunks = vec![Ok(b"data: {}\n\n".to_vec()), Err("contract failure"), Ok(b"data: {}\n\n".to_vec())];
    let (events, _) = read(chunks).await;
    assert_eq!(events, [Ok(json!({})), Err(Error::Transport("contract failure".into()))]);
    assert_eq!(events[1].as_ref().unwrap_err().to_string(), "Transport: contract failure");
    let (events, _) = read(vec![Ok(format!("data: {}", "x".repeat(16 * 1024 * 1024)).into_bytes())]).await;
    assert_eq!(events, [Err(Error::EventTooLarge)]);
}
