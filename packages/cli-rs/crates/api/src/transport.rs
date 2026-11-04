//! The transport trait and its `reqwest` implementation.

use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;

use bytes::Bytes;
use futures_util::{Stream, StreamExt};

/// A future a transport returns.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A response body as a stream of chunks.
pub type BodyStream = Pin<Box<dyn Stream<Item = Result<Bytes, String>> + Send>>;

/// One HTTP request, fully prepared by the client.
#[derive(Debug, Clone)]
pub struct Request {
    pub method: &'static str,
    pub url: url::Url,
    /// Header names are lowercase; each name appears once.
    pub headers: Vec<(String, String)>,
    pub body: Option<Bytes>,
}

/// One HTTP response. The body is read lazily, so server-sent events can stream.
pub struct Response {
    pub status: u16,
    /// Header names are lowercase.
    pub headers: Vec<(String, String)>,
    pub body: BodyStream,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// Reads the whole body.
    pub async fn bytes(mut self) -> Result<Bytes, String> {
        let mut buffer = Vec::new();
        while let Some(chunk) = self.body.next().await {
            buffer.extend_from_slice(&chunk?);
        }
        Ok(Bytes::from(buffer))
    }
}

impl std::fmt::Debug for Response {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Response")
            .field("status", &self.status)
            .field("headers", &self.headers)
            .finish_non_exhaustive()
    }
}

/// Sends requests. The `reqwest` implementation talks to a server; tests and P-APP use in-memory ones.
pub trait Transport: Send + Sync {
    /// Sends `request`. An error is a transport failure (no response), described as text.
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>>;
}

/// The checked response of a server-sent events endpoint: status and content type are verified, and
/// the body has not been read. F.3 parses it into events of type `T`.
pub struct SseResponse<T> {
    pub response: Response,
    event: PhantomData<fn() -> T>,
}

impl<T> SseResponse<T> {
    pub fn new(response: Response) -> Self {
        Self {
            response,
            event: PhantomData,
        }
    }
}

impl<T> std::fmt::Debug for SseResponse<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("SseResponse").field(&self.response).finish()
    }
}

/// The `reqwest` transport, with rustls.
#[derive(Debug, Clone, Default)]
pub struct Reqwest {
    client: reqwest::Client,
}

impl Reqwest {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

impl Transport for Reqwest {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        Box::pin(async move {
            let method = reqwest::Method::from_bytes(request.method.as_bytes())
                .map_err(|error| error.to_string())?;
            let mut builder = self.client.request(method, request.url);
            for (name, value) in &request.headers {
                builder = builder.header(name, value);
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let response = builder.send().await.map_err(|error| error.to_string())?;
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned()))
                })
                .collect();
            Ok(Response {
                status: response.status().as_u16(),
                headers,
                body: Box::pin(
                    response
                        .bytes_stream()
                        .map(|chunk| chunk.map_err(|error| error.to_string())),
                ),
            })
        })
    }
}
