//! A fake transport for the crate's tests: fixed replies per URL, and a record of the requests.

use std::collections::HashMap;
use std::sync::Mutex;

use bytes::Bytes;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};

#[derive(Clone)]
pub enum Reply {
    Status(u16, &'static str),
    Refused,
    Hang,
}

impl Reply {
    pub fn json(status: u16, body: &'static str) -> Self {
        Self::Status(status, body)
    }
}

#[derive(Default)]
pub struct Server {
    replies: Mutex<HashMap<String, Vec<Reply>>>,
    requests: Mutex<Vec<(String, Option<String>)>>,
}

impl Server {
    pub fn reply(self, url: &str, reply: Reply) -> Self {
        self.replies(url, [reply])
    }

    /// Replies to `url` in order; the last one repeats.
    pub fn replies(self, url: &str, replies: impl IntoIterator<Item = Reply>) -> Self {
        self.replies
            .lock()
            .unwrap()
            .insert(url.to_owned(), replies.into_iter().collect());
        self
    }

    /// URL and `authorization` header of each request, in order.
    pub fn requests(&self) -> Vec<(String, Option<String>)> {
        self.requests.lock().unwrap().clone()
    }
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let authorization = request
            .headers
            .iter()
            .find(|(name, _)| name == "authorization")
            .map(|(_, value)| value.clone());
        self.requests
            .lock()
            .unwrap()
            .push((request.url.to_string(), authorization));
        let reply = match self.replies.lock().unwrap().get_mut(request.url.as_str()) {
            Some(replies) if replies.len() > 1 => replies.remove(0),
            Some(replies) => replies[0].clone(),
            None => Reply::Refused,
        };
        Box::pin(async move {
            match reply {
                Reply::Refused => Err("connection refused".to_owned()),
                Reply::Hang => std::future::pending().await,
                Reply::Status(status, body) => Ok(Response {
                    status,
                    headers: vec![("content-type".to_owned(), "application/json".to_owned())],
                    body: Box::pin(futures_util::stream::iter([Ok(Bytes::from_static(
                        body.as_bytes(),
                    ))])),
                }),
            }
        })
    }
}
