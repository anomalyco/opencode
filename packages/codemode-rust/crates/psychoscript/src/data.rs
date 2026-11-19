//! JSON data as a program left it, the reference's `Json`: like `serde_json::Value`, but its strings and keys are
//! [`HostString`]s, so a string with an unpaired surrogate stays exactly as the program had it.

use crate::{HostString, Json};

/// JSON data as a program left it: its result. Strings and keys keep unpaired surrogates ([`HostString`]);
/// [`Data::to_json`] gives a `serde_json::Value`, with U+FFFD for each.
#[derive(Clone, Debug, PartialEq)]
pub enum Data {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(HostString),
    Array(Vec<Data>),
    /// Keys in the order the program's object had them.
    Object(Vec<(HostString, Data)>),
}

impl Data {
    /// The data as a `serde_json::Value`, with U+FFFD for each unpaired surrogate.
    pub fn to_json(&self) -> Json {
        match self {
            Data::Null => Json::Null,
            Data::Bool(b) => Json::Bool(*b),
            Data::Number(n) => Json::Number(n.clone()),
            Data::String(s) => Json::String(s.to_string_lossy().into_owned()),
            Data::Array(items) => Json::Array(items.iter().map(Data::to_json).collect()),
            Data::Object(fields) => Json::Object(
                fields
                    .iter()
                    .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_json()))
                    .collect(),
            ),
        }
    }

    /// The data of a `serde_json::Value`.
    pub fn from_json(json: &Json) -> Self {
        match json {
            Json::Null => Data::Null,
            Json::Bool(b) => Data::Bool(*b),
            Json::Number(n) => Data::Number(n.clone()),
            Json::String(s) => Data::String(s.into()),
            Json::Array(items) => Data::Array(items.iter().map(Data::from_json).collect()),
            Json::Object(map) => Data::Object(
                map.iter()
                    .map(|(k, v)| (k.into(), Data::from_json(v)))
                    .collect(),
            ),
        }
    }

    /// JSON whose strings and keys are a run's text (see `strings`), as the result crosses out of the run.
    pub(crate) fn from_run_json(json: Json) -> Self {
        match json {
            Json::Null => Data::Null,
            Json::Bool(b) => Data::Bool(b),
            Json::Number(n) => Data::Number(n),
            Json::String(s) => Data::String(HostString::from_run_text(&s)),
            Json::Array(items) => Data::Array(items.into_iter().map(Data::from_run_json).collect()),
            Json::Object(map) => Data::Object(
                map.into_iter()
                    .map(|(k, v)| (HostString::from_run_text(&k), Data::from_run_json(v)))
                    .collect(),
            ),
        }
    }

    /// The string, when the data is one.
    pub fn as_string(&self) -> Option<&HostString> {
        match self {
            Data::String(s) => Some(s),
            _ => None,
        }
    }

    /// The JSON text `JSON.stringify` writes for the data: compact, an unpaired surrogate as a `\u` escape.
    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Data::Null => out.push_str("null"),
            Data::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Data::Number(n) => out.push_str(&Json::Number(n.clone()).to_string()),
            Data::String(s) => write_string(out, s),
            Data::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Data::Object(fields) => {
                out.push('{');
                for (i, (k, v)) in fields.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_string(out, k);
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_string(out: &mut String, s: &HostString) {
    if let Some(text) = s.as_str() {
        out.push_str(&Json::String(text.to_owned()).to_string());
        return;
    }
    out.push('"');
    for unit in char::decode_utf16(s.to_utf16().iter().copied()) {
        match unit {
            Ok(c) => {
                let quoted = Json::String(c.to_string()).to_string();
                out.push_str(&quoted[1..quoted.len() - 1]);
            }
            Err(e) => out.push_str(&format!("\\u{:04x}", e.unpaired_surrogate())),
        }
    }
    out.push('"');
}

impl PartialEq<Json> for Data {
    /// Equal when the data is well formed and has the same JSON; numbers compare as `serde_json` does.
    fn eq(&self, other: &Json) -> bool {
        match (self, other) {
            (Data::Null, Json::Null) => true,
            (Data::Bool(a), Json::Bool(b)) => a == b,
            (Data::Number(a), Json::Number(b)) => a == b,
            (Data::String(a), Json::String(b)) => a == b,
            (Data::Array(a), Json::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a == b)
            }
            (Data::Object(a), Json::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|((ka, va), (kb, vb))| ka == kb && va == vb)
            }
            _ => false,
        }
    }
}

impl From<Json> for Data {
    fn from(json: Json) -> Self {
        Data::from_json(&json)
    }
}

impl std::fmt::Display for Data {
    /// The JSON text `JSON.stringify` writes for the data.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_json_string())
    }
}

impl Data {
    /// Whether it is `null`.
    pub fn is_null(&self) -> bool {
        matches!(self, Data::Null)
    }

    /// The value at `key`, when the data is an object that has it.
    pub fn get(&self, key: &str) -> Option<&Data> {
        match self {
            Data::Object(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// The data as a host value, for what saves it.
    pub(crate) fn to_host(&self) -> crate::HostValue {
        use crate::HostValue;
        match self {
            Data::Null => HostValue::Null,
            Data::Bool(b) => HostValue::Bool(*b),
            Data::Number(n) => HostValue::Number(n.as_f64().unwrap_or(f64::NAN)),
            Data::String(s) => HostValue::String(s.clone()),
            Data::Array(items) => HostValue::array(items.iter().map(Data::to_host)),
            Data::Object(fields) => HostValue::Object(
                fields
                    .iter()
                    .map(|(k, v)| (k.clone(), v.to_host()))
                    .collect(),
            ),
        }
    }

    /// The data a host value saved by `to_host` holds.
    pub(crate) fn from_host(v: &crate::HostValue) -> Self {
        use crate::HostValue;
        match v {
            HostValue::Bool(b) => Data::Bool(*b),
            HostValue::Number(n) => match crate::HostValue::Number(*n).to_json() {
                Some(Json::Number(n)) => Data::Number(n),
                _ => Data::Null,
            },
            HostValue::String(s) => Data::String(s.clone()),
            HostValue::Array(items) => Data::Array(
                items
                    .iter()
                    .map(|i| i.as_ref().map_or(Data::Null, Data::from_host))
                    .collect(),
            ),
            HostValue::Object(fields) => Data::Object(
                fields
                    .iter()
                    .map(|(k, v)| (k.clone(), Data::from_host(v)))
                    .collect(),
            ),
            _ => Data::Null,
        }
    }
}

impl From<&str> for Data {
    fn from(s: &str) -> Self {
        Data::String(s.into())
    }
}

impl From<String> for Data {
    fn from(s: String) -> Self {
        Data::String(s.into())
    }
}

impl From<HostString> for Data {
    fn from(s: HostString) -> Self {
        Data::String(s)
    }
}
