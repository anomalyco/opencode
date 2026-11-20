//! The running-job store (`packages/client/test/solid-job.test.ts`).

use crate::common;

use common::*;
use opencode_api::generated::*;
use opencode_store::{Data, Options};
use serde_json::{Value, json};

fn job(id: &str, status: &str, session: &str) -> Value {
    json!({ "kind": "codemode", "id": id, "sessionID": session, "status": status, "time": { "started": 1 } })
}

fn running(id: &str) -> Value {
    job(id, "running", "ses_root")
}

/// A store whose job list requests each wait for the test to answer them, in order.
fn setup() -> (Data, Log<Slot<Value>>) {
    let lists = Log::<Slot<Value>>::default();
    let pending = lists.clone();
    let data = data(
        handler(move |req: Req| {
            let pending = pending.clone();
            async move {
                if !req.path.ends_with("/job") {
                    return ok(json!({ "data": [] }));
                }
                assert_eq!(req.param("sessionID"), Some("ses_root"));
                assert_eq!(req.param("status"), Some("running"));
                assert_eq!(req.param("descendants"), Some("true"));
                let slot = Slot::default();
                pending.push(slot.clone());
                ok(json!({ "data": slot.wait().await }))
            }
        }),
        Options::default(),
    );
    (data, lists)
}

fn update(data: &Data, info: Value) {
    let id = format!("evt_{}_{}", info["id"].as_str().unwrap(), info["status"].as_str().unwrap());
    emit(data, json!({ "id": id, "created": 2, "type": "experimental.job.updated", "data": { "info": info } }));
}

fn ids(data: &Data) -> Vec<String> {
    data.read(|state| state.jobs(&SessionID("ses_root".into())).iter().map(|job| job.id().to_owned()).collect())
}

/// The `index`th job list request, once it arrived.
async fn request(lists: &Log<Slot<Value>>, index: usize) -> Slot<Value> {
    wait(|| lists.len() > index).await;
    lists.get()[index].clone()
}

fn root() -> SessionID {
    SessionID("ses_root".into())
}

#[tokio::test]
async fn lists_a_trees_running_jobs_and_follows_job_events() {
    let (data, lists) = setup();
    update(&data, running("job_stale"));
    let synced = data.job_sync(&root());
    request(&lists, 0)
        .await
        .resolve(json!([running("job_listed"), job("job_grandchild", "running", "ses_grandchild")]));
    synced.await.unwrap();
    assert_eq!(ids(&data), ["job_listed", "job_grandchild"]);

    update(&data, running("job_live"));
    assert_eq!(ids(&data), ["job_listed", "job_grandchild", "job_live"]);
    update(&data, job("job_grandchild", "completed", "ses_grandchild"));
    update(&data, job("job_listed", "cancelled", "ses_root"));
    assert_eq!(ids(&data), ["job_live"]);
}

#[tokio::test]
async fn applies_job_events_that_arrive_while_the_list_is_in_flight() {
    let (data, lists) = setup();
    let synced = data.job_sync(&root());
    let list = request(&lists, 0).await;
    update(&data, running("job_started"));
    update(&data, job("job_settled", "completed", "ses_root"));
    list.resolve(json!([running("job_settled")]));
    synced.await.unwrap();
    assert_eq!(ids(&data), ["job_started"]);
}

#[tokio::test]
async fn relists_on_reconnect_and_forgets_a_deleted_tree() {
    let (data, lists) = setup();
    let synced = data.job_sync(&root());
    request(&lists, 0).await.resolve(json!([running("job_a"), running("job_b")]));
    synced.await.unwrap();
    assert_eq!(ids(&data), ["job_a", "job_b"]);

    emit(&data, json!({ "id": "evt_connected", "created": 3, "type": "server.connected", "data": {} }));
    request(&lists, 1).await.resolve(json!([running("job_b")]));
    // The reconnect's list is in flight, so this joins it instead of starting another.
    data.job_sync(&root()).await.unwrap();
    assert_eq!(ids(&data), ["job_b"]);
    assert_eq!(lists.len(), 2);

    emit(
        &data,
        json!({
            "id": "evt_deleted", "created": 4, "type": "session.deleted",
            "durable": { "aggregateID": "ses_root", "seq": 1, "version": 1 }, "data": { "sessionID": "ses_root" },
        }),
    );
    assert!(ids(&data).is_empty());
    emit(&data, json!({ "id": "evt_connected_2", "created": 5, "type": "server.connected", "data": {} }));
    settle().await;
    assert_eq!(lists.len(), 2);
}
