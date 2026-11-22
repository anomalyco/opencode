//! ACP's performance scenario, run with the TUI's by `bun run perf` in `packages/cli-rs`: a long reply as the server
//! streams it, decoded, folded into updates and written by the connection. It shares the counting allocator and the
//! measured region with the TUI's scenarios (`crates/tui/tests/all/perf.rs`).

#[allow(dead_code, reason = "the TUI's tests use the rest")]
#[path = "../../tui/tests/all/support/heap.rs"]
mod heap;
#[allow(dead_code, reason = "the TUI's tests use the rest")]
#[path = "../../tui/tests/all/support/probe.rs"]
mod probe;

use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};

use bytes::Bytes;
use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use tokio::io::AsyncWrite;

use crate::connection::{self, Connection, Handler, RequestContext};
use crate::error::RpcError;
use crate::permission;
use crate::translate::{self, Output, StartKind, Terminal, TurnContext, TurnStart, TurnState};
use probe::Probe;

#[global_allocator]
static HEAP: heap::Counting = heap::Counting;

const SESSION: &str = "ses_acp";
const MESSAGE: &str = "msg_reply";
/// Blocks of text deltas, each followed by a tool call that streams its input.
const BLOCKS: usize = 20;
const TEXT_DELTAS: usize = 1000;
const INPUT_DELTAS: usize = 50;
/// What the connection writes for the stream: its length and its FNV-1a hash, the same before and after a change of
/// the update path.
const WRITTEN: (u64, u64) = (4_046_973, 2_864_509_620_693_505_320);

/// Streams a reply of text deltas and tool calls, one of which asks for permission and one of which carries a large
/// input, through the decoder, the fold and the connection's writer, all on the test thread. A permission's ask is an
/// exchange with the client, which the scenario leaves out; its fold is measured.
#[test]
#[ignore = "performance scenario; run with `bun run perf`"]
fn acp_stream() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let chunks: Vec<Result<Bytes, String>> =
        sse_body().chunks(16 * 1024).map(|chunk| Ok(Bytes::copy_from_slice(chunk))).collect();
    let ctx = TurnContext {
        session_id: SESSION.to_owned(),
        cwd: "/project".to_owned(),
        start: Some(TurnStart { kind: StartKind::Input, id: "msg_user".to_owned() }),
        child_updates: false,
        compaction: false,
    };
    let (connection, writer) = Connection::new();
    let sink = Sink::default();
    let (input, _client) = tokio::io::duplex(64);
    runtime.spawn(connection::run(connection.clone(), writer, input, sink.clone(), Arc::new(Ignore)));
    runtime.block_on(tokio::task::yield_now());
    let probe = Probe::start();
    let (terminal, sent) = runtime.block_on(async {
        let mut events = std::pin::pin!(opencode_api::sse::events::<translate::Event, _, _>(
            futures_util::stream::iter(chunks),
            || {}
        ));
        let (mut state, mut terminal, mut sent) = (TurnState::default(), None, 0);
        while let Some(event) = events.next().await {
            let event = event.unwrap();
            let folded = translate::fold(&mut state, &event, &ctx);
            for output in folded.outputs {
                if let Output::SessionUpdate { mut update, diff } = output {
                    permission::add_completed_diffs(&mut update, diff.as_ref(), &ctx.cwd).await;
                    connection.session_update(&ctx.session_id, &update).unwrap();
                    sent += 1;
                }
            }
            terminal = terminal.or(folded.terminal);
            tokio::task::yield_now().await;
        }
        while sink.lines() < sent {
            tokio::task::yield_now().await;
        }
        (terminal, sent)
    });
    probe.finish("acp_stream", (BLOCKS * TEXT_DELTAS) as u64);
    assert_eq!(terminal, Some(Terminal::Succeeded));
    assert!(sent > BLOCKS * TEXT_DELTAS, "{sent} updates");
    assert_eq!(sink.written(), WRITTEN);
}

/// The server's events as `GET /api/event` sends them.
fn sse_body() -> Vec<u8> {
    let words = ["The ", "parser ", "now ", "handles ", "**nested** ", "groups ", "and ", "`escapes`", ".\n\n"];
    let mut events = vec![
        ("session.inbox.delivered", json!({ "inboxID": "msg_user" })),
        ("session.step.started", json!({ "agent": "build", "model": { "providerID": "p", "id": "m" }, "started": 1 })),
        ("session.text.started", json!({ "ordinal": 0 })),
    ];
    for block in 0..BLOCKS {
        events.extend(
            (0..TEXT_DELTAS).map(|index| ("session.text.delta", json!({ "ordinal": 0, "delta": words[index % 9] }))),
        );
        let id = format!("call_{block}");
        let (name, input) = match block {
            5 => ("shell", json!({ "command": "cargo test", "description": "Runs the tests" })),
            10 => ("write", large_input()),
            _ => {
                ("edit", json!({ "filePath": format!("/project/src/m{block}.rs"), "oldString": "a", "newString": "b" }))
            }
        };
        events.push(("session.tool.input.started", json!({ "id": id, "name": name })));
        events.extend(
            (0..INPUT_DELTAS)
                .map(|index| ("session.tool.input.delta", json!({ "id": id, "delta": format!("{index}") }))),
        );
        events.push(("session.tool.called", json!({ "id": id, "input": input, "executed": true })));
        if block == 5 {
            let source = json!({ "type": "tool", "messageID": MESSAGE, "id": id });
            let ask = json!({ "id": "per_1", "action": "shell", "resources": ["cargo test"], "source": source });
            events.push(("permission.asked", ask));
            events.push(("permission.replied", json!({ "requestID": "per_1", "reply": "once" })));
        }
        events.push(("session.tool.progress", json!({ "id": id, "metadata": { "output": "running" } })));
        let content = json!([{ "type": "text", "text": "done" }]);
        let metadata = json!({ "output": "done", "exit": 0 });
        events.push((
            "session.tool.success",
            json!({ "id": id, "content": content, "metadata": metadata, "executed": true }),
        ));
    }
    events.push((
        "session.step.ended",
        json!({ "finish": "stop", "cost": 0.5, "tokens": { "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } } }),
    ));
    events.push(("session.execution.succeeded", json!({})));
    let mut body = Vec::new();
    for (seq, (kind, mut data)) in events.into_iter().enumerate() {
        data["sessionID"] = json!(SESSION);
        if kind.starts_with("session.") && !kind.starts_with("session.inbox") && !kind.starts_with("session.execution")
        {
            data["assistantMessageID"] = json!(MESSAGE);
        }
        let event = json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
            "durable": { "aggregateID": SESSION, "seq": seq, "version": 1 },
            "location": { "directory": "/project" },
            "data": data,
        });
        body.extend_from_slice(b"data: ");
        body.extend_from_slice(event.to_string().as_bytes());
        body.extend_from_slice(b"\n\n");
    }
    body
}

/// A write tool's input of 64 KiB of content and a nested open object.
fn large_input() -> Value {
    let content: String = (0..2048).map(|line| format!("line {line:04} of the generated file, padded\n")).collect();
    let options: Vec<Value> =
        (0..64).map(|index| json!({ "key": format!("k{index}"), "values": [index, index + 1] })).collect();
    json!({ "filePath": "/project/out.txt", "content": content, "options": options })
}

struct Ignore;

impl Handler for Ignore {
    fn request(&self, _: &str, _: Value, _: RequestContext) -> Option<BoxFuture<'static, Result<Value, RpcError>>> {
        None
    }

    fn notification(&self, _: &str, _: Value) {}
}

/// The client's end of the output: counts and hashes what the connection writes.
#[derive(Clone, Default)]
struct Sink(Arc<Mutex<(u64, u64, usize)>>);

impl Sink {
    fn lines(&self) -> usize {
        self.0.lock().unwrap().2
    }

    fn written(&self) -> (u64, u64) {
        let written = *self.0.lock().unwrap();
        (written.0, written.1)
    }
}

impl AsyncWrite for Sink {
    fn poll_write(self: Pin<&mut Self>, _: &mut Context<'_>, bytes: &[u8]) -> Poll<std::io::Result<usize>> {
        let mut written = self.0.lock().unwrap();
        if written.0 == 0 {
            written.1 = 0xcbf2_9ce4_8422_2325;
        }
        for byte in bytes {
            written.1 = (written.1 ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3);
        }
        written.0 += bytes.len() as u64;
        written.2 += bytes.iter().filter(|byte| **byte == b'\n').count();
        Poll::Ready(Ok(bytes.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
