//! Session forms as `elicitation/create` (`packages/cli/src/acp/elicitation.ts`).
//!
//! C.12 (`rs-acp-rest`) owns this file. C.11 left the signatures the turn calls. No form is shown yet:
//! `requested_schema` declines every form, so the turn cancels it (a question form with the message
//! that lets the model continue).

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{FormID, SessionFormCancelInput, SessionID, SessionInterruptInput};
use serde_json::Value;

use crate::capabilities::Capabilities;
use crate::child;
use crate::client::{decode_session_id, is_declared};
use crate::connection::Connection;
use crate::error::Failure;

pub const UNSHOWN_QUESTION_MESSAGE: &str = "The question couldn't be shown to the user in this client. Continue without an answer: make reasonable assumptions and state them, or ask the user in your reply if you can't proceed.";

const QUESTION_KIND: &str = "question";

pub struct Input {
    pub client: Client,
    pub connection: Connection,
    /// The `Form.Info` of the `form.created` event.
    pub form: Value,
    pub requested_schema: Value,
    pub client_session_id: String,
    pub child: Option<child::Session>,
    pub tool_call_sent: bool,
}

/// What the client answered: the form's answer, or a cancel.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Answer(Value),
    Cancel,
}

/// The elicitation schema for `form`, or `None` when this client cannot show it.
pub fn requested_schema(_form: &Value, _capabilities: &Capabilities) -> Option<Value> {
    None
}

// The question tool returns the message to the model, so the turn continues instead of ending as interrupted.
pub async fn cancel_unshown(client: &Client, form: &Value) {
    let question = form
        .get("metadata")
        .and_then(|metadata| metadata.get("kind"))
        .and_then(Value::as_str)
        == Some(QUESTION_KIND);
    let client = client.clone();
    let form = form.clone();
    // A spawned task finishes even when the turn stops waiting (TS: uninterruptible).
    let _ = tokio::spawn(async move {
        cancel(
            &client,
            &form,
            question.then(|| UNSHOWN_QUESTION_MESSAGE.to_owned()),
        )
        .await;
    })
    .await;
}

pub async fn ask(_input: &Input) -> Result<Outcome, Failure> {
    Ok(Outcome::Cancel)
}

pub async fn respond(input: &Input, outcome: Outcome) -> Result<(), Failure> {
    if outcome == Outcome::Cancel {
        cancel(&input.client, &input.form, None).await;
    }
    Ok(())
}

async fn cancel(client: &Client, form: &Value, message: Option<String>) {
    let text = |key: &str| {
        form.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let session_id = text("sessionID");
    let result = client
        .session_form_cancel(
            &SessionFormCancelInput {
                session_id: session_id.clone(),
                form_id: FormID(text("id")),
                message,
            },
            &RequestOptions::default(),
        )
        .await;
    let Err(error) = result else { return };
    if is_declared(&error, "FormAlreadySettledError") || is_declared(&error, "FormNotFoundError") {
        return;
    }
    if let Ok(session_id) = decode_session_id(&session_id) {
        let _ = client
            .session_interrupt(
                &SessionInterruptInput {
                    session_id: SessionID(session_id),
                    resume: None,
                },
                &RequestOptions::default(),
            )
            .await;
    }
}
