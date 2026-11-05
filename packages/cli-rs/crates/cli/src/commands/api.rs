//! `api`: a request to the running server (`packages/cli/src/commands/handlers/api.ts`).

use opencode_api::client::Auth;
use opencode_api::transport::{Request, Reqwest, Transport};
use serde_json::Value;

use super::Context;
use super::client::{block_on, connect};
use crate::args::ApiArgs;
use crate::output::{Exit, print};

const METHODS: [(&str, &str); 7] = [
    ("delete", "DELETE"),
    ("get", "GET"),
    ("head", "HEAD"),
    ("options", "OPTIONS"),
    ("patch", "PATCH"),
    ("post", "POST"),
    ("put", "PUT"),
];

pub fn run(context: &Context, args: &ApiArgs) -> anyhow::Result<()> {
    let ok = block_on(async {
        let server = connect(context).await?;
        let endpoint = server.endpoint();
        let transport = Reqwest::default();
        let auth = match &endpoint.auth {
            Some(auth @ Auth::Basic { .. }) => vec![("authorization".to_owned(), format!("Basic {}", auth.token()))],
            _ => Vec::new(),
        };
        let params = params(&args.param);
        let (method, path) = match raw_request(&args.request) {
            Some(request) => request,
            None if args.request.len() != 1 => {
                anyhow::bail!("Expected an operation name or an HTTP method and path")
            }
            None => {
                let response = transport
                    .send(Request {
                        method: "GET",
                        url: url::Url::parse(&endpoint.url)?.join("/openapi.json")?,
                        headers: auth.clone(),
                        body: None,
                    })
                    .await
                    .map_err(anyhow::Error::msg)?;
                if !(200..300).contains(&response.status) {
                    anyhow::bail!("Failed to load OpenAPI document: HTTP {}", response.status);
                }
                let spec: Value = serde_json::from_slice(&response.bytes().await.map_err(anyhow::Error::msg)?)?;
                resolve_operation(&spec, &args.request[0], &params)?
            }
        };
        let mut headers = auth;
        for header in &args.header {
            let Some((name, value)) = header.split_once(':').filter(|(name, _)| !name.is_empty()) else {
                anyhow::bail!("Invalid header, expected name:value: {header}");
            };
            set(&mut headers, name.trim().to_ascii_lowercase(), value.trim());
        }
        if args.data.is_some() && !headers.iter().any(|(name, _)| name == "content-type") {
            headers.push(("content-type".to_owned(), "application/json".to_owned()));
        }
        let response = transport
            .send(Request {
                method,
                url: url::Url::parse(&endpoint.url)?.join(&path)?,
                headers,
                body: args.data.clone().map(Into::into),
            })
            .await
            .map_err(anyhow::Error::msg)?;
        let status = response.status;
        let body = response.bytes().await.map_err(anyhow::Error::msg)?;
        let output = String::from_utf8_lossy(&body);
        if !output.is_empty() {
            print(&format!("{output}{}", if output.ends_with('\n') { "" } else { "\n" }))?;
        }
        if !(200..300).contains(&status) {
            let text = reqwest::StatusCode::from_u16(status)
                .ok()
                .and_then(|status| status.canonical_reason())
                .unwrap_or_default();
            eprintln!("HTTP {status} {text}");
            return Ok(false);
        }
        anyhow::Ok(true)
    })??;
    if ok {
        return Ok(());
    }
    Err(Exit(1).into())
}

fn method(name: &str) -> Option<&'static str> {
    METHODS.iter().find(|(lower, _)| *lower == name).map(|(_, upper)| *upper)
}

// `headers.set`: a later value replaces an earlier one of the same name.
fn set(headers: &mut Vec<(String, String)>, name: String, value: &str) {
    headers.retain(|(existing, _)| *existing != name);
    headers.push((name, value.to_owned()));
}

/// `--param` pairs as the JavaScript record holds them: a repeated key keeps its first position and
/// its last value, and integer-like keys come first in numeric order.
fn params(pairs: &[(String, String)]) -> Vec<(String, String)> {
    let mut record: Vec<(String, String)> = Vec::new();
    for (key, value) in pairs {
        match record.iter_mut().find(|(existing, _)| existing == key) {
            Some(entry) => entry.1 = value.clone(),
            None => record.push((key.clone(), value.clone())),
        }
    }
    let index = |key: &str| key.parse::<u32>().ok().filter(|index| *index < u32::MAX && index.to_string() == key);
    let (mut indexes, names): (Vec<_>, Vec<_>) = record.into_iter().partition(|(key, _)| index(key).is_some());
    indexes.sort_by_key(|(key, _)| index(key));
    indexes.into_iter().chain(names).collect()
}

/// `rawRequest`: an HTTP method and a path that starts with `/`.
fn raw_request(input: &[String]) -> Option<(&'static str, String)> {
    let [name, path] = input else { return None };
    let method = method(&name.to_lowercase())?;
    path.starts_with('/').then(|| (method, path.clone()))
}

/// `resolveOperation`: the first method in the OpenAPI document with `operationId`, and its path
/// with the parameters filled in.
fn resolve_operation(
    spec: &Value,
    operation: &str,
    params: &[(String, String)],
) -> anyhow::Result<(&'static str, String)> {
    let found = spec["paths"]
        .as_object()
        .into_iter()
        .flatten()
        .flat_map(|(path, operations)| {
            operations.as_object().into_iter().flatten().map(move |(name, value)| (path, name, value))
        })
        .find_map(|(path, name, value)| {
            let method = method(name)?;
            (value["operationId"].as_str() == Some(operation)).then_some((method, path))
        });
    let Some((method, path)) = found else {
        anyhow::bail!("Operation not found: {operation}");
    };
    Ok((method, interpolate(path, params)?))
}

// `{name}` segments take the parameter of that name; the other parameters become the query.
fn interpolate(path: &str, params: &[(String, String)]) -> anyhow::Result<String> {
    let mut used: Vec<&str> = Vec::new();
    let mut pathname = String::new();
    let mut rest = path;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open + 1..].find('}').filter(|close| *close > 0) else {
            break;
        };
        let name = &rest[open + 1..open + 1 + close];
        let Some((key, value)) = params.iter().find(|(key, _)| key == name) else {
            anyhow::bail!("Missing path parameter: {name}");
        };
        used.push(key);
        pathname.push_str(&rest[..open]);
        pathname.push_str(&encode_uri_component(value));
        rest = &rest[open + close + 2..];
    }
    pathname.push_str(rest);
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in params.iter().filter(|(key, _)| !used.contains(&key.as_str())) {
        query.append_pair(key, value);
    }
    let query = query.finish();
    if query.is_empty() {
        return Ok(pathname);
    }
    Ok(format!("{pathname}?{query}"))
}

// `encodeURIComponent`.
fn encode_uri_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                (byte as char).to_string()
            }
            byte => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
    }

    #[test]
    fn raw_requests_need_a_method_and_an_absolute_path() {
        let input = |items: &[&str]| items.iter().map(|item| item.to_string()).collect::<Vec<_>>();
        assert_eq!(raw_request(&input(&["Get", "/api/x?a=1"])), Some(("GET", "/api/x?a=1".to_owned())));
        assert_eq!(raw_request(&input(&["get", "api/x"])), None);
        assert_eq!(raw_request(&input(&["fetch", "/api/x"])), None);
        assert_eq!(raw_request(&input(&["session.list"])), None);
    }

    #[test]
    fn operations_fill_path_parameters_and_query() {
        // The cases of `packages/cli/src/commands/handlers/api.test.ts`, and more.
        let spec = json!({ "paths": {
            "/api/session": { "parameters": [], "get": { "operationId": "session.list" } },
            "/api/session/{sessionID}": { "get": { "operationId": "session.get" } },
            "/api/session/{sessionID}/message/{messageID}": {
                "get": { "operationId": "session.message" },
                "delete": { "operationId": "session.message.delete" },
            },
        }});
        let params = pairs(&[("sessionID", "ses 1/2"), ("limit", "5"), ("messageID", "msg_1"), ("q", "a b&c")]);
        assert_eq!(
            resolve_operation(&spec, "session.message.delete", &params).unwrap(),
            ("DELETE", "/api/session/ses%201%2F2/message/msg_1?limit=5&q=a+b%26c".to_owned())
        );
        assert_eq!(
            resolve_operation(&spec, "session.get", &pairs(&[("sessionID", "ses/a"), ("workspace", "work")])).unwrap(),
            ("GET", "/api/session/ses%2Fa?workspace=work".to_owned())
        );
        assert_eq!(resolve_operation(&spec, "session.list", &[]).unwrap(), ("GET", "/api/session".to_owned()));
        assert_eq!(
            resolve_operation(&spec, "session.message", &pairs(&[("sessionID", "s")])).unwrap_err().to_string(),
            "Missing path parameter: messageID"
        );
        assert_eq!(resolve_operation(&spec, "nope", &[]).unwrap_err().to_string(), "Operation not found: nope");
    }

    #[test]
    fn params_follow_javascript_record_order() {
        assert_eq!(
            params(&pairs(&[("b", "1"), ("10", "x"), ("a", "2"), ("b", "3"), ("2", "y"), ("01", "z")])),
            pairs(&[("2", "y"), ("10", "x"), ("b", "3"), ("a", "2"), ("01", "z")])
        );
    }
}
