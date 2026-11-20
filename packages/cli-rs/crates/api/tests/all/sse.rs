//! The event stream reader (`sse::events`), as the TypeScript client's.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use bytes::Bytes;
use futures_util::StreamExt;
use opencode_api::sse::{Error, events};
use opencode_util::rng::SplitMix64;
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

/// A malformed payload, a failed read or an event over the size limit ends the stream with its error, after the events
/// before it.
#[tokio::test]
async fn an_error_ends_the_stream() {
    let (events, _) = read(vec![Ok(b"data: {}\n\ndata: {not-json}\n\n".to_vec()), Ok(b"data: {}\n\n".to_vec())]).await;
    assert!(matches!(&events[..], [Ok(_), Err(Error::MalformedResponse(_))]), "{events:?}");
    let chunks = vec![Ok(b"data: {}\n\n".to_vec()), Err("contract failure"), Ok(b"data: {}\n\n".to_vec())];
    let (events, _) = read(chunks).await;
    assert_eq!(events, [Ok(json!({})), Err(Error::Transport("contract failure".into()))]);
    assert_eq!(events[1].as_ref().unwrap_err().to_string(), "Transport: contract failure");
    let (events, _) = read(vec![Ok(format!("data: {}", "x".repeat(16 * 1024 * 1024)).into_bytes())]).await;
    assert_eq!(events, [Err(Error::EventTooLarge)]);
}

/// Generated streams, cut into chunks anywhere, read as the TypeScript client reads them: payloads of nested JSON with
/// multibyte text, escapes and surrogates, `data` lines split at the payload's newlines, every line end, comments and
/// other fields, odd leading whitespace, invalid UTF-8, malformed payloads and empty chunks. `MODEL_SEED` and
/// `MODEL_CASES` widen the search; it skips without Bun.
#[test]
fn generated_streams_read_as_in_typescript() {
    let Some(root) = ts_root() else { return };
    let mut rng = SplitMix64(env("MODEL_SEED", 1));
    let cases: Vec<Vec<Vec<u8>>> = (0..env("MODEL_CASES", 300)).map(|_| chunks(&mut rng)).collect();
    let input: String = cases
        .iter()
        .map(|chunks| {
            let encoded: Vec<String> = chunks.iter().map(|chunk| STANDARD.encode(chunk)).collect();
            format!("{}\n", json!({ "chunks": encoded }))
        })
        .collect();
    let expected = bun(&root, "F.2-sse.ts", &input);
    assert_eq!(expected.lines().count(), cases.len());
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let (mut read_events, mut errors) = (0, 0);
    for (chunks, expected) in cases.iter().zip(expected.lines()) {
        let expected: Value = serde_json::from_str(expected).unwrap();
        let (events, activity) = runtime.block_on(read(chunks.iter().cloned().map(Ok).collect()));
        let error = events.iter().find_map(|event| event.as_ref().err()).map(|error| match error {
            Error::MalformedResponse(_) => "MalformedResponse",
            Error::EventTooLarge => "SseEventTooLarge",
            Error::Transport(_) => "Transport",
        });
        let events: Vec<Value> = events.into_iter().filter_map(Result::ok).map(numbers).collect();
        let want: Vec<Value> = expected["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|text| numbers(serde_json::from_str(text.as_str().unwrap()).unwrap()))
            .collect();
        let stream = String::from_utf8_lossy(&chunks.concat()).into_owned();
        assert_eq!((&events, error), (&want, expected["error"].as_str()), "stream {stream:?} in chunks {chunks:?}");
        // Every chunk counts as activity, an empty one too.
        assert!(error.is_some() || activity == chunks.len(), "{activity} of {} chunks: {stream:?}", chunks.len());
        read_events += events.len();
        errors += usize::from(error.is_some());
    }
    eprintln!("{} streams: {read_events} events, {errors} errors", cases.len());
}

/// Numbers as JavaScript holds them, so `1` and `1.0` compare equal.
fn numbers(value: Value) -> Value {
    match value {
        Value::Number(number) => json!(number.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.into_iter().map(numbers).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(key, value)| (key, numbers(value))).collect()),
        value => value,
    }
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// The TypeScript checkout with its dependencies, or `None` (and a note) without Bun.
fn ts_root() -> Option<PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap());
    let present = root.join("node_modules").is_dir() && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but Bun is missing"
        );
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", root.display());
    }
    present.then_some(root)
}

/// Runs `parity/oracle/<script>` in one Bun process with `input` on its standard input.
fn bun(root: &Path, script: &str, input: &str) -> String {
    let mut child = Command::new("bun")
        .arg("--cwd")
        .arg(root.join("packages/cli"))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle").join(script))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let input = input.to_owned();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()).unwrap());
    let output = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(output.status.success(), "{script} failed");
    String::from_utf8(output.stdout).unwrap()
}

/// One stream, cut at random places (equal places give empty chunks).
fn chunks(rng: &mut SplitMix64) -> Vec<Vec<u8>> {
    let stream = stream(rng);
    let mut cuts: Vec<usize> = (0..rng.below(8)).map(|_| rng.below(stream.len() as u64 + 1) as usize).collect();
    cuts.sort();
    let mut start = 0;
    let mut chunks: Vec<Vec<u8>> = cuts
        .into_iter()
        .map(|cut| {
            let chunk = stream[start..cut].to_vec();
            start = cut;
            chunk
        })
        .collect();
    chunks.push(stream[start..].to_vec());
    chunks
}

fn pick<'a>(rng: &mut SplitMix64, items: &[&'a str]) -> &'a str {
    items[rng.below(items.len() as u64) as usize]
}

fn stream(rng: &mut SplitMix64) -> Vec<u8> {
    let mut out = Vec::new();
    if rng.below(4) == 0 {
        out.extend("\u{feff}".as_bytes());
    }
    let ends = ["\n", "\r\n", "\r"];
    let blocks = 1 + rng.below(4);
    for block in 0..blocks {
        for _ in 0..rng.below(3) {
            let field = pick(rng, &[": heartbeat", ":", "id: 7", "event: x", "retry: 5", "data", "Data: 1", "dat: 2"]);
            out.extend(field.as_bytes());
            out.extend(pick(rng, &ends).as_bytes());
        }
        let mut payload = Vec::new();
        value(rng, 0, &mut payload);
        match rng.below(24) {
            0 => payload.truncate(rng.below(payload.len() as u64) as usize),
            1 => payload.clear(),
            _ => {}
        }
        for line in payload.split(|byte| *byte == b'\n') {
            out.extend(b"data:");
            // U+0085 and U+180E are not white space to `trimStart`, so the payload does not parse.
            let odd = ["\t", "\u{a0}", "\u{feff}", "\u{85}", "\u{2028}", "\u{3000}", "\u{180e}"];
            let space = if rng.below(8) == 0 { pick(rng, &odd) } else { pick(rng, &["", " ", "  "]) };
            out.extend(space.as_bytes());
            out.extend(line);
            out.extend(pick(rng, &ends).as_bytes());
        }
        // The last block may end with the body; any other without its blank line runs into the next.
        if rng.below(if block + 1 == blocks { 3 } else { 24 }) != 0 {
            out.extend(pick(rng, &ends).as_bytes());
        }
    }
    out
}

/// JSON text, valid unless an invalid byte or an escape JavaScript rejects lands in it.
fn value(rng: &mut SplitMix64, depth: u32, out: &mut Vec<u8>) {
    // A CR would end the `data` line inside the payload.
    let space = |rng: &mut SplitMix64, out: &mut Vec<u8>| out.extend(pick(rng, &["", "", " ", "\t", "\n"]).as_bytes());
    match rng.below(if depth > 2 { 3 } else { 5 }) {
        0 => out.extend(
            pick(
                rng,
                &[
                    "0",
                    "-0",
                    "1",
                    "-1",
                    "1.5",
                    "1.0",
                    "1e3",
                    "1E-7",
                    "-2.5e+10",
                    "9007199254740993",
                    "123456789012345678901",
                    "true",
                    "false",
                    "null",
                ],
            )
            .as_bytes(),
        ),
        1 | 2 => {
            out.push(b'"');
            for _ in 0..rng.below(6) {
                let piece = pick(
                    rng,
                    &[
                        "a",
                        "xyz",
                        " ",
                        "\u{e9}",
                        "\u{2580}",
                        "\u{1f600}",
                        "\u{1f469}\u{200d}\u{1f4bb}",
                        "\u{4e2d}\u{6587}",
                        "e\u{301}",
                        "\\n",
                        "\\t",
                        "\\u0000",
                        "\\u00e9",
                        "\\ud83d\\ude00",
                        "\\ud83d",
                        "\\ude00",
                        "\\ud83dx",
                        "\\\\ud83d",
                        "\\/",
                        "\\\"",
                        "\u{2028}",
                        "\u{7f}",
                        "\\uD83D\\uDE00",
                        "\\ud83d\\ud83d\\ude00",
                    ],
                );
                out.extend(piece.as_bytes());
            }
            if rng.below(16) == 0 {
                out.extend(
                    pick(
                        rng,
                        &[
                            "\u{ff}",
                            "\u{e2}\u{98}",
                            "\u{80}",
                            "\u{c0}\u{af}",
                            "\u{ed}\u{a0}\u{80}",
                            "\u{f4}\u{90}\u{80}\u{80}",
                        ],
                    )
                    .chars()
                    .map(|c| c as u8),
                );
            }
            out.push(b'"');
        }
        3 => {
            out.push(b'[');
            for index in 0..rng.below(4) {
                if index > 0 {
                    out.push(b',');
                }
                space(rng, out);
                value(rng, depth + 1, out);
                space(rng, out);
            }
            out.push(b']');
        }
        _ => {
            out.push(b'{');
            for index in 0..rng.below(4) {
                if index > 0 {
                    out.push(b',');
                }
                space(rng, out);
                let key = pick(rng, &["a", "type", "\u{e9}", "k\u{1f600}"]);
                out.extend(format!("\"{key}{index}\"").as_bytes());
                space(rng, out);
                out.push(b':');
                space(rng, out);
                value(rng, depth + 1, out);
            }
            out.push(b'}');
        }
    }
}
