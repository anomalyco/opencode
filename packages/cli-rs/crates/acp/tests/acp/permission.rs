//! `permission.test.ts`. The log assertion of "withdraws permission requests settled elsewhere" is not
//! ported: logs go to the `log` facade.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{Value, json};

use crate::wire::{
    Reply, Wire, WireOptions, assert_matches, delivered, ephemeral_event, events, file_diff,
    interrupted, lock, permission_asked, start_session, start_wire, succeeded, tool_called,
    tool_started, turn,
};

fn allow_once() -> Reply {
    Reply::Result(json!({ "outcome": { "outcome": "selected", "optionId": "once" } }))
}

fn decisions(acp: &Wire) -> Vec<Value> {
    acp.server
        .state()
        .replies
        .iter()
        .map(|reply| json!([reply["requestID"], reply["decision"]]))
        .collect()
}

fn question(session: &str, id: &str) -> Value {
    ephemeral_event(
        "form.created",
        json!({ "form": {
            "id": id, "sessionID": session, "title": "Questions", "metadata": { "kind": "question" },
            "fields": [{ "key": "q0", "title": "Runtime", "type": "string", "options": [{ "value": "Bun", "label": "Bun" }] }],
        } }),
    )
}

#[tokio::test]
async fn forwards_allow_once_and_allow_always_selections_to_the_server() {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                turn(
                    session,
                    &call.id,
                    vec![
                        tool_started(session, "call_once", "shell"),
                        tool_called(session, "call_once", json!({ "command": "printf hello" })),
                        tool_started(session, "call_always", "read"),
                        tool_called(session, "call_always", json!({ "path": "/workspace/file.ts" })),
                        permission_asked(
                            session,
                            "perm_once",
                            json!({
                                "action": "shell", "metadata": { "command": "printf hello" },
                                "source": { "type": "tool", "messageID": "msg_allow", "id": "call_once" },
                            }),
                        ),
                        permission_asked(
                            session,
                            "perm_always",
                            json!({
                                "action": "read", "metadata": { "path": "/workspace/file.ts" },
                                "source": { "type": "tool", "messageID": "msg_allow", "id": "call_always" },
                            }),
                        ),
                        permission_asked(session, "perm_selected_reject", json!({})),
                        permission_asked(session, "perm_cancelled", json!({})),
                        permission_asked(session, "perm_failed", json!({})),
                    ],
                )
            })),
            permission: Some(Arc::new(|request| {
                match request["toolCall"]["toolCallId"].as_str().unwrap_or_default() {
                    "call_once" => allow_once(),
                    "call_always" => Reply::Result(
                        json!({ "outcome": { "outcome": "selected", "optionId": "always" } }),
                    ),
                    "perm_selected_reject" => Reply::Result(
                        json!({ "outcome": { "outcome": "selected", "optionId": "reject" } }),
                    ),
                    "perm_cancelled" => Reply::Result(json!({ "outcome": { "outcome": "cancelled" } })),
                    _ => Reply::Error("client permission UI failed".to_owned()),
                }
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;

    assert_eq!(
        acp.prompt(&acp.session_id, "hello").await.unwrap()["stopReason"],
        "end_turn"
    );

    let permissions = lock(&acp.permissions).clone();
    assert_matches(
        &permissions[0],
        &json!({
            "sessionId": acp.session_id,
            "toolCall": {
                "toolCallId": "call_once", "status": "pending", "title": "printf hello", "kind": "execute",
                "locations": [{ "path": "/workspace" }],
                "rawInput": { "command": "printf hello", "cwd": "/workspace" },
            },
            "options": [
                { "optionId": "once", "kind": "allow_once", "name": "Allow once" },
                { "optionId": "always", "kind": "allow_always", "name": "Always allow" },
                { "optionId": "reject", "kind": "reject_once", "name": "Reject" },
            ],
        }),
    );
    assert_matches(
        &permissions[1],
        &json!({
            "sessionId": acp.session_id,
            "toolCall": {
                "toolCallId": "call_always", "status": "pending", "title": "/workspace/file.ts", "kind": "read",
                "locations": [{ "path": "/workspace/file.ts" }], "rawInput": { "path": "/workspace/file.ts" },
            },
        }),
    );
    assert_eq!(
        decisions(&acp),
        vec![
            json!(["perm_once", "once"]),
            json!(["perm_always", "always"]),
            json!(["perm_selected_reject", "reject"]),
            json!(["perm_cancelled", "reject"]),
            json!(["perm_failed", "reject"]),
        ]
    );
}

async fn cancelling_the_turn_cancels_its_pending_ask(
    method: &str,
    prefix: &'static str,
    outcome: &str,
) {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(move |call| {
                let session = call.session_id.as_str();
                let ask = |id: String| {
                    if prefix == "perm" {
                        permission_asked(session, &id, json!({}))
                    } else {
                        question(session, &id)
                    }
                };
                vec![
                    delivered(session, &call.id),
                    ask(format!("{prefix}_pending")),
                    ask(format!("{prefix}_queued")),
                ]
            })),
            on_interrupt: Some(Arc::new(|session: String| {
                Box::pin(async move { vec![interrupted(&session)] })
            })),
            permission: Some(Arc::new(|_| {
                Reply::UntilCancelled(json!({ "outcome": { "outcome": "cancelled" } }))
            })),
            elicitation: Some(Arc::new(|_| {
                Reply::UntilCancelled(json!({ "action": "cancel" }))
            })),
            ..WireOptions::default()
        },
        json!({ "elicitation": { "form": {} } }),
    )
    .await;

    let prompt = tokio::spawn(acp.begin_prompt("hello"));
    acp.until("the pending ask", || {
        (lock(&acp.permissions).len() + lock(&acp.elicitations).len() == 1).then_some(())
    })
    .await;
    acp.notify("session/cancel", json!({ "sessionId": acp.session_id }));

    assert_eq!(prompt.await.unwrap().unwrap()["stopReason"], "cancelled");
    let settled = || -> Vec<Value> {
        let state = acp.server.state();
        state
            .replies
            .iter()
            .map(|reply| json!([reply["requestID"], reply["decision"]]))
            .chain(
                state
                    .cancelled_forms
                    .iter()
                    .map(|form| json!([form["formID"], "cancelled"])),
            )
            .collect()
    };
    acp.until("both asks settled", || (settled().len() == 2).then_some(()))
        .await;
    assert_eq!(
        settled(),
        vec![
            json!([format!("{prefix}_pending"), outcome]),
            json!([format!("{prefix}_queued"), outcome]),
        ]
    );
    assert!(acp.server.state().replied_forms.is_empty());
    let received = lock(&acp.received).clone();
    let asked: Vec<&Value> = received
        .iter()
        .filter(|message| message["method"] == method && message.get("id").is_some())
        .collect();
    assert_eq!(asked.len(), 1);
    assert!(received.contains(&json!({
        "jsonrpc": "2.0", "method": "$/cancel_request", "params": { "requestId": asked[0]["id"] },
    })));
}

#[tokio::test]
async fn cancelling_the_turn_cancels_its_pending_permission_request() {
    cancelling_the_turn_cancels_its_pending_ask("session/request_permission", "perm", "reject")
        .await;
}

#[tokio::test]
async fn cancelling_the_turn_cancels_its_pending_elicitation() {
    cancelling_the_turn_cancels_its_pending_ask("elicitation/create", "frm", "cancelled").await;
}

#[tokio::test]
async fn withdraws_permission_requests_settled_elsewhere_and_still_asks_the_remaining_one() {
    let asked = Arc::new(AtomicUsize::new(0));
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                vec![
                    delivered(session, &call.id),
                    permission_asked(session, "perm_elsewhere", json!({})),
                    permission_asked(session, "perm_queued", json!({})),
                    permission_asked(session, "perm_remaining", json!({})),
                ]
            })),
            fetch: Some(Arc::new(|server, request| {
                if request["path"]
                    .as_str()
                    .is_some_and(|path| path.ends_with("/permission/perm_remaining/reply"))
                {
                    let session = request["path"].as_str().unwrap().split('/').nth(3).unwrap();
                    server.send(&[succeeded(session)]);
                }
                None
            })),
            permission: Some(Arc::new(move |_| {
                if asked.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Reply::UntilCancelled(json!({ "outcome": { "outcome": "cancelled" } }));
                }
                allow_once()
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;

    let prompt = tokio::spawn(acp.begin_prompt("hello"));
    acp.until("permission request", || {
        (lock(&acp.permissions).len() == 1).then_some(())
    })
    .await;
    acp.server.send(&[
        ephemeral_event(
            "permission.replied",
            json!({ "sessionID": acp.session_id, "requestID": "perm_queued", "reply": "always" }),
        ),
        ephemeral_event(
            "permission.replied",
            json!({ "sessionID": acp.session_id, "requestID": "perm_elsewhere", "reply": "always" }),
        ),
    ]);

    assert_eq!(prompt.await.unwrap().unwrap()["stopReason"], "end_turn");
    let ids: Vec<Value> = lock(&acp.permissions)
        .iter()
        .map(|request| request["toolCall"]["toolCallId"].clone())
        .collect();
    assert_eq!(ids, vec![json!("perm_elsewhere"), json!("perm_remaining")]);
    assert_eq!(decisions(&acp), vec![json!(["perm_remaining", "once"])]);
    let cancels = lock(&acp.received)
        .iter()
        .filter(|message| message["method"] == "$/cancel_request")
        .count();
    assert_eq!(cancels, 1);
}

fn edit(session: &str, call: &str, tool: &str, input: Value, metadata: Value) -> Vec<Value> {
    vec![
        tool_started(session, call, tool),
        tool_called(session, call, input),
        permission_asked(
            session,
            &format!("perm_{call}"),
            json!({
                "action": "edit", "metadata": metadata,
                "source": { "type": "tool", "messageID": "msg_edit", "id": call },
            }),
        ),
    ]
}

fn patch(lines: &[&str]) -> String {
    let mut all = vec!["*** Begin Patch"];
    all.extend(lines);
    all.push("*** End Patch");
    all.join("\n")
}

#[tokio::test]
async fn previews_added_files_as_new_and_deleted_files_as_empty() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap().to_owned();
    for (name, content) in [
        ("file.ts", "one\r\ntwo\r\n"),
        ("first.ts", "one\n"),
        ("second.ts", "alpha\n"),
        ("gone.ts", "gone\n"),
        ("stale.ts", "changed\n"),
        ("unpatched.ts", "changed\n"),
    ] {
        std::fs::write(dir.path().join(name), content).unwrap();
    }
    std::fs::create_dir(dir.path().join("folder")).unwrap();
    let file = |name: &str| format!("{root}/{name}");
    let acp = start_wire(WireOptions {
        on_prompt: Some(events(|call| {
            let session = call.session_id.as_str();
            let mut events = Vec::new();
            events.extend(edit(
                session,
                "call_edit",
                "edit",
                json!({ "path": "file.ts", "oldString": "one\ntwo", "newString": "one\nthree" }),
                json!({ "files": [file_diff("file.ts", "one\r\ntwo\r\n", "one\r\nthree\r\n", "modified")] }),
            ));
            events.extend(edit(
                session,
                "call_patch",
                "patch",
                json!({ "patchText": patch(&[
                    "*** Update File: first.ts", "@@", "-one", "+two",
                    "*** Update File: second.ts", "@@", "-alpha", "+beta",
                ]) }),
                json!({}),
            ));
            events.extend(edit(
                session,
                "call_write",
                "write",
                json!({ "path": "written.ts", "content": "two\n" }),
                json!({ "files": [file_diff("written.ts", "", "two\n", "added")] }),
            ));
            events.extend(edit(
                session,
                "call_add",
                "patch",
                json!({ "patchText": patch(&["*** Add File: added.ts", "+one"]) }),
                json!({}),
            ));
            events.push(permission_asked(
                session,
                "perm_delete",
                json!({ "action": "edit", "metadata": { "files": [file_diff("gone.ts", "gone\n", "", "deleted")] } }),
            ));
            events.push(permission_asked(
                session,
                "perm_stale",
                json!({
                    "action": "edit", "resources": ["stale.ts"],
                    "metadata": { "files": [file_diff("stale.ts", "one\n", "two\n", "modified")] },
                }),
            ));
            events.push(permission_asked(
                session,
                "perm_folder",
                json!({
                    "action": "edit", "resources": ["folder"],
                    "metadata": { "files": [file_diff("folder", "one\n", "two\n", "modified")] },
                }),
            ));
            events.extend(edit(
                session,
                "call_unpatched",
                "patch",
                json!({ "patchText": patch(&["*** Update File: unpatched.ts", "@@", "-one", "+two"]) }),
                json!({}),
            ));
            turn(session, &call.id, events)
        })),
        permission: Some(Arc::new(|_| allow_once())),
        ..WireOptions::default()
    })
    .await;
    acp.initialize(json!({})).await;
    let session = acp.new_session(&root, json!([])).await.unwrap();

    acp.prompt(session["sessionId"].as_str().unwrap(), "hello")
        .await
        .unwrap();

    let permissions = lock(&acp.permissions).clone();
    let diff = |name: &str, old: Value, new: &str| json!({ "type": "diff", "path": file(name), "oldText": old, "newText": new });
    let contents: Vec<Value> = permissions
        .iter()
        .map(|request| {
            request["toolCall"]
                .get("content")
                .cloned()
                .unwrap_or(Value::Null)
        })
        .collect();
    assert_eq!(
        contents,
        vec![
            json!([diff("file.ts", json!("one\r\ntwo\r\n"), "one\r\nthree\r\n")]),
            json!([
                diff("first.ts", json!("one\n"), "two\n"),
                diff("second.ts", json!("alpha\n"), "beta\n"),
            ]),
            json!([diff("written.ts", Value::Null, "two\n")]),
            json!([diff("added.ts", Value::Null, "one\n")]),
            json!([diff("gone.ts", json!("gone\n"), "")]),
            Value::Null,
            Value::Null,
            Value::Null,
        ]
    );
    assert_matches(
        &json!([permissions[0]["toolCall"], permissions[1]["toolCall"]]),
        &json!([
            { "title": "file.ts", "kind": "edit", "locations": [{ "path": file("file.ts") }] },
            { "title": "2 files", "kind": "edit", "locations": [{ "path": file("first.ts") }, { "path": file("second.ts") }] },
        ]),
    );
    let locations: Vec<Value> = permissions[5..]
        .iter()
        .map(|request| request["toolCall"]["locations"].clone())
        .collect();
    assert_eq!(
        locations,
        vec![
            json!([{ "path": file("stale.ts") }]),
            json!([{ "path": file("folder") }]),
            json!([{ "path": file("unpatched.ts") }]),
        ]
    );
    assert_eq!(permissions[0]["toolCall"]["name"], "edit");
    assert!(permissions[4]["toolCall"].get("name").is_none());
    assert_eq!(decisions(&acp).len(), 8);
}
