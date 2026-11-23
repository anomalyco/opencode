use crate::common;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use common::*;
use opencode_api::events::Event;
use opencode_api::generated::*;
use opencode_store::{CreateSession, Data, LoadMore, Options, Payload, SessionStatus, Touched};
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
async fn follows_a_changed_omit_setting_and_restores_dropped_tool_files_from_the_server() {
    let screenshot = format!("data:image/png;base64,{}", "A".repeat(64));
    let shot = screenshot.clone();
    let gets = Arc::new(AtomicUsize::new(0));
    let count = gets.clone();
    let data = data(
        handler(move |req: Req| {
            let screenshot = shot.clone();
            let file = json!({ "type": "file", "uri": screenshot, "mime": "image/png" });
            let message = |tools: Vec<Value>| {
                json!({
                    "id": "msg_assistant", "type": "assistant", "agent": "build",
                    "model": { "providerID": "provider", "id": "model" }, "time": { "created": 1 },
                    "content": tools,
                })
            };
            let tool = |id: &str, state: Value| json!({ "type": "tool", "id": id, "name": "execute", "time": { "created": 1, "ran": 1 }, "state": state });
            let done = |id: &str| tool(id, json!({ "status": "completed", "input": {}, "content": [file.clone()] }));
            let reply = if req.path.ends_with("/message/msg_assistant") {
                count.fetch_add(1, Ordering::SeqCst);
                // The server read predates `call_live`'s live progress; only the dropped files come back.
                let running = tool("call_live", json!({ "status": "running", "input": {}, "metadata": {} }));
                json!({ "data": message(vec![done("call_read"), running]) })
            } else {
                json!({ "data": [message(vec![done("call_read"), done("call_live")])], "cursor": {} })
            };
            async move { ok(reply) }
        }),
        Options { omit_tool_file_data: true, ..Default::default() },
    );
    data.message_sync(&id(SESSION)).await.unwrap();
    let dropped = json!([{ "type": "file", "uri": "data:image/png;base64,", "mime": "image/png" }]);
    assert_eq!(message(&data, SESSION, "msg_assistant")["content"][0]["state"]["content"], dropped);

    data.set_omit_tool_file_data(false);
    data.restore_files();
    let kept = json!([{ "type": "file", "uri": screenshot, "mime": "image/png" }]);
    wait(|| message(&data, SESSION, "msg_assistant")["content"][0]["state"]["content"] == kept).await;
    let row = message(&data, SESSION, "msg_assistant");
    // The running copy from the server carries no content, so `call_live` stays as the store has it.
    assert_eq!(row["content"][1]["state"]["status"], "completed");
    assert_eq!(row["content"][1]["state"]["content"], dropped);
    assert_eq!(gets.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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
        tokio::spawn(data.message_load_more(&session, options))
    };
    tokio::task::yield_now().await;
    let joined = {
        let (data, session, cancel) = (data.clone(), session.clone(), cancel.clone());
        tokio::spawn(data.message_load_more(&session, LoadMore { all: true, cancel: Some(cancel) }))
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
            Some(tokio::spawn(data.message_load_more(&session, LoadMore { all, cancel: None })))
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

#[tokio::test(flavor = "local")]
async fn bulk_reads_settle_all_joiners() {
    for case in ["success", "failure", "cancel", "cancel-retry", "cancel-page", "join-cancel", "join-failure"] {
        bulk_history(case).await;
    }
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

#[tokio::test(flavor = "local")]
async fn late_snapshots_preserve_live_activity() {
    for case in [
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
        "session.execution.started",
        "session.deleted",
    ] {
        preserves_activity(case).await;
    }
}

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

#[tokio::test(flavor = "local")]
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

/// Adjacent deltas of one part join before they apply: as JSON a view reads, in the store, and decoded, for a delta
/// listener, in the connection's batches; the listener gets them joined. Deltas of another session,
/// message, kind or tool call stay apart.
#[tokio::test(flavor = "local")]
async fn adjacent_deltas_of_one_part_join() {
    let part = |kind: &str, extra: Value| {
        let mut data = json!({ "sessionID": SESSION, "assistantMessageID": "msg_a" });
        data.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        durable(kind, "evt_1", 1, data)
    };
    let text = |delta: &str| part("session.text.delta", json!({ "ordinal": 0, "delta": delta }));
    let reasoning = |delta: &str| part("session.reasoning.delta", json!({ "ordinal": 0, "delta": delta }));
    let tool = |call: &str, delta: &str| part("session.tool.input.delta", json!({ "id": call, "delta": delta }));
    // A delta of another message, or of another session, which neither joins nor shows here.
    let elsewhere = |session: &str, message: &str| {
        let data = json!({ "sessionID": session, "assistantMessageID": message, "ordinal": 0, "delta": "X" });
        durable("session.text.delta", "evt_1", 1, data).to_string()
    };
    let step = json!({ "agent": "build", "model": { "providerID": "p", "id": "m" }, "started": 1 });
    let starts = [
        part("session.step.started", step),
        part("session.text.started", json!({ "ordinal": 0 })),
        part("session.reasoning.started", json!({ "ordinal": 0 })),
        part("session.tool.input.started", json!({ "id": "call_1", "name": "bash" })),
        part("session.tool.input.started", json!({ "id": "call_2", "name": "bash" })),
    ];
    // A lone surrogate escape, which `JSON.parse` keeps, reads as U+FFFD.
    let lone = text("?").to_string().replace('?', "\\ud83d");
    let deltas = [
        text("Hel").to_string(),
        elsewhere(SESSION, "msg_b"),
        elsewhere("ses_other", "msg_a"),
        text("lo\n").to_string(),
        lone,
        reasoning("th").to_string(),
        reasoning("ink").to_string(),
        text("!").to_string(),
        tool("call_1", "{\"a\"").to_string(),
        tool("call_1", ":1}").to_string(),
        tool("call_2", "{}").to_string(),
    ];
    for listened in [false, true] {
        let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
        data.remember(info(session(0)));
        let listening = listened.then(|| data.listen_deltas());
        data.apply(starts.iter().map(|start| event(start.clone())));
        // As the connection hands them over: read for the store's listeners, decoded deltas joined.
        let wanted = data.remote().wanted();
        let mut batch: Vec<Payload> = Vec::new();
        for delta in &deltas {
            let payload = Payload::read(delta.clone(), &wanted).unwrap();
            if !batch.last_mut().is_some_and(|last| last.merge(&payload)) {
                batch.push(payload);
            }
        }
        data.apply(batch);
        let content = message(&data, SESSION, "msg_a")["content"].clone();
        let parts: Vec<&str> = content
            .as_array()
            .unwrap()
            .iter()
            .map(|part| part.get("text").unwrap_or(&part["state"]["input"]).as_str().unwrap())
            .collect();
        assert_eq!(parts, ["Hello\n\u{fffd}!", "think", "{\"a\":1}", "{}"], "listened: {listened}");
        let Some(listening) = listening else { continue };
        let kept = listening.take(|events| {
            events.iter().map(|event| serde_json::to_value(event).unwrap()["data"]["delta"].clone()).collect::<Vec<_>>()
        });
        assert_eq!(kept, ["Hel", "X", "X", "lo\n\u{fffd}", "think", "!", "{\"a\":1}", "{}"]);
    }
}

#[tokio::test(flavor = "local")]
async fn change_tracking_reports_sessions_messages_and_parts_by_revision() {
    let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
    let notified = std::rc::Rc::new(std::cell::Cell::new(false));
    let notify = notified.clone();
    data.on_change(move || notify.set(true));
    data.remember(info(session(0)));
    let session = id(SESSION);
    assert!(notified.get());
    let mut taken = Taken::default();
    let (first, changes) = taken.take(&data);
    assert!(changes.sessions() && changes.has(&session, Touched::INFO));

    let step = durable(
        "session.step.started",
        "evt_step",
        1,
        json!({
            "sessionID": SESSION, "assistantMessageID": "msg_a", "agent": "build",
            "model": { "providerID": "p", "id": "m" }, "started": 1,
        }),
    );
    data.apply(vec![
        event(step),
        event(durable(
            "session.text.started",
            "evt_text",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0 }),
        )),
    ]);
    let (second, changes) = taken.take(&data);
    assert_eq!(second, first + 1, "one batch is one flush");
    assert!(changes.has(&session, Touched::SHAPE));
    assert!(!changes.has(&session, Touched::INFO));

    emit(
        &data,
        durable(
            "session.text.delta",
            "evt_delta",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "delta": "Hi" }),
        ),
    );
    let (third, changes) = taken.take(&data);
    assert!(!changes.has(&session, Touched::SHAPE), "a delta does not change the list");
    assert!(data.read(|state| changes.changed_messages(state).eq([(&session, "msg_a")])), "the delta's message only");
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

/// A part start applied again (a replay over a snapshot that already holds it) adds no second part, while a start
/// with the next ordinal or another call ID does (O5).
#[tokio::test(flavor = "local")]
async fn part_starts_are_idempotent() {
    let start = |kind: &str, id: &str, extra: Value| {
        let mut data = json!({ "sessionID": SESSION, "assistantMessageID": "msg_a" });
        data.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        event(durable(kind, id, 1, data))
    };
    let cases = [
        ("text", "session.text.started", json!({ "ordinal": 0 }), json!({ "ordinal": 1 })),
        ("reasoning", "session.reasoning.started", json!({ "ordinal": 0 }), json!({ "ordinal": 1 })),
        (
            "tool",
            "session.tool.input.started",
            json!({ "id": "call_1", "name": "bash" }),
            json!({ "id": "call_2", "name": "bash" }),
        ),
    ];
    for (name, kind, first, next) in cases {
        let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
        data.remember(info(session(0)));
        let step = json!({
            "sessionID": SESSION, "assistantMessageID": "msg_a", "agent": "build",
            "model": { "providerID": "p", "id": "m" }, "started": 1,
        });
        data.apply(vec![event(durable("session.step.started", "evt_step", 1, step))]);
        data.apply(vec![start(kind, "evt_1", first.clone()), start(kind, "evt_2", first)]);
        assert_eq!(message(&data, SESSION, "msg_a")["content"].as_array().unwrap().len(), 1, "{name}: replay");
        data.apply(vec![start(kind, "evt_3", next)]);
        assert_eq!(message(&data, SESSION, "msg_a")["content"].as_array().unwrap().len(), 2, "{name}: next part");
    }
}

/// A reload with the same IDs in the same order, and the same "more" state, reports only the
/// messages that differ (TS `reconcile`); anything else replaces the list.
#[tokio::test(flavor = "local")]
async fn message_sync_reconciles_a_reload_with_the_same_ids() {
    let row = |id: &str, text: &str| json!({ "id": id, "type": "user", "text": text, "time": { "created": 1 } });
    let more = json!({ "next": "older" });
    let first = json!({ "data": [row("msg_2", "b"), row("msg_1", "a")], "cursor": more });
    let cases = [
        ("same data", first.clone(), false, vec![]),
        ("one edit", json!({ "data": [row("msg_2", "B"), row("msg_1", "a")], "cursor": more }), false, vec!["msg_2"]),
        (
            "new message",
            json!({ "data": [row("msg_3", "c"), row("msg_2", "b"), row("msg_1", "a")], "cursor": more }),
            true,
            vec![],
        ),
        ("reordered", json!({ "data": [row("msg_1", "a"), row("msg_2", "b")], "cursor": more }), true, vec![]),
        ("no more pages", json!({ "data": [row("msg_2", "b"), row("msg_1", "a")], "cursor": {} }), true, vec![]),
    ];
    for (name, second, reshaped, edited) in cases {
        let replies = Log::<Value>::default();
        replies.push(first.clone());
        let log = replies.clone();
        let data = data(
            handler(move |_req: Req| {
                let reply = log.get().last().cloned().unwrap();
                async move { ok(reply) }
            }),
            Options::default(),
        );
        let session = id(SESSION);
        data.message_sync(&session).await.unwrap();
        replies.push(second.clone());
        data.message_invalidate(&session);
        let mut taken = Taken::default();
        taken.take(&data);
        data.message_sync(&session).await.unwrap();
        let changes = taken.take(&data).1;
        assert_eq!(changes.has(&session, Touched::SHAPE), reshaped, "{name}");
        let mut changed: Vec<_> =
            data.read(|state| changes.changed_messages(state).map(|(_, id)| id.to_owned()).collect());
        changed.sort();
        assert_eq!(changed, edited, "{name}");
        let rows = second["data"].as_array().unwrap();
        let expected: Vec<_> = rows.iter().rev().map(|item| item["id"].as_str().unwrap()).collect();
        assert_eq!(ids(&data, SESSION), expected, "{name}");
        let text = &rows.iter().find(|item| item["id"] == "msg_2").unwrap()["text"];
        assert_eq!(&message(&data, SESSION, "msg_2")["text"], text, "{name}");
        assert_eq!(data.read(|state| state.has_more_messages(&session)), name != "no more pages", "{name}");
    }
}

/// Only the published page changes the list; the loading flag alone reports nothing.
#[tokio::test(flavor = "local")]
async fn message_load_more_reports_only_the_published_page() {
    let release = Slot::<()>::default();
    let gate = release.clone();
    let data = data(
        handler(move |req: Req| {
            let gate = gate.clone();
            let older = req.param("cursor").is_some();
            async move {
                if !older {
                    return ok(
                        json!({ "data": [{ "id": "msg_2", "type": "user", "text": "b", "time": { "created": 2 } }], "cursor": { "next": "older" } }),
                    );
                }
                gate.wait().await;
                ok(
                    json!({ "data": [{ "id": "msg_1", "type": "user", "text": "a", "time": { "created": 1 } }], "cursor": {} }),
                )
            }
        }),
        Options::default(),
    );
    let session = id(SESSION);
    data.message_sync(&session).await.unwrap();
    let mut taken = Taken::default();
    let seen = taken.take(&data).0;
    let load = {
        let (data, session) = (data.clone(), session.clone());
        tokio::spawn(data.message_load_more(&session, LoadMore::default()))
    };
    wait(|| data.read(|state| state.messages_loading(&session))).await;
    assert_eq!(data.revision(), seen, "starting a load changes nothing a view shows");
    release.resolve(());
    load.await.unwrap().unwrap();
    let (revision, changes) = taken.take(&data);
    assert_eq!(revision, seen + 1, "one flush: the page");
    assert!(changes.has(&session, Touched::SHAPE));
    assert_eq!(ids(&data, SESSION), ["msg_1", "msg_2"]);
    assert!(!data.read(|state| state.messages_loading(&session) || state.has_more_messages(&session)));
}

// Expected: each event of a listened type reaches the signals after its batch, a streaming delta never does, and a
// type stops once its last listener drops.
#[tokio::test(flavor = "local")]
async fn signals_carry_the_listened_events_but_no_deltas() {
    let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
    data.remember(info(session(0)));
    let mut signals = Vec::new();
    let _steps = data.listen([EventKind::SessionStepStarted, EventKind::SessionTextDelta]);
    let renamed = data.listen([EventKind::SessionRenamed]);
    let again = data.listen([EventKind::SessionRenamed]);
    let step = json!({
        "sessionID": SESSION, "assistantMessageID": "msg_a", "agent": "build",
        "model": { "providerID": "p", "id": "m" }, "started": 1,
    });
    data.apply(vec![
        event(durable("session.step.started", "evt_step", 1, step)),
        event(durable(
            "session.text.delta",
            "evt_delta",
            1,
            json!({ "sessionID": SESSION, "assistantMessageID": "msg_a", "ordinal": 0, "delta": "Hi" }),
        )),
        event(durable("session.renamed", "evt_renamed", 1, json!({ "sessionID": SESSION, "title": "Renamed" }))),
    ]);
    let mut tags = || -> Vec<String> {
        data.take_signals(&mut signals);
        signals.iter().map(|event| event.tag().to_owned()).collect()
    };
    assert_eq!(tags(), ["session.step.started", "session.renamed"]);

    let renamed_again =
        || event(durable("session.renamed", "evt_renamed_2", 2, json!({ "sessionID": SESSION, "title": "Again" })));
    drop(renamed);
    data.apply(vec![renamed_again()]);
    assert_eq!(tags(), ["session.renamed"], "another listener still wants it");
    drop(again);
    data.apply(vec![renamed_again()]);
    assert_eq!(tags(), Vec::<String>::new());
}

#[tokio::test(flavor = "local")]
async fn deltas_are_kept_while_listened_and_bounded() {
    let data = data(handler(|_req: Req| async { ok(json!({ "data": [] })) }), Options::default());
    let delta = |ordinal: usize| {
        let body = json!({ "sessionID": "ses_none", "assistantMessageID": "msg_a", "ordinal": ordinal, "delta": "x" });
        event(durable("session.text.delta", &format!("evt_{ordinal}"), 1, body))
    };
    let ordinals = |events: &[V2Event]| -> Vec<i64> {
        events
            .iter()
            .map(|event| match event {
                V2Event::SessionTextDelta(delta) => delta.data.ordinal,
                other => panic!("not a text delta: {}", other.tag()),
            })
            .collect()
    };
    data.apply(vec![delta(0)]);
    let listening = data.listen_deltas();
    assert!(listening.take(<[_]>::is_empty), "kept before anyone listened");
    let woken = std::rc::Rc::new(std::cell::Cell::new(false));
    let wake = woken.clone();
    data.on_change(move || wake.set(true));
    let renamed = event(durable("session.renamed", "evt_renamed", 1, json!({ "sessionID": "ses_none", "title": "T" })));
    data.apply(vec![delta(1), renamed.clone(), delta(2)]);
    assert!(woken.take(), "a kept delta wakes the consumer");
    assert_eq!(listening.take(ordinals), [1, 2]);
    assert!(listening.take(<[_]>::is_empty));
    data.apply(vec![renamed]);
    assert!(listening.take(<[_]>::is_empty));
    let flood: Vec<V2Event> = (0..opencode_store::DELTAS + 2).map(delta).collect();
    data.apply(flood);
    let kept = listening.take(ordinals);
    assert_eq!(
        (kept.len(), kept[0], kept[kept.len() - 1]),
        (opencode_store::DELTAS, 2, opencode_store::DELTAS as i64 + 1)
    );
    data.apply(vec![delta(6)]);
    let second = data.listen_deltas();
    assert!(second.take(<[_]>::is_empty), "a delta from before it listened");
    data.apply(vec![delta(7)]);
    assert_eq!(second.take(ordinals), [7]);
    assert_eq!(listening.take(ordinals), [6, 7], "one listener's take takes none from another");
    data.apply(vec![delta(8)]);
    drop(listening);
    assert_eq!(second.take(ordinals), [8], "another listener still wants them");
    data.apply(vec![delta(9)]);
    drop(second);
    let third = data.listen_deltas();
    assert!(third.take(<[_]>::is_empty), "the last listener's drop forgets them");
    drop(third);
    data.apply(vec![delta(10)]);
    let fourth = data.listen_deltas();
    assert!(fourth.take(<[_]>::is_empty), "kept with no listener");
}
