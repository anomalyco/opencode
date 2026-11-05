//! The UI half of the simulation protocol (`packages/protocol/src/simulation.ts`): JSON-RPC 2.0 requests over a
//! WebSocket, decoded as `Frontend.Request` decodes them, and the handshake.

use crate::keys::{Direction, KeyModifiers, Mouse};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

/// The capabilities this endpoint implements, in `Frontend.Capabilities` order. `ui.focus`, `ui.click`,
/// `ui.state`, and `ui.snapshot` name renderable numbers, which the Rust TUI has none of (plan 7.3), and the endpoint
/// does not record (`ui.recording.*`).
pub const CAPABILITIES: &[&str] = &[
    "ui.type",
    "ui.press",
    "ui.enter",
    "ui.arrow",
    "ui.mouse",
    "ui.resize",
    "ui.matches",
    "ui.capture",
];

/// One decoded request. `id` is `None` for a notification, which gets a response only when it fails.
#[derive(Debug, Clone, PartialEq)]
pub struct Envelope {
    pub id: Option<Value>,
    pub request: Request,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Request {
    Handshake(HandshakeParams),
    Type {
        text: String,
    },
    Press {
        key: String,
        modifiers: KeyModifiers,
    },
    Enter,
    Arrow(Direction),
    Mouse(Mouse),
    Resize {
        cols: f64,
        rows: f64,
    },
    Matches {
        text: String,
    },
    Capture,
    /// A request of the protocol this endpoint does not implement.
    Unsupported(&'static str),
}

/// Decodes a request, or says why it is not one. TS answers a request it cannot decode with a failure whose `id` is
/// null.
pub fn decode(input: &str) -> Result<Envelope, String> {
    let value: Value =
        serde_json::from_str(input).map_err(|error| format!("invalid JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or("expected a JSON-RPC request object")?;
    if object.get("jsonrpc") != Some(&json!("2.0")) {
        return Err("jsonrpc: expected \"2.0\"".into());
    }
    let id = object.get("id").cloned();
    if id
        .as_ref()
        .is_some_and(|id| !(id.is_string() || id.is_number() || id.is_null()))
    {
        return Err("id: expected a string, a number, or null".into());
    }
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .ok_or("method: expected a string")?;
    let params = object.get("params");
    let request = match method {
        "simulation.handshake" => Request::Handshake(params_of(method, params)?),
        "ui.type" => Request::Type {
            text: params_of::<Text>(method, params)?.text,
        },
        "ui.matches" => Request::Matches {
            text: params_of::<Text>(method, params)?.text,
        },
        "ui.press" => {
            let press: Press = params_of(method, params)?;
            Request::Press {
                key: press.key,
                modifiers: press.modifiers.unwrap_or_default(),
            }
        }
        "ui.arrow" => Request::Arrow(params_of::<Arrow>(method, params)?.direction),
        "ui.mouse" => Request::Mouse(params_of(method, params)?),
        "ui.resize" => {
            let resize: Resize = params_of(method, params)?;
            Request::Resize {
                cols: resize.cols,
                rows: resize.rows,
            }
        }
        "ui.enter" => Request::Enter,
        "ui.capture" => Request::Capture,
        "ui.focus" | "ui.click" => {
            params_of::<Value>(method, params)?;
            Request::Unsupported(if method == "ui.focus" {
                "ui.focus"
            } else {
                "ui.click"
            })
        }
        "ui.state" => Request::Unsupported("ui.state"),
        "ui.snapshot" => Request::Unsupported("ui.snapshot"),
        "ui.recording.finish" => Request::Unsupported("ui.recording.finish"),
        other => return Err(format!("method: unknown simulation UI method {other:?}")),
    };
    Ok(Envelope { id, request })
}

fn params_of<T: DeserializeOwned>(method: &str, params: Option<&Value>) -> Result<T, String> {
    let params = params
        .filter(|params| params.is_object())
        .ok_or_else(|| format!("{method}: params: expected an object"))?;
    serde_json::from_value(params.clone()).map_err(|error| format!("{method}: params: {error}"))
}

#[derive(Deserialize)]
struct Text {
    text: String,
}

#[derive(Deserialize)]
struct Press {
    key: String,
    modifiers: Option<KeyModifiers>,
}

#[derive(Deserialize)]
struct Arrow {
    direction: Direction,
}

#[derive(Deserialize)]
struct Resize {
    cols: f64,
    rows: f64,
}

/// The message for a request this endpoint does not implement.
pub fn unsupported(method: &str) -> String {
    match method {
        "ui.recording.finish" => "UI recording is not available".into(),
        _ => format!(
            "{method} is not supported by the Rust TUI: it has no renderable numbers; use ui.mouse with coordinates"
        ),
    }
}

/// `JsonRpc.success`: nothing for a notification.
pub fn success(id: Option<Value>, result: Value) -> Option<Value> {
    id.map(|id| json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// `JsonRpc.failure`, with the server's error code.
pub fn failure(id: Option<Value>, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "error": { "code": -32000, "message": message } })
}

/// `Handshake.Params`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeParams {
    pub client: Identity,
    pub expected_role: Role,
    pub offered_versions: Vec<u64>,
    pub required_capabilities: Vec<String>,
    pub optional_capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Identity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Ui,
    Backend,
}

/// `Handshake.dispatch` for the `ui` role, after the checks `Handshake.Params` makes while decoding.
pub fn handshake(params: &HandshakeParams, version: &str) -> Result<Value, String> {
    check(params)?;
    if params.expected_role != Role::Ui {
        return Err("Expected simulation endpoint role backend, received ui".into());
    }
    if !params.offered_versions.contains(&1) {
        return Err("No mutually supported simulation protocol version".into());
    }
    let missing: Vec<&str> = params
        .required_capabilities
        .iter()
        .map(String::as_str)
        .filter(|capability| !CAPABILITIES.contains(capability))
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Simulation endpoint is missing required capabilities: {}",
            missing.join(", ")
        ));
    }
    Ok(json!({
        "protocolVersion": 1,
        "role": "ui",
        "server": { "name": "opencode", "version": version },
        "capabilities": CAPABILITIES,
    }))
}

fn check(params: &HandshakeParams) -> Result<(), String> {
    let unique = |items: &[String]| {
        items
            .iter()
            .enumerate()
            .all(|(index, item)| !items[..index].contains(item))
    };
    if params.client.name.is_empty() || params.client.version.is_empty() {
        return Err(
            "simulation.handshake: params.client: expected a non-empty name and version".into(),
        );
    }
    let versions = &params.offered_versions;
    if versions.is_empty()
        || versions.contains(&0)
        || versions
            .iter()
            .enumerate()
            .any(|(index, version)| versions[..index].contains(version))
    {
        return Err(
            "simulation.handshake: params.offeredVersions: expected unique positive integers"
                .into(),
        );
    }
    for capabilities in [&params.required_capabilities, &params.optional_capabilities] {
        if capabilities.iter().any(String::is_empty) || !unique(capabilities) {
            return Err(
                "simulation.handshake: params: expected unique non-empty capabilities".into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handshake_request(role: &str, versions: &str, required: &str) -> String {
        format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"simulation.handshake","params":{{"client":{{"name":"t","version":"1"}},"expectedRole":"{role}","offeredVersions":{versions},"requiredCapabilities":{required},"optionalCapabilities":[]}}}}"#
        )
    }

    fn answer(input: &str) -> Result<Value, String> {
        let Request::Handshake(params) = decode(input)?.request else {
            panic!("not a handshake")
        };
        handshake(&params, "9.9.9")
    }

    #[test]
    fn handshakes_match_typescript() {
        let ok = answer(&handshake_request("ui", "[2,1]", r#"["ui.capture"]"#)).unwrap();
        assert_eq!(ok["protocolVersion"], 1);
        assert_eq!(
            ok["server"],
            json!({ "name": "opencode", "version": "9.9.9" })
        );
        assert_eq!(
            ok["capabilities"].as_array().unwrap().len(),
            CAPABILITIES.len()
        );
        assert_eq!(
            answer(&handshake_request("backend", "[1]", "[]")).unwrap_err(),
            "Expected simulation endpoint role backend, received ui"
        );
        assert_eq!(
            answer(&handshake_request("ui", "[2]", "[]")).unwrap_err(),
            "No mutually supported simulation protocol version"
        );
        assert_eq!(
            answer(&handshake_request(
                "ui",
                "[1]",
                r#"["ui.state","ui.type","ui.click"]"#
            ))
            .unwrap_err(),
            "Simulation endpoint is missing required capabilities: ui.state, ui.click"
        );
        assert!(answer(&handshake_request("ui", "[]", "[]")).is_err());
        assert!(answer(&handshake_request("ui", "[1,1]", "[]")).is_err());
        assert!(answer(&handshake_request("ui", "[1]", r#"["a","a"]"#)).is_err());
    }

    #[test]
    fn requests_decode_as_the_frontend_schema() {
        let decode_request = |input: &str| decode(input).map(|envelope| envelope.request);
        assert_eq!(
            decode(r#"{"jsonrpc":"2.0","id":"a","method":"ui.type","params":{"text":"hi"}}"#)
                .unwrap(),
            Envelope {
                id: Some(json!("a")),
                request: Request::Type { text: "hi".into() }
            }
        );
        assert_eq!(
            decode(r#"{"jsonrpc":"2.0","method":"ui.enter"}"#)
                .unwrap()
                .id,
            None
        );
        assert_eq!(
            decode_request(
                r#"{"jsonrpc":"2.0","id":1,"method":"ui.press","params":{"key":"c","modifiers":{"ctrl":true}}}"#
            ),
            Ok(Request::Press {
                key: "c".into(),
                modifiers: KeyModifiers {
                    ctrl: true,
                    ..KeyModifiers::default()
                }
            })
        );
        assert_eq!(
            decode_request(
                r#"{"jsonrpc":"2.0","id":1,"method":"ui.arrow","params":{"direction":"left"}}"#
            ),
            Ok(Request::Arrow(Direction::Left))
        );
        assert_eq!(
            decode_request(
                r#"{"jsonrpc":"2.0","id":1,"method":"ui.resize","params":{"cols":80.5,"rows":24}}"#
            ),
            Ok(Request::Resize {
                cols: 80.5,
                rows: 24.0
            })
        );
        assert_eq!(
            decode_request(r#"{"jsonrpc":"2.0","id":1,"method":"ui.state"}"#),
            Ok(Request::Unsupported("ui.state"))
        );
        assert_eq!(
            decode_request(
                r#"{"jsonrpc":"2.0","id":1,"method":"ui.click","params":{"target":1,"x":0,"y":0}}"#
            ),
            Ok(Request::Unsupported("ui.click"))
        );
        for bad in [
            "nope",
            r#"{"jsonrpc":"1.0","id":1,"method":"ui.enter"}"#,
            r#"{"jsonrpc":"2.0","id":{},"method":"ui.enter"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ui.type"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ui.type","params":{"text":1}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ui.arrow","params":{"direction":"in"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"ui.nope"}"#,
        ] {
            assert!(decode(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn responses_are_json_rpc() {
        assert_eq!(success(None, json!(true)), None);
        assert_eq!(
            success(Some(json!(3)), json!(true)),
            Some(json!({ "jsonrpc": "2.0", "id": 3, "result": true }))
        );
        assert_eq!(
            failure(None, "bad"),
            json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": "bad" } })
        );
    }
}
