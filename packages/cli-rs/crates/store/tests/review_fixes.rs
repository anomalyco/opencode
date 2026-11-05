//! Regressions for the `carbon` review of F.7 (`reviews/rs-store-core.review-carbon.md`).

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use common::*;
use opencode_api::events::{self, Status};
use opencode_api::generated::*;
use opencode_store::{Catalog, CreateSession, Data, Options};
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
