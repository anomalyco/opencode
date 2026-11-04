//! Port of `packages/client/test/solid-inbox-race.test.ts`.

mod common;

use common::*;
use futures_util::FutureExt;
use opencode_api::generated::*;
use opencode_store::{Data, MessageExt, Options, Prompt};
use serde_json::{Value, json};

const SESSION: &str = "ses_remote";

fn session() -> SessionID {
    SessionID(SESSION.into())
}

fn item() -> Value {
    json!({
        "id": "msg_remote", "sessionID": SESSION, "type": "user", "delivery": "steer",
        "time": { "created": 1 }, "payload": { "text": "Check the remote preview" },
    })
}

fn enqueued() -> Value {
    json!({
        "id": "evt_enqueued", "type": "session.inbox.enqueued", "created": 1,
        "durable": { "aggregateID": SESSION, "seq": 1, "version": 1 },
        "data": {
            "sessionID": SESSION, "inboxID": "msg_remote",
            "item": { "type": "user", "delivery": "steer", "payload": { "text": "Check the remote preview" } },
        },
    })
}

/// Every request waits for `response`; POSTs for `admission` when given.
fn fixture(response: &Slot<Reply>, admission: Option<&Slot<Reply>>) -> Data {
    let response = response.clone();
    let admission = admission.cloned();
    data(
        handler(move |req: Req| match (&admission, req.method.as_str()) {
            (Some(admission), "POST") => admission.wait(),
            _ => response.wait(),
        }),
        Options::default(),
    )
}

fn pending(data: &Data) -> Vec<SessionInboxInfo> {
    data.read(|state| state.pending(&session()).to_vec())
}

fn items(value: Value) -> Vec<SessionInboxInfo> {
    serde_json::from_value(value).unwrap()
}

async fn consumed(action: &str) {
    let response = Slot::<Reply>::default();
    let data = fixture(&response, None);
    emit(&data, enqueued());
    let reading = data.pending_sync(&session());
    emit(
        &data,
        json!({
            "id": "evt_consumed", "type": format!("session.inbox.{action}"), "created": 2,
            "durable": { "aggregateID": SESSION, "seq": 2, "version": 1 },
            "data": { "sessionID": SESSION, "inboxID": "msg_remote" },
        }),
    );
    assert!(!data.read(|state| state.has_input(&session(), "msg_remote")));
    response.resolve(ok(json!({ "data": [item()] })));
    reading.await.unwrap();
    assert!(!data.read(|state| state.has_input(&session(), "msg_remote")));
    let created = data.read(|state| {
        state
            .message(&session(), "msg_remote")
            .map(|message| message.created())
    });
    match action {
        "cancelled" => assert_eq!(created, None),
        _ => assert_eq!(created, Some(2.0)),
    }
}

#[tokio::test]
async fn a_delayed_inbox_snapshot_cannot_resurrect_a_delivered_prompt() {
    consumed("delivered").await;
}

#[tokio::test]
async fn a_delayed_inbox_snapshot_cannot_resurrect_a_cancelled_prompt() {
    consumed("cancelled").await;
}

async fn retains(action: &str) {
    let response = Slot::<Reply>::default();
    let data = fixture(&response, None);
    let reading = data.pending_sync(&session());
    emit(
        &data,
        match action {
            "enqueue" => enqueued(),
            _ => json!({
                "id": "evt_delivery", "type": "session.inbox.delivery.changed", "created": 2,
                "durable": { "aggregateID": SESSION, "seq": 2, "version": 1 },
                "data": { "sessionID": SESSION, "inboxID": "msg_remote", "delivery": "steer" },
            }),
        },
    );
    let snapshot = match action {
        "enqueue" => json!([]),
        _ => {
            let mut queued = item();
            queued["delivery"] = json!("queue");
            json!([queued])
        }
    };
    response.resolve(ok(json!({ "data": snapshot })));
    reading.await.unwrap();
    assert_eq!(pending(&data), items(json!([item()])));
}

#[tokio::test]
async fn inbox_hydration_retains_a_concurrent_enqueue_event() {
    retains("enqueue").await;
}

#[tokio::test]
async fn inbox_hydration_retains_a_concurrent_delivery_event() {
    retains("delivery").await;
}

#[tokio::test]
async fn hydration_preserves_submission_order_across_optimistic_admissions() {
    let response = Slot::<Reply>::default();
    let admission = Slot::<Reply>::default();
    let data = fixture(&response, Some(&admission));
    admission.resolve(ok(json!({ "data": {
        "id": "msg_admitted", "sessionID": SESSION, "type": "user", "delivery": "steer",
        "time": { "created": 1 }, "payload": { "text": "" },
    } })));
    let gate = Slot::<()>::default();
    let prompt = |id: &str, text: &str| {
        let wait = gate.wait();
        data.prompt(Prompt {
            input: SessionPromptInput {
                session_id: session(),
                id: Some(Some(SessionMessageID(id.into()))),
                text: text.into(),
                ..Default::default()
            },
            gate: Some(
                async move {
                    wait.await;
                    Ok(())
                }
                .boxed(),
            ),
            prepare: None,
        })
    };
    let first = prompt("msg_first", "First");
    let reading = data.pending_sync(&session());
    let second = prompt("msg_second", "Second");
    response.resolve(ok(json!({ "data": [] })));
    reading.await.unwrap();
    assert_eq!(
        data.read(|state| state
            .inputs(&session())
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>()),
        ["msg_first", "msg_second"]
    );
    gate.resolve(());
    first.await.unwrap();
    second.await.unwrap();
}

#[tokio::test]
async fn hydration_coalesces_a_concurrent_optimistic_compaction_even_if_its_post_fails() {
    let response = Slot::<Reply>::default();
    let admission = Slot::<Reply>::default();
    let data = fixture(&response, Some(&admission));
    let canonical = json!({
        "id": "msg_canonical", "sessionID": SESSION, "type": "compaction", "delivery": "steer",
        "time": { "created": 1 }, "payload": {},
    });
    let reading = data.pending_sync(&session());
    let compacting = data.compact(&session(), None);
    response.resolve(ok(json!({ "data": [canonical] })));
    reading.await.unwrap();
    assert_eq!(pending(&data), items(json!([canonical])));
    // The TS test rejects the POST with "Connection closed"; a transport failure here.
    admission.resolve(Reply::Text(502, "Connection closed".into()));
    assert!(compacting.await.is_err());
    assert_eq!(pending(&data), items(json!([canonical])));
}
