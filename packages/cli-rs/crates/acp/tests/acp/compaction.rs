//! `compaction.test.ts`.

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::Notify;

use crate::wire::{
    Wire, WireOptions, durable_event, enqueued, ephemeral_event, lock, start_session, turn,
};

const SUMMARY: &str = "Summary of the earlier conversation";

/// Holds the compact response so the test can publish the turn's events while the request is in
/// flight. Returns the wire, the compaction ID, and the prompt response.
async fn compact_turn(
    events: impl Fn(&str, &str) -> Vec<Value>,
    capabilities: Value,
) -> (Wire, String, Value) {
    let release = Arc::new(Notify::new());
    let held = release.clone();
    let acp = start_session(
        WireOptions {
            fetch: Some(Arc::new(move |_, request| {
                let path = request["path"].as_str()?;
                if !path.ends_with("/compact") {
                    return None;
                }
                let session = path.split('/').nth(3)?.to_owned();
                let id = request["body"]["id"].as_str()?.to_owned();
                let held = held.clone();
                Some(Box::pin(async move {
                    held.notified().await;
                    enqueued(&session, &id, "compaction", json!({}))
                }))
            })),
            ..WireOptions::default()
        },
        capabilities,
    )
    .await;
    let response = tokio::spawn(acp.begin_prompt("/compact"));
    let id = acp
        .until("compact request", || {
            acp.server
                .state()
                .recorded
                .iter()
                .find(|request| {
                    request["path"]
                        .as_str()
                        .is_some_and(|path| path.ends_with("/compact"))
                })
                .map(|request| request["body"]["id"].as_str().unwrap().to_owned())
        })
        .await;
    acp.server
        .send(&turn(&acp.session_id, &id, events(&acp.session_id, &id)));
    release.notify_one();
    let response = response.await.unwrap().unwrap();
    (acp, id, response)
}

fn turn_updates(acp: &Wire) -> Vec<Value> {
    lock(&acp.updates)
        .iter()
        .filter(|item| {
            !matches!(
                item["update"]["sessionUpdate"].as_str(),
                Some("available_commands_update" | "usage_update")
            )
        })
        .cloned()
        .collect()
}

#[tokio::test]
async fn streams_a_compact_turns_summary_and_completes_it_with_the_full_summary() {
    let (acp, id, response) = compact_turn(
        |session, id| {
            vec![
                durable_event(
                    "session.compaction.started",
                    json!({ "sessionID": session, "reason": "manual", "inputID": id }),
                ),
                ephemeral_event(
                    "session.compaction.delta",
                    json!({ "sessionID": session, "text": "Summary of " }),
                ),
                ephemeral_event(
                    "session.compaction.delta",
                    json!({ "sessionID": session, "text": "the earlier conversation" }),
                ),
                durable_event(
                    "session.compaction.ended",
                    json!({ "sessionID": session, "reason": "manual", "text": SUMMARY }),
                ),
            ]
        },
        json!({ "session": { "compaction": {} } }),
    )
    .await;

    let session = acp.session_id.clone();
    let chunk = |text: &str| json!({ "sessionId": session, "update": { "sessionUpdate": "compaction_summary_chunk", "compactionId": id, "content": { "type": "text", "text": text } } });
    assert_eq!(
        turn_updates(&acp),
        vec![
            json!({ "sessionId": session, "update": { "sessionUpdate": "compaction_update", "compactionId": id, "status": "in_progress" } }),
            chunk("Summary of "),
            chunk("the earlier conversation"),
            json!({ "sessionId": session, "update": {
                "sessionUpdate": "compaction_update", "compactionId": id, "status": "completed",
                "summary": [{ "type": "text", "text": SUMMARY }],
            } }),
        ]
    );
    assert_eq!(response["stopReason"], "end_turn");
}

#[tokio::test]
async fn treats_a_null_compaction_capability_as_unsupported() {
    let (acp, id, _) = compact_turn(
        |session, id| {
            vec![
                durable_event(
                    "session.compaction.started",
                    json!({ "sessionID": session, "reason": "manual", "inputID": id }),
                ),
                ephemeral_event(
                    "session.compaction.delta",
                    json!({ "sessionID": session, "text": SUMMARY }),
                ),
                durable_event(
                    "session.compaction.ended",
                    json!({ "sessionID": session, "reason": "manual", "text": SUMMARY }),
                ),
            ]
        },
        json!({ "session": { "compaction": null } }),
    )
    .await;

    let marker = |status: &str| {
        json!({ "sessionId": acp.session_id, "update": {
            "sessionUpdate": "session_info_update",
            "_meta": { "opencode/compaction": { "status": status, "messageId": id, "reason": "manual" } },
        } })
    };
    assert_eq!(
        turn_updates(&acp),
        vec![marker("started"), marker("completed")]
    );
}
