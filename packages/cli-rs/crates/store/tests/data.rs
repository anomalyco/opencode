//! Port of the session, message, and activity cases of `packages/client/test/solid-data.test.ts`.
//! Its project, location, catalog, and credential cases belong to F.8. Plus change tracking.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use common::*;
use opencode_api::events::Event;
use opencode_api::generated::*;
use opencode_store::{CreateSession, Data, LoadMore, MessageExt, Options, SessionStatus};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

const SESSION: &str = "ses_refresh";

fn id(value: &str) -> SessionID {
    SessionID(value.into())
}

fn session(viewed: u64) -> Value {
    json!({
        "id": SESSION, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "outcome": "succeeded", "time": { "created": 0, "updated": 0, "idle": 2, "viewed": viewed },
        "location": { "directory": "/project" },
    })
}

fn info(value: Value) -> SessionInfo {
    serde_json::from_value(value).unwrap()
}

fn ids(data: &Data, session: &str) -> Vec<String> {
    data.read(|state| state.messages(&id(session)).iter().map(|item| item.id().to_owned()).collect())
}

fn message(data: &Data, session: &str, message: &str) -> Value {
    data.read(|state| serde_json::to_value(state.message(&id(session), message)).unwrap())
}

fn durable(kind: &str, event: &str, created: u64, data: Value) -> Value {
    json!({
        "id": event, "created": created, "type": kind,
        "durable": { "aggregateID": SESSION, "seq": 1, "version": 1 }, "data": data,
    })
}

#[tokio::test]
async fn uses_the_configured_initial_window_and_retains_normal_cursor_page_sizes() {
    let requests = Log::<(Option<String>, Option<String>)>::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            let cursor = req.param("cursor").map(str::to_owned);
            log.push((req.param("limit").map(str::to_owned), cursor.clone()));
            async move {
                let old = cursor.is_some();
                ok(json!({
                    "data": [{ "id": if old { "msg_1" } else { "msg_2" }, "type": "user", "text": "History", "time": { "created": if old { 1 } else { 2 } } }],
                    "cursor": if old { json!({}) } else { json!({ "next": "older" }) },
                }))
            }
        }),
        Options { initial_message_limit: Some(40), ..Default::default() },
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    data.message_sync(&id(SESSION)).await.unwrap();
    assert_eq!(requests.get(), [(Some("40".into()), None)]);
    data.message_load_more(&id(SESSION), LoadMore::default()).await.unwrap();
    assert_eq!(requests.get(), [(Some("40".into()), None), (Some("20".into()), Some("older".into()))]);
    assert_eq!(ids(&data, SESSION), ["msg_1", "msg_2"]);
}

#[tokio::test]
async fn counts_every_subagent_page_in_a_root_sessions_cost() {
    let child = |index: usize| {
        let mut value = session(0);
        value["id"] = format!("ses_child_{index}").into();
        value["parentID"] = "ses_root".into();
        value["cost"] = 1.into();
        value
    };
    let requests = Log::<String>::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            let query: Vec<String> = req.query.iter().map(|(key, value)| format!("{key}={value}")).collect();
            log.push(format!("{}?{}", req.path, query.join("&")));
            async move {
                if req.path == "/api/session/ses_root" {
                    let mut root = session(0);
                    root["id"] = "ses_root".into();
                    root["cost"] = 0.5.into();
                    return ok(json!({ "data": root }));
                }
                if req.param("cursor") == Some("page_2") {
                    let page: Vec<_> = (200..250).map(child).collect();
                    return ok(json!({ "data": page, "cursor": { "next": "page_3" } }));
                }
                let page: Vec<_> = (0..200).map(child).collect();
                ok(json!({ "data": page, "cursor": { "next": "page_2" } }))
            }
        }),
        Options::default(),
    );
    data.session_sync(&id("ses_root"), true).await.unwrap();
    assert_eq!(data.read(|state| state.family(&id("ses_root")).len()), 251);
    assert_eq!(data.read(|state| state.cost(&id("ses_root"))), 250.5);
    let mut seen = requests.get();
    seen.sort();
    assert_eq!(
        seen,
        [
            "/api/session/ses_root?",
            "/api/session?limit=200&cursor=page_2",
            "/api/session?limit=200&order=desc&parentID=ses_root",
        ]
    );
}

#[tokio::test]
async fn keeps_the_previous_model_in_a_live_variant_notice_until_the_projected_message_arrives() {
    let projected = Slot::<()>::default();
    let previous = json!({ "providerID": "provider", "id": "model", "variant": "high" });
    let model = json!({ "providerID": "provider", "id": "model" });
    let (gate, (previous_value, model_value)) = (projected.clone(), (previous.clone(), model.clone()));
    let data = data(
        handler(move |req: Req| {
            let (gate, previous, model) = (gate.clone(), previous_value.clone(), model_value.clone());
            async move {
                match req.path.as_str() {
                    "/api/session/ses_refresh/message" => ok(json!({ "data": [], "cursor": {} })),
                    "/api/session/ses_refresh/message/msg_variant" => {
                        gate.wait().await;
                        ok(json!({ "data": {
                            "id": "msg_variant", "type": "model-switched", "model": model, "previous": previous,
                            "metadata": { "refetched": true }, "time": { "created": 2 },
                        } }))
                    }
                    path => panic!("unexpected request: {path}"),
                }
            }
        }),
        Options::default(),
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    emit(
        &data,
        durable(
            "session.model.selected",
            "evt_variant",
            2,
            json!({ "sessionID": SESSION, "model": model, "previous": previous }),
        ),
    );
    let row = message(&data, SESSION, "msg_variant");
    assert_eq!(row["type"], "model-switched");
    assert_eq!(row["model"], model);
    assert_eq!(row["previous"], previous);
    projected.resolve(());
    wait(|| message(&data, SESSION, "msg_variant")["metadata"]["refetched"] == true).await;
}

#[tokio::test]
async fn reconciles_a_stale_running_tool_when_execution_settles() {
    let completed = Arc::new(AtomicBool::new(false));
    let requests = Arc::new(AtomicUsize::new(0));
    let (done, count) = (completed.clone(), requests.clone());
    let data = data(
        handler(move |_req: Req| {
            count.fetch_add(1, Ordering::SeqCst);
            let completed = done.load(Ordering::SeqCst);
            async move {
                let state = if completed {
                    json!({ "status": "completed", "input": {}, "metadata": {}, "content": [] })
                } else {
                    json!({ "status": "running", "input": {}, "metadata": {} })
                };
                let mut time = json!({ "created": 1 });
                let mut tool_time = json!({ "created": 1, "ran": 1 });
                if completed {
                    time["completed"] = 2.into();
                    tool_time["completed"] = 2.into();
                }
                ok(json!({
                    "data": [{
                        "id": "msg_assistant", "type": "assistant", "agent": "build",
                        "model": { "providerID": "provider", "id": "model" }, "time": time,
                        "content": [{ "type": "tool", "id": "call_execute", "name": "execute", "time": tool_time, "state": state }],
                    }],
                    "cursor": {},
                }))
            }
        }),
        Options::default(),
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    completed.store(true, Ordering::SeqCst);
    emit(
        &data,
        durable(
            "session.execution.interrupted",
            "evt_interrupted",
            3,
            json!({ "sessionID": SESSION, "reason": "user" }),
        ),
    );
    wait(|| message(&data, SESSION, "msg_assistant")["content"][0]["state"]["status"] == "completed").await;
    assert_eq!(requests.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn omits_inline_tool_result_file_payloads_from_read_and_live_tool_results_when_asked() {
    let screenshot = format!("data:image/png;base64,{}", "A".repeat(4096));
    let shot = screenshot.clone();
    let data = data(
        handler(move |_req: Req| {
            let screenshot = shot.clone();
            async move {
                let tool = |id: &str, state: Value| json!({ "type": "tool", "id": id, "name": "execute", "time": { "created": 1, "ran": 1 }, "state": state });
                ok(json!({
                    "data": [{
                        "id": "msg_assistant", "type": "assistant", "agent": "build",
                        "model": { "providerID": "provider", "id": "model" }, "time": { "created": 1 },
                        "content": [
                            tool("call_read", json!({ "status": "completed", "input": {}, "content": [
                                { "type": "text", "text": "Took a screenshot" },
                                { "type": "file", "uri": screenshot, "mime": "image/png", "name": "page.png" },
                                { "type": "file", "uri": "file:///project/notes.md", "mime": "text/markdown" },
                            ] })),
                            tool("call_live", json!({ "status": "running", "input": {}, "metadata": {} })),
                        ],
                    }],
                    "cursor": {},
                }))
            }
        }),
        Options { omit_tool_file_data: true, ..Default::default() },
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    emit(
        &data,
        durable(
            "session.tool.success",
            "evt_success",
            2,
            json!({
                "sessionID": SESSION, "assistantMessageID": "msg_assistant", "id": "call_live", "executed": true,
                "content": [{ "type": "file", "uri": screenshot, "mime": "image/png" }],
            }),
        ),
    );
    let row = message(&data, SESSION, "msg_assistant");
    assert_eq!(
        row["content"][0]["state"]["content"],
        json!([
            { "type": "text", "text": "Took a screenshot" },
            { "type": "file", "uri": "data:image/png;base64,", "mime": "image/png", "name": "page.png" },
            { "type": "file", "uri": "file:///project/notes.md", "mime": "text/markdown" },
        ])
    );
    assert_eq!(row["content"][1]["state"]["status"], "completed");
    assert_eq!(
        row["content"][1]["state"]["content"],
        json!([{ "type": "file", "uri": "data:image/png;base64,", "mime": "image/png" }])
    );
}

#[tokio::test]
async fn refreshes_a_loaded_sessions_execution_start_when_it_starts_running() {
    let data = data(
        handler(|req: Req| async move {
            assert!(req.path.ends_with("/api/session/ses_refresh"), "unexpected request: {}", req.path);
            let mut value = session(2);
            value["time"]["busy"] = 3.into();
            ok(json!({ "data": value }))
        }),
        Options::default(),
    );
    data.remember(info(session(2)));
    emit(&data, durable("session.execution.started", "evt_started", 3, json!({ "sessionID": SESSION })));
    assert_eq!(data.read(|state| state.status(&id(SESSION))), SessionStatus::Running);
    wait(|| data.read(|state| state.session(&id(SESSION)).and_then(|info| info.time.busy)) == Some(3.0)).await;
}

#[tokio::test]
async fn revalidates_after_an_event_overtakes_an_active_session_read() {
    let gate = Slot::<()>::default();
    let requests = Arc::new(AtomicUsize::new(0));
    let (release, count) = (gate.clone(), requests.clone());
    let data = data(
        handler(move |req: Req| {
            assert!(req.path.ends_with("/api/session/ses_refresh"), "unexpected request: {}", req.path);
            let n = count.fetch_add(1, Ordering::SeqCst) + 1;
            let release = release.clone();
            async move {
                if n == 1 {
                    release.wait().await;
                    return ok(json!({ "data": session(1) }));
                }
                ok(json!({ "data": session(2) }))
            }
        }),
        Options::default(),
    );
    data.remember(info(session(1)));
    data.session_invalidate(&id(SESSION));
    let initial = data.session_sync(&id(SESSION), false);
    wait(|| requests.load(Ordering::SeqCst) == 1).await;
    emit(&data, durable("session.viewed", "evt_viewed", 2, json!({ "sessionID": SESSION, "idle": 2 })));
    settle().await;
    gate.resolve(());
    initial.await.unwrap();
    wait(|| {
        requests.load(Ordering::SeqCst) == 2
            && data.read(|state| state.session(&id(SESSION)).and_then(|info| info.time.viewed)) == Some(2.0)
    })
    .await;
}

#[tokio::test]
async fn preserves_a_live_session_rename_across_concurrent_session_and_family_reads() {
    let family = Slot::<()>::default();
    let renamed = Slot::<()>::default();
    let requests = Arc::new(AtomicUsize::new(0));
    let (first, second, count) = (family.clone(), renamed.clone(), requests.clone());
    let data = data(
        handler(move |req: Req| {
            let read = req.path == format!("/api/session/{SESSION}");
            let n = if read { count.fetch_add(1, Ordering::SeqCst) + 1 } else { 0 };
            let gate = if n == 1 { first.clone() } else { second.clone() };
            async move {
                if !read {
                    return ok(json!({ "data": [], "cursor": {} }));
                }
                gate.wait().await;
                ok(json!({ "data": session(0) }))
            }
        }),
        Options::default(),
    );
    let initial = data.session_sync(&id(SESSION), true);
    wait(|| requests.load(Ordering::SeqCst) == 1).await;
    emit(
        &data,
        durable("session.renamed", "evt_renamed", 1, json!({ "sessionID": SESSION, "title": "Generated title" })),
    );
    wait(|| requests.load(Ordering::SeqCst) == 2).await;
    renamed.resolve(());
    wait(|| data.read(|state| state.session(&id(SESSION)).is_some())).await;
    family.resolve(());
    initial.await.unwrap();
    settle().await;
    assert_eq!(
        data.read(|state| state.session(&id(SESSION)).and_then(|info| info.title.clone())),
        Some("Generated title".into())
    );
}

#[tokio::test]
async fn reports_optimistic_sessions_as_creating_until_the_request_settles() {
    let release = Slot::<()>::default();
    let gate = release.clone();
    let data = data(
        handler(move |req: Req| {
            assert!(req.path.ends_with("/api/session"), "unexpected request: {}", req.path);
            let gate = gate.clone();
            async move {
                gate.wait().await;
                ok(json!({ "data": session(0) }))
            }
        }),
        Options::default(),
    );
    let (created, request) = data.session_create(CreateSession {
        id: Some(id(SESSION)),
        location: Some(LocationPublicRef { directory: AbsolutePath("/project".into()) }),
        ..Default::default()
    });
    assert!(data.read(|state| state.is_creating(&created)));
    release.resolve(());
    request.await.unwrap();
    assert!(!data.read(|state| state.is_creating(&created)));
}

#[tokio::test]
async fn loads_bounded_message_pages() {
    let requests = Log::<Vec<(String, String)>>::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            log.push(req.query.clone());
            let first = log.len() == 1;
            async move { ok(json!({ "data": [], "cursor": if first { json!({ "next": "next" }) } else { json!({}) } })) }
        }),
        Options::default(),
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    data.message_load_more(&id(SESSION), LoadMore::default()).await.unwrap();
    let mut seen = requests.get();
    for query in &mut seen {
        query.sort();
    }
    assert_eq!(
        seen,
        [
            vec![("limit".into(), "20".into()), ("order".into(), "desc".into())],
            vec![("cursor".into(), "next".into()), ("limit".into(), "20".into())],
        ]
    );
}

/// `bulk history (%s)`: `cancel` stands for the TS `AbortSignal`. The TS `beforePublish` hook and
/// object-identity checks have no counterpart: a publication happens under one lock.
async fn bulk_history(mode: &str) {
    let release = Slot::<()>::default();
    let requests = Log::<Vec<(String, String)>>::default();
    let messages: Vec<Value> = (1..=3)
        .map(|index| json!({ "id": format!("msg_{index}"), "type": "user", "text": format!("Message {index}"), "time": { "created": index } }))
        .collect();
    let (gate, log, join) = (release.clone(), requests.clone(), mode.starts_with("join"));
    let fail = mode.to_owned();
    let data = data(
        handler(move |req: Req| {
            log.push(req.query.clone());
            let (gate, messages, fail) = (gate.clone(), messages.clone(), fail.clone());
            let cursor = req.param("cursor").map(str::to_owned);
            async move {
                match cursor.as_deref() {
                    None => ok(json!({ "data": [messages[2]], "cursor": { "next": "recent" } })),
                    Some("recent") => {
                        if join {
                            gate.wait().await;
                        }
                        if fail == "join-failure" {
                            return Reply::Json(503, json!({ "message": "offline" }));
                        }
                        ok(json!({ "data": [messages[2], messages[1]], "cursor": { "next": "oldest" } }))
                    }
                    Some("oldest") => ok(json!({ "data": [messages[0]], "cursor": { "next": "empty" } })),
                    Some(_) => {
                        gate.wait().await;
                        if fail == "failure" {
                            return Reply::Json(503, json!({ "message": "offline" }));
                        }
                        ok(json!({ "data": [], "cursor": {} }))
                    }
                }
            }
        }),
        Options::default(),
    );
    let session = id(SESSION);
    let cancel = CancellationToken::new();
    data.message_sync(&session).await.unwrap();
    let load = {
        let (data, session) = (data.clone(), session.clone());
        let options = if join { LoadMore::default() } else { LoadMore { all: true, cancel: Some(cancel.clone()) } };
        tokio::spawn(async move { data.message_load_more(&session, options).await })
    };
    tokio::task::yield_now().await;
    let joined = {
        let (data, session, cancel) = (data.clone(), session.clone(), cancel.clone());
        tokio::spawn(
            async move { data.message_load_more(&session, LoadMore { all: true, cancel: Some(cancel) }).await },
        )
    };
    let limit =
        |query: &Vec<(String, String)>| query.iter().find(|(key, _)| key == "limit").map(|(_, value)| value.clone());
    if join {
        wait(|| requests.len() == 2).await;
        cancel.cancel();
        wait(|| joined.is_finished()).await;
        assert!(data.read(|state| state.messages_loading(&session)));
        release.resolve(());
        let load = load.await.unwrap();
        assert!(joined.await.unwrap().is_ok());
        assert_eq!(load.is_err(), mode == "join-failure");
        assert_eq!(requests.len(), 2);
        assert_eq!(limit(&requests.get()[1]).as_deref(), Some("20"));
        assert!(data.read(|state| state.has_more_messages(&session)));
        let expected: &[&str] = if mode == "join-failure" { &["msg_3"] } else { &["msg_2", "msg_3"] };
        assert_eq!(ids(&data, SESSION), expected);
        return;
    }
    wait(|| requests.len() == 4).await;
    assert!(data.read(|state| state.messages_loading(&session)));
    assert_eq!(ids(&data, SESSION), ["msg_3"]);
    let limits: Vec<_> = requests.get()[1..].iter().map(&limit).collect();
    assert_eq!(limits, [Some("200".into()), Some("200".into()), Some("200".into())]);
    if mode.starts_with("cancel") {
        cancel.cancel();
    }
    let retry = match mode {
        "cancel-retry" | "cancel-page" => {
            let (data, session) = (data.clone(), session.clone());
            let all = mode == "cancel-retry";
            Some(tokio::spawn(async move { data.message_load_more(&session, LoadMore { all, cancel: None }).await }))
        }
        _ => None,
    };
    release.resolve(());
    let (load, joined) = (load.await.unwrap(), joined.await.unwrap());
    assert_eq!(load.is_err(), mode == "failure");
    assert_eq!(joined.is_err(), mode == "failure");
    if let Some(retry) = retry {
        retry.await.unwrap().unwrap();
    }
    let success = mode == "success" || mode == "cancel-retry";
    assert!(!data.read(|state| state.messages_loading(&session)));
    assert_eq!(data.read(|state| state.has_more_messages(&session)), !success);
    let expected: &[&str] = if success {
        &["msg_1", "msg_2", "msg_3"]
    } else if mode == "cancel-page" {
        &["msg_2", "msg_3"]
    } else {
        &["msg_3"]
    };
    assert_eq!(ids(&data, SESSION), expected);
    let total = match mode {
        "cancel-retry" => 7,
        "cancel-page" => 5,
        _ => 4,
    };
    assert_eq!(requests.len(), total);
    if mode == "cancel-page" {
        assert_eq!(limit(requests.get().last().unwrap()).as_deref(), Some("20"));
    }
}

#[tokio::test]
async fn bulk_history_success() {
    bulk_history("success").await;
}

#[tokio::test]
async fn bulk_history_failure() {
    bulk_history("failure").await;
}

#[tokio::test]
async fn bulk_history_cancel() {
    bulk_history("cancel").await;
}

#[tokio::test]
async fn bulk_history_cancel_retry() {
    bulk_history("cancel-retry").await;
}

#[tokio::test]
async fn bulk_history_cancel_page() {
    bulk_history("cancel-page").await;
}

#[tokio::test]
async fn bulk_history_join_cancel() {
    bulk_history("join-cancel").await;
}

#[tokio::test]
async fn bulk_history_join_failure() {
    bulk_history("join-failure").await;
}

/// The TS `activityFixture`: `session.active` answers through `read`; listed sessions by ID.
fn activity(
    read: impl Fn() -> futures_util::future::BoxFuture<'static, Reply> + Send + Sync + 'static,
    sessions: Vec<Value>,
) -> Data {
    let read = Arc::new(read);
    data(
        handler(move |req: Req| {
            let answer = (req.path == "/api/session/active").then(|| read());
            let known = sessions
                .iter()
                .find(|item| req.path == format!("/api/session/{}", item["id"].as_str().unwrap()))
                .cloned();
            async move {
                if let Some(answer) = answer {
                    return answer.await;
                }
                if let Some(known) = known {
                    return ok(json!({ "data": known }));
                }
                ok(json!({ "location": { "directory": "/project" }, "data": { "branch": "main" } }))
            }
        }),
        Options::default(),
    )
}

fn connected(data: &Data) {
    emit(data, json!({ "id": "evt_connected", "type": "server.connected", "data": {} }));
}

async fn preserves_activity(kind: &str) {
    let release = Slot::<()>::default();
    let requested = Slot::<()>::default();
    let started = kind == "session.execution.started";
    let (gate, seen) = (release.clone(), requested.clone());
    let data = activity(
        move || {
            let (gate, seen) = (gate.clone(), seen.clone());
            Box::pin(async move {
                seen.resolve(());
                gate.wait().await;
                let mut active = json!({ "ses_hydrated": { "type": "running" } });
                if !started {
                    active["ses_refresh"] = json!({ "type": "running" });
                }
                ok(json!({ "data": active }))
            })
        },
        Vec::new(),
    );
    if !started {
        data.set_status(&id(SESSION), SessionStatus::Running);
    }
    connected(&data);
    requested.wait().await;
    let mut payload = json!({ "sessionID": SESSION, "reason": "user" });
    if kind == "session.execution.failed" {
        payload["error"] = json!({ "type": "provider.no-route", "message": "Model unavailable: opencode/gpt-5.2" });
    }
    let mut event = durable(kind, "evt_activity", 2, payload);
    event["durable"]["seq"] = 2.into();
    emit(&data, event);
    let expected = if started { SessionStatus::Running } else { SessionStatus::Idle };
    assert_eq!(data.read(|state| state.status(&id(SESSION))), expected);
    if kind == "session.execution.failed" {
        let last = data.read(|state| state.messages(&id(SESSION)).last().cloned());
        let expected: SessionMessageInfo = serde_json::from_value(json!({
            "id": "msg_activity", "type": "idle", "outcome": "failed",
            "error": { "type": "provider.no-route", "message": "Model unavailable: opencode/gpt-5.2" },
            "time": { "created": 2 },
        }))
        .unwrap();
        assert_eq!(last, Some(expected));
    }
    release.resolve(());
    wait(|| data.read(|state| state.status(&id("ses_hydrated"))) == SessionStatus::Running).await;
    assert_eq!(data.read(|state| state.status(&id(SESSION))), expected);
}

#[tokio::test]
async fn preserves_execution_succeeded_activity_when_an_older_snapshot_arrives() {
    preserves_activity("session.execution.succeeded").await;
}

#[tokio::test]
async fn preserves_execution_failed_activity_when_an_older_snapshot_arrives() {
    preserves_activity("session.execution.failed").await;
}

#[tokio::test]
async fn preserves_execution_interrupted_activity_when_an_older_snapshot_arrives() {
    preserves_activity("session.execution.interrupted").await;
}

#[tokio::test]
async fn preserves_execution_started_activity_when_an_older_snapshot_arrives() {
    preserves_activity("session.execution.started").await;
}

#[tokio::test]
async fn preserves_session_deleted_activity_when_an_older_snapshot_arrives() {
    preserves_activity("session.deleted").await;
}

#[tokio::test]
async fn adds_running_sessions_created_while_disconnected_to_their_family() {
    let mut root = session(0);
    root["id"] = "ses_root".into();
    let mut child = session(0);
    child["id"] = "ses_child".into();
    child["parentID"] = "ses_root".into();
    let data =
        activity(|| Box::pin(async { ok(json!({ "data": { "ses_child": { "type": "running" } } })) }), vec![child]);
    data.remember(info(root));
    connected(&data);
    wait(|| data.read(|state| state.family(&id("ses_root")).contains(&id("ses_child")))).await;
    assert_eq!(data.read(|state| state.status(&id("ses_child"))), SessionStatus::Running);
}

#[tokio::test]
async fn ignores_activity_snapshots_from_an_older_connection() {
    let reads = Log::<Slot<Reply>>::default();
    let log = reads.clone();
    let data = activity(
        move || {
            let read = Slot::<Reply>::default();
            log.push(read.clone());
            read.wait()
        },
        Vec::new(),
    );
    connected(&data);
    wait(|| reads.len() == 1).await;
    connected(&data);
    wait(|| reads.len() == 2).await;
    reads.get()[1].resolve(ok(json!({ "data": { "ses_new": { "type": "running" } } })));
    wait(|| data.read(|state| state.status(&id("ses_new"))) == SessionStatus::Running).await;
    reads.get()[0].resolve(ok(json!({ "data": { "ses_old": { "type": "running" } } })));
    settle().await;
    assert_eq!(data.read(|state| state.status(&id("ses_new"))), SessionStatus::Running);
    assert_eq!(data.read(|state| state.status(&id("ses_old"))), SessionStatus::Idle);
}

#[tokio::test]
async fn projects_background_user_shell_metadata_from_durable_shell_data() {
    let data = activity(|| Box::pin(async { ok(json!({ "data": {} })) }), Vec::new());
    emit(
        &data,
        durable(
            "session.shell.started",
            "evt_user_shell",
            1,
            json!({
                "sessionID": SESSION,
                "shell": {
                    "id": "sh_user", "status": "running", "command": "pwd", "cwd": "/project", "shell": "/bin/sh",
                    "file": "/project/shell.out", "metadata": { "sessionID": SESSION, "background": true },
                    "time": { "started": 1 },
                },
            }),
        ),
    );
    let messages = data.read(|state| serde_json::to_value(state.messages(&id(SESSION))).unwrap());
    assert_eq!(messages.as_array().unwrap().len(), 1);
    assert_eq!(messages[0]["type"], "shell");
    assert_eq!(messages[0]["shellID"], "sh_user");
    assert_eq!(messages[0]["status"], "running");
    assert_eq!(messages[0]["metadata"]["background"], true);
}

// ---------------------------------------------------------------------------------------------------
// Not in the TS suite.

#[test]
fn messages_decode_by_their_type_tag() {
    let assistant: SessionMessageInfo = serde_json::from_value(json!({
        "id": "msg_a", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
        "time": { "created": 1 }, "content": [],
    }))
    .unwrap();
    assert!(matches!(assistant, SessionMessageInfo::Assistant(_)));
    let system: SessionMessageInfo = serde_json::from_value(json!({
        "id": "msg_s", "type": "system", "text": "x", "description": "d", "time": { "created": 1 },
    }))
    .unwrap();
    assert!(matches!(system, SessionMessageInfo::System(_)));
    let compaction: SessionMessageInfo = serde_json::from_value(json!({
        "id": "msg_c", "type": "compaction", "status": "running", "reason": "auto", "summary": "", "time": { "created": 1 },
    }))
    .unwrap();
    assert_eq!(compaction.tag(), "compaction");
    assert!(matches!(compaction, SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_))));
}

#[test]
fn adjacent_deltas_of_one_part_merge() {
    let delta = |kind: &str, message: &str, ordinal: i64, text: &str| {
        event(json!({
            "id": "evt_1", "created": 1, "type": kind,
            "data": { "sessionID": SESSION, "assistantMessageID": message, "ordinal": ordinal, "delta": text },
        }))
    };
    let mut first = delta("session.text.delta", "msg_a", 0, "Hel");
    assert!(first.merge(&delta("session.text.delta", "msg_a", 0, "lo")));
    let V2Event::SessionTextDelta(merged) = &first else {
        panic!("not a text delta");
    };
    assert_eq!(merged.data.delta, "Hello");
    assert!(!first.merge(&delta("session.text.delta", "msg_a", 1, "!")));
    assert!(!first.merge(&delta("session.text.delta", "msg_b", 0, "!")));
    assert!(!first.merge(&delta("session.reasoning.delta", "msg_a", 0, "!")));

    let tool = |call: &str, text: &str| {
        event(json!({
            "id": "evt_2", "created": 1, "type": "session.tool.input.delta",
            "data": { "sessionID": SESSION, "assistantMessageID": "msg_a", "id": call, "delta": text },
        }))
    };
    let mut input = tool("call_1", "{\"a\"");
    assert!(input.merge(&tool("call_1", ":1}")));
    assert!(!input.merge(&tool("call_2", "{}")));
}

#[tokio::test]
async fn change_tracking_reports_sessions_messages_and_parts_by_revision() {
    let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
    let notified = data.subscribe();
    data.remember(info(session(0)));
    let session = id(SESSION);
    assert!(notified.has_changed().unwrap());
    let (first, changes) = data.changes_since(0);
    assert!(changes.sessions() && changes.session(&session));

    let step = durable(
        "session.step.started",
        "evt_step",
        1,
        json!({
            "sessionID": SESSION, "assistantMessageID": "msg_a", "agent": "build",
            "model": { "providerID": "p", "id": "m" }, "started": 1,
        }),
    );
    data.apply(&[
        event(step),
        event(durable(
            "session.text.started",
            "evt_text",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0 }),
        )),
    ]);
    let (second, changes) = data.changes_since(first);
    assert_eq!(second, first + 1, "one batch is one flush");
    assert!(changes.messages(&session));
    assert!(!changes.session(&session));

    emit(
        &data,
        durable(
            "session.text.delta",
            "evt_delta",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "delta": "Hi" }),
        ),
    );
    let (third, changes) = data.changes_since(second);
    assert!(!changes.messages(&session), "a delta does not change the list");
    assert!(changes.message(&session, &SessionMessageID("msg_a".into())));
    assert!(!changes.message(&session, &SessionMessageID("msg_b".into())));
    assert_eq!(message(&data, SESSION, "msg_a")["content"][0]["text"], "Hi");

    // A delta for a message that is not loaded is dropped and changes nothing.
    emit(
        &data,
        durable(
            "session.text.delta",
            "evt_delta",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_gone", "ordinal": 0, "delta": "Hi" }),
        ),
    );
    assert_eq!(data.revision(), third);
}
