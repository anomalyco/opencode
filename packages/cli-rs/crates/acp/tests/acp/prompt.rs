//! `prompt.test.ts`. Left to C.12: "reports full-file diffs for a completed edit and patch", the tool
//! locations of the streamed shell call, and the compaction updates of the two wind-down cases.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::wire::{
    Hook, PromptCall, Wire, WireOptions, assert_matches, delivered, durable_event, events, failed,
    interrupted, lock, make_session, reasoning_delta, review_command, start_session, start_wire,
    step_ended, succeeded, text_delta, tokens, tool_called, tool_failed, tool_progress,
    tool_started, tool_succeeded, turn, usage,
};

fn lost() -> Value {
    json!({ "type": "provider.transport", "message": "stream connection lost" })
}

// A "hold" prompt is admitted, streams, and fails a step, then waits on its retry until interrupted.
fn held() -> WireOptions {
    WireOptions {
        on_prompt: Some(events(|call| {
            if call.text != "hold" {
                return turn(&call.session_id, &call.id, Vec::new());
            }
            let session = call.session_id.as_str();
            vec![
                delivered(session, &call.id),
                text_delta(session, "msg_held", "working", 0),
                durable_event(
                    "session.step.failed",
                    json!({ "sessionID": session, "assistantMessageID": "msg_held", "error": lost() }),
                ),
                durable_event(
                    "session.retry.scheduled",
                    json!({ "sessionID": session, "assistantMessageID": "msg_held", "attempt": 1, "at": 0, "error": lost() }),
                ),
            ]
        })),
        on_interrupt: Some(Arc::new(|session: String| {
            Box::pin(async move { vec![interrupted(&session)] })
        })),
        ..WireOptions::default()
    }
}

// The server answered admission before streaming the chunk, and this request round-trips through the
// server after it, so the agent has observed admission before the test cancels.
async fn admitted(acp: &Wire) {
    acp.wait_for_update("agent_message_chunk", |item| {
        item["update"]["sessionUpdate"] == "agent_message_chunk"
    })
    .await;
    acp.request(
        "session/set_mode",
        json!({ "sessionId": acp.session_id, "modeId": "build" }),
    )
    .await
    .unwrap();
}

/// Session updates the client received before the cancelled prompt response.
fn received_before_response(acp: &Wire) -> Vec<Value> {
    let received = lock(&acp.received).clone();
    let response = received
        .iter()
        .position(|message| message["result"]["stopReason"] == "cancelled")
        .expect("cancelled response");
    received[..response]
        .iter()
        .filter(|message| message["method"] == "session/update")
        .map(|message| message["params"]["update"].clone())
        .collect()
}

fn summary(update: &Value) -> Value {
    let update = &update["update"];
    let id = update
        .get("toolCallId")
        .or_else(|| update.get("messageId"))
        .cloned()
        .unwrap_or(Value::Null);
    json!([
        update["sessionUpdate"],
        id,
        update.get("status").cloned().unwrap_or(Value::Null)
    ])
}

#[tokio::test]
async fn streams_an_admitted_turn_and_resolves_with_usage_after_its_terminal_event() {
    let release = CancellationToken::new();
    let held = release.clone();
    let hook: Hook<PromptCall> = Arc::new(move |_call| {
        let held = held.clone();
        Box::pin(async move {
            held.cancelled().await;
            Vec::new()
        })
    });
    let acp = start_session(
        WireOptions {
            on_prompt: Some(hook),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;
    acp.request(
        "session/set_config_option",
        json!({ "sessionId": acp.session_id, "configId": "model", "value": "test/second-model" }),
    )
    .await
    .unwrap();
    {
        let mut session = make_session(&acp.session_id, "/workspace");
        session["cost"] = json!(3.5);
        acp.server
            .state()
            .sessions
            .insert(acp.session_id.clone(), session);
    }

    let prompt = tokio::spawn(acp.begin_prompt("hi"));
    let submitted = acp
        .until("prompt submission", || {
            acp.server.state().prompts().first().cloned()
        })
        .await;
    let session = acp.session_id.as_str();
    acp.server.send(&turn(
        session,
        submitted["id"].as_str().unwrap(),
        vec![
            reasoning_delta(session, "msg_assistant", "think-1", 0),
            reasoning_delta(session, "msg_assistant", " continued", 0),
            text_delta(session, "msg_assistant", "hello", 1),
            reasoning_delta(session, "msg_assistant", "think-2", 1),
            tool_started(session, "call_ok", "shell"),
            tool_called(
                session,
                "call_ok",
                json!({ "command": "printf done", "workdir": "sub" }),
            ),
            tool_progress(session, "call_ok", json!({ "phase": 1 })),
            tool_succeeded(session, "call_ok", json!({ "exit": 0 }), "done"),
            tool_started(session, "call_fail", "read"),
            tool_called(
                session,
                "call_fail",
                json!({ "path": "/workspace/missing.ts" }),
            ),
            tool_failed(
                session,
                "call_fail",
                json!({ "error": { "type": "tool.error", "message": "not found" } }),
            ),
            step_ended(session, "msg_assistant", "stop", usage(100, 40, 7, 11, 13)),
        ],
    ));
    acp.until("streamed updates", || {
        (acp.turn_updates().len() == 11).then_some(())
    })
    .await;
    assert!(!prompt.is_finished());
    release.cancel();

    assert_eq!(
        prompt.await.unwrap().unwrap(),
        json!({
            "stopReason": "end_turn",
            "usage": {
                "inputTokens": 100, "outputTokens": 40, "thoughtTokens": 7,
                "cachedReadTokens": 11, "cachedWriteTokens": 13, "totalTokens": 171,
            },
            "_meta": {},
        })
    );
    let submissions = acp.server.state().submissions.clone();
    assert_eq!(submissions.len(), 1);
    assert!(submissions[0]["id"].as_str().unwrap().starts_with("msg_"));
    assert_matches(
        &submissions[0],
        &json!({ "kind": "prompt", "sessionID": session, "text": "hi", "files": [], "delivery": "steer" }),
    );
    let updates = acp.turn_updates();
    assert_eq!(
        updates.iter().map(summary).collect::<Vec<_>>(),
        vec![
            json!(["agent_thought_chunk", "msg_assistant:reasoning:0", null]),
            json!(["agent_thought_chunk", "msg_assistant:reasoning:0", null]),
            json!(["agent_message_chunk", "msg_assistant", null]),
            json!(["agent_thought_chunk", "msg_assistant:reasoning:1", null]),
            json!(["tool_call", "call_ok", "pending"]),
            json!(["tool_call_update", "call_ok", "in_progress"]),
            json!(["tool_call_update", "call_ok", "in_progress"]),
            json!(["tool_call_update", "call_ok", "completed"]),
            json!(["tool_call", "call_fail", "pending"]),
            json!(["tool_call_update", "call_fail", "in_progress"]),
            json!(["tool_call_update", "call_fail", "failed"]),
        ]
    );
    assert_eq!(
        updates[2]["update"],
        json!({ "sessionUpdate": "agent_message_chunk", "messageId": "msg_assistant", "content": { "type": "text", "text": "hello" } })
    );
    assert_matches(
        &updates[5]["update"],
        &json!({ "title": "printf done", "kind": "execute", "rawInput": { "command": "printf done", "workdir": "sub" } }),
    );
    assert_matches(
        &updates[7]["update"],
        &json!({ "content": [{ "type": "content", "content": { "type": "text", "text": "done" } }], "rawOutput": { "metadata": { "exit": 0 } } }),
    );
    assert_matches(
        &updates[10]["update"],
        &json!({ "content": [{ "type": "content", "content": { "type": "text", "text": "not found" } }], "rawOutput": { "error": "not found" } }),
    );
    assert_eq!(
        acp.wait_for_update("usage_update", |item| item["update"]["sessionUpdate"]
            == "usage_update")
            .await,
        json!({
            "sessionId": session,
            "update": { "sessionUpdate": "usage_update", "used": 171, "size": 200_000, "cost": { "amount": 3.5, "currency": "USD" } },
        })
    );
}

#[tokio::test]
async fn routes_slash_commands_and_compact_through_their_session_endpoints() {
    let acp = start_wire(WireOptions::default()).await;
    acp.server.state().commands = vec![
        review_command(),
        json!({ "name": "compact", "description": "Server compact" }),
    ];
    acp.initialize(json!({})).await;
    let session = acp.new_session("/workspace", json!([])).await.unwrap();
    let id = session["sessionId"].as_str().unwrap();

    let command = acp.prompt(id, "/review now").await.unwrap();
    let compact = acp.prompt(id, "/compact").await.unwrap();

    assert_eq!(command["stopReason"], "end_turn");
    assert_eq!(compact["stopReason"], "end_turn");
    let submissions = acp.server.state().submissions.clone();
    assert_eq!(
        submissions[0],
        json!({ "kind": "command", "sessionID": id, "name": "review", "text": "now", "files": [], "delivery": "steer" })
    );
    assert_matches(
        &submissions[1],
        &json!({ "kind": "compact", "sessionID": id }),
    );
    assert!(submissions[1]["id"].as_str().unwrap().starts_with("msg_"));
    assert_eq!(submissions.len(), 2);
    assert_eq!(
        acp.wait_for_update("available_commands_update", |item| {
            item["update"]["sessionUpdate"] == "available_commands_update"
        })
        .await["update"],
        json!({
            "sessionUpdate": "available_commands_update",
            "availableCommands": [
                { "name": "review", "description": "Review changes" },
                { "name": "compact", "description": "Compact the session" },
            ],
        })
    );
}

fn file_url(path: &std::path::Path) -> String {
    url::Url::from_file_path(path).unwrap().to_string()
}

#[tokio::test]
async fn attaches_readable_file_links_and_references_unreadable_ones_in_place() {
    let dir = tempfile::tempdir().unwrap();
    let file = file_url(&dir.path().join("notes.md"));
    let folder = file_url(&dir.path().join("src"));
    let missing = file_url(&dir.path().join("missing.md"));
    let image = file_url(&dir.path().join("local.png"));
    let missing_image = file_url(&dir.path().join("missing.png"));
    std::fs::write(dir.path().join("notes.md"), "# notes\n").unwrap();
    std::fs::write(dir.path().join("local.png"), "png").unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    let acp = start_session(WireOptions::default(), json!({})).await;

    let response = acp
        .prompt_blocks(
            &acp.session_id,
            json!([
                { "type": "text", "text": "compare" },
                { "type": "text", "text": "hidden context", "annotations": { "audience": ["assistant"] } },
                { "type": "resource_link", "uri": file, "name": "notes.md" },
                { "type": "resource_link", "uri": missing, "name": "missing.md" },
                { "type": "resource_link", "uri": folder, "name": "src" },
                { "type": "image", "data": "", "mimeType": "image/png", "uri": "https://example.com/remote.png" },
                { "type": "image", "data": "", "mimeType": "image/png", "uri": image },
                { "type": "image", "data": "", "mimeType": "image/png", "uri": missing_image },
                { "type": "text", "text": "please" },
            ]),
        )
        .await
        .unwrap();

    assert_eq!(response["stopReason"], "end_turn");
    let submissions = acp.server.state().submissions.clone();
    assert_eq!(
        submissions[0],
        json!({
            "kind": "synthetic", "sessionID": acp.session_id, "text": "hidden context",
            "description": "ACP embedded context", "delivery": "steer", "resume": false,
        })
    );
    assert_matches(
        &submissions[1],
        &json!({
            "kind": "prompt",
            "text": format!("compare\n[missing.md]({missing})\n[remote.png](https://example.com/remote.png)\n[missing.png]({missing_image})\nplease"),
            "files": [
                { "uri": file, "name": "notes.md" },
                { "uri": folder, "name": "src" },
                { "uri": image, "name": "local.png" },
            ],
        }),
    );
    let error = acp
        .prompt_blocks(
            &acp.session_id,
            json!([{ "type": "text", "text": "look" }, { "type": "image", "data": "", "mimeType": "image/png" }]),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, -32602);
    assert!(error.message.contains("image content has no data or uri"));
    assert_eq!(acp.server.state().submissions.len(), 2);
}

#[tokio::test]
async fn maps_failures_to_acp_errors() {
    type Failure = fn(&str) -> Value;
    let rows: Vec<(&str, Failure, Value)> = vec![
        (
            "an execution auth failure",
            |session| {
                failed(
                    session,
                    json!({ "type": "provider.auth", "message": "missing key" }),
                )
            },
            json!({ "code": -32000 }),
        ),
        (
            "a step auth failure",
            |session| {
                durable_event(
                    "session.step.failed",
                    json!({ "sessionID": session, "assistantMessageID": "msg_auth", "error": { "type": "provider.auth", "message": "expired" } }),
                )
            },
            json!({ "code": -32000 }),
        ),
        (
            "another execution failure",
            |session| {
                failed(
                    session,
                    json!({ "type": "provider.rate-limit", "message": "slow down" }),
                )
            },
            json!({ "code": -32603, "message": "Internal error: slow down" }),
        ),
    ];
    for (name, failure, expected) in rows {
        let acp = start_session(
            WireOptions {
                on_prompt: Some(events(move |call| {
                    vec![
                        delivered(&call.session_id, &call.id),
                        text_delta(&call.session_id, "msg_auth", "partial", 0),
                        failure(&call.session_id),
                        succeeded(&call.session_id),
                    ]
                })),
                ..WireOptions::default()
            },
            json!({}),
        )
        .await;
        let error = acp.prompt(&acp.session_id, "hello").await.unwrap_err();
        assert!(
            crate::wire::matches(&error.json(), &expected),
            "{name}: {}",
            error.json()
        );
    }
}

#[tokio::test]
async fn session_cancel_during_setup_or_before_admission_returns_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("notes.md"), "# notes\n").unwrap();
    let aborted = CancellationToken::new();
    let seen = aborted.clone();
    let hook: Hook<PromptCall> = Arc::new(move |call| {
        let seen = seen.clone();
        // Dropping the request drops this hook, so a separate task watches for the abort.
        let aborted = call.aborted.clone();
        tokio::spawn(async move {
            aborted.cancelled().await;
            seen.cancel();
        });
        Box::pin(async move {
            call.aborted.cancelled().await;
            Vec::new()
        })
    });
    let acp = start_session(
        WireOptions {
            on_prompt: Some(hook),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;

    // The linked file's readability check holds the prompt in setup, before it submits.
    let link = file_url(&dir.path().join("notes.md"));
    let preparing = tokio::spawn(acp.begin(
        "session/prompt",
        json!({ "sessionId": acp.session_id, "prompt": [{ "type": "resource_link", "uri": link, "name": "notes.md" }] }),
        None,
    ));
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));

    assert_eq!(
        preparing.await.unwrap().unwrap(),
        json!({ "stopReason": "cancelled", "_meta": {} })
    );
    assert!(acp.server.state().submissions.is_empty());

    let prompt = tokio::spawn(acp.begin_prompt("hello"));
    acp.until("prompt submission", || {
        (acp.server.state().submissions.len() == 1).then_some(())
    })
    .await;
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));

    assert_eq!(
        prompt.await.unwrap().unwrap(),
        json!({ "stopReason": "cancelled", "_meta": {} })
    );
    tokio::time::timeout(Duration::from_secs(5), aborted.cancelled())
        .await
        .expect("the submission was abandoned");
    assert_eq!(acp.server.state().interrupts, vec![acp.session_id.clone()]);
}

#[tokio::test]
async fn session_cancel_forwards_the_servers_wind_down_before_resolving_cancelled() {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                if call.text == "again" {
                    return turn(session, &call.id, Vec::new());
                }
                vec![
                    delivered(session, &call.id),
                    tool_started(session, "call_sleep", "shell"),
                    tool_called(session, "call_sleep", json!({ "command": "sleep 60" })),
                    text_delta(session, "msg_held", "working", 0),
                ]
            })),
            on_interrupt: Some(Arc::new(|session: String| {
                Box::pin(async move {
                    let mut step_tokens = tokens(1);
                    step_tokens["input"] = json!(30);
                    step_tokens["output"] = json!(3);
                    vec![
                        tool_failed(
                            &session,
                            "call_sleep",
                            json!({ "error": { "type": "aborted", "message": "interrupted" } }),
                        ),
                        durable_event(
                            "session.step.failed",
                            json!({
                                "sessionID": session, "assistantMessageID": "msg_held",
                                "error": { "type": "aborted", "message": "interrupted" },
                                "cost": 0, "tokens": step_tokens,
                            }),
                        ),
                        interrupted(&session),
                    ]
                })
            })),
            ..WireOptions::default()
        },
        json!({ "session": { "compaction": {} } }),
    )
    .await;

    let prompt = tokio::spawn(acp.begin_prompt("hello"));
    admitted(&acp).await;
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));

    assert_eq!(
        prompt.await.unwrap().unwrap(),
        json!({
            "stopReason": "cancelled",
            "usage": { "inputTokens": 30, "outputTokens": 3, "totalTokens": 33 },
            "_meta": {},
        })
    );
    let before = received_before_response(&acp);
    assert!(before.iter().any(|update| crate::wire::matches(
        update,
        &json!({ "sessionUpdate": "tool_call_update", "toolCallId": "call_sleep", "status": "failed" })
    )));
    assert!(before.iter().any(|update| crate::wire::matches(
        update,
        &json!({ "sessionUpdate": "usage_update", "used": 33 })
    )));
    assert_eq!(acp.server.state().interrupts, vec![acp.session_id.clone()]);
    assert_eq!(
        acp.prompt(&acp.session_id, "again").await.unwrap()["stopReason"],
        "end_turn"
    );
}

#[tokio::test]
async fn stops_waiting_for_a_wind_down_that_never_ends_and_fails_the_tools_left_running() {
    let acp = start_session(
        WireOptions {
            drain_timeout: Some(Duration::from_millis(50)),
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                vec![
                    delivered(session, &call.id),
                    tool_started(session, "call_stuck", "shell"),
                    tool_called(session, "call_stuck", json!({ "command": "sleep 60" })),
                    text_delta(session, "msg_held", "working", 0),
                ]
            })),
            ..WireOptions::default()
        },
        json!({ "session": { "compaction": {} } }),
    )
    .await;

    let prompt = tokio::spawn(acp.begin_prompt("hello"));
    admitted(&acp).await;
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));

    assert_eq!(
        prompt.await.unwrap().unwrap(),
        json!({ "stopReason": "cancelled", "_meta": {} })
    );
    assert!(received_before_response(&acp).iter().any(|update| crate::wire::matches(
        update,
        &json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "call_stuck", "status": "failed",
            "rawOutput": { "error": "Cancelled" },
        })
    )));
}

#[tokio::test]
async fn cancel_request_on_the_prompt_cancels_the_turn_like_session_cancel() {
    let acp = start_session(held(), json!({})).await;
    let cancel = CancellationToken::new();

    let prompt = tokio::spawn(acp.begin(
        "session/prompt",
        json!({ "sessionId": acp.session_id, "prompt": [{ "type": "text", "text": "hold" }] }),
        Some(cancel.clone()),
    ));
    admitted(&acp).await;
    cancel.cancel();

    assert_matches(
        &prompt.await.unwrap().unwrap(),
        &json!({ "stopReason": "cancelled" }),
    );
    assert_eq!(acp.server.state().interrupts, vec![acp.session_id.clone()]);
    assert_eq!(
        acp.prompt(&acp.session_id, "again").await.unwrap()["stopReason"],
        "end_turn"
    );
}

async fn close_or_delete(method: &str) {
    let acp = start_session(held(), json!({})).await;
    let other = acp.new_session("/workspace", json!([])).await.unwrap();
    let other = other["sessionId"].as_str().unwrap().to_owned();

    let order = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let prompt_order = order.clone();
    let holding = acp.begin_prompt("hold");
    let prompt = tokio::spawn(async move {
        let result = holding.await;
        lock(&prompt_order).push("prompt".to_owned());
        result
    });
    admitted(&acp).await;
    let response = acp
        .request(method, json!({ "sessionId": acp.session_id }))
        .await
        .unwrap();
    lock(&order).push(method.to_owned());

    assert_eq!(response, json!({}));
    assert_matches(
        &prompt.await.unwrap().unwrap(),
        &json!({ "stopReason": "cancelled" }),
    );
    assert_eq!(*lock(&order), vec!["prompt".to_owned(), method.to_owned()]);
    assert_eq!(acp.server.state().interrupts, vec![acp.session_id.clone()]);
    assert_eq!(
        acp.server.state().sessions.contains_key(&acp.session_id),
        method == "session/close"
    );
    assert_matches(
        &acp.prompt(&acp.session_id, "again")
            .await
            .unwrap_err()
            .json(),
        &json!({ "code": -32602, "data": { "sessionId": acp.session_id } }),
    );
    assert_eq!(
        acp.prompt(&other, "still here").await.unwrap()["stopReason"],
        "end_turn"
    );
    assert_eq!(
        acp.prompt(&other, "/review now").await.unwrap()["stopReason"],
        "end_turn"
    );
    acp.request("session/close", json!({ "sessionId": other }))
        .await
        .unwrap();
    assert_eq!(
        acp.server.state().interrupts,
        vec![acp.session_id.clone(), other]
    );
}

#[tokio::test]
async fn session_close_settles_the_active_turn_before_responding() {
    close_or_delete("session/close").await;
}

#[tokio::test]
async fn session_delete_settles_the_active_turn_before_responding() {
    close_or_delete("session/delete").await;
}

#[tokio::test]
async fn rejects_a_second_prompt_while_one_is_active() {
    let acp = start_session(held(), json!({})).await;
    let prompt = tokio::spawn(acp.begin_prompt("hold"));
    admitted(&acp).await;

    let error = acp.prompt(&acp.session_id, "again").await.unwrap_err();

    assert_eq!(
        error.json(),
        json!({
            "code": -32603,
            "message": format!("Internal error: Session already has an active ACP prompt: {}", acp.session_id),
            "data": { "service": "session" },
        })
    );
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));
    assert_matches(
        &prompt.await.unwrap().unwrap(),
        &json!({ "stopReason": "cancelled", "_meta": { "opencode/retry": { "attempt": 1, "nextRetryAt": "1970-01-01T00:00:00.000Z" } } }),
    );
}
