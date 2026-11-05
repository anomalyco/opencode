//! Port of `packages/client/test/solid-eviction.test.ts`.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use common::*;
use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use opencode_api::generated::*;
use opencode_store::{Data, MessageExt, Options, SessionStatus};
use serde_json::json;

fn id(value: &str) -> SessionID {
    SessionID(value.into())
}

fn info(session: &str, parent: Option<&str>) -> SessionInfo {
    serde_json::from_value(json!({
        "id": session, "parentID": parent, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 0, "updated": 0 }, "location": { "directory": "/project" },
    }))
    .unwrap()
}

fn enqueued(session: &str, inbox: &str) -> serde_json::Value {
    json!({
        "id": format!("evt_{inbox}"), "created": 1, "type": "session.inbox.enqueued",
        "durable": { "aggregateID": session, "seq": 1, "version": 1 },
        "data": {
            "sessionID": session, "inboxID": inbox,
            "item": { "type": "user", "delivery": "steer", "payload": { "text": "pending" } },
        },
    })
}

type Read = Arc<dyn Fn(&Req) -> Option<BoxFuture<'static, Reply>> + Send + Sync>;

/// Inbox reads list one pending prompt, message reads one page with an older cursor; `read` may
/// answer first.
fn fixture(read: Option<Read>) -> Data {
    let data = data(
        handler(move |req: Req| {
            let answer = read.as_ref().and_then(|read| read(&req));
            async move {
                if let Some(answer) = answer {
                    return answer.await;
                }
                let session = req.path.split('/').nth(3).unwrap_or_default().to_owned();
                if req.path.ends_with("/inbox") {
                    return ok(json!({ "data": [{
                        "id": "msg_pending", "sessionID": session, "type": "user", "delivery": "steer",
                        "payload": { "text": "pending" }, "time": { "created": 1 },
                    }] }));
                }
                let cursor = match req.param("cursor") {
                    Some(_) => json!({}),
                    None => json!({ "next": "older" }),
                };
                ok(json!({
                    "data": [{ "id": "msg_page", "type": "user", "text": "page", "time": { "created": 0 } }],
                    "cursor": cursor,
                }))
            }
        }),
        Options::default(),
    );
    data.remember(info("ses_parent", None));
    data.remember(info("ses_child", Some("ses_parent")));
    data.remember(info("ses_grandchild", Some("ses_child")));
    data.remember(info("ses_other", None));
    data
}

fn messages(data: &Data, session: &str) -> Vec<String> {
    data.read(|state| state.messages(&id(session)).iter().map(|item| item.id().to_owned()).collect())
}

#[tokio::test]
async fn evicts_a_whole_family_while_preserving_metadata_and_attention() {
    let data = fixture(None);
    for session in ["ses_parent", "ses_child", "ses_grandchild", "ses_other"] {
        data.message_sync(&id(session)).await.unwrap();
        data.pending_sync(&id(session)).await.unwrap();
    }
    data.set_status(&id("ses_child"), SessionStatus::Running);
    emit(
        &data,
        json!({
            "id": "evt_permission", "created": 1, "type": "permission.asked",
            "data": { "id": "per_test", "sessionID": "ses_child", "action": "bash", "resources": ["bun test"] },
        }),
    );

    data.evict(&id("ses_parent"));

    data.read(|state| {
        for session in ["ses_parent", "ses_child", "ses_grandchild"] {
            let session = id(session);
            assert!(state.messages(&session).is_empty());
            assert!(state.message(&session, "msg_page").is_none());
            assert!(!state.has_more_messages(&session));
            assert!(!state.messages_loading(&session));
            assert!(state.pending(&session).is_empty());
            assert!(state.inputs(&session).is_empty());
            assert_eq!(state.session(&session).map(|info| &info.id), Some(&session));
        }
        assert_eq!(state.family(&id("ses_parent")), [id("ses_parent"), id("ses_child"), id("ses_grandchild")]);
        assert_eq!(state.status(&id("ses_child")), SessionStatus::Running);
        assert_eq!(state.permissions(&id("ses_child")).unwrap()[0].id.0, "per_test");
    });
    assert_eq!(messages(&data, "ses_other").len(), 2);

    emit(
        &data,
        json!({
            "id": "evt_agent", "created": 1, "type": "session.agent.selected",
            "durable": { "aggregateID": "ses_parent", "seq": 1, "version": 1 },
            "data": { "sessionID": "ses_parent", "agent": "build" },
        }),
    );
    assert_eq!(data.read(|state| state.messages(&id("ses_parent"))[0].tag().to_owned()), "agent-switched");
    data.message_sync(&id("ses_parent")).await.unwrap();
    assert_eq!(messages(&data, "ses_parent"), ["msg_page"]);
    data.message_sync(&id("ses_grandchild")).await.unwrap();
    data.pending_sync(&id("ses_grandchild")).await.unwrap();
    assert_eq!(messages(&data, "ses_grandchild").len(), 2);
    assert!(messages(&data, "ses_child").is_empty());
}

#[tokio::test]
async fn evicting_an_in_flight_read_leaves_the_next_sync_invalidated() {
    let requested = Slot::<()>::default();
    let release = Slot::<()>::default();
    let requests = Arc::new(AtomicUsize::new(0));
    let (signal, wait, count) = (requested.clone(), release.clone(), requests.clone());
    let data = fixture(Some(Arc::new(move |_req: &Req| {
        if count.fetch_add(1, Ordering::SeqCst) != 0 {
            return None;
        }
        signal.resolve(());
        let wait = wait.wait();
        // Answer with the default page once released.
        Some(
            async move {
                wait.await;
                ok(json!({
                    "data": [{ "id": "msg_page", "type": "user", "text": "page", "time": { "created": 0 } }],
                    "cursor": { "next": "older" },
                }))
            }
            .boxed(),
        )
    })));
    let initial = data.message_sync(&id("ses_child"));
    requested.wait().await;
    data.evict(&id("ses_parent"));
    release.resolve(());
    initial.await.unwrap();
    data.message_sync(&id("ses_child")).await.unwrap();
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    assert_eq!(messages(&data, "ses_child").len(), 1);
}

async fn preserves_optimistic(mode: &'static str) {
    let release = Slot::<()>::default();
    let wait = release.clone();
    let data = fixture(Some(Arc::new(move |req: &Req| {
        if !req.path.ends_with("/prompt") {
            return None;
        }
        let wait = wait.wait();
        let id = req.id();
        Some(
            async move {
                wait.await;
                match mode {
                    "reject" => Reply::Json(400, json!({ "message": "rejected" })),
                    _ => ok(json!({ "data": {
                        "id": id, "sessionID": "ses_child", "type": "user", "delivery": "steer",
                        "time": { "created": 1 }, "payload": { "text": "local" },
                    } })),
                }
            }
            .boxed(),
        )
    })));
    let request = data.prompt(SessionPromptInput {
        session_id: id("ses_child"),
        id: Some(Some(SessionMessageID("msg_local".into()))),
        text: "local".into(),
        ..Default::default()
    });
    data.evict(&id("ses_parent"));
    assert_eq!(messages(&data, "ses_child"), ["msg_local"]);
    if mode == "echo" {
        emit(&data, enqueued("ses_child", "msg_local"));
    }
    release.resolve(());
    let _ = request.await;
    let expected = if mode == "echo" { 1 } else { 0 };
    assert_eq!(messages(&data, "ses_child").len(), expected);
    assert_eq!(data.read(|state| state.pending(&id("ses_child")).len()), expected);
}

#[tokio::test]
async fn eviction_preserves_optimistic_submissions_until_echo() {
    preserves_optimistic("echo").await;
}

#[tokio::test]
async fn eviction_preserves_optimistic_submissions_until_reject() {
    preserves_optimistic("reject").await;
}
