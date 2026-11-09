//! The plugins' one route for I/O (O-67): a built-in builds its request with a generated `*_call` builder and turns it
//! into an [`abi::Fetch`] here; the host sends a fetch through its own client, on the transport the TUI runs on now.

use opencode_api::client::{Body, Call};
use opencode_plugin::abi;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Every error status: a plugin decodes the body of the error it gets itself.
const STATUSES: [u16; 200] = {
    let mut statuses = [0; 200];
    let mut index = 0;
    while index < 200 {
        statuses[index] = 400 + index as u16;
        index += 1;
    }
    statuses
};

/// The fetch of `call`, as a generated builder made it. Its headers and a byte body do not cross; no builder a
/// built-in uses sets them.
pub fn fetch_of(call: Call) -> abi::Fetch {
    debug_assert!(call.headers.is_empty(), "a plugin fetch carries no headers");
    abi::Fetch {
        method: call.method.to_owned(),
        path: call.path,
        query: call.query,
        body: match call.body {
            Some(Body::Json(value)) => Some(value),
            _ => None,
        },
    }
}

/// The value of an API reply that wraps it in `data`, as the generated methods that return `data` read it.
pub fn data<T: DeserializeOwned>(reply: Result<Value, String>) -> Result<T, String> {
    #[derive(serde::Deserialize)]
    struct Data<T> {
        data: T,
    }
    serde_json::from_value::<Data<T>>(reply?).map(|value| value.data).map_err(|error| error.to_string())
}

/// The call of a plugin's `fetch`.
pub(crate) fn call_of(fetch: abi::Fetch) -> Result<Call, String> {
    let method = ["GET", "POST", "PUT", "PATCH", "DELETE"]
        .into_iter()
        .find(|method| method.eq_ignore_ascii_case(&fetch.method))
        .ok_or_else(|| format!("unsupported method {}", fetch.method))?;
    if !fetch.path.starts_with('/') {
        return Err(format!("the path {} does not start with /", fetch.path));
    }
    let mut call = Call::new(method, fetch.path, 200, &STATUSES);
    call.query = fetch.query;
    call.body = fetch.body.map(Body::Json);
    Ok(call)
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_api::client::Client;
    use opencode_api::generated::{
        ExperimentalSessionStatsInput, ExperimentalSessionStatsInputTools, SessionGenerateInput, SessionID,
    };

    // Expected: a generated call turned into a fetch and back prepares the same request, query and body included.
    #[test]
    fn a_call_survives_the_fetch_round_trip() {
        let client = Client::new("http://127.0.0.1:4096/base").unwrap();
        let stats = || {
            let input = ExperimentalSessionStatsInput {
                from: Some(1.5),
                timezone: Some("Europe/Oslo".to_owned()),
                tools: Some(ExperimentalSessionStatsInputTools::None),
                ..ExperimentalSessionStatsInput::default()
            };
            Client::experimental_session_stats_call(&input).unwrap()
        };
        let generate = || {
            let input = SessionGenerateInput { session_id: SessionID("ses_1".into()), prompt: "why?".into() };
            Client::session_generate_call(&input).unwrap()
        };
        for call in [stats as fn() -> Call, generate] {
            let fetch: abi::Fetch = serde_json::from_value(serde_json::to_value(fetch_of(call())).unwrap()).unwrap();
            let (want, got) = (client.prepare(call()).unwrap(), client.prepare(call_of(fetch).unwrap()).unwrap());
            assert_eq!((want.method, want.url, want.headers, want.body), (got.method, got.url, got.headers, got.body));
        }
        assert!(call_of(abi::Fetch { method: "TRACE".into(), path: "/x".into(), ..abi::Fetch::default() }).is_err());
    }
}
