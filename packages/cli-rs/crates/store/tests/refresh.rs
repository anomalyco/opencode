//! Port of `packages/client/test/solid-refresh.test.ts`. The typed client decodes every response,
//! so the fixtures add the fields the TS fixtures leave out: `project` on `/api/location`, a VCS
//! `branch`, and complete agents.

mod common;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use opencode_api::generated::*;
use opencode_store::location::SETTLE;
use opencode_store::{Catalog, Data, Options};
use serde_json::{Value, json};

fn id(value: &str) -> SessionID {
    SessionID(value.into())
}

fn location() -> Value {
    json!({ "directory": "/project" })
}

fn agent(name: &str) -> Value {
    json!({
        "id": name, "name": name, "mode": "primary", "hidden": false,
        "request": { "settings": {}, "headers": {}, "body": {} }, "permissions": [],
    })
}

fn session(id: &str, parent: Option<&str>, idle: Option<u64>) -> Value {
    let mut time = json!({ "created": 0, "updated": 0 });
    if let Some(idle) = idle {
        time["idle"] = json!(idle);
    }
    json!({
        "id": id, "parentID": parent, "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": time, "location": { "directory": "/project" },
    })
}

fn info(value: Value) -> SessionInfo {
    serde_json::from_value(value).unwrap()
}

fn errors(data: &Data) -> Arc<Mutex<Vec<String>>> {
    let errors = Arc::new(Mutex::new(Vec::new()));
    let log = errors.clone();
    data.on_error(move |error| log.lock().unwrap().push(error.to_string()));
    errors
}

#[tokio::test]
async fn config_reads_and_update_refreshes_are_opt_in() {
    let requests = Log::<String>::default();
    let model = Arc::new(Mutex::new("provider/first".to_owned()));
    let (log, current) = (requests.clone(), model.clone());
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            let model = current.lock().unwrap().clone();
            async move {
                match req.path.as_str() {
                    "/api/location" => ok(json!({
                        "directory": "/project",
                        "project": { "id": "project", "directory": "/project", "canonical": "/project" },
                    })),
                    "/api/config" => {
                        ok(json!([{ "type": "document", "info": { "model": model } }]))
                    }
                    "/api/mcp/resource" => ok(json!({
                        "location": location(), "data": { "resources": [], "templates": [] },
                    })),
                    "/api/vcs" => ok(json!({ "location": location(), "data": { "branch": {} } })),
                    _ => ok(json!({ "location": location(), "data": [] })),
                }
            }
        }),
        Options::default(),
    );
    let config_reads = || {
        requests
            .get()
            .iter()
            .filter(|path| *path == "/api/config")
            .count()
    };
    let event = json!({ "id": "evt_config", "created": 1, "type": "config.updated", "location": location(), "data": {} });

    data.location_sync(None).await.unwrap();
    emit(&data, event.clone());
    settle().await;
    assert_eq!(config_reads(), 0);

    data.catalog_sync(Catalog::Config, None).await.unwrap();
    assert_eq!(config_reads(), 1);
    *model.lock().unwrap() = "provider/second".into();
    emit(&data, event);
    data.catalog_sync(Catalog::Config, None).await.unwrap();
    assert_eq!(config_reads(), 2);
    let config = data.read(|state| state.location(None).unwrap().config.clone().unwrap());
    assert_eq!(
        serde_json::to_value(config).unwrap(),
        json!([{ "type": "document", "info": { "model": "provider/second" } }])
    );
}

#[tokio::test]
async fn event_refreshes_report_failures_remain_retryable_and_preserve_explicit_read_errors() {
    let offline = Arc::new(AtomicBool::new(true));
    let requests = Arc::new(AtomicUsize::new(0));
    let (down, count) = (offline.clone(), requests.clone());
    let data = data(
        handler(move |_req: Req| {
            count.fetch_add(1, Ordering::SeqCst);
            let down = down.load(Ordering::SeqCst);
            async move {
                if down {
                    return Reply::Fail("Failed to fetch".into());
                }
                let mut recovered = session("ses_refresh_failure", None, Some(2));
                recovered["title"] = json!("Recovered");
                ok(json!({ "data": recovered }))
            }
        }),
        Options::default(),
    );
    let errors = errors(&data);
    let target = id("ses_refresh_failure");
    let viewed = json!({
        "id": "evt_refresh_failure", "created": 2, "type": "session.viewed",
        "durable": { "aggregateID": "ses_refresh_failure", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_refresh_failure", "idle": 2 },
    });

    data.remember(info(session("ses_refresh_failure", None, Some(2))));
    data.session_invalidate(&target);
    let error = data.session_sync(&target, false).await.unwrap_err();
    assert!(error.to_string().contains("Failed to fetch"), "{error}");
    assert!(errors.lock().unwrap().is_empty());
    emit(&data, viewed.clone());
    wait(|| !errors.lock().unwrap().is_empty()).await;
    assert_eq!(errors.lock().unwrap().len(), 1);
    assert!(data.read(|state| state.session(&target).unwrap().title.is_none()));
    offline.store(false, Ordering::SeqCst);
    emit(&data, viewed);
    data.session_sync(&target, false).await.unwrap();
    assert_eq!(
        data.read(|state| state.session(&target).unwrap().title.clone()),
        Some("Recovered".into())
    );
    assert_eq!(requests.load(Ordering::SeqCst), 3);
}

async fn background_reads_respect(mode: &str) {
    let pending = Slot::<Reply>::default();
    let requests = Arc::new(AtomicUsize::new(0));
    let (wait, count) = (pending.clone(), requests.clone());
    let data = data(
        handler(move |_req: Req| {
            let first = count.fetch_add(1, Ordering::SeqCst) == 0;
            let wait = wait.wait();
            async move {
                if first {
                    return ok(json!({ "location": location(), "data": [] }));
                }
                wait.await
            }
        }),
        Options::default(),
    );
    let errors = errors(&data);
    data.catalog_sync(Catalog::Command, None).await.unwrap();
    if mode == "reconnecting" {
        data.set_online(false);
    }
    emit(
        &data,
        json!({ "id": "evt_refresh_owner", "created": 1, "type": "command.updated", "location": location(), "data": {} }),
    );
    if mode == "reconnecting" {
        settle().await;
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        return;
    }
    let joined = data.catalog_sync(Catalog::Command, None);
    data.dispose();
    pending.resolve(Reply::Fail("Failed to fetch".into()));
    let error = joined.await.unwrap_err();
    assert!(error.to_string().contains("Failed to fetch"), "{error}");
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    settle().await;
    assert!(errors.lock().unwrap().is_empty());
}

#[tokio::test]
async fn background_reads_respect_reconnecting_owners() {
    background_reads_respect("reconnecting").await;
}

#[tokio::test]
async fn background_reads_respect_disposed_owners() {
    background_reads_respect("disposed").await;
}

#[tokio::test]
async fn a_burst_of_mcp_status_changed_events_refetches_the_server_list_once_it_settles() {
    let requests = Log::<String>::default();
    let log = requests.clone();
    let data = data(
        handler(move |req: Req| {
            log.push(req.path.clone());
            async move { ok(json!({ "location": location(), "data": [] })) }
        }),
        Options::default(),
    );
    let reads = || {
        requests
            .get()
            .iter()
            .filter(|path| *path == "/api/mcp")
            .count()
    };
    data.catalog_sync(Catalog::McpServer, None).await.unwrap();
    assert_eq!(reads(), 1);
    for server in ["a", "b", "c", "d", "e"] {
        emit(
            &data,
            json!({
                "id": format!("evt_{server}"), "created": 1, "type": "mcp.status.changed",
                "location": location(), "data": { "server": server },
            }),
        );
    }
    settle().await;
    assert_eq!(reads(), 1);
    tokio::time::sleep(SETTLE * 2).await;
    assert_eq!(reads(), 2);
}

#[tokio::test]
async fn invalidations_that_land_before_a_queued_reload_starts_are_absorbed_by_it() {
    let pending = Arc::new(Mutex::new(Vec::<Slot<Reply>>::new()));
    let slots = pending.clone();
    let data = data(
        handler(move |_req: Req| {
            let slot = Slot::<Reply>::default();
            slots.lock().unwrap().push(slot.clone());
            slot.wait()
        }),
        Options::default(),
    );
    let count = || pending.lock().unwrap().len();
    let slot = |index: usize| pending.lock().unwrap()[index].clone();

    let first = data.catalog_sync(Catalog::Agent, None);
    wait(|| count() == 1).await;
    data.catalog_invalidate(Catalog::Agent, None);
    let second = data.catalog_sync(Catalog::Agent, None);
    data.catalog_invalidate(Catalog::Agent, None);
    let third = data.catalog_sync(Catalog::Agent, None);
    data.catalog_invalidate(Catalog::Agent, None);
    settle().await;
    assert_eq!(count(), 1);
    slot(0).resolve(ok(json!({ "location": location(), "data": [] })));
    first.await.unwrap();
    wait(|| count() == 2).await;
    slot(1).resolve(ok(
        json!({ "location": location(), "data": [agent("reviewer")] }),
    ));
    second.await.unwrap();
    third.await.unwrap();
    assert_eq!(count(), 2);
    data.catalog_sync(Catalog::Agent, None).await.unwrap();
    assert_eq!(count(), 2);
}

#[tokio::test]
async fn event_driven_session_reads_evict_missing_sessions_without_reporting_an_error() {
    let data = data(
        handler(|_req: Req| async {
            Reply::Json(
                404,
                json!({
                    "_tag": "SessionNotFoundError", "sessionID": "ses_ephemeral",
                    "message": "Session not found: ses_ephemeral",
                }),
            )
        }),
        Options::default(),
    );
    let errors = errors(&data);
    let target = id("ses_ephemeral");
    data.remember(info(session("ses_ephemeral", None, Some(1))));
    assert!(data.read(|state| state.session(&target).is_some()));
    emit(
        &data,
        json!({
            "id": "evt_ephemeral_viewed", "created": 2, "type": "session.viewed",
            "durable": { "aggregateID": "ses_ephemeral", "seq": 1, "version": 1 },
            "data": { "sessionID": "ses_ephemeral", "idle": 2 },
        }),
    );
    wait(|| data.read(|state| state.is_missing(&target))).await;
    assert!(errors.lock().unwrap().is_empty());
    assert!(data.read(|state| state.session(&target).is_none()));

    let error = data.session_sync(&target, false).await.unwrap_err();
    let declared = error.declared().unwrap();
    assert_eq!(declared.tag.as_deref(), Some("SessionNotFoundError"));
    assert_eq!(declared.body["sessionID"], "ses_ephemeral");
    assert!(errors.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delayed_metadata_and_family_reads_do_not_resurrect_sessions_deleted_while_in_flight() {
    let own_started = Slot::<()>::default();
    let own_release = Slot::<()>::default();
    let family_started = Slot::<()>::default();
    let family_release = Slot::<()>::default();
    let child_reads = Arc::new(AtomicUsize::new(0));
    let (own_signal, own_wait, family_signal, family_wait, reads) = (
        own_started.clone(),
        own_release.clone(),
        family_started.clone(),
        family_release.clone(),
        child_reads.clone(),
    );
    let data = data(
        handler(move |req: Req| {
            let path = req.path.clone();
            let family = path == "/api/session" && req.param("parentID") == Some("ses_root");
            let own = path == "/api/session/ses_child" && reads.fetch_add(1, Ordering::SeqCst) == 0;
            let (own_signal, own_wait) = (own_signal.clone(), own_wait.wait());
            let (family_signal, family_wait) = (family_signal.clone(), family_wait.wait());
            async move {
                if path == "/api/session/ses_root" {
                    return ok(json!({ "data": session("ses_root", None, None) }));
                }
                if family {
                    family_signal.resolve(());
                    family_wait.await;
                    return ok(json!({
                        "data": [session("ses_child", Some("ses_root"), None)], "cursor": {},
                    }));
                }
                if own {
                    own_signal.resolve(());
                    own_wait.await;
                    return ok(json!({ "data": session("ses_child", Some("ses_root"), None) }));
                }
                Reply::Json(
                    404,
                    json!({
                        "_tag": "SessionNotFoundError", "sessionID": "ses_child",
                        "message": "Session not found: ses_child",
                    }),
                )
            }
        }),
        Options::default(),
    );
    let (root, child) = (id("ses_root"), id("ses_child"));
    let deleted = |seq: u64| {
        emit(
            &data,
            json!({
                "id": format!("evt_del_{seq}"), "created": seq, "type": "session.deleted",
                "durable": { "aggregateID": "ses_child", "seq": seq, "version": 1 },
                "data": { "sessionID": "ses_child" },
            }),
        );
    };

    // An own metadata read started before the deletion must not publish.
    data.remember(info(session("ses_child", Some("ses_root"), None)));
    data.session_invalidate(&child);
    let own = data.session_sync(&child, false);
    own_started.wait().await;
    deleted(1);
    assert!(data.read(|state| state.session(&child).is_none()));
    own_release.resolve(());
    own.await.unwrap();
    assert!(data.read(|state| state.session(&child).is_none()));

    // A parent family read started before the child's deletion must not publish it either.
    data.remember(info(session("ses_root", None, None)));
    data.remember(info(session("ses_child", Some("ses_root"), None)));
    let family = data.session_sync(&root, true);
    family_started.wait().await;
    deleted(2);
    assert!(data.read(|state| state.session(&child).is_none()));
    family_release.resolve(());
    family.await.unwrap();
    assert!(data.read(|state| state.session(&child).is_none()));
    assert_eq!(
        data.read(|state| state.family(&root).to_vec()),
        [root.clone()]
    );
    let error = tokio::time::timeout(Duration::from_secs(2), data.session_sync(&child, false))
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(
        error.declared().unwrap().tag.as_deref(),
        Some("SessionNotFoundError")
    );
}
