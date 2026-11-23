use opencode_api::client::Auth;
use opencode_api::transport::{Request, Reqwest, Transport};
use opencode_util::{bail, error};
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

pub fn run(context: &Context, args: &ApiArgs) -> error::Result<()> {
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
                bail!("Expected an operation name or an HTTP method and path")
            }
            None => {
                let response = transport
                    .send(Request {
                        method: "GET",
                        url: opencode_api::js::join_url(&opencode_api::js::parse_url(&endpoint.url)?, "/openapi.json")?,
                        headers: auth.clone(),
                        body: None,
                    })
                    .await
                    .map_err(error::Error::msg)?;
                if !(200..300).contains(&response.status) {
                    bail!("Failed to load OpenAPI document: HTTP {}", response.status);
                }
                let spec: Value = serde_json::from_slice(&response.bytes().await.map_err(error::Error::msg)?)?;
                resolve_operation(&spec, &args.request[0], &params)?
            }
        };
        let mut headers = auth;
        for header in &args.header {
            let Some((name, value)) = header.split_once(':').filter(|(name, _)| !name.is_empty()) else {
                bail!("Invalid header, expected name:value: {header}");
            };
            // `headers.set`: a later value replaces an earlier one of the same name.
            let name = name.trim().to_ascii_lowercase();
            headers.retain(|(existing, _)| *existing != name);
            headers.push((name, value.trim().to_owned()));
        }
        if args.data.is_some() && !headers.iter().any(|(name, _)| name == "content-type") {
            headers.push(("content-type".to_owned(), "application/json".to_owned()));
        }
        let response = transport
            .send(Request {
                method,
                url: opencode_api::js::join_url(&opencode_api::js::parse_url(&endpoint.url)?, &path)?,
                headers,
                body: args.data.clone().map(Into::into),
            })
            .await
            .map_err(error::Error::msg)?;
        let status = response.status;
        let body = response.bytes().await.map_err(error::Error::msg)?;
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
        Ok::<_, error::Error>(true)
    })??;
    if ok {
        return Ok(());
    }
    Err(Exit(1).into())
}

fn method(name: &str) -> Option<&'static str> {
    METHODS.iter().find(|(lower, _)| *lower == name).map(|(_, upper)| *upper)
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
) -> error::Result<(&'static str, String)> {
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
        bail!("Operation not found: {operation}");
    };
    Ok((method, interpolate(path, params)?))
}

// `{name}` segments take the parameter of that name; the other parameters become the query.
fn interpolate(path: &str, params: &[(String, String)]) -> error::Result<String> {
    let mut used: Vec<&str> = Vec::new();
    let mut pathname = String::new();
    let mut rest = path;
    while let Some(open) = rest.find('{') {
        let Some(close) = rest[open + 1..].find('}').filter(|close| *close > 0) else { break };
        let name = &rest[open + 1..open + 1 + close];
        let Some((key, value)) = params.iter().find(|(key, _)| key == name) else {
            bail!("Missing path parameter: {name}");
        };
        used.push(key);
        pathname.push_str(&rest[..open]);
        pathname.push_str(&opencode_api::js::encode_component(value));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
    }

    #[test]
    fn params_follow_javascript_record_order() {
        assert_eq!(
            params(&pairs(&[("b", "1"), ("10", "x"), ("a", "2"), ("b", "3"), ("2", "y"), ("01", "z")])),
            pairs(&[("2", "y"), ("10", "x"), ("b", "3"), ("a", "2"), ("01", "z")])
        );
    }
}
