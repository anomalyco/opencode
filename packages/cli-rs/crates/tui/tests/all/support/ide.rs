//! A fake IDE MCP server for the editor context tests (E.5), shared by `editor.rs` and the P-APP runner.
// Each test binary uses part of it.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

/// A WebSocket server on a loopback port: it answers `initialize`, records what the client sends and the
/// handshake's authorization header, and pushes notifications to every client.
pub struct Ide {
    pub port: u16,
    pub received: Arc<Mutex<Vec<Value>>>,
    pub authorization: Arc<Mutex<Vec<Option<String>>>>,
    outgoing: tokio::sync::broadcast::Sender<String>,
    _runtime: tokio::runtime::Runtime,
}

impl Ide {
    pub fn start() -> Self {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let listener = runtime
            .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let received = Arc::new(Mutex::new(Vec::new()));
        let authorization = Arc::new(Mutex::new(Vec::new()));
        let (outgoing, _) = tokio::sync::broadcast::channel(16);
        let (log, auth, sender) = (received.clone(), authorization.clone(), outgoing.clone());
        runtime.spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let auth = auth.clone();
                // tungstenite's handshake callback returns its error response by value.
                #[allow(clippy::result_large_err)]
                let header = move |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                                   response| {
                    auth.lock().unwrap().push(
                        request
                            .headers()
                            .get("x-claude-code-ide-authorization")
                            .and_then(|value| value.to_str().ok())
                            .map(str::to_owned),
                    );
                    Ok(response)
                };
                let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, header).await else {
                    continue;
                };
                let (mut write, mut read) = socket.split();
                let (log, mut notifications) = (log.clone(), sender.subscribe());
                let (reply, mut replies) = tokio::sync::mpsc::unbounded_channel::<String>();
                tokio::spawn(async move {
                    loop {
                        let text = tokio::select! {
                            Ok(text) = notifications.recv() => text,
                            Some(text) = replies.recv() => text,
                            else => return,
                        };
                        if write.send(Message::text(text)).await.is_err() {
                            return;
                        }
                    }
                });
                tokio::spawn(async move {
                    while let Some(Ok(Message::Text(text))) = read.next().await {
                        let message: Value = serde_json::from_str(&text).unwrap_or_default();
                        if message["method"] == "initialize" {
                            let _ = reply.send(
                                json!({
                                    "jsonrpc": "2.0", "id": message["id"],
                                    "result": { "protocolVersion": "2025-11-25", "serverInfo": { "name": "fake-ide", "version": "1" } },
                                })
                                .to_string(),
                            );
                        }
                        log.lock().unwrap().push(message);
                    }
                });
            }
        });
        Self {
            port,
            received,
            authorization,
            outgoing,
            _runtime: runtime,
        }
    }

    pub fn methods(&self) -> Vec<String> {
        self.received
            .lock()
            .unwrap()
            .iter()
            .map(|message| message["method"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    /// Whether a client finished the MCP handshake.
    pub fn initialized(&self) -> bool {
        self.methods()
            .iter()
            .any(|method| method == "notifications/initialized")
    }

    /// Sends `{"jsonrpc": "2.0", ...message}` to every client.
    pub fn send(&self, message: &Value) {
        let mut message = message.clone();
        if let Some(object) = message.as_object_mut() {
            object.shift_insert(0, "jsonrpc".to_owned(), json!("2.0"));
        }
        let _ = self.outgoing.send(message.to_string());
    }

    pub fn notify(&self, method: &str, params: Value) {
        self.send(&json!({ "method": method, "params": params }));
    }
}
