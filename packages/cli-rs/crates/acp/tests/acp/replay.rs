//! `replay.test.ts`.

use serde_json::{Value, json};

use crate::wire::{WireOptions, assert_matches, assistant_message, file_diff, make_session, start_wire};

fn messages(edited: &str) -> Vec<Value> {
    vec![
        json!({
            "id": "msg_user", "type": "user", "text": "hello", "time": { "created": 1 },
            "files": [
                { "data": "", "mime": "text/markdown", "name": "note.md", "source": { "type": "uri", "uri": "file:///workspace/note.md" } },
                { "data": "aGVsbG8=", "mime": "text/plain", "name": "inline.txt", "source": { "type": "inline" } },
            ],
        }),
        assistant_message(
            "msg_assistant",
            json!([
                { "type": "text", "text": "answer" },
                { "type": "reasoning", "text": "thinking" },
                {
                    "type": "tool", "id": "call_done", "name": "shell", "time": { "created": 2, "completed": 3 },
                    "state": {
                        "status": "completed", "input": { "command": "printf done" }, "metadata": { "exit": 0 },
                        "content": [
                            { "type": "text", "text": "done" },
                            { "type": "file", "uri": "data:image/png;base64,AAAA", "mime": "image/png", "name": "image.png" },
                        ],
                    },
                },
                {
                    "type": "tool", "id": "call_running", "name": "shell", "time": { "created": 2, "ran": 2 },
                    "state": { "status": "running", "input": { "command": "pwd" }, "metadata": {} },
                },
                {
                    "type": "tool", "id": "call_failed", "name": "read", "time": { "created": 2, "completed": 3 },
                    "state": {
                        "status": "error", "input": { "path": "/workspace/missing.ts" }, "metadata": { "bytes": 0 },
                        "content": [{ "type": "text", "text": "partial" }],
                        "error": { "type": "tool.error", "message": "failed hard" },
                    },
                },
                {
                    "type": "tool", "id": "call_streaming", "name": "shell", "time": { "created": 2 },
                    "state": { "status": "streaming", "input": "{\"command\":" },
                },
                {
                    "type": "tool", "id": "call_edit", "name": "edit", "time": { "created": 2, "completed": 3 },
                    "state": {
                        "status": "completed", "input": { "path": edited, "oldString": "two", "newString": "three" },
                        "metadata": { "files": [file_diff(edited, "one\r\ntwo\r\n", "one\r\nthree\r\n", "modified")] },
                        "content": [{ "type": "text", "text": "edited" }],
                    },
                },
            ]),
        ),
    ]
}

#[tokio::test]
async fn replays_user_text_reasoning_and_tool_messages_in_order_on_session_load() {
    let dir = tempfile::tempdir().unwrap();
    let edited = dir.path().join("edited.ts").to_str().unwrap().to_owned();
    std::fs::write(&edited, "one\r\nthree\r\n").unwrap();
    let acp = start_wire(WireOptions::default()).await;
    {
        let mut state = acp.server.state();
        state.sessions.insert("ses_replay".to_owned(), make_session("ses_replay", "/workspace"));
        state.messages.insert("ses_replay".to_owned(), messages(&edited));
    }
    acp.initialize(json!({})).await;

    acp.request("session/load", json!({ "cwd": "/workspace", "sessionId": "ses_replay", "mcpServers": [] }))
        .await
        .unwrap();

    let updates: Vec<Value> = acp
        .updates()
        .into_iter()
        .filter(|item| item["update"]["sessionUpdate"] != "available_commands_update")
        .collect();
    assert!(updates.iter().all(|item| item["sessionId"] == "ses_replay"));
    let kinds: Vec<&str> = updates.iter().map(|item| item["update"]["sessionUpdate"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        [
            "user_message_chunk",
            "user_message_chunk",
            "user_message_chunk",
            "agent_message_chunk",
            "agent_thought_chunk",
            "tool_call",
            "tool_call_update",
            "tool_call",
            "tool_call_update",
            "tool_call",
            "tool_call_update",
            "tool_call",
            "tool_call",
            "tool_call_update",
        ]
    );
    let update = |index: usize| &updates[index]["update"];
    assert_matches(
        update(1),
        &json!({ "content": { "type": "resource_link", "uri": "file:///workspace/note.md", "name": "note.md", "mimeType": "text/markdown" } }),
    );
    assert_matches(
        update(2),
        &json!({ "content": { "type": "resource", "resource": { "mimeType": "text/plain", "text": "hello" } } }),
    );
    assert_matches(update(4), &json!({ "messageId": "msg_assistant:reasoning:0" }));
    assert_matches(
        update(6),
        &json!({
            "toolCallId": "call_done", "status": "completed",
            "content": [
                { "type": "content", "content": { "type": "text", "text": "done" } },
                { "type": "content", "content": { "type": "image", "mimeType": "image/png", "data": "AAAA" } },
            ],
            "rawOutput": { "metadata": { "exit": 0 } },
        }),
    );
    assert_matches(
        update(8),
        &json!({ "toolCallId": "call_running", "status": "in_progress", "title": "pwd", "locations": [{ "path": "/workspace" }] }),
    );
    assert_matches(
        update(10),
        &json!({
            "toolCallId": "call_failed", "status": "failed",
            "content": [
                { "type": "content", "content": { "type": "text", "text": "partial" } },
                { "type": "content", "content": { "type": "text", "text": "failed hard" } },
            ],
        }),
    );
    assert_matches(update(5), &json!({ "name": "shell" }));
    assert_matches(update(11), &json!({ "toolCallId": "call_streaming", "status": "pending", "rawInput": {} }));
    assert_matches(
        update(13),
        &json!({
            "toolCallId": "call_edit", "status": "completed",
            "content": [
                { "type": "content", "content": { "type": "text", "text": "edited" } },
                { "type": "diff", "path": edited, "oldText": "one\r\ntwo\r\n", "newText": "one\r\nthree\r\n" },
            ],
        }),
    );
}
