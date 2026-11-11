//! Regressions for the `carbon` review of F.7 (`reviews/rs-store-core.review-carbon.md`).

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use common::*;
use opencode_api::events::{self, Status};
use opencode_api::generated::*;
use opencode_store::{Catalog, CreateSession, Data, LoadMore, MessageExt, Options};
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};

fn id(value: &str) -> SessionID {
    SessionID(value.into())
}

fn session(id: &str, parent: Option<&str>, cost: f64) -> Value {
    let mut value = json!({
        "id": id, "projectID": "project", "cost": cost,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 0, "updated": 0 }, "location": { "directory": "/project" },
    });
    if let Some(parent) = parent {
        value["parentID"] = parent.into();
    }
    value
}

fn info(value: Value) -> SessionInfo {
    serde_json::from_value(value).unwrap()
}

fn durable(kind: &str, event: &str, data: Value) -> Value {
    let aggregate = data["sessionID"].clone();
    json!({
        "id": event, "created": 1, "type": kind,
        "durable": { "aggregateID": aggregate, "seq": 1, "version": 1 }, "data": data,
    })
}

fn connected() -> V2Event {
    event(json!({ "id": "evt_connected", "type": "server.connected", "data": {} }))
}

fn state(status: Status) -> events::State {
    events::State { status, attempt: 0, error: None }
}

/// Counts requests by path; message lists answer empty, sessions with their info.
fn counting() -> (Data, Log<String>) {
    let paths = Log::<String>::default();
    let log = paths.clone();
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            async move {
                if req.path.ends_with("/message") {
                    return ok(json!({ "data": [], "cursor": {} }));
                }
                if req.path == "/api/session/active" {
                    return ok(json!({ "data": {} }));
                }
                if let Some(rest) = req.path.strip_prefix("/api/session/")
                    && !rest.contains('/')
                {
                    return ok(json!({ "data": session(rest, None, 0.0) }));
                }
                ok(json!({ "data": [] }))
            }
        }),
        Options::default(),
    );
    (data, paths)
}

fn reads(paths: &Log<String>, path: &str) -> usize {
    paths.get().iter().filter(|item| *item == path).count()
}

// carbon-1 -------------------------------------------------------------------------------------

/// A reconnect the status watch coalesces (`Connected -> Reconnecting -> Connected` before `run`
/// polls it) must still invalidate cached reads and wake views.
#[tokio::test]
async fn a_coalesced_reconnect_invalidates_reads_and_flushes_everything() {
    let (data, paths) = counting();
    let (status, watcher) = watch::channel(state(Status::Connected));
    let (batches, receiver) = mpsc::channel(8);
    let driver = tokio::spawn(opencode_store::connection::run(data.clone(), watcher, receiver));
    batches.send(vec![connected()]).await.unwrap();
    settle().await;
    let path = "/api/session/ses_a/message";
    data.message_sync(&id("ses_a")).await.unwrap();
    assert_eq!(reads(&paths, path), 1);
    let seen = data.revision();

    // The second `server.connected` arrives with no status change `run` could observe.
    batches.send(vec![connected()]).await.unwrap();
    settle().await;
    let (_, changes) = data.changes_since(seen);
    assert!(changes.all, "a reconnect wakes every view");
    data.message_sync(&id("ses_a")).await.unwrap();
    assert_eq!(reads(&paths, path), 2, "a reconnect invalidates cached reads");
    drop((status, batches));
    driver.await.unwrap();
}

/// The dying stream's last batch is applied before the disconnect invalidates, so a
/// `session.created` in it cannot keep its reads marked done across the reconnect.
#[tokio::test]
async fn the_dying_streams_tail_batch_applies_before_the_disconnect() {
    let (data, paths) = counting();
    let (status, watcher) = watch::channel(state(Status::Connected));
    let (batches, receiver) = mpsc::channel(8);
    let driver = tokio::spawn(opencode_store::connection::run(data.clone(), watcher, receiver));
    batches.send(vec![connected()]).await.unwrap();
    settle().await;

    // F.3 flushes the tail into the queue, then reports the disconnect.
    let created = durable(
        "session.created",
        "evt_created",
        json!({ "sessionID": "ses_new", "projectID": "project", "location": { "directory": "/project" }, "slug": "s", "version": "1" }),
    );
    batches.send(vec![event(created)]).await.unwrap();
    status.send_replace(state(Status::Reconnecting));
    settle().await;
    status.send_replace(state(Status::Connected));
    settle().await;

    data.message_sync(&id("ses_new")).await.unwrap();
    assert_eq!(reads(&paths, "/api/session/ses_new/message"), 1);
    drop((status, batches));
    driver.await.unwrap();
}

// carbon-2 -------------------------------------------------------------------------------------

/// A deletion between a read's call and its task's first poll must not let the read publish
/// (`solid-refresh.test.ts` "does not resurrect").
async fn deleted_before_first_poll(read: &str) {
    let (data, _) = counting();
    let target = id("ses_gone");
    let task = match read {
        "session" => data.session_sync(&target, false),
        "message" => data.message_sync(&target),
        "permission" => data.permission_sync(&target),
        _ => data.form_sync("ses_gone", None),
    };
    emit(&data, durable("session.deleted", "evt_deleted", json!({ "sessionID": "ses_gone" })));
    task.await.unwrap();
    data.read(|state| {
        assert!(state.is_missing(&target), "{read}: still missing");
        assert!(state.session(&target).is_none(), "{read}: no info");
        assert!(state.transcript(&target).is_none(), "{read}: no transcript");
        assert!(state.permissions(&target).is_none(), "{read}: no permissions");
        assert!(state.forms("ses_gone", None).is_none(), "{read}: no forms");
    });
}

#[tokio::test]
async fn a_session_read_started_before_a_deletion_does_not_resurrect_it() {
    deleted_before_first_poll("session").await;
}

#[tokio::test]
async fn a_message_read_started_before_a_deletion_does_not_resurrect_it() {
    deleted_before_first_poll("message").await;
}

#[tokio::test]
async fn a_permission_read_started_before_a_deletion_does_not_resurrect_it() {
    deleted_before_first_poll("permission").await;
}

#[tokio::test]
async fn a_form_read_started_before_a_deletion_does_not_resurrect_it() {
    deleted_before_first_poll("form").await;
}

// carbon-3 -------------------------------------------------------------------------------------

#[tokio::test]
async fn overtaking_enqueues_keep_their_order() {
    let release = Slot::<()>::default();
    let gate = release.clone();
    let data = data(
        handler(move |_req: Req| {
            let gate = gate.clone();
            async move {
                gate.wait().await;
                ok(json!({ "data": [] }))
            }
        }),
        Options::default(),
    );
    let target = id("ses_order");
    let reading = data.pending_sync(&target);
    let ids: Vec<String> = (1..=8).map(|index| format!("msg_0{index}")).collect();
    for inbox in &ids {
        emit(
            &data,
            durable(
                "session.inbox.enqueued",
                "evt_enqueue",
                json!({ "sessionID": "ses_order", "inboxID": inbox, "item": { "type": "user", "delivery": "steer", "payload": { "text": inbox } } }),
            ),
        );
    }
    release.resolve(());
    reading.await.unwrap();
    let order: Vec<String> = data.read(|state| state.inputs(&target).iter().map(|id| (*id).to_owned()).collect());
    assert_eq!(order, ids);
}

// carbon-4 -------------------------------------------------------------------------------------

/// The read of a running session that is not loaded checks the connection when it would start.
#[tokio::test]
async fn rehydration_reads_nothing_once_offline() {
    let release = Slot::<()>::default();
    let paths = Log::<String>::default();
    let (gate, log) = (release.clone(), paths.clone());
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            let gate = gate.clone();
            async move {
                if req.path == "/api/session/active" {
                    gate.wait().await;
                    return ok(json!({ "data": { "ses_x": { "type": "running" } } }));
                }
                ok(json!({ "data": session("ses_x", None, 0.0) }))
            }
        }),
        Options::default(),
    );
    data.apply(&[connected()]);
    wait(|| paths.get().iter().any(|path| path == "/api/session/active")).await;
    data.set_online(false);
    release.resolve(());
    settle().await;
    assert_eq!(reads(&paths, "/api/session/ses_x"), 0);
}

// carbon-6 -------------------------------------------------------------------------------------

#[tokio::test]
async fn child_changes_mark_the_root_whose_family_and_cost_they_change() {
    let (data, _) = counting();
    let root = id("ses_root");
    data.remember(info(session("ses_root", None, 0.5)));
    let seen = data.revision();
    data.remember(info(session("ses_child", Some("ses_root"), 1.0)));
    let (seen, changes) = {
        let (revision, changes) = data.changes_since(seen);
        (revision, changes)
    };
    assert!(changes.session(&root), "joining the family changes the root");
    assert_eq!(data.read(|state| state.cost(&root)), 1.5);

    emit(
        &data,
        durable(
            "session.usage.updated",
            "evt_usage",
            json!({ "sessionID": "ses_child", "cost": 2.0, "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } } }),
        ),
    );
    let (seen, changes) = data.changes_since(seen);
    assert!(changes.session(&root), "child usage changes the root's cost");

    emit(&data, durable("session.deleted", "evt_deleted", json!({ "sessionID": "ses_child" })));
    let (_, changes) = data.changes_since(seen);
    assert!(changes.session(&root), "removing a child changes the root's family");
    assert_eq!(data.read(|state| state.family(&root).len()), 1);
}

#[tokio::test]
async fn a_failed_create_after_its_echo_flushes_the_end_of_creating() {
    let release = Slot::<()>::default();
    let gate = release.clone();
    let data = data(
        handler(move |req: Req| {
            let gate = gate.clone();
            async move {
                if req.path == "/api/session" {
                    gate.wait().await;
                    return Reply::Text(500, "Creation failed".into());
                }
                ok(json!({ "data": session("ses_made", None, 0.0) }))
            }
        }),
        Options::default(),
    );
    let made = id("ses_made");
    let (_, request) = data.session_create(CreateSession { id: Some(made.clone()), ..Default::default() });
    emit(
        &data,
        durable(
            "session.created",
            "evt_created",
            json!({ "sessionID": "ses_made", "projectID": "project", "location": { "directory": "/project" }, "slug": "s", "version": "1" }),
        ),
    );
    // Let the echo's own session read land first.
    settle().await;
    let seen = data.revision();
    release.resolve(());
    assert!(request.await.is_err());
    assert!(!data.read(|state| state.is_creating(&made)));
    let (_, changes) = data.changes_since(seen);
    assert!(changes.session(&made), "the end of creating is a change");
}

#[tokio::test]
async fn views_read_changes_and_state_under_one_lock() {
    let (data, _) = counting();
    data.remember(info(session("ses_a", None, 0.0)));
    let (revision, changes, count) = data.read(|state| {
        let (revision, changes) = state.changes_since(0);
        (revision, changes, state.sessions().len())
    });
    assert_eq!(revision, data.revision());
    assert!(changes.session(&id("ses_a")));
    assert_eq!(count, 1);
}

// carbon-7 -------------------------------------------------------------------------------------

#[test]
fn connect_works_from_a_thread_outside_the_runtime() {
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
    let opened = Arc::new(AtomicUsize::new(0));
    let count = opened.clone();
    let client = client(handler(move |_req: Req| {
        count.fetch_add(1, Ordering::SeqCst);
        async { Reply::Text(500, "no stream".into()) }
    }));
    let data = Data::with_runtime(client, Options::default(), runtime.handle().clone());
    // The UI thread has no runtime context.
    let (connection, _task) =
        std::thread::spawn(move || opencode_store::connection::connect(&data, events::Options::default()))
            .join()
            .expect("connect does not panic outside the runtime");
    runtime.block_on(async {
        wait(|| opened.load(Ordering::SeqCst) > 0).await;
    });
    drop(connection);
}

/// MS1 `carbon-5`, after `store-ui-flow`: a read inside a read on the same thread reuses the outer guard, and reads
/// of another store nest. A write inside a read panics in every build instead of hanging.
#[tokio::test]
async fn a_nested_read_works_and_a_write_inside_a_read_panics() {
    let data = common::data(handler(|_| async { ok(json!({})) }), Options::default());
    let other = common::data(handler(|_| async { ok(json!({})) }), Options::default());
    assert!(data.read(|_| other.read(|_| data.read(|_| true))));
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            data.read(|_| data.catalog_invalidate(Catalog::Model, None));
        }));
        let _ = sender.send(result.is_err());
    });
    let panicked = receiver.recv_timeout(std::time::Duration::from_secs(2));
    assert_eq!(panicked, Ok(true), "a write inside a read must panic, not hang");
}

// r2 data review --------------------------------------------------------------------------------

#[tokio::test]
async fn deleting_a_session_drops_its_forms() {
    let (data, _) = counting();
    emit(
        &data,
        json!({
            "id": "evt_form", "created": 1, "type": "form.created", "location": { "directory": "/project" },
            "data": { "form": { "id": "frm_a", "sessionID": "ses_form", "title": "Ask", "fields": [] } },
        }),
    );
    assert_eq!(data.read(|state| state.form_sessions().len()), 1);
    let seen = data.revision();
    emit(&data, durable("session.deleted", "evt_deleted", json!({ "sessionID": "ses_form" })));
    let (_, changes) = data.changes_since(seen);
    assert!(changes.forms("ses_form"));
    assert!(data.read(|state| state.forms("ses_form", None).is_none()));
    assert!(data.read(|state| state.form_sessions().is_empty()));
}

/// `handleEvent` "session.step.failed": a budget refusal refreshes usage limits that were read.
#[tokio::test]
async fn a_budget_refusal_refreshes_usage_limits() {
    let paths = Log::<String>::default();
    let log = paths.clone();
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            async move { ok(json!({ "location": { "directory": "/project" }, "data": null })) }
        }),
        Options::default(),
    );
    let location = opencode_store::Location::new("/project");
    data.catalog_sync(Catalog::UsageLimits, Some(&location)).await.unwrap();
    let failed = |event: &str, error: &str| {
        let mut value = durable(
            "session.step.failed",
            event,
            json!({
                "sessionID": "ses_a", "assistantMessageID": "msg_a",
                "error": { "type": error, "message": "limit" },
            }),
        );
        value["location"] = json!({ "directory": "/project" });
        value
    };
    emit(&data, failed("evt_other", "provider.rate-limit"));
    settle().await;
    assert_eq!(reads(&paths, "/api/experimental/usage/limits"), 1);
    emit(&data, failed("evt_budget", "provider.budget-limit"));
    wait(|| reads(&paths, "/api/experimental/usage/limits") == 2).await;
    emit(&data, failed("evt_model", "provider.model-budget-limit"));
    wait(|| reads(&paths, "/api/experimental/usage/limits") == 3).await;
}

// O-89: list snapshots keep what arrived meanwhile -------------------------------------------------

/// A handler that answers `path` with the list the test releases, and everything else empty.
fn held(path: &'static str) -> (Data, Slot<Value>) {
    let slot = Slot::<Value>::default();
    let release = slot.clone();
    let data = data(
        handler(move |req: Req| {
            let release = release.clone();
            async move {
                if req.path == path {
                    return ok(json!({ "data": release.wait().await, "cursor": {} }));
                }
                ok(json!({ "data": [] }))
            }
        }),
        Options::default(),
    );
    (data, slot)
}

fn permission(id: &str) -> Value {
    json!({ "id": id, "sessionID": "ses_p", "action": "bash", "resources": ["ls"] })
}

/// A permission asked while the list read is in flight survives the older snapshot; one replied
/// meanwhile does not come back with it.
#[tokio::test]
async fn a_permission_list_keeps_asks_and_replies_that_overtook_it() {
    let (data, release) = held("/api/session/ses_p/permission");
    let task = data.permission_sync(&id("ses_p"));
    let running = tokio::spawn(task);
    settle().await;
    emit(&data, json!({ "id": "evt_asked", "created": 1, "type": "permission.asked", "data": permission("per_new") }));
    emit(
        &data,
        json!({
            "id": "evt_replied", "created": 2, "type": "permission.replied",
            "data": { "sessionID": "ses_p", "requestID": "per_old", "reply": "once" },
        }),
    );
    release.resolve(json!([permission("per_old"), permission("per_kept")]));
    running.await.unwrap().unwrap();
    let ids = data.read(|state| {
        state.permissions(&id("ses_p")).unwrap().iter().map(|item| item.id.0.clone()).collect::<Vec<_>>()
    });
    assert_eq!(ids, ["per_kept", "per_new"]);
}

/// More changes than the overlay holds overtake a permission read: it publishes nothing and reads
/// again, so the bound costs a read, never an ask (model M1, O-92 Q1).
#[tokio::test]
async fn an_overflowed_permission_read_reads_again() {
    let slot = Slot::<Value>::default();
    let release = slot.clone();
    let reads = Arc::new(AtomicUsize::new(0));
    let counted = reads.clone();
    let asked: Vec<String> = (0..1100).map(|n| format!("per_{n:04}")).collect();
    let server: Vec<Value> =
        std::iter::once("per_old").chain(asked.iter().map(String::as_str)).map(permission).collect();
    let data = data(
        handler(move |_: Req| {
            let release = release.clone();
            let server = server.clone();
            let first = counted.fetch_add(1, Ordering::SeqCst) == 0;
            async move {
                if first {
                    return ok(json!({ "data": release.wait().await }));
                }
                ok(json!({ "data": server }))
            }
        }),
        Options::default(),
    );
    let running = tokio::spawn(data.permission_sync(&id("ses_p")));
    settle().await;
    for (n, ask) in asked.iter().enumerate() {
        emit(
            &data,
            json!({ "id": format!("evt_{n}"), "created": n, "type": "permission.asked", "data": permission(ask) }),
        );
    }
    slot.resolve(json!([permission("per_old")]));
    running.await.unwrap().unwrap();
    wait(|| reads.load(Ordering::SeqCst) == 2).await;
    wait(|| data.read(|state| state.permissions(&id("ses_p")).unwrap().len() == 1101)).await;
    let first = data.read(|state| state.permissions(&id("ses_p")).unwrap()[0].id.0.clone());
    assert_eq!(first, "per_old");
}

fn form(id: &str) -> Value {
    json!({ "id": id, "sessionID": "ses_f", "title": "Ask", "fields": [] })
}

#[tokio::test]
async fn a_form_list_keeps_forms_created_and_settled_while_it_was_read() {
    let (data, release) = held("/api/session/ses_f/form");
    let running = tokio::spawn(data.form_sync("ses_f", None));
    settle().await;
    emit(
        &data,
        json!({
            "id": "evt_form", "created": 1, "type": "form.created", "location": { "directory": "/project" },
            "data": { "form": form("frm_new") },
        }),
    );
    emit(
        &data,
        json!({
            "id": "evt_cancel", "created": 2, "type": "form.cancelled", "location": { "directory": "/project" },
            "data": { "id": "frm_old", "sessionID": "ses_f" },
        }),
    );
    release.resolve(json!([form("frm_old"), form("frm_kept")]));
    running.await.unwrap().unwrap();
    let ids = data.read(|state| {
        state.forms("ses_f", None).unwrap().iter().map(|form| form.info.id.0.clone()).collect::<Vec<_>>()
    });
    assert_eq!(ids, ["frm_kept", "frm_new"]);
}

fn streamed(kind: &str, event: &str, mut data: Value) -> Value {
    data["sessionID"] = "ses_m".into();
    data["assistantMessageID"] = "msg_a".into();
    durable(kind, event, data)
}

fn text(data: &Data, message: &str) -> Option<String> {
    data.read(|state| {
        let value = serde_json::to_value(state.message(&id("ses_m"), message)?).unwrap();
        value["content"][0]["text"].as_str().map(str::to_owned)
    })
}

/// A latest-page read that started before a step must not erase the assistant row the step's
/// events created, with or without an older copy of it in the page.
#[tokio::test]
async fn a_transcript_refresh_keeps_the_reply_that_streamed_meanwhile() {
    let user = json!({ "id": "msg_u", "type": "user", "text": "hi", "time": { "created": 1 } });
    let stale = json!({
        "id": "msg_a", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
        "content": [], "time": { "created": 2 },
    });
    // Pages list the newest first.
    for page in [json!([user]), json!([stale, user])] {
        let (data, release) = held("/api/session/ses_m/message");
        let running = tokio::spawn(data.message_sync(&id("ses_m")));
        settle().await;
        emit(
            &data,
            streamed(
                "session.step.started",
                "evt_step",
                json!({ "agent": "build", "model": { "providerID": "p", "id": "m" }, "started": 2 }),
            ),
        );
        emit(&data, streamed("session.text.started", "evt_text", json!({ "ordinal": 0 })));
        emit(&data, streamed("session.text.delta", "evt_delta", json!({ "ordinal": 0, "delta": "Hel" })));
        release.resolve(page.clone());
        running.await.unwrap().unwrap();
        emit(&data, streamed("session.text.delta", "evt_delta2", json!({ "ordinal": 0, "delta": "lo" })));
        let ids: Vec<String> =
            data.read(|state| state.messages(&id("ses_m")).iter().map(|item| item.id().to_owned()).collect());
        assert_eq!(ids, ["msg_u", "msg_a"], "{page}");
        assert_eq!(text(&data, "msg_a").as_deref(), Some("Hello"), "{page}");
    }
}

/// An older page read from a cursor that a latest-page refresh replaced is not stitched onto the
/// new list: the load starts again from the new cursor, so no message goes missing.
#[tokio::test]
async fn an_older_page_does_not_leave_a_gap_after_a_refresh() {
    let release = Slot::<()>::default();
    let gate = release.clone();
    let latest = Arc::new(AtomicUsize::new(2));
    let head = latest.clone();
    let row = |n: usize| json!({ "id": format!("msg_{n}"), "type": "user", "text": "x", "time": { "created": n } });
    let data = data(
        handler(move |req: Req| {
            let gate = gate.clone();
            let head = head.load(Ordering::SeqCst);
            let cursor = req.param("cursor").map(str::to_owned);
            async move {
                // One message a page; the cursor `before:N` lists message N - 1.
                let n = match cursor {
                    None => head,
                    Some(cursor) => {
                        let n: usize = cursor.strip_prefix("before:").unwrap().parse::<usize>().unwrap() - 1;
                        if n == 1 {
                            gate.wait().await;
                        }
                        n
                    }
                };
                let next = if n > 1 { json!({ "next": format!("before:{n}") }) } else { json!({}) };
                ok(json!({ "data": [row(n)], "cursor": next }))
            }
        }),
        Options { initial_message_limit: Some(1), ..Default::default() },
    );
    let session = id("ses_m");
    data.message_sync(&session).await.unwrap();
    let load = {
        let (data, session) = (data.clone(), session.clone());
        tokio::spawn(async move { data.message_load_more(&session, LoadMore::default()).await })
    };
    settle().await;
    latest.store(3, Ordering::SeqCst);
    data.message_invalidate(&session);
    data.message_sync(&session).await.unwrap();
    release.resolve(());
    load.await.unwrap().unwrap();
    let ids: Vec<String> =
        data.read(|state| state.messages(&session).iter().map(|item| item.id().to_owned()).collect());
    assert_eq!(ids.first().map(String::as_str), Some("msg_2"), "{ids:?}");
    assert_eq!(ids, ["msg_2", "msg_3"]);
    assert!(data.read(|state| state.has_more_messages(&session)), "the cursor to msg_1 is kept");
}
