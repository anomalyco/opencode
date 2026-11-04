//! `translate.test.ts`: the rows for the turn fold. Left to C.12: the tool location rows ("locates the
//! file of an edit tool", "... write tool", "... patch tool", and the `locations` of the shell row), the
//! compaction rows, and the replay rows.

use opencode_acp::translate::{
    self, Output, StartKind, Terminal, TurnContext, TurnStart, TurnState,
};
use serde_json::{Value, json};

use crate::wire::{
    assert_matches, child_created, delivered, durable_event, failed, reasoning_delta, step_ended,
    succeeded, text_delta, tool_called, tool_failed, tool_progress, tool_started, tool_succeeded,
    usage,
};

const ROOT: &str = "ses_root";

fn ctx(child_updates: bool) -> TurnContext {
    TurnContext {
        session_id: ROOT.to_owned(),
        cwd: "/workspace".to_owned(),
        start: TurnStart {
            kind: StartKind::Input,
            id: "msg_input".to_owned(),
        },
        child_updates,
        compaction: false,
    }
}

fn live(events: Vec<Value>) -> Vec<Value> {
    let mut all = vec![delivered(ROOT, "msg_input")];
    all.extend(events);
    all
}

struct Run {
    state: TurnState,
    outputs: Vec<Output>,
    terminal: Option<Terminal>,
}

fn run(events: &[Value], ctx: &TurnContext) -> Run {
    let mut result = Run {
        state: TurnState::default(),
        outputs: Vec::new(),
        terminal: None,
    };
    for (index, event) in events.iter().enumerate() {
        let mut event = event.clone();
        event["id"] = json!(format!("evt_{}", index + 1));
        let folded = translate::fold(&result.state, &event, ctx);
        result.state = folded.state;
        result.outputs.extend(folded.outputs);
        if folded.terminal.is_some() {
            result.terminal = folded.terminal;
        }
    }
    result
}

fn updates(outputs: &[Output]) -> Value {
    json!(
        outputs
            .iter()
            .filter_map(|output| match output {
                Output::SessionUpdate { update, .. } => Some(update.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
    )
}

/// The fields a row checks, as `translate()` in the TS test builds them.
fn translated(events: &[Value], ctx: &TurnContext) -> Value {
    let result = run(events, ctx);
    let terminal = result.terminal.map(|terminal| match terminal {
        Terminal::Succeeded => "succeeded",
        Terminal::Failed => "failed",
        Terminal::Interrupted => "interrupted",
    });
    let usage = result.state.usage.map(|usage| {
        let last = usage.last;
        json!({
            "input": translate::number(last.input), "output": translate::number(last.output),
            "reasoning": translate::number(last.reasoning),
            "cache": { "read": translate::number(last.cache_read), "write": translate::number(last.cache_write) },
        })
    });
    json!({
        "updates": updates(&result.outputs),
        "children": result.outputs.iter().filter_map(|output| match output {
            Output::ChildUpdate { update, .. } => Some(update.clone()),
            _ => None,
        }).collect::<Vec<_>>(),
        "terminal": terminal,
        "response": result.terminal.map(|terminal| translate::response(&result.state, ROOT, terminal)),
        "failure": translate::failure(&result.state).map(|failure| failure.tag()),
        "context": usage,
        "abandoned": updates(&translate::abandon(&result.state, ctx).outputs),
    })
}

fn child_meta(id: &str, parent: &str, depth: u64, title: &str) -> Value {
    json!({ "opencode/child-session": { "id": id, "parentID": parent, "depth": depth, "title": title } })
}

fn step_failed(error: Value, tokens: Option<Value>) -> Value {
    let mut data = json!({ "sessionID": ROOT, "assistantMessageID": "msg_1", "error": error });
    if let Some(tokens) = tokens {
        data["cost"] = json!(0);
        data["tokens"] = tokens;
    }
    durable_event("session.step.failed", data)
}

#[test]
fn turn_translation() {
    let rows: Vec<(&str, bool, Vec<Value>, Value)> = vec![
        (
            "ignores a session's events until its own input is delivered",
            false,
            vec![
                text_delta(ROOT, "msg_early", "early", 0),
                delivered(ROOT, "msg_other_input"),
                succeeded(ROOT),
            ],
            json!({ "updates": [], "terminal": null }),
        ),
        (
            "ignores other sessions' events",
            false,
            live(vec![
                delivered("ses_other", "msg_input"),
                text_delta("ses_other", "msg_other", "other", 0),
                text_delta(ROOT, "msg_ok", "accepted", 0),
            ]),
            json!({ "updates": [{ "sessionUpdate": "agent_message_chunk", "messageId": "msg_ok" }] }),
        ),
        (
            "streams text and reasoning with one message ID per reasoning ordinal",
            false,
            live(vec![
                reasoning_delta(ROOT, "msg_a", "think", 0),
                text_delta(ROOT, "msg_a", "answer", 1),
                reasoning_delta(ROOT, "msg_a", "more", 1),
            ]),
            json!({ "updates": [
                { "sessionUpdate": "agent_thought_chunk", "messageId": "msg_a:reasoning:0", "content": { "text": "think" } },
                { "sessionUpdate": "agent_message_chunk", "messageId": "msg_a", "content": { "text": "answer" } },
                { "sessionUpdate": "agent_thought_chunk", "messageId": "msg_a:reasoning:1", "content": { "text": "more" } },
            ] }),
        ),
        (
            "ends a normal turn with end_turn",
            false,
            live(vec![
                step_ended(ROOT, "msg_1", "stop", usage(1, 1, 0, 0, 0)),
                succeeded(ROOT),
            ]),
            json!({ "response": { "stopReason": "end_turn", "usage": { "inputTokens": 1, "outputTokens": 1, "totalTokens": 2 } } }),
        ),
        (
            "ends a length-limited step with max_tokens",
            false,
            live(vec![
                step_ended(ROOT, "msg_1", "length", usage(1, 1, 0, 0, 0)),
                succeeded(ROOT),
            ]),
            json!({ "response": { "stopReason": "max_tokens" } }),
        ),
        (
            "ends a content-filtered step with refusal",
            false,
            live(vec![
                step_ended(ROOT, "msg_1", "content-filter", usage(1, 1, 0, 0, 0)),
                succeeded(ROOT),
            ]),
            json!({ "response": { "stopReason": "refusal" } }),
        ),
        (
            "ends a content-filter failure with refusal and no error",
            false,
            live(vec![failed(
                ROOT,
                json!({ "type": "provider.content-filter", "message": "blocked" }),
            )]),
            json!({ "response": { "stopReason": "refusal" }, "failure": null }),
        ),
        (
            "ends a server-side interruption with cancelled",
            false,
            live(vec![durable_event(
                "session.execution.interrupted",
                json!({ "sessionID": ROOT, "reason": "shutdown" }),
            )]),
            json!({ "terminal": "interrupted", "response": { "stopReason": "cancelled" } }),
        ),
        (
            "ends an aborted execution with cancelled and no error",
            false,
            live(vec![failed(
                ROOT,
                json!({ "type": "aborted", "message": "interrupted" }),
            )]),
            json!({ "response": { "stopReason": "cancelled" }, "failure": null }),
        ),
        (
            "fails an execution auth failure as auth required",
            false,
            live(vec![failed(
                ROOT,
                json!({ "type": "provider.auth", "message": "missing key" }),
            )]),
            json!({ "failure": "ACPAuthRequiredError" }),
        ),
        (
            "fails a step auth failure as auth required even when the execution succeeds",
            false,
            live(vec![
                step_failed(
                    json!({ "type": "provider.auth", "message": "expired" }),
                    None,
                ),
                succeeded(ROOT),
            ]),
            json!({ "terminal": "succeeded", "failure": "ACPAuthRequiredError" }),
        ),
        (
            "fails other execution failures as service failures",
            false,
            live(vec![failed(
                ROOT,
                json!({ "type": "provider.rate-limit", "message": "slow down" }),
            )]),
            json!({ "failure": "ACPServiceFailureError" }),
        ),
        (
            "sums usage across steps and reports thought and cache tokens",
            false,
            live(vec![
                step_ended(ROOT, "msg_1", "tool-calls", usage(100, 10, 0, 0, 50)),
                step_ended(ROOT, "msg_2", "stop", usage(20, 5, 3, 150, 0)),
                succeeded(ROOT),
            ]),
            json!({
                "response": { "usage": {
                    "inputTokens": 120, "outputTokens": 15, "thoughtTokens": 3,
                    "cachedReadTokens": 150, "cachedWriteTokens": 50, "totalTokens": 338,
                } },
                "context": usage(20, 5, 3, 150, 0),
            }),
        ),
        (
            "counts a failed step's tokens and clears its error when the next step starts",
            false,
            live(vec![
                step_failed(
                    json!({ "type": "provider.stream", "message": "stream interrupted" }),
                    Some(usage(40, 4, 0, 0, 0)),
                ),
                durable_event(
                    "session.step.started",
                    json!({
                        "sessionID": ROOT, "assistantMessageID": "msg_2", "agent": "build",
                        "model": { "providerID": "test", "id": "test-model" }, "started": 0,
                    }),
                ),
                step_ended(ROOT, "msg_2", "stop", usage(20, 7, 0, 0, 0)),
                succeeded(ROOT),
            ]),
            json!({
                "response": { "stopReason": "end_turn", "usage": { "inputTokens": 60, "outputTokens": 11, "totalTokens": 71 } },
                "failure": null,
                "context": usage(20, 7, 0, 0, 0),
            }),
        ),
        (
            "excludes child session steps from the turn usage",
            false,
            live(vec![
                child_created("ses_child", ROOT, "Explore"),
                step_ended("ses_child", "msg_child", "stop", usage(500, 50, 0, 0, 0)),
                succeeded("ses_child"),
                step_ended(ROOT, "msg_root", "stop", usage(20, 7, 0, 0, 0)),
                succeeded(ROOT),
            ]),
            json!({
                "response": { "usage": { "inputTokens": 20, "outputTokens": 7, "totalTokens": 27 } },
                "context": usage(20, 7, 0, 0, 0),
            }),
        ),
        (
            "streams a tool call from pending through progress to completion",
            false,
            live(vec![
                tool_started(ROOT, "call_ok", "shell"),
                tool_called(
                    ROOT,
                    "call_ok",
                    json!({ "command": "printf done", "workdir": "sub" }),
                ),
                tool_progress(ROOT, "call_ok", json!({ "phase": 1 })),
                tool_succeeded(ROOT, "call_ok", json!({ "exit": 0 }), "done"),
            ]),
            json!({ "updates": [
                { "sessionUpdate": "tool_call", "toolCallId": "call_ok", "name": "shell", "status": "pending", "kind": "execute" },
                {
                    "sessionUpdate": "tool_call_update", "status": "in_progress", "title": "printf done",
                    "rawInput": { "command": "printf done", "workdir": "sub" },
                },
                { "sessionUpdate": "tool_call_update", "status": "in_progress" },
                {
                    "sessionUpdate": "tool_call_update", "status": "completed",
                    "content": [{ "type": "content", "content": { "type": "text", "text": "done" } }],
                    "rawOutput": { "metadata": { "exit": 0 } },
                },
            ] }),
        ),
        (
            "fails a tool call with its partial content and error",
            false,
            live(vec![
                tool_started(ROOT, "call_fail", "read"),
                tool_called(
                    ROOT,
                    "call_fail",
                    json!({ "path": "/workspace/missing.ts" }),
                ),
                tool_failed(
                    ROOT,
                    "call_fail",
                    json!({
                        "error": { "type": "tool.error", "message": "not found" },
                        "metadata": { "bytes": 0 },
                        "content": [{ "type": "text", "text": "opening" }],
                    }),
                ),
            ]),
            json!({ "updates": [
                { "status": "pending" },
                { "status": "in_progress" },
                {
                    "status": "failed", "kind": "read",
                    "content": [
                        { "type": "content", "content": { "type": "text", "text": "opening" } },
                        { "type": "content", "content": { "type": "text", "text": "not found" } },
                    ],
                    "rawOutput": { "metadata": { "bytes": 0 }, "error": "not found" },
                },
            ] }),
        ),
        (
            "projects a child's tool call onto the parent with its ID and title prefixed",
            false,
            live(vec![
                child_created("ses_child", ROOT, "Explore"),
                tool_started("ses_child", "call_1", "read"),
            ]),
            json!({
                "updates": [{
                    "sessionUpdate": "tool_call", "toolCallId": "ses_child:call_1", "title": "Explore: read",
                    "_meta": child_meta("ses_child", ROOT, 1, "Explore"),
                }],
                "children": [],
            }),
        ),
        (
            "projects a nested child with its depth and its own parent, and ignores unrelated sessions",
            false,
            live(vec![
                child_created("ses_child", ROOT, "Explore"),
                child_created("ses_grandchild", "ses_child", "Deeper"),
                child_created("ses_stranger", "ses_unknown", "Unrelated"),
                tool_started("ses_grandchild", "call_1", "read"),
                text_delta("ses_stranger", "msg_stranger", "ignored", 0),
            ]),
            json!({ "updates": [{
                "toolCallId": "ses_grandchild:call_1", "title": "Deeper: read",
                "_meta": child_meta("ses_grandchild", "ses_child", 2, "Deeper"),
            }] }),
        ),
        (
            "routes child work to the extension when the client supports it",
            true,
            live(vec![
                child_created("ses_child", ROOT, "Explore"),
                durable_event(
                    "session.execution.started",
                    json!({ "sessionID": "ses_child" }),
                ),
                text_delta("ses_child", "msg_child", "nested", 0),
                failed(
                    "ses_child",
                    json!({ "type": "tool.error", "message": "boom" }),
                ),
            ]),
            json!({
                "updates": [],
                "terminal": null,
                "children": [
                    { "childSessionId": "ses_child", "parentSessionId": ROOT, "depth": 1, "type": "status", "status": "created" },
                    { "childSessionId": "ses_child", "type": "status", "status": "running" },
                    { "childSessionId": "ses_child", "type": "update", "update": { "sessionUpdate": "agent_message_chunk" } },
                    { "childSessionId": "ses_child", "type": "status", "status": "failed", "error": { "type": "tool.error" } },
                ],
            }),
        ),
        (
            "fails the tools a cancelled turn left open, including a child's",
            false,
            live(vec![
                child_created("ses_child", ROOT, "Explore"),
                tool_started(ROOT, "call_root", "shell"),
                tool_called(ROOT, "call_root", json!({ "command": "sleep 60" })),
                tool_progress(ROOT, "call_root", json!({ "pid": 1 })),
                tool_started("ses_child", "call_child", "read"),
            ]),
            json!({ "abandoned": [
                {
                    "toolCallId": "call_root", "status": "failed", "rawInput": { "command": "sleep 60" },
                    "rawOutput": { "metadata": { "pid": 1 }, "error": "Cancelled" },
                },
                { "toolCallId": "ses_child:call_child", "status": "failed", "title": "Explore: read" },
            ] }),
        ),
    ];
    for (name, child_updates, events, expected) in rows {
        let actual = translated(&events, &ctx(child_updates));
        assert!(
            crate::wire::matches(&actual, &expected),
            "{name}\n  actual:   {actual}\n  expected: {expected}"
        );
    }
}

#[test]
fn reports_a_pending_retry_and_clears_it_when_the_next_step_starts() {
    let error = json!({ "type": "provider.transport", "message": "lost" });
    let retry = durable_event(
        "session.retry.scheduled",
        json!({ "sessionID": ROOT, "assistantMessageID": "msg_1", "attempt": 2, "at": 1_000, "error": error }),
    );
    let pending = run(&live(vec![retry.clone()]), &ctx(false));
    assert_matches(
        &updates(&pending.outputs),
        &json!([{ "sessionUpdate": "session_info_update", "_meta": { "opencode/retry": { "attempt": 2, "nextRetryAt": "1970-01-01T00:00:01.000Z", "error": error } } }]),
    );
    assert_eq!(
        translate::response(&pending.state, ROOT, Terminal::Interrupted)["_meta"],
        json!({ "opencode/retry": { "attempt": 2, "nextRetryAt": "1970-01-01T00:00:01.000Z", "error": error } })
    );

    let cleared = run(
        &live(vec![
            retry,
            durable_event(
                "session.step.started",
                json!({ "sessionID": ROOT, "assistantMessageID": "msg_2" }),
            ),
        ]),
        &ctx(false),
    );
    assert_eq!(
        updates(&cleared.outputs)[1],
        json!({ "sessionUpdate": "session_info_update", "_meta": { "opencode/retry": null } })
    );
    assert_eq!(
        translate::response(&cleared.state, ROOT, Terminal::Succeeded)["_meta"],
        json!({})
    );
}
