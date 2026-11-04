//! Port of `packages/client/test/solid-pending-status.test.ts`.

mod common;

use std::sync::atomic::{AtomicU64, Ordering};

use common::*;
use futures_util::FutureExt;
use opencode_api::generated::*;
use opencode_store::{Data, Options, PendingStatus, Prompt, SessionStatus};
use serde_json::{Value, json};

const SESSION: &str = "ses_pending";

struct Fixture {
    data: Data,
    seq: AtomicU64,
}

fn fixture() -> Fixture {
    // The TS fixture answers every POST with `{}`; the typed client needs a valid echo.
    let data = data(
        handler(|req: Req| async move {
            if req.method == "GET" {
                return ok(json!({ "data": [] }));
            }
            ok(json!({ "data": {
                "id": req.id(), "sessionID": SESSION, "time": { "created": 1 }, "type": "user",
                "delivery": "steer", "payload": { "text": "" },
            } }))
        }),
        Options::default(),
    );
    Fixture {
        data,
        seq: AtomicU64::new(0),
    }
}

impl Fixture {
    fn emit(&self, kind: &str, payload: Value) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let mut data = json!({ "sessionID": SESSION });
        data.as_object_mut()
            .unwrap()
            .extend(payload.as_object().unwrap().clone());
        emit(
            &self.data,
            json!({
                "id": format!("evt_{seq}"), "type": kind, "created": seq,
                "durable": { "aggregateID": SESSION, "seq": seq, "version": 1 }, "data": data,
            }),
        );
    }

    fn enqueue(&self, id: &str, delivery: &str) {
        self.emit(
            "session.inbox.enqueued",
            json!({ "inboxID": id, "item": { "type": "user", "delivery": delivery, "payload": { "text": id } } }),
        );
    }

    fn deliver(&self, id: &str) {
        self.emit("session.inbox.delivered", json!({ "inboxID": id }));
    }

    fn started(&self) {
        self.emit("session.execution.started", json!({}));
    }

    fn settled(&self, outcome: &str) {
        let payload = match outcome {
            "failed" => {
                json!({ "error": { "type": "provider", "message": "Provider unavailable" } })
            }
            "interrupted" => json!({ "reason": "user" }),
            _ => json!({}),
        };
        self.emit(&format!("session.execution.{outcome}"), payload);
    }

    fn move_to(&self, id: &str, delivery: &str) {
        self.emit(
            "session.inbox.delivery.changed",
            json!({ "inboxID": id, "delivery": delivery }),
        );
    }

    fn status(&self, id: &str) -> Option<PendingStatus> {
        self.data.read(|state| state.pending_status(&session(), id))
    }
}

fn session() -> SessionID {
    SessionID(SESSION.into())
}

fn prompt(id: &str, text: &str) -> SessionPromptInput {
    SessionPromptInput {
        session_id: session(),
        id: Some(Some(SessionMessageID(id.into()))),
        text: text.into(),
        ..Default::default()
    }
}

#[tokio::test]
async fn an_idle_send_is_starting_from_optimistic_admission_until_delivery() {
    let setup = fixture();
    // The composer marks the session running in the same task as optimistic admission.
    let sending = setup.data.prompt(prompt("msg_first", "first"));
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    setup.data.set_status(&session(), SessionStatus::Running);
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    sending.await.unwrap();
    setup.enqueue("msg_first", "steer");
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    setup.started();
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    setup.deliver("msg_first");
    assert_eq!(setup.status("msg_first"), None);
    let tag = setup.data.read(|state| {
        state
            .message(&session(), "msg_first")
            .map(|item| item.tag().to_owned())
    });
    assert_eq!(tag.as_deref(), Some("user"));
}

#[tokio::test]
async fn a_steer_sent_after_the_execution_delivered_input_is_steering_and_follows_delivery_changes()
{
    let setup = fixture();
    setup.enqueue("msg_first", "steer");
    setup.started();
    setup.deliver("msg_first");
    setup.enqueue("msg_steer", "steer");
    assert_eq!(setup.status("msg_steer"), Some(PendingStatus::Steering));
    setup.move_to("msg_steer", "queue");
    assert_eq!(setup.status("msg_steer"), Some(PendingStatus::Queued));
    setup.move_to("msg_steer", "steer");
    assert_eq!(setup.status("msg_steer"), Some(PendingStatus::Steering));
    setup.deliver("msg_steer");
    assert_eq!(setup.status("msg_steer"), None);
}

#[tokio::test]
async fn rapid_follow_ups_join_the_starting_execution_until_it_delivers_without_them() {
    let setup = fixture();
    setup.enqueue("msg_first", "steer");
    setup.started();
    setup.enqueue("msg_second", "steer");
    // The idle boundary promotes every pending steer, so both are starting.
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    assert_eq!(setup.status("msg_second"), Some(PendingStatus::Starting));
    // Promotion happened before the second admission landed; it now steers the execution.
    setup.deliver("msg_first");
    assert_eq!(setup.status("msg_second"), Some(PendingStatus::Steering));
}

async fn stranded(outcome: &str) {
    let setup = fixture();
    setup.enqueue("msg_first", "steer");
    setup.started();
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    setup.settled(outcome);
    assert_eq!(
        setup.data.read(|state| state.status(&session())),
        SessionStatus::Idle
    );
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Stranded));
    // A new idle send starts fresh, and its execution promotes the stranded steer with it.
    setup.enqueue("msg_retry", "steer");
    assert_eq!(setup.status("msg_retry"), Some(PendingStatus::Starting));
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Stranded));
    setup.started();
    assert_eq!(setup.status("msg_first"), Some(PendingStatus::Starting));
    assert_eq!(setup.status("msg_retry"), Some(PendingStatus::Starting));
}

#[tokio::test]
async fn an_undelivered_steer_is_stranded_after_execution_failed() {
    stranded("failed").await;
}

#[tokio::test]
async fn an_undelivered_steer_is_stranded_after_execution_interrupted() {
    stranded("interrupted").await;
}

#[tokio::test]
async fn a_later_execution_starts_fresh_after_an_earlier_turn_delivered_input() {
    let setup = fixture();
    setup.enqueue("msg_first", "steer");
    setup.started();
    setup.deliver("msg_first");
    setup.settled("succeeded");
    setup.enqueue("msg_next", "steer");
    assert_eq!(setup.status("msg_next"), Some(PendingStatus::Starting));
    setup.started();
    assert_eq!(setup.status("msg_next"), Some(PendingStatus::Starting));
}

#[tokio::test]
async fn a_remote_idle_prompt_is_starting() {
    let setup = fixture();
    setup.enqueue("msg_remote", "steer");
    assert_eq!(setup.status("msg_remote"), Some(PendingStatus::Starting));
    setup.started();
    assert_eq!(setup.status("msg_remote"), Some(PendingStatus::Starting));
}

#[tokio::test]
async fn a_queued_prompt_is_queued_regardless_of_execution_state() {
    let setup = fixture();
    setup.enqueue("msg_queued", "queue");
    assert_eq!(setup.status("msg_queued"), Some(PendingStatus::Queued));
    setup.started();
    assert_eq!(setup.status("msg_queued"), Some(PendingStatus::Queued));
}

#[tokio::test]
async fn optimistic_prompt_admission_preserves_inline_data_attachments_before_the_server_echo() {
    let gate = Slot::<()>::default();
    let setup = fixture();
    let mut input = prompt("msg_with_image", "Inspect this screenshot");
    input.files = Some(vec![
        PromptInputFileAttachment {
            uri: "data:image/png;base64,YQ==".into(),
            name: Some("shot.png".into()),
            ..Default::default()
        },
        PromptInputFileAttachment {
            uri: "file:///project/README.md".into(),
            name: Some("README.md".into()),
            ..Default::default()
        },
    ]);
    let wait = gate.wait();
    let sending = setup.data.prompt(Prompt {
        input,
        gate: Some(
            async move {
                wait.await;
                Ok(())
            }
            .boxed(),
        ),
        prepare: None,
    });
    let expected = json!([{
        "data": "YQ==", "mime": "image/png", "source": { "type": "inline" }, "name": "shot.png",
    }]);
    let (pending, message) = setup.data.read(|state| {
        (
            serde_json::to_value(state.pending(&session())).unwrap(),
            serde_json::to_value(state.message(&session(), "msg_with_image")).unwrap(),
        )
    });
    assert_eq!(pending[0]["id"], "msg_with_image");
    assert_eq!(pending[0]["type"], "user");
    assert_eq!(pending[0]["payload"]["text"], "Inspect this screenshot");
    assert_eq!(pending[0]["payload"]["files"], expected);
    assert_eq!(message["id"], "msg_with_image");
    assert_eq!(message["type"], "user");
    assert_eq!(message["text"], "Inspect this screenshot");
    assert_eq!(message["files"], expected);
    gate.resolve(());
    sending.await.unwrap();
}
