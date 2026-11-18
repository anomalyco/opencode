//! Calling an operation, as the reference's `openapi/runtime.ts` does: the model's input becomes the URL, query,
//! headers and JSON body, authentication is resolved and applied, and the response becomes the tool's result.

use std::sync::Arc;

use super::spec::{Body, BodyMode, InputField, Location, SecurityRequirement, Style};
use super::{ApiKeyLocation, AuthContext, AuthResolver, Credential, Operation, SecurityScheme};
use crate::Json;
use crate::schema::js_stringify;
use crate::tool::{BoxFuture, ToolError};
use crate::value::write_num;

const MAX_ERROR_BODY_CHARS: usize = 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 50 * 1024 * 1024;

/// A request the generated tools send. Header names are lowercase; `url` includes the query string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// The HTTP transport the host provides, the counterpart of the reference's `HttpClient.HttpClient`. An error is a
/// transport failure.
pub trait HttpClient: Send + Sync {
    fn execute(&self, request: HttpRequest) -> BoxFuture<'static, Result<HttpResponse, String>>;
}

pub struct Plan {
    pub operation: Operation,
    pub url: String,
    pub fields: Vec<InputField>,
    pub body: Option<Body>,
    pub security: Vec<SecurityRequirement>,
    pub schemes: Vec<(String, SecurityScheme)>,
    pub auth: Option<AuthResolver>,
    pub headers: Arc<Vec<(String, String)>>,
}

fn error(message: impl Into<String>) -> ToolError {
    ToolError::new(message)
}

pub async fn invoke(plan: &Plan, client: &dyn HttpClient, input: Json) -> Result<Json, ToolError> {
    let empty = serde_json::Map::new();
    let value = input.as_object().unwrap_or(&empty);
    let mut request = build_request(plan, value)?;
    let (headers, query) = resolve_auth(plan).await?;
    for (name, item) in query {
        request.query.retain(|(k, _)| *k != name);
        request.query.push((name, item));
    }
    for (name, item) in headers {
        set_header(&mut request.headers, &name, item);
    }
    let op = &plan.operation;
    let response = client
        .execute(request.finish())
        .await
        .map_err(|_| error(format!("{} {} failed: transport error", op.method, op.path)))?;
    let declared = response.header("content-length").and_then(parse_int);
    if declared.is_some_and(|n| n > MAX_RESPONSE_BODY_BYTES as f64)
        || response.body.len() > MAX_RESPONSE_BODY_BYTES
    {
        return Err(error(format!(
            "{} {} response exceeds 50 MiB.",
            op.method, op.path
        )));
    }
    let text = String::from_utf8_lossy(&response.body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned();
    let media = response
        .header("content-type")
        .map(|m| m.split(';').next().unwrap_or("").trim().to_lowercase());
    let json = media
        .as_deref()
        .is_some_and(|m| m == "application/json" || m.ends_with("+json"));
    let decoded: Option<Json> = if text.is_empty() {
        Some(Json::Null)
    } else if json {
        serde_json::from_str(&text).ok()
    } else {
        None
    };
    let parsed = if json {
        decoded
            .clone()
            .unwrap_or_else(|| Json::String(text.clone()))
    } else if text.is_empty() {
        Json::Null
    } else {
        Json::String(text.clone())
    };
    if !(200..300).contains(&response.status) {
        let rendered = match &parsed {
            Json::String(s) => s.clone(),
            other => js_stringify(other),
        };
        let summary = if rendered.is_empty() || rendered == "null" {
            "no response body".to_owned()
        } else if rendered.encode_utf16().count() > MAX_ERROR_BODY_CHARS {
            let mut cut = String::new();
            let mut units = 0;
            for c in rendered.chars() {
                units += c.len_utf16();
                if units > MAX_ERROR_BODY_CHARS {
                    break;
                }
                cut.push(c);
            }
            format!("{cut}...")
        } else {
            rendered
        };
        return Err(error(format!(
            "{} {} failed with HTTP {}: {summary}",
            op.method, op.path, response.status
        )));
    }
    if json && decoded.is_none() {
        return Err(error(format!(
            "{} {} returned malformed JSON.",
            op.method, op.path
        )));
    }
    Ok(parsed)
}

/// `Number.parseInt(text, 10)` when it is a non-negative safe integer.
fn parse_int(text: &str) -> Option<f64> {
    let t = text.trim_start();
    let digits: String = t.chars().take_while(char::is_ascii_digit).collect();
    let n: f64 = digits.parse().ok()?;
    (n <= 9_007_199_254_740_991.0).then_some(n)
}

struct Building {
    method: String,
    url: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
}

impl Building {
    fn finish(self) -> HttpRequest {
        let mut url = self.url;
        if !self.query.is_empty() {
            url.push('?');
            let pairs: Vec<String> = self
                .query
                .iter()
                .map(|(k, v)| format!("{}={}", form_encode(k), form_encode(v)))
                .collect();
            url.push_str(&pairs.join("&"));
        }
        HttpRequest {
            method: self.method,
            url,
            headers: self.headers,
            body: self.body,
        }
    }
}

fn set_header(headers: &mut Vec<(String, String)>, name: &str, value: String) {
    let name = name.to_ascii_lowercase();
    match headers.iter_mut().find(|(k, _)| *k == name) {
        Some(entry) => entry.1 = value,
        None => headers.push((name, value)),
    }
}

fn build_request(
    plan: &Plan,
    input: &serde_json::Map<String, Json>,
) -> Result<Building, ToolError> {
    // Model input is checked before auth resolution can refresh credentials.
    let url = build_url(plan, input)?;
    if let Some(missing) = plan
        .fields
        .iter()
        .find(|f| f.required && f.location != Location::Path && !input.contains_key(&f.input_name))
    {
        let label = if missing.location == Location::Body {
            "body field".to_owned()
        } else {
            format!("{} parameter", missing.location.name())
        };
        return Err(error(format!(
            "Missing required {label} '{}'.",
            missing.input_name
        )));
    }
    let mut request = Building {
        method: plan.operation.method.clone(),
        url,
        query: Vec::new(),
        headers: Vec::new(),
        body: None,
    };
    for field in plan.fields.iter().filter(|f| f.location == Location::Query) {
        if let Some(item) = input.get(&field.input_name) {
            request.query.extend(serialize_query(field, item)?);
        }
    }
    for (k, v) in plan.headers.iter() {
        set_header(&mut request.headers, k, v.clone());
    }
    for field in plan
        .fields
        .iter()
        .filter(|f| f.location == Location::Header)
    {
        if let Some(item) = input.get(&field.input_name) {
            let serialized = serialize_simple(field, item, &|s| s.to_owned())?;
            set_header(&mut request.headers, &field.name, serialized);
        }
    }
    let mut set_body = |value: &Json, media: &str| {
        request.body = Some(js_stringify(value).into_bytes());
        set_header(&mut request.headers, "content-type", media.to_owned());
    };
    match &plan.body {
        Some(Body {
            mode: BodyMode::Value,
            media_type,
            ..
        }) => {
            let field = plan.fields.iter().find(|f| f.location == Location::Body);
            if let Some(body) = field.and_then(|f| input.get(&f.input_name)) {
                set_body(body, media_type);
            }
        }
        Some(Body {
            mode: BodyMode::Object,
            media_type,
            required,
        }) => {
            let entries: serde_json::Map<String, Json> = plan
                .fields
                .iter()
                .filter(|f| f.location == Location::Body)
                .filter_map(|f| {
                    input
                        .get(&f.input_name)
                        .map(|v| (f.name.clone(), v.clone()))
                })
                .collect();
            if *required || !entries.is_empty() {
                set_body(&Json::Object(entries), media_type);
            }
        }
        None => {}
    }
    Ok(request)
}

/// The headers and query parameters of the first security alternative whose credentials all resolve.
async fn resolve_auth(
    plan: &Plan,
) -> Result<(Vec<(String, String)>, Vec<(String, String)>), ToolError> {
    if plan.security.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let mut unavailable: Vec<String> = Vec::new();
    'alternatives: for requirement in &plan.security {
        if requirement.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        let mut credentials = Vec::new();
        for (name, scopes) in requirement {
            let scheme = plan.schemes.iter().find(|(n, _)| n == name).map(|(_, s)| s);
            let (Some(scheme), Some(auth)) = (scheme, &plan.auth) else {
                unavailable.push(name.clone());
                continue 'alternatives;
            };
            let context = AuthContext {
                name: name.clone(),
                definition: scheme.clone(),
                scopes: scopes.clone(),
                operation: plan.operation.clone(),
            };
            match auth(&context).await? {
                Some(credential) => credentials.push((name.clone(), scheme.clone(), credential)),
                None => {
                    unavailable.push(name.clone());
                    continue 'alternatives;
                }
            }
        }
        return apply_credentials(&credentials);
    }
    let mut names: Vec<String> = Vec::new();
    for n in unavailable {
        if !names.contains(&n) {
            names.push(n);
        }
    }
    Err(error(format!(
        "{} {} requires authentication; no credential available for: {}.",
        plan.operation.method,
        plan.operation.path,
        names.join(", ")
    )))
}

type Carriers = (Vec<(String, String)>, Vec<(String, String)>);

fn apply_credentials(
    credentials: &[(String, SecurityScheme, Credential)],
) -> Result<Carriers, ToolError> {
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut query: Vec<(String, String)> = Vec::new();
    fn add(
        target: &mut Vec<(String, String)>,
        carrier: &str,
        name: String,
        value: String,
    ) -> Result<(), ToolError> {
        if target.iter().any(|(k, _)| *k == name) {
            return Err(error(format!(
                "Authentication resolves multiple credentials for {carrier} '{name}'."
            )));
        }
        target.push((name, value));
        Ok(())
    }
    for (name, definition, credential) in credentials {
        match credential {
            Credential::Bearer { token } => add(
                &mut headers,
                "header",
                "authorization".into(),
                format!("Bearer {token}"),
            )?,
            Credential::Basic { username, password } => add(
                &mut headers,
                "header",
                "authorization".into(),
                format!(
                    "Basic {}",
                    base64(format!("{username}:{password}").as_bytes())
                ),
            )?,
            Credential::Header { name, value } => {
                add(&mut headers, "header", name.to_lowercase(), value.clone())?
            }
            Credential::ApiKey { value } => {
                let SecurityScheme::ApiKey {
                    name: parameter,
                    location,
                } = definition
                else {
                    return Err(error(format!(
                        "Security scheme '{name}' is not an apiKey scheme; resolve a bearer, basic, or header credential for it."
                    )));
                };
                match location {
                    ApiKeyLocation::Cookie => {
                        return Err(error(format!(
                            "Cookie authentication '{name}' is not supported."
                        )));
                    }
                    ApiKeyLocation::Header => add(
                        &mut headers,
                        "header",
                        parameter.to_lowercase(),
                        value.clone(),
                    )?,
                    ApiKeyLocation::Query => {
                        add(&mut query, "query", parameter.clone(), value.clone())?
                    }
                }
            }
        }
    }
    Ok((headers, query))
}

fn build_url(plan: &Plan, input: &serde_json::Map<String, Json>) -> Result<String, ToolError> {
    let mut url = plan.url.clone();
    for field in plan.fields.iter().filter(|f| f.location == Location::Path) {
        let Some(item) = input.get(&field.input_name) else {
            return Err(error(format!(
                "Missing required path parameter '{}'.",
                field.input_name
            )));
        };
        let value = serialize_simple(field, item, &encode_uri_component)?;
        // URL normalization collapses encoded `.` and `..`, which could retarget the request.
        if value.is_empty() || value == "." || value == ".." {
            return Err(error(format!(
                "Invalid path parameter '{}'.",
                field.input_name
            )));
        }
        url = url.replace(&format!("{{{}}}", field.name), &value);
    }
    if super::spec::has_template(&url) {
        let start = url
            .match_indices('{')
            .map(|(i, _)| i)
            .find(|&i| {
                let rest = &url[i + 1..];
                matches!(rest.find(['{', '}']), Some(j) if j > 0 && rest.as_bytes()[j] == b'}')
            })
            .unwrap_or(0);
        let end = url[start..].find('}').map_or(url.len(), |j| start + j + 1);
        return Err(error(format!(
            "Unresolved path parameter {}.",
            &url[start..end]
        )));
    }
    Ok(url)
}

/// JavaScript's `String(value)` for a JSON scalar.
fn js_string(v: &Json) -> String {
    match v {
        Json::String(s) => s.clone(),
        Json::Number(n) => {
            let mut out = String::new();
            write_num(&mut out, n.as_f64().unwrap_or(f64::NAN));
            out
        }
        other => js_stringify(other),
    }
}

fn is_scalar(v: &Json) -> bool {
    !matches!(v, Json::Array(_) | Json::Object(_))
}

fn serialize_simple(
    field: &InputField,
    value: &Json,
    encode: &dyn Fn(&str) -> String,
) -> Result<String, ToolError> {
    let scalar = |item: &Json| {
        if is_scalar(item) {
            Ok(encode(&js_string(item)))
        } else {
            Err(error(format!(
                "Parameter '{}' contains an unsupported nested value.",
                field.input_name
            )))
        }
    };
    match value {
        Json::Array(items) => Ok(items
            .iter()
            .map(scalar)
            .collect::<Result<Vec<_>, _>>()?
            .join(",")),
        Json::Object(map) => {
            let mut parts = Vec::new();
            for (name, item) in map {
                let rendered = scalar(item)?;
                if field.explode {
                    parts.push(format!("{}={rendered}", encode(name)));
                } else {
                    parts.push(encode(name));
                    parts.push(rendered);
                }
            }
            Ok(parts.join(","))
        }
        other => scalar(other),
    }
}

fn serialize_query(field: &InputField, value: &Json) -> Result<Vec<(String, String)>, ToolError> {
    if field.style == Some(Style::DeepObject) {
        let Json::Object(map) = value else {
            return Err(error(format!(
                "Deep-object parameter '{}' must be an object.",
                field.input_name
            )));
        };
        let mut out = Vec::new();
        for (name, item) in map {
            if !is_scalar(item) {
                return Err(error(format!(
                    "Deep-object parameter '{}' contains an unsupported nested value.",
                    field.input_name
                )));
            }
            out.push((format!("{}[{name}]", field.name), js_string(item)));
        }
        return Ok(out);
    }
    match value {
        Json::Array(items) if field.explode => items
            .iter()
            .map(|item| {
                if is_scalar(item) {
                    Ok((field.name.clone(), js_string(item)))
                } else {
                    Err(error(format!(
                        "Parameter '{}' contains an unsupported nested value.",
                        field.input_name
                    )))
                }
            })
            .collect(),
        Json::Object(map) if field.explode => map
            .iter()
            .map(|(name, item)| {
                if is_scalar(item) {
                    Ok((name.clone(), js_string(item)))
                } else {
                    Err(error(format!(
                        "Query parameter '{}' contains an unsupported nested value.",
                        field.input_name
                    )))
                }
            })
            .collect(),
        other => Ok(vec![(
            field.name.clone(),
            serialize_simple(field, other, &|s| s.to_owned())?,
        )]),
    }
}

/// `encodeURIComponent`, with `!'()*` also encoded as the reference does for path segments.
fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The `application/x-www-form-urlencoded` serializer `URLSearchParams` uses.
fn form_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b' ' => out.push('+'),
            b if b.is_ascii_alphanumeric() || b"*-._".contains(&b) => out.push(b as char),
            b => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodings_match_javascript() {
        assert_eq!(super::encode_uri_component("a!b*"), "a%21b%2A");
        assert_eq!(super::form_encode("/tmp/a b&c"), "%2Ftmp%2Fa+b%26c");
        assert_eq!(super::base64(b"user:p\xc3\xa4ss"), "dXNlcjpww6Rzcw==");
    }
}
