//! Request core: base URL, authentication, per-call headers, and declared errors. It follows the
//! `make` function of the TypeScript Promise client (`packages/client/src/promise/generated/client.ts:354-473`).
//! The generated methods (`generated/methods.rs`) build a [`Call`] and send it here.

use std::sync::Arc;

use base64::Engine;
use bytes::Bytes;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::{DeclaredError, Error};
use crate::query;
use crate::transport::{Request, Reqwest, Response, SseResponse, Transport};

/// The query parameter the server reads credentials from when a request cannot carry headers.
pub const AUTH_TOKEN_QUERY: &str = "auth_token";

/// How the client authenticates. The server accepts `Basic` credentials in the `authorization` header or,
/// base64-encoded the same way, in the `auth_token` query parameter
/// (`packages/server/src/middleware/authorization.ts:33-40`).
#[derive(Clone, PartialEq, Eq)]
pub enum Auth {
    /// `authorization: Basic base64(username:password)`.
    Basic { username: String, password: String },
    /// `?auth_token=base64(username:password)`.
    Query { username: String, password: String },
}

impl Auth {
    /// Basic credentials with the user name the CLI uses for its local service.
    pub fn password(password: impl Into<String>) -> Self {
        Self::Basic { username: "opencode".to_owned(), password: password.into() }
    }

    /// `base64(username:password)`, the value of the header after `Basic ` and of `auth_token`.
    pub fn token(&self) -> String {
        let (Self::Basic { username, password } | Self::Query { username, password }) = self;
        base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
    }
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (kind, username) = match self {
            Self::Basic { username, .. } => ("Basic", username),
            Self::Query { username, .. } => ("Query", username),
        };
        write!(f, "Auth::{kind} {{ username: {username:?}, password: <redacted> }}")
    }
}

/// The API client. Cheap to clone.
#[derive(Clone)]
pub struct Client {
    base_url: url::Url,
    auth: Option<Auth>,
    headers: Vec<(String, String)>,
    transport: Arc<dyn Transport>,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("base_url", &self.base_url.as_str())
            .field("auth", &self.auth)
            .finish_non_exhaustive()
    }
}

impl Client {
    /// A client on the `reqwest` transport.
    pub fn new(base_url: &str) -> Result<Self, Error> {
        Self::with_transport(base_url, Arc::new(Reqwest::default()))
    }

    pub fn with_transport(base_url: &str, transport: Arc<dyn Transport>) -> Result<Self, Error> {
        let mut base_url = crate::js::parse_url(base_url).map_err(|error| match error {
            crate::js::UrlError::NonAsciiHost(_) => Error::Transport(error.to_string()),
            error => Error::Transport(format!("{base_url}: {error}")),
        })?;
        // A leading slash would replace any path prefix on the base URL, so paths join relative to it.
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }
        Ok(Self { base_url, auth: None, headers: Vec::new(), transport })
    }

    pub fn auth(mut self, auth: Auth) -> Self {
        self.auth = Some(auth);
        self
    }

    /// Adds a header to every request.
    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        set_header(&mut self.headers, name.into(), value.into());
        self
    }

    /// A copy of this client that adds a header to every request.
    pub fn with_header(&self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.clone().header(name, value)
    }

    pub fn base_url(&self) -> &url::Url {
        &self.base_url
    }

    pub fn credentials(&self) -> Option<&Auth> {
        self.auth.as_ref()
    }

    pub fn transport(&self) -> &Arc<dyn Transport> {
        &self.transport
    }

    /// The URL of `path` (which starts with `/`) on this server, with `query` and no credentials. A path that resolves
    /// to another origin, such as `/https://elsewhere/`, is an error, so the server's credentials never leave it.
    pub fn url(&self, path: &str, query: &[(String, String)]) -> Result<url::Url, Error> {
        let mut url = crate::js::join_url(&self.base_url, path.trim_start_matches('/'))
            .map_err(|error| Error::Transport(format!("{path}: {error}")))?;
        let base = &self.base_url;
        if (url.scheme(), url.host(), url.port_or_known_default())
            != (base.scheme(), base.host(), base.port_or_known_default())
        {
            return Err(Error::Transport(format!("{path}: not on the server {}", base.origin().ascii_serialization())));
        }
        if !query.is_empty() {
            url.set_query(Some(&query::encode(query)));
        }
        Ok(url)
    }

    /// Builds the request for `call`, as `prepare` does in TypeScript.
    pub fn prepare(&self, call: Call) -> Result<Request, Error> {
        let mut query = call.query;
        if let Some(auth @ Auth::Query { .. }) = &self.auth {
            query.push((AUTH_TOKEN_QUERY.to_owned(), auth.token()));
        }
        let url = self.url(&call.path, &query)?;
        let mut headers = Vec::new();
        if let Some(auth @ Auth::Basic { .. }) = &self.auth {
            headers.push(("authorization".to_owned(), format!("Basic {}", auth.token())));
        }
        for (name, value) in self.headers.iter().chain(&call.headers) {
            set_header(&mut headers, name.clone(), value.clone());
        }
        let body = match call.body {
            None => None,
            Some(Body::Bytes(bytes)) => {
                default_header(&mut headers, "content-type", "application/octet-stream");
                Some(bytes)
            }
            Some(Body::Json(value)) => {
                default_header(&mut headers, "content-type", "application/json");
                Some(Bytes::from(serde_json::to_vec(&value).map_err(encode_error)?))
            }
        };
        Ok(Request { method: call.method, url, headers, body })
    }

    async fn execute(&self, call: Call) -> Result<Response, Error> {
        let success = call.success_status;
        let declared = call.declared_statuses;
        let request = self.prepare(call)?;
        let response = self.transport.send(request).await.map_err(Error::Transport)?;
        if response.status != success {
            return Err(response_error(response, declared).await);
        }
        Ok(response)
    }

    /// Sends `call` and decodes the JSON body as `T`. Public so a caller can read a response as
    /// `serde_json::Value`, as the TypeScript Promise client returns it, without the typed decode.
    pub async fn json<T: DeserializeOwned>(&self, call: Call) -> Result<T, Error> {
        let bytes = json_body(self.execute(call).await?).await?;
        // Reads the value only, so bytes after it are not checked.
        T::deserialize(&mut serde_json::Deserializer::from_slice(&bytes))
            .map_err(|error| Error::MalformedResponse(error.to_string()))
    }

    pub(crate) async fn data<T: DeserializeOwned>(&self, call: Call) -> Result<T, Error> {
        #[derive(serde::Deserialize)]
        struct Data<T> {
            data: T,
        }
        self.json::<Data<T>>(call).await.map(|value| value.data)
    }

    /// Sends `call` and accepts any 2xx status: the JSON body, or `null` without one. For a caller that does not know
    /// which status a call answers with, such as a plugin's fetch.
    pub async fn reply(&self, call: Call) -> Result<Value, Error> {
        let declared = call.declared_statuses;
        let request = self.prepare(call)?;
        let response = self.transport.send(request).await.map_err(Error::Transport)?;
        if !(200..300).contains(&response.status) {
            return Err(response_error(response, declared).await);
        }
        let bytes = response.bytes().await.map_err(Error::Transport)?;
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes).map_err(|error| Error::MalformedResponse(error.to_string()))
    }

    /// Sends `call` and expects no body. Public so a caller can send a body with its own key order.
    pub async fn empty(&self, call: Call) -> Result<(), Error> {
        self.execute(call).await.map(|_| ())
    }

    pub(crate) async fn binary(&self, call: Call) -> Result<Bytes, Error> {
        let response = self.execute(call).await?;
        response.bytes().await.map_err(Error::Transport)
    }

    pub(crate) async fn sse<T>(&self, call: Call) -> Result<SseResponse<T>, Error> {
        let response = self.execute(call).await?;
        if !is_content_type(&response, "text/event-stream") {
            return Err(Error::UnsupportedContentType(response.header("content-type").map(str::to_owned)));
        }
        Ok(SseResponse::new(response))
    }
}

/// One request a generated method describes.
#[derive(Debug)]
pub struct Call {
    pub method: &'static str,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Option<Body>,
    pub success_status: u16,
    pub declared_statuses: &'static [u16],
}

#[derive(Debug)]
pub enum Body {
    Json(Value),
    Bytes(Bytes),
}

impl Call {
    pub fn new(method: &'static str, path: String, success_status: u16, declared_statuses: &'static [u16]) -> Self {
        Self { method, path, query: Vec::new(), headers: Vec::new(), body: None, success_status, declared_statuses }
    }

    /// Adds a query value, bracket-encoded like `appendQuery`.
    pub fn query<T: Serialize + ?Sized>(&mut self, key: &str, value: &T) -> Result<(), Error> {
        query::append(&mut self.query, key, &serde_json::to_value(value).map_err(encode_error)?);
        Ok(())
    }

    /// Sets a header from an input field; `null` is skipped.
    pub fn header<T: Serialize + ?Sized>(&mut self, name: &str, value: &T) -> Result<(), Error> {
        let value = serde_json::to_value(value).map_err(encode_error)?;
        if !value.is_null() {
            set_header(&mut self.headers, name.to_owned(), query::js_string(&value));
        }
        Ok(())
    }

    /// Starts a JSON object body; [`Call::field`] fills it.
    pub fn object(&mut self) {
        self.body = Some(Body::Json(Value::Object(serde_json::Map::new())));
    }

    pub fn field<T: Serialize + ?Sized>(&mut self, key: &str, value: &T) -> Result<(), Error> {
        let value = serde_json::to_value(value).map_err(encode_error)?;
        if let Some(Body::Json(Value::Object(map))) = &mut self.body {
            map.insert(key.to_owned(), value);
        }
        Ok(())
    }

    /// Sets the whole JSON body, for payloads that are not flattened into fields.
    pub fn json<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.body = Some(Body::Json(serde_json::to_value(value).map_err(encode_error)?));
        Ok(())
    }

    pub fn bytes(&mut self, value: Bytes) {
        self.body = Some(Body::Bytes(value));
    }
}

/// A path parameter: `String(value)` encoded like `encodeURIComponent`.
pub fn path_param<T: Serialize + ?Sized>(value: &T) -> Result<String, Error> {
    let value = serde_json::to_value(value).map_err(encode_error)?;
    Ok(utf8_percent_encode(&query::js_string(&value), COMPONENT).to_string())
}

/// A trailing wildcard path, each segment encoded like `encodeURIComponent`.
pub fn path_wildcard(value: &str) -> String {
    value.split('/').map(|segment| utf8_percent_encode(segment, COMPONENT).to_string()).collect::<Vec<_>>().join("/")
}

/// The characters `encodeURIComponent` escapes: everything except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

fn set_header(headers: &mut Vec<(String, String)>, name: String, value: String) {
    let name = name.to_ascii_lowercase();
    headers.retain(|(key, _)| *key != name);
    headers.push((name, value));
}

fn default_header(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    if !headers.iter().any(|(key, _)| key == name) {
        headers.push((name.to_owned(), value.to_owned()));
    }
}

fn encode_error(error: serde_json::Error) -> Error {
    Error::Transport(format!("encode request: {error}"))
}

async fn response_error(response: Response, declared: &[u16]) -> Error {
    let status = response.status;
    if !declared.contains(&status) {
        return Error::UnexpectedStatus { status };
    }
    let body = match json_body(response).await {
        Ok(body) => body,
        Err(error) => return error,
    };
    match serde_json::from_slice(&body) {
        Ok(body) => Error::Declared(Box::new(DeclaredError::new(status, body))),
        Err(error) => Error::MalformedResponse(error.to_string()),
    }
}

/// The body of a JSON response: checks the content type and rejects an empty body, as `json` does in
/// TypeScript.
async fn json_body(response: Response) -> Result<Bytes, Error> {
    let content_type = response.header("content-type").map(str::to_owned);
    if !is_content_type(&response, "application/json")
        && !content_type.as_deref().is_some_and(|value| value.contains("+json"))
    {
        return Err(Error::UnsupportedContentType(content_type));
    }
    let bytes = response.bytes().await.map_err(Error::Transport)?;
    if bytes.is_empty() {
        return Err(Error::MalformedResponse("empty body".to_owned()));
    }
    Ok(bytes)
}

fn is_content_type(response: &Response, expected: &str) -> bool {
    response
        .header("content-type")
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(expected))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a path that resolves to another origin is refused before credentials are added, in both credential
    // modes, while a path on the server, its prefix kept, still prepares.
    #[test]
    fn a_request_stays_on_the_configured_origin() {
        let base = Client::new("https://server.invalid:4096/base").unwrap();
        let credentials = [
            Auth::Basic { username: "opencode".into(), password: "secret".into() },
            Auth::Query { username: "opencode".into(), password: "secret".into() },
        ];
        for auth in credentials {
            let client = base.clone().auth(auth);
            for path in [
                "/https://outside.invalid/x",
                "/http://server.invalid:4096/x",
                "/\\\\outside.invalid/x",
                "/ //outside.invalid/x",
            ] {
                let error = client.prepare(Call::new("GET", path.to_owned(), 200, &[])).unwrap_err();
                assert!(matches!(error, Error::Transport(_)), "{path}: {error:?}");
            }
            for (path, url) in [("/api/x", "/base/api/x"), ("//outside.invalid/x", "/base/outside.invalid/x")] {
                let request = client.prepare(Call::new("GET", path.to_owned(), 200, &[])).unwrap();
                assert_eq!(request.url.path(), url);
            }
        }
    }
}
