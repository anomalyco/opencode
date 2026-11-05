//! Session forms as `elicitation/create` (`packages/cli/src/acp/elicitation.ts`).

use std::collections::HashSet;
use std::sync::LazyLock;

use opencode_api::client::Client;
use opencode_api::generated::{
    FormID, FormValue, SessionFormCancelInput, SessionFormReplyInput, SessionID, SessionInterruptInput,
};
use regex::Regex;
use serde_json::{Map, Value, json};

use crate::capabilities::Capabilities;
use crate::child;
use crate::client::{decode_session_id, is_declared};
use crate::connection::Connection;
use crate::error::Failure;

pub const UNSHOWN_QUESTION_MESSAGE: &str = "The question couldn't be shown to the user in this client. Continue without an answer: make reasonable assumptions and state them, or ask the user in your reply if you can't proceed.";

const QUESTION_KIND: &str = "question";

// Form mode must not collect secrets; elicit only flows known to be credential-free.
const ELICITED_KINDS: [&str; 2] = [QUESTION_KIND, "websearch.provider"];

static CREDENTIAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)password|passphrase|secret|token|api[_ -]?key|credential|private[_ -]?key")
        .expect("credential pattern")
});

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
pub fn requested_schema(form: &Value, capabilities: &Capabilities) -> Option<Value> {
    if !capabilities.form_elicitation {
        return None;
    }
    let kind = form.get("metadata")?.as_object()?.get("kind")?.as_str()?;
    if !ELICITED_KINDS.contains(&kind) {
        return None;
    }
    let fields: Vec<&Value> = form.get("fields")?.as_array()?.iter().collect();
    if fields.iter().any(|field| credential_like(field)) {
        return None;
    }
    if fields.iter().any(|field| {
        kind_of(field) == "external" || field.get("when").and_then(Value::as_array).is_some_and(|when| !when.is_empty())
    }) {
        return None;
    }
    if fields.iter().any(|field| flag(field, "hidden") && flag(field, "required") && field.get("default").is_none()) {
        return None;
    }
    let keys: HashSet<&str> = fields.iter().filter_map(|field| field.get("key")?.as_str()).collect();
    let visible: Vec<&Value> = fields.into_iter().filter(|field| !flag(field, "hidden")).collect();
    if !visible.iter().all(|field| representable(field, &keys)) {
        return None;
    }
    let mut properties = Map::new();
    for field in &visible {
        for (key, schema) in field_properties(field) {
            properties.insert(key, schema);
        }
    }
    let required: Vec<Value> =
        visible.iter().filter(|field| flag(field, "required")).filter_map(|field| field.get("key").cloned()).collect();
    Some(json!({ "type": "object", "properties": properties, "required": required }))
}

// The question tool returns the message to the model, so the turn continues instead of ending as interrupted.
pub async fn cancel_unshown(client: &Client, form: &Value) {
    let question =
        form.get("metadata").and_then(|metadata| metadata.get("kind")).and_then(Value::as_str) == Some(QUESTION_KIND);
    let client = client.clone();
    let form = form.clone();
    // A spawned task finishes even when the turn stops waiting (TS: uninterruptible).
    let _ = tokio::spawn(async move {
        cancel(&client, &form, question.then(|| UNSHOWN_QUESTION_MESSAGE.to_owned())).await;
    })
    .await;
}

pub async fn ask(input: &Input) -> Result<Outcome, Failure> {
    let tool_call_id = input
        .tool_call_sent
        .then(|| input.form.get("metadata")?.get("tool")?.get("id")?.as_str())
        .flatten()
        .map(|id| child::tool_call_id(input.child.as_ref(), id));
    let mut params = Map::new();
    params.insert("mode".to_owned(), json!("form"));
    params.insert("sessionId".to_owned(), json!(input.client_session_id));
    if let Some(id) = tool_call_id {
        params.insert("toolCallId".to_owned(), json!(id));
    }
    params.insert(
        "message".to_owned(),
        json!(child::prefix_title(
            input.child.as_ref(),
            input.form.get("title").and_then(Value::as_str).unwrap_or_default()
        )),
    );
    params.insert("requestedSchema".to_owned(), input.requested_schema.clone());
    let response = input.connection.request("elicitation/create", Value::Object(params)).await?;
    Ok(answer(&input.form, &response).map_or(Outcome::Cancel, Outcome::Answer))
}

pub async fn respond(input: &Input, outcome: Outcome) -> Result<(), Failure> {
    let Outcome::Answer(answer) = outcome else {
        cancel(&input.client, &input.form, None).await;
        return Ok(());
    };
    let result = input
        .client
        .session_form_reply(&SessionFormReplyInput {
            session_id: text(&input.form, "sessionID"),
            form_id: FormID(text(&input.form, "id")),
            answer: answer
                .as_object()
                .into_iter()
                .flatten()
                .map(|(key, value)| (key.clone(), FormValue::Unknown(value.clone())))
                .collect(),
        })
        .await;
    let Err(error) = result else { return Ok(()) };
    if is_declared(&error, "FormAlreadySettledError") || is_declared(&error, "FormNotFoundError") {
        return Ok(());
    }
    log::warn!(cause:% = error; "ACP form reply failed");
    cancel(&input.client, &input.form, None).await;
    Ok(())
}

fn answer(form: &Value, response: &Value) -> Option<Value> {
    if response.get("action").and_then(Value::as_str) != Some("accept") {
        return None;
    }
    let empty = Map::new();
    let content = match response.get("content") {
        None | Some(Value::Null) => &empty,
        Some(content) => content.as_object()?,
    };
    if !content.values().all(form_value) {
        return None;
    }
    let mut answer = Map::new();
    for field in form.get("fields")?.as_array()? {
        let Some(key) = field.get("key").and_then(Value::as_str) else {
            continue;
        };
        if let Some(value) = field_answer(field, content) {
            answer.insert(key.to_owned(), value);
        }
    }
    Some(Value::Object(answer))
}

/// `Form.Value`: a string, number, boolean, or array of strings.
fn form_value(value: &Value) -> bool {
    match value {
        Value::String(_) | Value::Number(_) | Value::Bool(_) => true,
        Value::Array(items) => items.iter().all(Value::is_string),
        _ => false,
    }
}

fn field_answer(field: &Value, content: &Map<String, Value>) -> Option<Value> {
    let kind = kind_of(field);
    if kind != "external" && flag(field, "hidden") {
        return field.get("default").cloned();
    }
    let value = content.get(field.get("key")?.as_str()?).cloned();
    if !matches!(kind, "string" | "multiselect") || !flag(field, "custom") || !has_options(field) {
        return value;
    }
    let custom = content.get(&custom_key(field)).and_then(Value::as_str).filter(|custom| !custom.trim().is_empty());
    let Some(custom) = custom else { return value };
    if kind == "string" {
        return Some(json!(custom));
    }
    Some(match value {
        Some(Value::Array(mut items)) => {
            items.push(json!(custom));
            Value::Array(items)
        }
        _ => json!([custom]),
    })
}

fn credential_like(field: &Value) -> bool {
    let labels: Vec<&str> = if matches!(kind_of(field), "string" | "multiselect") {
        options(field).iter().filter_map(|option| option.get("label")?.as_str()).collect()
    } else {
        Vec::new()
    };
    ["key", "title", "description"]
        .iter()
        .filter_map(|key| field.get(*key)?.as_str())
        .chain(labels)
        .any(|text| CREDENTIAL.is_match(text))
}

fn representable(field: &Value, keys: &HashSet<&str>) -> bool {
    let kind = kind_of(field);
    if !matches!(kind, "string" | "multiselect") || !has_options(field) {
        return true;
    }
    let values: HashSet<&str> = options(field).iter().filter_map(|option| option.get("value")?.as_str()).collect();
    let defaults: Vec<&str> = match field.get("default") {
        None => Vec::new(),
        Some(Value::String(value)) => vec![value.as_str()],
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).collect(),
        Some(_) => Vec::new(),
    };
    if defaults.iter().any(|value| !values.contains(value)) {
        return false;
    }
    if !flag(field, "custom") {
        return true;
    }
    if flag(field, "required") || keys.contains(custom_key(field).as_str()) {
        return false;
    }
    kind == "string" || (field.get("minItems").is_none() && field.get("maxItems").is_none())
}

fn field_properties(field: &Value) -> Vec<(String, Value)> {
    let key = text(field, "key");
    let mut schema = Map::new();
    let kind = kind_of(field);
    let schema_type = match kind {
        "multiselect" => "array",
        other => other,
    };
    schema.insert("type".to_owned(), json!(schema_type));
    copy(&mut schema, field, &["title", "description"]);
    match kind {
        "string" if !has_options(field) => {
            string_constraints(&mut schema, field);
            copy(&mut schema, field, &["default"]);
            vec![(key, Value::Object(schema))]
        }
        "string" => {
            schema.insert("oneOf".to_owned(), json!(enum_options(field)));
            copy(&mut schema, field, &["default"]);
            with_other(field, key, schema, "Type your own answer")
        }
        "multiselect" => {
            schema.insert("items".to_owned(), json!({ "anyOf": enum_options(field) }));
            let min_items = field.get("minItems").and_then(Value::as_f64);
            let min_items = if flag(field, "required") { Some(min_items.unwrap_or(0.0).max(1.0)) } else { min_items };
            if let Some(min_items) = min_items {
                schema.insert("minItems".to_owned(), number(min_items));
            }
            copy(&mut schema, field, &["maxItems", "default"]);
            with_other(field, key, schema, "Add your own answer")
        }
        "number" | "integer" => {
            copy(&mut schema, field, &["minimum", "maximum", "default"]);
            vec![(key, Value::Object(schema))]
        }
        _ => {
            copy(&mut schema, field, &["default"]);
            vec![(key, Value::Object(schema))]
        }
    }
}

fn with_other(field: &Value, key: String, select: Map<String, Value>, description: &str) -> Vec<(String, Value)> {
    let mut properties = vec![(key.clone(), Value::Object(select))];
    if !flag(field, "custom") {
        return properties;
    }
    let mut other = Map::new();
    other.insert("type".to_owned(), json!("string"));
    let title = field.get("title").and_then(Value::as_str).unwrap_or(&key);
    other.insert("title".to_owned(), json!(format!("{title} (other)")));
    other.insert("description".to_owned(), json!(description));
    if kind_of(field) == "string" {
        string_constraints(&mut other, field);
    }
    properties.push((custom_key(field), Value::Object(other)));
    properties
}

// Core rejects an empty string for a required field.
fn string_constraints(schema: &mut Map<String, Value>, field: &Value) {
    copy(schema, field, &["format"]);
    let min_length = field.get("minLength").and_then(Value::as_f64);
    let min_length = if flag(field, "required") { Some(min_length.unwrap_or(0.0).max(1.0)) } else { min_length };
    if let Some(min_length) = min_length {
        schema.insert("minLength".to_owned(), number(min_length));
    }
    copy(schema, field, &["maxLength", "pattern"]);
}

fn enum_options(field: &Value) -> Vec<Value> {
    options(field)
        .iter()
        .map(|option| {
            let mut item = Map::new();
            if let Some(value) = option.get("value") {
                item.insert("const".to_owned(), value.clone());
            }
            if let Some(label) = option.get("label") {
                item.insert("title".to_owned(), label.clone());
            }
            if let Some(description) = option.get("description") {
                item.insert("description".to_owned(), description.clone());
            }
            Value::Object(item)
        })
        .collect()
}

fn copy(schema: &mut Map<String, Value>, field: &Value, keys: &[&str]) {
    for key in keys {
        if let Some(value) = field.get(*key) {
            schema.insert((*key).to_owned(), value.clone());
        }
    }
}

fn number(value: f64) -> Value {
    #[allow(clippy::cast_possible_truncation)]
    if value.fract() == 0.0 && value.abs() < 9e15 {
        return json!(value as i64);
    }
    json!(value)
}

fn options(field: &Value) -> &[Value] {
    field.get("options").and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn has_options(field: &Value) -> bool {
    kind_of(field) == "multiselect" || field.get("options").is_some()
}

fn custom_key(field: &Value) -> String {
    format!("{}_custom", text(field, "key"))
}

fn kind_of(field: &Value) -> &str {
    field.get("type").and_then(Value::as_str).unwrap_or_default()
}

fn flag(field: &Value, key: &str) -> bool {
    field.get(key) == Some(&Value::Bool(true))
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

async fn cancel(client: &Client, form: &Value, message: Option<String>) {
    let session_id = text(form, "sessionID");
    let result = client
        .session_form_cancel(&SessionFormCancelInput {
            session_id: session_id.clone(),
            form_id: FormID(text(form, "id")),
            message,
        })
        .await;
    let Err(error) = result else { return };
    if is_declared(&error, "FormAlreadySettledError") || is_declared(&error, "FormNotFoundError") {
        return;
    }
    if let Ok(session_id) = decode_session_id(&session_id) {
        let _ =
            client.session_interrupt(&SessionInterruptInput { session_id: SessionID(session_id), resume: None }).await;
    }
}
