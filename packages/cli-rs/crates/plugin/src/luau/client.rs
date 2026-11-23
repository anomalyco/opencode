//! Builds Luau client calls from the generated operations table using the Rust client encoders. The prelude unwraps
//! the reply according to the operation.

use std::collections::HashMap;
use std::sync::OnceLock;

use opencode_api_types::call::{append, path_param, path_wildcard};
use serde::Deserialize;
use serde_json::Value;

use crate::abi::Fetch;

/// The operations table, by operation name.
const OPERATIONS: &str = include_str!("operations.json");

/// A row of the operations table.
#[derive(Deserialize)]
struct Operation {
    method: String,
    path: String,
    /// Each input field: its name, where it goes, whether it may be left out, and its Luau type (the stub's).
    fields: Vec<(String, Source, bool, serde::de::IgnoredAny)>,
    body: Option<BodyKind>,
    reply: Reply,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Source {
    Params,
    Query,
    Headers,
    Payload,
    Wildcard,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum BodyKind {
    /// The payload fields make an object.
    Object,
    /// The payload field is the whole body.
    Json,
    /// A byte body.
    Bytes,
}

/// How an operation's reply reads, which the prelude unwraps by.
#[derive(Clone, Copy, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Reply {
    Json,
    Data,
    Empty,
    Binary,
    Sse,
}

impl Reply {
    pub fn name(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Data => "data",
            Self::Empty => "empty",
            Self::Binary => "binary",
            Self::Sse => "sse",
        }
    }
}

fn operations() -> &'static HashMap<String, Operation> {
    static PARSED: OnceLock<HashMap<String, Operation>> = OnceLock::new();
    PARSED.get_or_init(|| serde_json::from_str(OPERATIONS).expect("operations.json is the generator's"))
}

/// The fetch of operation `name` (`session.inbox.list`) with `input`, an object of the operation's input fields by their
/// JSON names, and how its reply reads. A call the host's fetch cannot carry is the error, as for `cx.call`: a header,
/// a byte body, a stream of events; so are an operation the client does not have, a required field left out and a
/// field the operation does not take.
pub fn request(name: &str, input: &Value) -> Result<(Fetch, Reply), String> {
    let operation = operations().get(name).ok_or_else(|| format!("plugin.client has no operation {name}"))?;
    let empty = serde_json::Map::new();
    let given = match input {
        Value::Object(fields) => fields,
        // A Luau table with no fields is an empty array.
        Value::Null => &empty,
        Value::Array(items) if items.is_empty() => &empty,
        _ => return Err(format!("{name}: the input is a table of named fields")),
    };
    if let Some(unknown) = given.keys().find(|key| !operation.fields.iter().any(|(field, ..)| field == *key)) {
        return Err(format!("{name}: no field {unknown}"));
    }
    if operation.reply == Reply::Sse {
        return Err(format!("{name} streams events, which a plugin's fetch does not read"));
    }
    let mut path = operation.path.clone();
    let mut query = Vec::new();
    let mut body = (operation.body == Some(BodyKind::Object)).then(|| Value::Object(serde_json::Map::new()));
    for (field, source, optional, _) in &operation.fields {
        let Some(value) = given.get(field) else {
            if *optional {
                continue;
            }
            return Err(format!("{name}: {field} is required"));
        };
        match source {
            Source::Params => path = path.replacen(&format!(":{field}"), &path_param(value)?, 1),
            Source::Wildcard => {
                let Value::String(rest) = value else { return Err(format!("{name}: {field} is a string")) };
                path = format!("{}{}", path.trim_end_matches('*'), path_wildcard(rest));
            }
            Source::Query => append(&mut query, field, value),
            Source::Headers => return Err(format!("a plugin's fetch sends no headers, and {name} sets {field}")),
            Source::Payload => match (operation.body, &mut body) {
                (Some(BodyKind::Bytes), _) => {
                    return Err(format!("a plugin's fetch sends no byte body, which {name} takes"));
                }
                (Some(BodyKind::Json), _) => body = Some(value.clone()),
                (_, Some(Value::Object(fields))) => drop(fields.insert(field.clone(), value.clone())),
                _ => return Err(format!("{name}: {field} has no body to go in")),
            },
        }
    }
    let fetch = Fetch::new(operation.method.clone(), path).query(query).maybe(body, Fetch::body);
    Ok((if operation.reply == Reply::Binary { fetch.bytes() } else { fetch }, operation.reply))
}

/// The names of the operations, for the table test.
pub fn names() -> impl Iterator<Item = &'static str> {
    operations().keys().map(String::as_str)
}
