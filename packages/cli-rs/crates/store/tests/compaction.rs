//! Port of `packages/client/test/solid-compaction.test.ts`. The TS listener-count assertions have
//! no counterpart: the Rust store receives batches through `Data::apply`, not a listener.

mod common;

use std::sync::Arc;

use common::*;
use futures_util::FutureExt;
use futures_util::future::{BoxFuture, Shared};
use opencode_api::generated::*;
use opencode_store::{CreateSession, Data, Error, Options, Prompt, SessionStatus};
use serde_json::{Value, json};

const SESSION: &str = "ses_compact";

fn session() -> SessionID {
    SessionID(SESSION.into())
}

fn item(id: &str, created: u64) -> Value {
    json!({
        "id": id, "sessionID": SESSION, "time": { "created": created }, "type": "compaction",
        "delivery": "steer", "payload": {},
    })
}

fn info(values: Value) -> Vec<SessionInboxInfo> {
    serde_json::from_value(values).unwrap()
}

fn event(kind: &str, data: Value) -> Value {
    json!({
        "id": "evt_compact", "created": 10, "type": kind,
        "durable": { "aggregateID": SESSION, "seq": 1, "version": 1 }, "data": data,
    })
}

type Override = Arc<dyn Fn(&Req) -> Option<BoxFuture<'static, Reply>> + Send + Sync>;

#[derive(Clone, Default)]
struct Parts {
    /// True resolves the model switch; false fails it.
    model: Slot<bool>,
    response: Slot<Reply>,
    calls: Log<String>,
    proposals: Log<String>,
    pending: Log<Value>,
}

struct Setup {
    data: Data,
}

fn setup(parts: &Parts, intercept: Option<Override>) -> Setup {
    let shared = parts.clone();
    let data = data(
        handler(move |req: Req| {
            let parts = shared.clone();
            let intercepted = intercept.as_ref().and_then(|intercept| intercept(&req));
            async move {
                if let Some(reply) = intercepted {
                    return reply.await;
                }
                match req.rpc() {
                    "inbox" => ok(json!({ "data": parts.pending.get() })),
                    "model" => {
                        parts.calls.push("model".into());
                        if parts.model.wait().await {
                            // `POST /api/session/:id/model` answers 204 with no body.
                            return Reply::Text(204, String::new());
                        }
                        Reply::Text(500, "Model setup failed".into())
                    }
                    "compact" => {
                        parts.calls.push("compact".into());
                        parts.proposals.push(req.id());
                        parts.response.wait().await
                    }
                    "prompt" => {
                        parts.calls.push("prompt".into());
                        let mut row = item(&req.id(), 10);
                        row["type"] = "user".into();
                        row["payload"] = json!({ "text": "Follow up" });
                        ok(json!({ "data": row }))
                    }
                    rpc => panic!("unexpected request: {rpc}"),
                }
            }
        }),
        Options::default(),
    );
    Setup { data }
}

impl Setup {
    fn pending(&self, id: &str) -> Vec<SessionInboxInfo> {
        self.data
            .read(|state| state.pending(&SessionID(id.into())).to_vec())
    }

    fn pending_ids(&self) -> Vec<String> {
        self.pending(SESSION)
            .iter()
            .map(|item| {
                serde_json::to_value(item).unwrap()["id"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect()
    }

    fn messages(&self) -> Value {
        self.data
            .read(|state| serde_json::to_value(state.messages(&session())).unwrap())
    }

    fn enqueue(&self, id: &str, created: u64) {
        let mut value = event(
            "session.inbox.enqueued",
            json!({ "sessionID": SESSION, "inboxID": id, "item": { "type": "compaction", "delivery": "steer", "payload": {} } }),
        );
        value["created"] = created.into();
        emit(&self.data, value);
    }

    fn compact(
        &self,
        model: bool,
    ) -> Shared<BoxFuture<'static, Result<SessionInboxCompaction, Error>>> {
        let model = model.then(|| ModelRef {
            provider_id: ProviderID("demo".into()),
            id: "model".into(),
            variant: None,
        });
        self.data.compact(&session(), model)
    }

    fn prompt(&self, text: &str) -> Shared<BoxFuture<'static, Result<SessionInboxUser, Error>>> {
        self.data.prompt(SessionPromptInput {
            session_id: session(),
            text: text.into(),
            ..Default::default()
        })
    }
}

fn failure(message: &str) -> Error {
    Arc::new(opencode_api::error::Error::Transport(message.into()))
}

#[tokio::test]
async fn admits_compaction_before_model_setup_and_serializes_the_following_prompt() {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let compact = fixture.compact(true);
    let proposed = fixture.pending_ids()[0].clone();
    assert_eq!(fixture.pending(SESSION)[0].tag(), "compaction");
    assert!(parts.calls.get().is_empty());
    assert_eq!(fixture.messages(), json!([]));
    assert_eq!(
        fixture.data.read(|state| state.status(&session())),
        SessionStatus::Idle
    );

    let prompt = fixture.prompt("Follow up");
    let messages = fixture.messages();
    assert_eq!(messages[0]["type"], "user");
    assert_eq!(messages[0]["text"], "Follow up");
    wait(|| parts.calls.len() == 1).await;
    assert_eq!(parts.calls.get(), ["model"]);
    parts.model.resolve(true);
    wait(|| parts.calls.len() == 2).await;
    assert_eq!(parts.calls.get(), ["model", "compact"]);
    parts
        .response
        .resolve(ok(json!({ "data": item(&proposed, 10) })));
    compact.await.unwrap();
    prompt.await.unwrap();
    assert_eq!(parts.calls.get(), ["model", "compact", "prompt"]);
    assert_eq!(parts.proposals.get(), [proposed]);
}

#[tokio::test]
async fn coalesces_duplicate_gestures_until_the_admission_request_settles() {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let first = fixture.compact(false);
    assert!(Shared::ptr_eq(&first, &fixture.compact(false)));
    assert_eq!(fixture.pending(SESSION).len(), 1);
    wait(|| parts.calls.len() == 1).await;
    parts
        .response
        .resolve(ok(json!({ "data": item("msg_canonical", 10) })));
    first.clone().await.unwrap();
    assert_eq!(parts.calls.get(), ["compact"]);
    let next = fixture.compact(false);
    assert!(!Shared::ptr_eq(&first, &next));
    next.await.unwrap();
    assert_eq!(parts.calls.get(), ["compact", "compact"]);
    let proposals = parts.proposals.get();
    assert_ne!(proposals[0], proposals[1]);
    assert!(!proposals.contains(&"msg_canonical".to_owned()));
}

#[tokio::test]
async fn substitutes_the_canonical_response_id_and_reconciles_its_later_echo() {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let request = fixture.compact(false);
    let proposed = fixture.pending_ids()[0].clone();
    fixture.data.pending_sync(&session()).await.unwrap();
    assert_eq!(fixture.pending_ids(), [proposed]);
    parts
        .response
        .resolve(ok(json!({ "data": item("msg_canonical", 10) })));
    request.await.unwrap();
    assert_eq!(
        fixture.pending(SESSION),
        info(json!([item("msg_canonical", 10)]))
    );
    fixture.enqueue("msg_canonical", 20);
    assert_eq!(
        fixture.pending(SESSION),
        info(json!([item("msg_canonical", 20)]))
    );
    assert!(
        fixture
            .data
            .read(|state| state.inputs(&session()).is_empty())
    );
}

async fn adopts_echo(kind: &str) {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let request = fixture.compact(false);
    let id = match kind {
        "proposed" => fixture.pending_ids()[0].clone(),
        _ => "msg_canonical".to_owned(),
    };
    fixture.enqueue(&id, 20);
    assert_eq!(fixture.pending(SESSION), info(json!([item(&id, 20)])));
    parts.response.resolve(ok(json!({ "data": item(&id, 10) })));
    request.await.unwrap();
    assert_eq!(fixture.pending(SESSION), info(json!([item(&id, 20)])));
}

#[tokio::test]
async fn adopts_the_proposed_echo_before_the_response_without_duplicating_it() {
    adopts_echo("proposed").await;
}

#[tokio::test]
async fn adopts_the_canonical_echo_before_the_response_without_duplicating_it() {
    adopts_echo("canonical").await;
}

async fn does_not_resurrect(kind: &str) {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let request = fixture.compact(false);
    fixture.enqueue("msg_canonical", 10);
    let data = match kind {
        "started" => (
            "session.compaction.started",
            json!({ "inputID": "msg_canonical", "reason": "manual" }),
        ),
        "cancelled" => (
            "session.inbox.cancelled",
            json!({ "inboxID": "msg_canonical" }),
        ),
        _ => (
            "session.compaction.failed",
            json!({ "inputID": "msg_canonical", "reason": "manual", "error": { "type": "aborted", "message": "Cancelled" } }),
        ),
    };
    let mut payload = data.1;
    payload["sessionID"] = SESSION.into();
    emit(&fixture.data, event(data.0, payload));
    assert!(fixture.pending(SESSION).is_empty());
    parts
        .response
        .resolve(ok(json!({ "data": item("msg_canonical", 10) })));
    request.await.unwrap();
    assert!(fixture.pending(SESSION).is_empty());
    if kind != "started" {
        return;
    }
    let messages = fixture.messages();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    assert_eq!(messages[0]["type"], "compaction");
    assert_eq!(messages[0]["status"], "running");
    let model = json!({ "providerID": "demo", "id": "model" });
    let tokens = json!({ "input": 10.0, "output": 4.0, "reasoning": 0.0, "cache": { "read": 3.0, "write": 0.0 } });
    emit(
        &fixture.data,
        event(
            "session.compaction.ended",
            json!({
                "sessionID": SESSION, "reason": "manual", "model": model, "native": { "messages": [] },
                "text": "Summary", "cost": 0.01, "tokens": tokens,
            }),
        ),
    );
    // The live fold carries the provider window and request usage, as a reloaded session does.
    let messages = fixture.messages();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    let row = &messages[0];
    assert_eq!(row["status"], "completed");
    assert_eq!(row["summary"], "Summary");
    assert_eq!(row["model"], model);
    assert_eq!(row["native"], json!({ "messages": [] }));
    assert_eq!(row["cost"], 0.01);
    assert_eq!(row["tokens"], tokens);
}

#[tokio::test]
async fn does_not_resurrect_a_canonical_item_already_started_before_the_response() {
    does_not_resurrect("started").await;
}

#[tokio::test]
async fn does_not_resurrect_a_canonical_item_already_cancelled_before_the_response() {
    does_not_resurrect("cancelled").await;
}

#[tokio::test]
async fn does_not_resurrect_a_canonical_item_already_failed_before_the_response() {
    does_not_resurrect("failed").await;
}

async fn rolls_back(rpc: &str) {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let request = fixture.compact(true);
    let prompt = fixture.prompt("Follow up");
    if rpc == "model" {
        parts.model.resolve(false);
    } else {
        parts.model.resolve(true);
        parts
            .response
            .resolve(Reply::Text(500, "Admission failed".into()));
    }
    assert!(request.await.is_err());
    prompt.await.unwrap();
    let tags: Vec<_> = fixture
        .pending(SESSION)
        .iter()
        .map(|item| item.tag().to_owned())
        .collect();
    assert_eq!(tags, ["user"]);
    let messages = fixture.messages();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    assert_eq!(messages[0]["text"], "Follow up");
}

#[tokio::test]
async fn rolls_back_a_rejected_model_rpc_and_releases_the_following_prompt() {
    rolls_back("model").await;
}

#[tokio::test]
async fn rolls_back_a_rejected_compact_rpc_and_releases_the_following_prompt() {
    rolls_back("compact").await;
}

async fn preserves_acknowledged(kind: &str) {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    if kind == "existing" {
        fixture.enqueue("msg_canonical", 10);
    }
    let request = fixture.compact(false);
    let id = match kind {
        "proposed" => fixture.pending_ids()[0].clone(),
        _ => "msg_canonical".to_owned(),
    };
    if kind != "existing" {
        fixture.enqueue(&id, 10);
    }
    assert_eq!(fixture.pending(SESSION), info(json!([item(&id, 10)])));
    parts
        .response
        .resolve(Reply::Text(500, "Lost response".into()));
    assert!(request.await.is_err());
    assert_eq!(fixture.pending(SESSION), info(json!([item(&id, 10)])));
}

#[tokio::test]
async fn preserves_acknowledged_proposed_compaction_after_an_http_error() {
    preserves_acknowledged("proposed").await;
}

#[tokio::test]
async fn preserves_acknowledged_canonical_compaction_after_an_http_error() {
    preserves_acknowledged("canonical").await;
}

#[tokio::test]
async fn preserves_acknowledged_existing_compaction_after_an_http_error() {
    preserves_acknowledged("existing").await;
}

#[tokio::test]
async fn uses_a_fresh_control_id_when_the_known_pending_compaction_starts_during_model_setup() {
    let proposed = Slot::<String>::default();
    let parts = Parts::default();
    let slot = proposed.clone();
    let fixture = setup(
        &parts,
        Some(Arc::new(move |req: &Req| {
            if !req.path.ends_with("/compact") {
                return None;
            }
            let id = req.id();
            slot.resolve(id.clone());
            Some(
                async move {
                    if id == "msg_existing" {
                        return Reply::Json(
                            409,
                            json!({ "message": "Control ID already consumed" }),
                        );
                    }
                    ok(json!({ "data": item(&id, 10) }))
                }
                .boxed(),
            )
        })),
    );
    fixture.enqueue("msg_existing", 10);
    let request = fixture.compact(true);
    assert_eq!(
        fixture.pending(SESSION),
        info(json!([item("msg_existing", 10)]))
    );
    wait(|| parts.calls.get().contains(&"model".to_owned())).await;
    emit(
        &fixture.data,
        event(
            "session.compaction.started",
            json!({ "sessionID": SESSION, "inputID": "msg_existing", "reason": "manual" }),
        ),
    );
    parts.model.resolve(true);
    let id = proposed.wait().await;
    assert_ne!(id, "msg_existing");
    let result = request.await.unwrap();
    assert_eq!(
        SessionInboxInfo::Compaction(result),
        info(json!([item(&id, 10)])).remove(0)
    );
    assert_eq!(fixture.pending(SESSION), info(json!([item(&id, 10)])));
    let messages = fixture.messages();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    assert_eq!(messages[0]["id"], "msg_existing");
    assert_eq!(messages[0]["status"], "running");
}

async fn preserves_fetched_durable(kind: &str) {
    let parts = Parts::default();
    let response = parts.response.clone();
    let fixture = setup(
        &parts,
        Some(Arc::new(move |req: &Req| {
            req.path.ends_with("/prompt").then(|| response.wait())
        })),
    );
    let request = if kind == "user" {
        fixture
            .prompt("Follow up")
            .map(|result| result.map(|_| ()))
            .boxed()
    } else {
        fixture
            .compact(false)
            .map(|result| result.map(|_| ()))
            .boxed()
    };
    let id = match kind {
        "canonical compaction" => "msg_canonical".to_owned(),
        _ => fixture.pending_ids()[0].clone(),
    };
    let mut durable = item(&id, 20);
    if kind == "user" {
        durable["type"] = "user".into();
        durable["payload"] = json!({ "text": "Follow up" });
    }
    parts.pending.push(durable.clone());
    fixture.data.pending_sync(&session()).await.unwrap();
    assert_eq!(fixture.pending(SESSION), info(json!([durable])));
    parts
        .response
        .resolve(Reply::Text(500, "Lost response".into()));
    assert!(request.await.is_err());
    assert_eq!(fixture.pending(SESSION), info(json!([durable])));
    if kind == "user" {
        let messages = fixture.messages();
        assert_eq!(messages.as_array().unwrap().len(), 1);
        assert_eq!(messages[0]["id"], id.as_str());
        assert_eq!(messages[0]["text"], "Follow up");
    }
}

#[tokio::test]
async fn preserves_a_fetched_durable_compaction_when_sse_is_delayed_and_http_fails() {
    preserves_fetched_durable("compaction").await;
}

#[tokio::test]
async fn preserves_a_fetched_durable_canonical_compaction_when_sse_is_delayed_and_http_fails() {
    preserves_fetched_durable("canonical compaction").await;
}

#[tokio::test]
async fn preserves_a_fetched_durable_user_when_sse_is_delayed_and_http_fails() {
    preserves_fetched_durable("user").await;
}

#[tokio::test]
async fn settles_admissions_when_the_data_owner_is_disposed_during_a_gate() {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let gate = Slot::<()>::default();
    let wait = gate.wait();
    let first = fixture.data.prompt(Prompt {
        input: SessionPromptInput {
            session_id: session(),
            text: "First".into(),
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
    });
    let compact = fixture.compact(false);
    fixture.data.dispose();
    gate.resolve(());
    parts
        .response
        .resolve(ok(json!({ "data": item("msg_canonical", 10) })));
    first.await.unwrap();
    compact.await.unwrap();
}

#[tokio::test]
async fn routes_concurrent_compaction_observations_by_session() {
    let first_response = Slot::<Reply>::default();
    let second_response = Slot::<Reply>::default();
    let parts = Parts::default();
    let (first_slot, second_slot) = (first_response.clone(), second_response.clone());
    let fixture = setup(
        &parts,
        Some(Arc::new(move |req: &Req| {
            if !req.path.ends_with("/compact") {
                return None;
            }
            Some(if req.path.contains(&format!("/session/{SESSION}/")) {
                first_slot.wait()
            } else {
                second_slot.wait()
            })
        })),
    );
    let other = SessionID("ses_other".into());
    let first = fixture.compact(false);
    let second = fixture.data.compact(&other, None);
    let first_id = fixture.pending_ids()[0].clone();
    let second_id = serde_json::to_value(&fixture.pending("ses_other")[0]).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    emit(
        &fixture.data,
        event(
            "session.inbox.cancelled",
            json!({ "sessionID": SESSION, "inboxID": first_id }),
        ),
    );
    assert!(fixture.pending(SESSION).is_empty());
    assert_eq!(fixture.pending("ses_other").len(), 1);

    first_response.resolve(ok(json!({ "data": item(&first_id, 10) })));
    let mut second_item = item(&second_id, 10);
    second_item["sessionID"] = "ses_other".into();
    second_response.resolve(ok(json!({ "data": second_item })));
    first.await.unwrap();
    second.await.unwrap();
    assert!(fixture.pending(SESSION).is_empty());
    assert_eq!(fixture.pending("ses_other"), info(json!([second_item])));
}

async fn failed_preparation(kind: &str) {
    let parts = Parts::default();
    let fixture = setup(&parts, None);
    let gate = Slot::<bool>::default();
    let prepared = Log::<String>::default();
    let gated = |gate: &Slot<bool>| {
        let wait = gate.wait();
        async move {
            match wait.await {
                true => Ok(()),
                false => Err(failure("Preparation failed")),
            }
        }
        .boxed()
    };
    let (first_gate, first_prepared) = (gate.clone(), prepared.clone());
    let first = fixture.data.prompt(Prompt {
        input: SessionPromptInput {
            session_id: session(),
            id: Some(Some(SessionMessageID("msg_first".into()))),
            text: "First".into(),
            ..Default::default()
        },
        gate: (kind == "gate").then(|| gated(&gate)),
        prepare: Some(Box::new(move || {
            first_prepared.push("first".into());
            gated(&first_gate)
        })),
    });
    let compact = fixture.data.compact(
        &session(),
        Some(ModelRef {
            provider_id: ProviderID("demo".into()),
            id: "first".into(),
            variant: None,
        }),
    );
    let (client, following_prepared) = (fixture.data.clone(), prepared.clone());
    let following = fixture.data.prompt(Prompt {
        input: SessionPromptInput {
            session_id: session(),
            text: "Follow up".into(),
            ..Default::default()
        },
        gate: None,
        prepare: Some(Box::new(move || {
            following_prepared.push("following".into());
            async move {
                let input = SessionSwitchModelInput {
                    session_id: session(),
                    model: ModelRef {
                        provider_id: ProviderID("demo".into()),
                        id: "second".into(),
                        variant: None,
                    },
                };
                client
                    .client()
                    .session_switch_model(&input, &Default::default())
                    .await
                    .map_err(Arc::new)
            }
            .boxed()
        })),
    });
    if kind == "prepare" {
        wait(|| prepared.get().contains(&"first".to_owned())).await;
    }
    gate.resolve(false);
    assert!(first.await.is_err());
    wait(|| parts.calls.get().contains(&"model".to_owned())).await;
    let expected: &[&str] = if kind == "prepare" { &["first"] } else { &[] };
    assert_eq!(prepared.get(), expected);
    parts.model.resolve(true);
    parts
        .response
        .resolve(ok(json!({ "data": item("msg_canonical", 10) })));
    compact.await.unwrap();
    following.await.unwrap();
    assert_eq!(parts.calls.get(), ["model", "compact", "model", "prompt"]);
    assert_eq!(prepared.get().last().map(String::as_str), Some("following"));
    let messages = fixture.messages();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    assert_eq!(messages[0]["text"], "Follow up");
}

#[tokio::test]
async fn a_preceding_prompts_failed_gate_does_not_block_compaction_or_following_model_preparation()
{
    failed_preparation("gate").await;
}

#[tokio::test]
async fn a_preceding_prompts_failed_prepare_does_not_block_compaction_or_following_model_preparation()
 {
    failed_preparation("prepare").await;
}

#[tokio::test]
async fn creation_failure_rejects_gated_prompt_compaction_and_following_preparation_without_sending_their_rpcs()
 {
    let creation = Slot::<Reply>::default();
    let requested = Slot::<()>::default();
    let parts = Parts::default();
    let (slot, seen) = (creation.clone(), requested.clone());
    let fixture = setup(
        &parts,
        Some(Arc::new(move |req: &Req| {
            if req.path != "/api/session" {
                return None;
            }
            seen.resolve(());
            Some(slot.wait())
        })),
    );
    let gate = Slot::<()>::default();
    let prepared = Log::<String>::default();
    let (_, created) = fixture.data.session_create(CreateSession {
        id: Some(session()),
        ..Default::default()
    });
    let wait = gate.wait();
    let first = fixture.data.prompt(Prompt {
        input: SessionPromptInput {
            session_id: session(),
            text: "First".into(),
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
    });
    let compact = fixture.compact(true);
    let log = prepared.clone();
    let following = fixture.data.prompt(Prompt {
        input: SessionPromptInput {
            session_id: session(),
            text: "Follow up".into(),
            ..Default::default()
        },
        gate: None,
        prepare: Some(Box::new(move || {
            log.push("following".into());
            async { Ok(()) }.boxed()
        })),
    });
    requested.wait().await;
    creation.resolve(Reply::Text(500, "Creation failed".into()));
    let (created, first, compact, following) =
        futures_util::future::join4(created, first, compact, following).await;
    assert!(created.is_err() && first.is_err() && compact.is_err() && following.is_err());
    assert!(parts.calls.get().is_empty());
    assert!(prepared.get().is_empty());
    assert!(
        fixture
            .data
            .read(|state| state.session(&session()).is_none())
    );
    assert!(fixture.pending(SESSION).is_empty());
    gate.resolve(());
}
