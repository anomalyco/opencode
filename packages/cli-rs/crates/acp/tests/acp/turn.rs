//! `turn.test.ts`.

use std::sync::Arc;

use serde_json::{Value, json};

use crate::wire::{
    Reply, WireOptions, assert_matches, child_created, delivered, durable_event, ephemeral_event, events, lock,
    permission_asked, start_session, succeeded, text_delta, tool_called, tool_started, tool_succeeded, turn,
};

fn child_work() -> WireOptions {
    WireOptions {
        on_prompt: Some(events(|call| {
            let session = call.session_id.as_str();
            if call.count > 1 {
                return turn(session, &call.id, Vec::new());
            }
            turn(
                session,
                &call.id,
                vec![
                    child_created("ses_child", session, "Explore code"),
                    durable_event("session.execution.started", json!({ "sessionID": "ses_child" })),
                    child_created("ses_grandchild", "ses_child", "Deeper"),
                    tool_started("ses_grandchild", "call_read", "read"),
                    tool_called("ses_grandchild", "call_read", json!({ "path": "/workspace/src/index.ts" })),
                    permission_asked(
                        "ses_grandchild",
                        "perm_child",
                        json!({ "action": "read", "source": { "type": "tool", "messageID": "msg_child", "id": "call_read" } }),
                    ),
                    tool_succeeded("ses_grandchild", "call_read", json!({}), "source"),
                    succeeded("ses_grandchild"),
                    child_created("ses_background", session, "Research"),
                    succeeded("ses_child"),
                ],
            )
        })),
        permission: Some(Arc::new(|_| {
            Reply::Result(json!({ "outcome": { "outcome": "selected", "optionId": "once" } }))
        })),
        ..WireOptions::default()
    }
}

async fn child_sessions(child_session_updates: bool, parent: Value, child: Value) {
    let acp =
        start_session(child_work(), json!({ "_meta": { "opencode/child-session-updates": child_session_updates } }))
            .await;

    assert_eq!(acp.prompt(&acp.session_id, "hello").await.unwrap()["stopReason"], "end_turn");
    let responded = acp.turn_updates().len();
    acp.server.send(&[
        durable_event("session.execution.started", json!({ "sessionID": "ses_background" })),
        permission_asked(
            "ses_background",
            "perm_background",
            json!({ "action": "read", "metadata": { "path": "/workspace/notes.md" } }),
        ),
        text_delta("ses_background", "msg_background", "late", 0),
        succeeded("ses_background"),
        permission_asked("ses_background", "perm_after_end", json!({ "action": "read" })),
    ]);
    acp.until("child permission replies", || (acp.server.state().replies.len() == 2).then_some(())).await;
    assert_eq!(acp.turn_updates().len(), responded);
    assert_eq!(acp.prompt(&acp.session_id, "again").await.unwrap()["stopReason"], "end_turn");

    let parents: Vec<Value> = acp.turn_updates().into_iter().map(|item| item["update"].clone()).collect();
    assert_matches(&json!(parents), &parent);
    assert_matches(&json!(lock(&acp.child_updates).clone()), &child);
    let grandchild = json!({ "opencode/child-session": { "id": "ses_grandchild", "parentID": "ses_child", "depth": 2, "title": "Deeper" } });
    assert_matches(
        &json!(lock(&acp.permissions).clone()),
        &json!([
            { "sessionId": acp.session_id, "toolCall": { "toolCallId": "ses_grandchild:call_read", "title": "Deeper: /workspace/src/index.ts", "_meta": grandchild } },
            {
                "sessionId": acp.session_id,
                "toolCall": {
                    "toolCallId": "ses_background:perm_background",
                    "title": "Research: /workspace/notes.md",
                    "_meta": { "opencode/child-session": { "id": "ses_background", "parentID": acp.session_id, "depth": 1, "title": "Research" } },
                },
            },
        ]),
    );
    assert_eq!(
        acp.server.state().replies,
        vec![
            json!({ "sessionID": "ses_grandchild", "requestID": "perm_child", "decision": "once" }),
            json!({ "sessionID": "ses_background", "requestID": "perm_background", "decision": "once" }),
        ]
    );
}

#[tokio::test]
async fn shows_nested_and_background_child_work_on_the_parent_without_the_child_capability() {
    let grandchild = json!({ "opencode/child-session": { "id": "ses_grandchild", "parentID": "ses_child", "depth": 2, "title": "Deeper" } });
    child_sessions(
        false,
        json!([
            { "sessionUpdate": "tool_call", "toolCallId": "ses_grandchild:call_read", "title": "Deeper: read", "_meta": grandchild },
            { "sessionUpdate": "tool_call_update", "toolCallId": "ses_grandchild:call_read", "status": "in_progress" },
            { "sessionUpdate": "tool_call_update", "toolCallId": "ses_grandchild:call_read", "status": "completed" },
        ]),
        json!([]),
    )
    .await;
}

#[tokio::test]
async fn sends_nested_and_background_child_work_through_the_extension() {
    child_sessions(
        true,
        json!([]),
        json!([
            { "childSessionId": "ses_child", "depth": 1, "type": "status", "status": "created" },
            { "childSessionId": "ses_child", "type": "status", "status": "running" },
            { "childSessionId": "ses_grandchild", "parentSessionId": "ses_child", "depth": 2, "title": "Deeper", "status": "created" },
            { "childSessionId": "ses_grandchild", "update": { "sessionUpdate": "tool_call", "toolCallId": "ses_grandchild:call_read" } },
            { "childSessionId": "ses_grandchild", "update": { "sessionUpdate": "tool_call_update", "status": "in_progress" } },
            { "childSessionId": "ses_grandchild", "update": { "sessionUpdate": "tool_call_update", "status": "completed" } },
            { "childSessionId": "ses_grandchild", "type": "status", "status": "completed" },
            { "childSessionId": "ses_background", "type": "status", "status": "created" },
            { "childSessionId": "ses_child", "type": "status", "status": "completed" },
            { "childSessionId": "ses_background", "type": "status", "status": "running" },
            { "childSessionId": "ses_background", "type": "update", "update": { "sessionUpdate": "agent_message_chunk" } },
            { "childSessionId": "ses_background", "type": "status", "status": "completed" },
        ]),
    )
    .await;
}

#[tokio::test]
async fn streams_resumed_parent_turns_after_background_children_report_across_prompts() {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                match call.text.as_str() {
                    "launch" => turn(
                        session,
                        &call.id,
                        vec![
                            child_created("ses_first", session, "First"),
                            child_created("ses_second", session, "Second"),
                        ],
                    ),
                    "followup" => turn(
                        session,
                        &call.id,
                        vec![durable_event("session.execution.started", json!({ "sessionID": "ses_first" }))],
                    ),
                    _ => turn(
                        session,
                        &call.id,
                        vec![
                            text_delta("ses_second", "msg_child_2", "older child during chat", 0),
                            text_delta(session, "msg_chat", "chat reply", 0),
                        ],
                    ),
                }
            })),
            permission: Some(Arc::new(|_| {
                Reply::Result(json!({ "outcome": { "outcome": "selected", "optionId": "once" } }))
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;
    let session = acp.session_id.clone();
    let reaction = |text: &'static str| move |item: &Value| item.to_string().contains(text);

    assert_eq!(acp.prompt(&session, "launch").await.unwrap()["stopReason"], "end_turn");
    let mut report = vec![text_delta("ses_first", "msg_child", "child only", 0), succeeded("ses_first")];
    report.extend(turn(&session, "msg_report_1", vec![text_delta(&session, "msg_reaction_1", "first reaction", 0)]));
    report.push(text_delta(&session, "msg_stale", "stale", 0));
    acp.server.send(&report);
    acp.wait_for_update("first reaction", reaction("first reaction")).await;

    assert_eq!(acp.prompt(&session, "chat").await.unwrap()["stopReason"], "end_turn");
    let mut report =
        vec![permission_asked("ses_second", "perm_second", json!({ "action": "read" })), succeeded("ses_second")];
    report.extend(turn(&session, "msg_report_2", vec![text_delta(&session, "msg_reaction_2", "second reaction", 0)]));
    acp.server.send(&report);
    acp.wait_for_update("second reaction", reaction("second reaction")).await;
    acp.until("second child permission reply", || (acp.server.state().replies.len() == 1).then_some(())).await;

    assert_eq!(acp.prompt(&session, "followup").await.unwrap()["stopReason"], "end_turn");
    let mut report = vec![succeeded("ses_first")];
    report.extend(turn(&session, "msg_report_3", vec![text_delta(&session, "msg_reaction_3", "followup reaction", 0)]));
    acp.server.send(&report);
    acp.wait_for_update("followup reaction", reaction("followup reaction")).await;

    assert_eq!(
        acp.server.state().replies,
        vec![json!({ "sessionID": "ses_second", "requestID": "perm_second", "decision": "once" })]
    );
    let updates: Vec<Value> = acp.turn_updates().into_iter().map(|item| item["update"].clone()).collect();
    assert_matches(
        &json!(updates),
        &json!([
            { "messageId": "msg_reaction_1", "content": { "text": "first reaction" } },
            { "messageId": "msg_chat", "content": { "text": "chat reply" } },
            { "messageId": "msg_reaction_2", "content": { "text": "second reaction" } },
            { "messageId": "msg_reaction_3", "content": { "text": "followup reaction" } },
        ]),
    );
}

#[tokio::test]
async fn cancels_unsupported_session_forms_so_execution_can_continue() {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                vec![
                    delivered(session, &call.id),
                    ephemeral_event(
                        "form.created",
                        json!({ "form": {
                            "id": "frm_question", "sessionID": session, "title": "Questions",
                            "metadata": { "kind": "question" },
                            "fields": [{ "key": "q0", "title": "Choice", "type": "string" }],
                        } }),
                    ),
                ]
            })),
            on_form_cancel: Some(Arc::new(|(session, form): (String, String)| {
                Box::pin(async move {
                    vec![
                        ephemeral_event("form.cancelled", json!({ "sessionID": session, "id": form })),
                        succeeded(&session),
                    ]
                })
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;

    assert_eq!(acp.prompt(&acp.session_id, "hello").await.unwrap()["stopReason"], "end_turn");
    assert_eq!(
        acp.server.state().cancelled_forms,
        vec![json!({
            "sessionID": acp.session_id,
            "formID": "frm_question",
            "message": opencode_acp::elicitation::UNSHOWN_QUESTION_MESSAGE,
        })]
    );
    assert!(lock(&acp.elicitations).is_empty());
}

#[tokio::test]
async fn steers_a_running_session_and_leaves_an_idle_one_alone() {
    let acp = start_session(WireOptions::default(), json!({})).await;
    let steer = || {
        acp.request(
            "_session/steering",
            json!({ "sessionId": acp.session_id, "prompt": [{ "type": "text", "text": "redirect" }] }),
        )
    };

    assert_eq!(steer().await.unwrap(), json!({ "outcome": "promptRequired", "reason": "noRunningTurn" }));
    assert_eq!(acp.server.state().submissions, Vec::<Value>::new());

    acp.server.state().active.push(acp.session_id.clone());
    assert_eq!(steer().await.unwrap(), json!({ "outcome": "injected" }));
    let prompts = acp.server.state().prompts();
    assert_eq!(prompts.len(), 1);
    assert_matches(&prompts[0], &json!({ "text": "redirect", "delivery": "steer", "resume": false }));
}
