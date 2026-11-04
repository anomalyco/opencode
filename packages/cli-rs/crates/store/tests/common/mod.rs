//! A scripted transport and small async helpers for the store tests, standing in for the TS tests'
//! `fetch` overrides and `Promise.withResolvers`.

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use opencode_api::client::Client;
use opencode_api::generated::V2Event;
use opencode_api::transport::{Request, Response, Transport};
use opencode_store::{Data, Options};
use serde_json::Value;
use tokio::sync::watch;

/// One request, as a handler sees it.
#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub headers: Vec<(String, String)>,
    pub body: Option<Value>,
}

impl Req {
    pub fn param(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// The last path segment (the TS tests' `rpc`).
    pub fn rpc(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or_default()
    }

    pub fn id(&self) -> String {
        self.body
            .as_ref()
            .and_then(|body| body.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    }
}

#[derive(Debug, Clone)]
pub enum Reply {
    Json(u16, Value),
    Text(u16, String),
    /// The request fails before a response, as a failed `fetch` does.
    Fail(String),
}

pub fn ok(value: Value) -> Reply {
    Reply::Json(200, value)
}

pub type Handler = Arc<dyn Fn(Req) -> BoxFuture<'static, Reply> + Send + Sync>;

struct Fake {
    handler: Handler,
}

impl Transport for Fake {
    fn send(
        &self,
        request: Request,
    ) -> opencode_api::transport::BoxFuture<'_, Result<Response, String>> {
        let req = Req {
            method: request.method.to_owned(),
            path: request.url.path().to_owned(),
            query: request
                .url
                .query_pairs()
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect(),
            headers: request.headers.clone(),
            body: request
                .body
                .as_ref()
                .and_then(|body| serde_json::from_slice(body).ok()),
        };
        let reply = (self.handler)(req);
        Box::pin(async move {
            let (status, content_type, body) = match reply.await {
                Reply::Json(status, value) => (
                    status,
                    "application/json",
                    serde_json::to_vec(&value).unwrap(),
                ),
                Reply::Text(status, text) => (status, "text/plain", text.into_bytes()),
                Reply::Fail(message) => return Err(message),
            };
            Ok(Response {
                status,
                headers: vec![("content-type".to_owned(), content_type.to_owned())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(body))])),
            })
        })
    }
}

pub fn handler<F>(f: impl Fn(Req) -> F + Send + Sync + 'static) -> Handler
where
    F: std::future::Future<Output = Reply> + Send + 'static,
{
    Arc::new(move |req| f(req).boxed())
}

pub fn client(handler: Handler) -> Client {
    Client::with_transport("http://opencode.local", Arc::new(Fake { handler })).unwrap()
}

pub fn data(handler: Handler, options: Options) -> Data {
    let client = client(handler);
    let directory = match options.directory.as_str() {
        "" => "/project".to_owned(),
        directory => directory.to_owned(),
    };
    Data::new(
        client,
        Options {
            directory,
            ..options
        },
    )
}

pub fn event(value: Value) -> V2Event {
    serde_json::from_value(value).expect("event decodes")
}

/// Applies one event as its own batch.
pub fn emit(data: &Data, value: Value) {
    data.apply(&[event(value)]);
}

/// Yields to spawned tasks until `check` holds (2 s at most).
pub async fn wait(mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "timed out waiting for condition"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

/// Lets spawned tasks run for a while.
pub async fn settle() {
    tokio::time::sleep(Duration::from_millis(20)).await;
}

/// A value set once and awaited by any number of waiters (`Promise.withResolvers`).
#[derive(Clone)]
pub struct Slot<T: Clone> {
    sender: Arc<watch::Sender<Option<T>>>,
}

impl<T: Clone + Send + Sync + 'static> Default for Slot<T> {
    fn default() -> Self {
        Self {
            sender: Arc::new(watch::channel(None).0),
        }
    }
}

impl<T: Clone + Send + Sync + 'static> Slot<T> {
    pub fn resolve(&self, value: T) {
        self.sender.send_if_modified(|current| {
            if current.is_some() {
                return false;
            }
            *current = Some(value);
            true
        });
    }

    pub fn wait(&self) -> BoxFuture<'static, T> {
        let mut receiver = self.sender.subscribe();
        async move {
            let value = receiver.wait_for(Option::is_some).await.unwrap();
            value.clone().unwrap()
        }
        .boxed()
    }
}

/// A list shared between the test and its handler.
#[derive(Clone, Default)]
pub struct Log<T>(pub Arc<Mutex<Vec<T>>>);

impl<T: Clone> Log<T> {
    pub fn push(&self, value: T) {
        self.0.lock().unwrap().push(value);
    }

    pub fn get(&self) -> Vec<T> {
        self.0.lock().unwrap().clone()
    }

    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}
