//! `elicitation.test.ts`.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use opencode_acp::capabilities::Capabilities;
use opencode_acp::elicitation::requested_schema;
use serde_json::{Value, json};

use crate::wire::{
    Reply, WireOptions, assert_matches, delivered, ephemeral_event, events, lock, start_session, succeeded, text_delta,
    tool_started, tool_succeeded,
};

fn questions(session: &str, id: &str) -> Value {
    ephemeral_event(
        "form.created",
        json!({ "form": {
            "id": id, "sessionID": session, "title": "Questions",
            "metadata": { "kind": "question", "tool": { "messageID": "msg_tools", "id": "call_question" } },
            "fields": [
                {
                    "key": "q0", "title": "Runtime", "description": "Which runtime?", "type": "string",
                    "options": [
                        { "value": "Bun", "label": "Bun", "description": "Fast" },
                        { "value": "Node", "label": "Node", "description": "Stable" },
                    ],
                    "custom": true,
                },
                {
                    "key": "q1", "title": "Goals", "description": "What matters?", "type": "multiselect",
                    "options": [{ "value": "Fast", "label": "Fast", "description": "Speed" }],
                    "custom": true,
                },
            ],
        } }),
    )
}

const CAPABLE: Capabilities = Capabilities { child_session_updates: false, form_elicitation: true, compaction: false };

fn form(fields: Value, metadata: Value) -> Value {
    json!({ "id": "frm_test", "sessionID": "ses_test", "title": "Test", "metadata": metadata, "fields": fields })
}

#[test]
fn cancels_forms_from_unsupported_clients_unknown_flows_and_credential_looking_fields() {
    let fields = json!([{ "key": "name", "type": "string" }]);
    let question = json!({ "kind": "question" });
    let unsupported = Capabilities { form_elicitation: false, ..CAPABLE };
    assert!(requested_schema(&form(fields.clone(), question.clone()), &unsupported).is_none());
    assert!(requested_schema(&form(fields.clone(), json!({ "kind": "mcp-elicitation" })), &CAPABLE).is_none());
    assert!(requested_schema(&form(fields.clone(), json!({})), &CAPABLE).is_none());
    assert!(requested_schema(&form(fields, json!({ "kind": "websearch.provider" })), &CAPABLE).is_some());
    let credentials = [
        json!([{ "key": "api_key", "type": "string" }]),
        json!([{ "key": "q0", "title": "GitHub token", "type": "string" }]),
        json!([{ "key": "q0", "title": "Password", "type": "string", "hidden": true, "default": "" }]),
        json!([{ "key": "q0", "title": "Setup", "description": "Paste your API key", "type": "string" }]),
        json!([{ "key": "q0", "title": "Setup", "type": "string", "options": [{ "value": "a", "label": "Use my access token" }] }]),
    ];
    for fields in credentials {
        assert!(requested_schema(&form(fields.clone(), question.clone()), &CAPABLE).is_none(), "{fields}");
    }
}

#[test]
fn builds_the_schema_for_selects_with_a_custom_answer() {
    let schema = requested_schema(
        &form(
            json!([
                { "key": "q0", "title": "Runtime", "type": "string", "required": true, "options": [{ "value": "Bun", "label": "Bun" }], "default": "Bun" },
                { "key": "q1", "title": "Goals", "type": "multiselect", "options": [{ "value": "Fast", "label": "Fast" }], "custom": true },
                { "key": "q2", "type": "integer", "minimum": 1 },
                { "key": "q3", "type": "string", "hidden": true, "default": "x" },
            ]),
            json!({ "kind": "question" }),
        ),
        &CAPABLE,
    )
    .unwrap();
    assert_eq!(
        schema,
        json!({
            "type": "object",
            "properties": {
                "q0": { "type": "string", "title": "Runtime", "oneOf": [{ "const": "Bun", "title": "Bun" }], "default": "Bun" },
                "q1": { "type": "array", "title": "Goals", "items": { "anyOf": [{ "const": "Fast", "title": "Fast" }] } },
                "q1_custom": { "type": "string", "title": "Goals (other)", "description": "Add your own answer" },
                "q2": { "type": "integer", "minimum": 1 },
            },
            "required": ["q0"],
        })
    );
    // A required custom select cannot leave the custom answer optional.
    assert!(
        requested_schema(
            &form(
                json!([{ "key": "q0", "type": "string", "required": true, "custom": true, "options": [] }]),
                json!({ "kind": "question" }),
            ),
            &CAPABLE,
        )
        .is_none()
    );
}

#[tokio::test]
async fn answers_a_question_form_through_elicitation_and_continues_the_turn() {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                vec![
                    delivered(session, &call.id),
                    tool_started(session, "call_question", "question"),
                    questions(session, "frm_question"),
                ]
            })),
            elicitation: Some(Arc::new(|_| {
                Reply::Result(json!({
                    "action": "accept",
                    "content": { "q0": "Bun", "q1": ["Fast"], "q1_custom": "Small" },
                }))
            })),
            on_form_reply: Some(Arc::new(|reply: Value| {
                Box::pin(async move {
                    let session = reply["sessionID"].as_str().unwrap().to_owned();
                    vec![
                        ephemeral_event(
                            "form.replied",
                            json!({ "sessionID": session, "id": reply["formID"], "answer": {} }),
                        ),
                        tool_succeeded(&session, "call_question", json!({}), "answered"),
                        text_delta(&session, "msg_after", "thanks", 0),
                        succeeded(&session),
                    ]
                })
            })),
            ..WireOptions::default()
        },
        json!({ "elicitation": { "form": {} } }),
    )
    .await;

    assert_eq!(acp.prompt(&acp.session_id, "hello").await.unwrap()["stopReason"], "end_turn");
    assert_matches(
        &json!(lock(&acp.elicitations).clone()),
        &json!([{ "mode": "form", "sessionId": acp.session_id, "toolCallId": "call_question", "message": "Questions" }]),
    );
    assert_eq!(
        acp.server.state().replied_forms,
        vec![json!({
            "sessionID": acp.session_id, "formID": "frm_question",
            "answer": { "q0": "Bun", "q1": ["Fast", "Small"] },
        })]
    );
    assert!(acp.server.state().cancelled_forms.is_empty());
    assert!(acp.updates().iter().any(|item| item["update"]["sessionUpdate"] == "agent_message_chunk"));
}

#[tokio::test]
async fn cancels_the_form_when_the_client_declines_cancels_fails_or_sends_a_wrong_value_type() {
    const IDS: [&str; 4] = ["frm_decline", "frm_cancel", "frm_fail", "frm_invalid"];
    let answered = Arc::new(AtomicUsize::new(0));
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                let session = call.session_id.as_str();
                let mut events = vec![delivered(session, &call.id)];
                events.extend(IDS.iter().map(|id| questions(session, id)));
                events
            })),
            elicitation: Some(Arc::new(move |_| match answered.fetch_add(1, Ordering::SeqCst) {
                0 => Reply::Result(json!({ "action": "decline" })),
                1 => Reply::Result(json!({ "action": "cancel" })),
                2 => Reply::Error("elicitation UI failed".to_owned()),
                _ => Reply::Result(json!({ "action": "accept", "content": { "q0": { "nested": true } } })),
            })),
            on_form_cancel: Some(Arc::new({
                let cancelled = Arc::new(AtomicUsize::new(0));
                move |(session, _): (String, String)| {
                    let done = cancelled.fetch_add(1, Ordering::SeqCst) + 1 == IDS.len();
                    Box::pin(async move { if done { vec![succeeded(&session)] } else { Vec::new() } })
                }
            })),
            ..WireOptions::default()
        },
        json!({ "elicitation": { "form": {} } }),
    )
    .await;

    assert_eq!(acp.prompt(&acp.session_id, "hello").await.unwrap()["stopReason"], "end_turn");
    assert_eq!(lock(&acp.elicitations).len(), IDS.len());
    let state = acp.server.state();
    let forms: Vec<Value> = state.cancelled_forms.iter().map(|form| form["formID"].clone()).collect();
    assert_eq!(forms, IDS.map(|id| json!(id)).to_vec());
    assert!(state.cancelled_forms.iter().all(|form| form.get("message").is_none()));
    assert!(state.replied_forms.is_empty());
    assert!(state.interrupts.is_empty());
}
