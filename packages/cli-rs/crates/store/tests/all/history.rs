//! Keeping loaded transcript history when the newest page is read again (mirrors `solid-data.test.ts`).

use crate::common;

use std::sync::{Arc, Mutex};

use common::*;
use opencode_api::generated::{LocationPublicRef, SessionID};
use opencode_store::{CreateSession, Data, LoadMore, Options};
use serde_json::{Value, json};

const SESSION: &str = "ses_refresh";

fn session_id() -> SessionID {
    SessionID(SESSION.into())
}

fn note(n: usize) -> Value {
    json!({
        "id": format!("msg_{n:03}"),
        "type": "user",
        "text": format!("Message {n}"),
        "time": { "created": n },
    })
}

fn notes(first: usize, last: usize) -> Vec<Value> {
    (first..=last).map(note).collect()
}

fn note_ids(messages: &[Value]) -> Vec<String> {
    messages.iter().map(|message| message["id"].as_str().unwrap().to_owned()).collect()
}

fn session_json() -> Value {
    json!({
        "id": SESSION, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 0, "updated": 0 }, "location": { "directory": "/project" },
    })
}

struct Server {
    messages: Vec<Value>,
    requests: Vec<String>,
    hold: Option<(String, Slot<()>)>,
}

struct Setup {
    data: Data,
    server: Arc<Mutex<Server>>,
}

impl Setup {
    fn new(messages: Vec<Value>) -> Self {
        let server = Arc::new(Mutex::new(Server { messages, requests: Vec::new(), hold: None }));
        let shared = server.clone();
        let data = data(
            handler(move |req: Req| {
                let shared = shared.clone();
                async move {
                    let path = req
                        .path
                        .strip_prefix(&format!("/api/session/{SESSION}/"))
                        .or_else(|| req.path.strip_prefix("/api/session"))
                        .unwrap_or(&req.path)
                        .trim_start_matches('/');
                    if path.is_empty() {
                        return ok(json!({ "data": session_json() }));
                    }
                    if path == "inbox" {
                        return ok(json!({ "data": [] }));
                    }
                    let query = req.query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
                    let request = if query.is_empty() { path.to_owned() } else { format!("{path}?{query}") };
                    let gate = {
                        let mut server = shared.lock().unwrap();
                        server.requests.push(request.clone());
                        server
                            .hold
                            .as_ref()
                            .filter(|(needle, _)| request.ends_with(needle))
                            .map(|(_, gate)| gate.clone())
                    };
                    if let Some(gate) = gate {
                        gate.wait().await;
                    }
                    let server = shared.lock().unwrap();
                    if path != "message" {
                        let found = server
                            .messages
                            .iter()
                            .find(|msg| format!("message/{}", msg["id"].as_str().unwrap()) == path);
                        return match found {
                            Some(message) => ok(json!({ "data": message })),
                            None => Reply::Json(
                                404,
                                json!({ "_tag": "MessageNotFoundError", "messageID": path, "message": "not found" }),
                            ),
                        };
                    }
                    let cursor = req.param("cursor");
                    let limit: usize = req.param("limit").and_then(|v| v.parse().ok()).unwrap_or(20);
                    let end = match cursor {
                        Some(cursor) => match server.messages.iter().position(|msg| msg["id"].as_str() == Some(cursor))
                        {
                            Some(at) => at,
                            None => return ok(json!({ "data": [], "cursor": {} })),
                        },
                        None => server.messages.len(),
                    };
                    let start = end.saturating_sub(limit);
                    let page: Vec<Value> = server.messages[start..end].iter().rev().cloned().collect();
                    let next = page.last().map(|msg| json!({ "next": msg["id"] })).unwrap_or_else(|| json!({}));
                    ok(json!({ "data": page, "cursor": next }))
                }
            }),
            Options::default(),
        );
        Self { data, server }
    }

    fn ids(&self) -> Vec<String> {
        self.data.read(|state| state.messages(&session_id()).iter().map(|item| item.id().to_owned()).collect())
    }

    fn message(&self, id: &str) -> Value {
        self.data.read(|state| serde_json::to_value(state.message(&session_id(), id).unwrap()).unwrap())
    }

    fn requests(&self) -> Vec<String> {
        self.server.lock().unwrap().requests.clone()
    }
}

#[tokio::test(flavor = "local")]
async fn reading_the_newest_page_again_keeps_the_loaded_history() {
    let reverted: Vec<Value> = notes(1, 25).into_iter().chain(notes(36, 38)).collect();
    let cases = [
        ("after fewer new messages than a page", 30, notes(1, 35), vec!["message?limit=20&order=desc"]),
        (
            "after more new messages than a page",
            30,
            notes(1, 60),
            vec!["message?limit=20&order=desc", "message?limit=20&cursor=msg_041"],
        ),
        ("without the messages a revert removed", 30, reverted, vec!["message?limit=20&order=desc"]),
    ];
    for (name, loaded, server, expected_requests) in cases {
        let setup = Setup::new(notes(1, loaded));
        let session = session_id();
        setup.data.message_sync(&session).await.unwrap();
        setup.data.message_load_more(&session, LoadMore { all: true, cancel: None }).await.unwrap();
        assert_eq!(setup.ids(), note_ids(&notes(1, loaded)), "{name}");

        {
            let mut state = setup.server.lock().unwrap();
            state.messages = server.clone();
            state.requests.clear();
        }
        setup.data.message_invalidate(&session);
        setup.data.message_sync(&session).await.unwrap();

        assert_eq!(setup.ids(), note_ids(&server), "{name}");
        assert_eq!(setup.requests(), expected_requests, "{name}");
        // The history was loaded to its start, and still is.
        assert!(!setup.data.read(|state| state.has_more_messages(&session)), "{name}");
    }
}

#[tokio::test(flavor = "local")]
async fn a_newest_page_too_far_ahead_replaces_loaded_history_and_restarts_an_older_load() {
    let older = Slot::<()>::default();
    let setup = Setup::new(notes(1, 40));
    let session = session_id();
    setup.data.message_sync(&session).await.unwrap();
    setup.server.lock().unwrap().hold = Some(("cursor=msg_021".into(), older.clone()));
    let paging = {
        let (data, session) = (setup.data.clone(), session.clone());
        tokio::spawn(data.message_load_more(&session, LoadMore::default()))
    };
    wait(|| setup.requests().len() == 2).await;

    setup.server.lock().unwrap().messages = notes(1, 340);
    setup.data.message_invalidate(&session);
    setup.data.message_sync(&session).await.unwrap();
    // Messages 41 to 120 were never read, so nothing before them may show; the read gives up after three older pages.
    assert_eq!(setup.ids(), note_ids(&notes(121, 340)));
    assert_eq!(
        &setup.requests()[2..],
        [
            "message?limit=20&order=desc",
            "message?limit=20&cursor=msg_321",
            "message?limit=40&cursor=msg_301",
            "message?limit=140&cursor=msg_261",
        ]
    );
    // Releasing the stale older load drops its [1..20] page and restarts from the new cursor (O89-older-page).
    older.resolve(());
    paging.await.unwrap().unwrap();
    assert_eq!(setup.ids(), note_ids(&notes(101, 340)));
}

#[tokio::test(flavor = "local")]
async fn a_kept_message_that_was_still_running_is_read_again() {
    let tool = |state: Value| {
        json!({
            "id": "msg_005",
            "type": "assistant",
            "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 5, "completed": 5 },
            "content": [{ "type": "tool", "id": "call_shell", "name": "shell", "time": { "created": 5, "ran": 5 }, "state": state }],
        })
    };
    let initial: Vec<Value> = notes(1, 4)
        .into_iter()
        .chain([tool(json!({ "status": "running", "input": {}, "metadata": {} }))])
        .chain(notes(6, 30))
        .collect();
    let setup = Setup::new(initial);
    let session = session_id();
    setup.data.message_sync(&session).await.unwrap();
    setup.data.message_load_more(&session, LoadMore { all: true, cancel: None }).await.unwrap();

    let updated: Vec<Value> = notes(1, 4)
        .into_iter()
        .chain([tool(json!({ "status": "completed", "input": {}, "content": [{ "type": "text", "text": "done" }] }))])
        .chain(notes(6, 33))
        .collect();
    {
        let mut state = setup.server.lock().unwrap();
        state.messages = updated;
        state.requests.clear();
    }
    setup.data.message_invalidate(&session);
    setup.data.message_sync(&session).await.unwrap();

    let refreshed = setup.message("msg_005");
    assert_eq!(refreshed["content"][0]["state"]["status"], "completed");
    assert_eq!(setup.requests(), ["message?limit=20&order=desc", "message/msg_005"]);
}

#[tokio::test(flavor = "local")]
async fn a_transcript_anchor_depends_on_session_creation() {
    let cases = [
        ("events alone", None, 16, true),
        ("session.created event", Some("event"), 11, false),
        ("local session_create", Some("here"), 11, false),
    ];
    for (name, created, first, more) in cases {
        let setup = Setup::new(notes(if created.is_some() { 11 } else { 1 }, 35));
        let session = session_id();
        if created == Some("here") {
            let (_, task) = setup.data.session_create(CreateSession {
                id: Some(session.clone()),
                location: Some(LocationPublicRef { directory: "/project".into() }),
                ..Default::default()
            });
            task.await.unwrap();
        }
        if created == Some("event") {
            emit(
                &setup.data,
                json!({
                    "id": "evt_created", "created": 0, "type": "session.created",
                    "durable": { "aggregateID": SESSION, "seq": 0, "version": 1 },
                    "data": {
                        "sessionID": SESSION, "projectID": "project",
                        "location": { "directory": "/project" }, "slug": "refresh", "version": "2",
                    },
                }),
            );
        }
        for (index, item) in notes(11, 35).iter().enumerate() {
            let id = item["id"].as_str().unwrap().replace("msg_", "evt_");
            emit(
                &setup.data,
                json!({
                    "id": id, "created": item["time"]["created"], "type": "session.synthetic",
                    "durable": { "aggregateID": SESSION, "seq": index + 1, "version": 1 },
                    "data": { "sessionID": SESSION, "text": "Synthetic" },
                }),
            );
        }
        assert_eq!(setup.ids(), note_ids(&notes(11, 35)), "{name}");

        setup.data.message_invalidate(&session);
        setup.data.message_sync(&session).await.unwrap();
        assert_eq!(setup.ids(), note_ids(&notes(first, 35)), "{name}");
        assert_eq!(setup.data.read(|state| state.has_more_messages(&session)), more, "{name}");
    }
}

#[tokio::test(flavor = "local")]
async fn an_input_does_not_misplace_loaded_history() {
    for delivered in [false, true] {
        let input = json!({ "id": "msg_input", "type": "user", "text": "Queued", "time": { "created": 31 } });
        let steps: Vec<Value> = (1..=25)
            .map(|i| json!({ "id": format!("msg_step_{i:02}"), "type": "synthetic", "text": "Synthetic", "time": { "created": 31 + i } }))
            .collect();
        let setup = Setup::new(notes(1, 30));
        let session = session_id();
        setup.data.message_sync(&session).await.unwrap();
        emit(
            &setup.data,
            json!({
                "id": "evt_input", "created": 31, "type": "session.inbox.enqueued",
                "durable": { "aggregateID": SESSION, "seq": 1, "version": 1 },
                "data": {
                    "sessionID": SESSION, "inboxID": "msg_input",
                    "item": { "type": "user", "delivery": "queue", "payload": { "text": "Queued" } },
                },
            }),
        );
        for (index, step) in steps.iter().enumerate() {
            let id = step["id"].as_str().unwrap().replace("msg_", "evt_");
            emit(
                &setup.data,
                json!({
                    "id": id, "created": step["time"]["created"], "type": "session.synthetic",
                    "durable": { "aggregateID": SESSION, "seq": index + 2, "version": 1 },
                    "data": { "sessionID": SESSION, "text": "Synthetic" },
                }),
            );
        }
        let expected_before: Vec<Value> =
            notes(11, 30).into_iter().chain([input.clone()]).chain(steps.clone()).collect();
        assert_eq!(setup.ids(), note_ids(&expected_before), "delivered={delivered}");

        let mut server_messages: Vec<Value> = notes(1, 30).into_iter().chain(steps.clone()).collect();
        if delivered {
            server_messages.push(input.clone());
            server_messages.extend(notes(57, 75));
        }
        setup.server.lock().unwrap().messages = server_messages.clone();
        if delivered {
            setup.data.pending_sync(&session).await.unwrap();
        }
        assert_eq!(setup.data.read(|state| state.has_input(&session, "msg_input")), !delivered);
        setup.data.message_invalidate(&session);
        setup.data.message_sync(&session).await.unwrap();

        let expected: Vec<Value> = if delivered {
            server_messages[10..].to_vec()
        } else {
            notes(11, 30).into_iter().chain(steps).chain([input]).collect()
        };
        assert_eq!(setup.ids(), note_ids(&expected), "delivered={delivered}");
        if !delivered {
            continue;
        }
        // The read placed the input, so the next read keeps it with the rest of the history.
        let mut extended = server_messages;
        extended.extend(notes(76, 85));
        setup.server.lock().unwrap().messages = extended.clone();
        setup.data.message_invalidate(&session);
        setup.data.message_sync(&session).await.unwrap();
        assert_eq!(setup.ids(), note_ids(&extended[10..]));
    }
}
