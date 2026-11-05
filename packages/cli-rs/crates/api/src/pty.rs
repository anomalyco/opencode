//! Persistent PTY socket (E.13a, row A04): a port of `packages/client/src/solid/pty.ts`.
//!
//! The server sends JSON control messages as text and terminal output as binary messages. The client sends binary
//! interaction frames: a type byte (0 for a size-only frame that claims control, 1 for input), the columns and rows as
//! big-endian `u16`, then the input bytes. [`connect`] asks for a ticket over HTTP and opens the socket through a
//! [`Connector`], so tests can serve a fake socket.

use std::future::Future;
use std::pin::Pin;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use url::Url;

use crate::client::Client;
use crate::error::Error;
use crate::generated::{ExperimentalPersistentPtyConnectTokenInput, PtyID};
use crate::ws;

/// Messages a socket queue holds in each direction.
pub const QUEUE: usize = 256;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Controller,
    Observer,
}

/// The fields of each server message that clients read; the server may send more.
#[derive(Clone, Debug, PartialEq)]
pub enum Message {
    Attached {
        input_protocol: Option<f64>,
        size: Size,
        role: Option<Role>,
    },
    ReplayComplete,
    Resized {
        size: Size,
        /// Base64 of the screen at the new size.
        checkpoint: String,
    },
    /// `None` when the field is absent, `Some(None)` when it is `null`.
    ControllerChanged {
        attachment_id: Option<Option<String>>,
    },
    Exited {
        exit_code: Option<Option<f64>>,
    },
    TitleChanged {
        title: String,
    },
    ForegroundProcessChanged {
        process: Option<String>,
    },
}

/// Decodes a text message; `None` for malformed JSON, a missing or mistyped field, or an unknown type.
pub fn decode(text: &str) -> Option<Message> {
    let value: Value = serde_json::from_str(text).ok()?;
    let field = |name: &str| value.get(name);
    let optional = |name: &str| match field(name) {
        None => Some(None),
        Some(value) => Some(Some(value)),
    };
    let nullable_string = |value: &Value| match value {
        Value::Null => Some(None),
        Value::String(text) => Some(Some(text.clone())),
        _ => None,
    };
    let message = match field("type")?.as_str()? {
        "attached" => Message::Attached {
            input_protocol: match optional("inputProtocol")? {
                None => None,
                Some(number) => Some(number.as_f64()?),
            },
            size: size(field("info")?.get("size")?)?,
            role: match optional("role")? {
                None => None,
                Some(role) => Some(match role.as_str()? {
                    "controller" => Role::Controller,
                    "observer" => Role::Observer,
                    _ => return None,
                }),
            },
        },
        "replay_complete" => Message::ReplayComplete,
        "resized" => Message::Resized { size: size(&value)?, checkpoint: field("checkpoint")?.as_str()?.to_owned() },
        "controller_changed" => Message::ControllerChanged {
            attachment_id: match optional("attachmentID")? {
                None => None,
                Some(value) => Some(nullable_string(value)?),
            },
        },
        "exited" => Message::Exited {
            exit_code: match optional("exitCode")? {
                None => None,
                Some(Value::Null) => Some(None),
                Some(value) => Some(Some(value.as_f64()?)),
            },
        },
        "title_changed" => Message::TitleChanged { title: field("title")?.as_str()?.to_owned() },
        "foreground_process_changed" => {
            Message::ForegroundProcessChanged { process: nullable_string(field("process")?)? }
        }
        _ => return None,
    };
    Some(message)
}

/// `{cols, rows}` as JSON numbers. A size beyond `u16` saturates.
fn size(value: &Value) -> Option<Size> {
    let cell = |name: &str| value.get(name)?.as_f64().map(|number| number as u16);
    Some(Size { cols: cell("cols")?, rows: cell("rows")? })
}

/// An interaction frame: size only without `data`, an input frame with it (even when empty).
pub fn frame(size: Size, data: Option<&[u8]>) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + data.map_or(0, <[u8]>::len));
    frame.push(u8::from(data.is_some()));
    frame.extend(size.cols.to_be_bytes());
    frame.extend(size.rows.to_be_bytes());
    frame.extend(data.unwrap_or_default());
    frame
}

/// What a socket delivers. `Closed` and `Failed` end it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Incoming {
    Text(String),
    Binary(Vec<u8>),
    Closed,
    Failed(String),
}

/// An open socket as two bounded queues. Dropping `outgoing` closes it.
pub struct Socket {
    pub outgoing: mpsc::Sender<Vec<u8>>,
    pub incoming: mpsc::Receiver<Incoming>,
}

/// The far end of [`pair`], for fake servers in tests.
pub struct Remote {
    pub sent: mpsc::Receiver<Vec<u8>>,
    pub deliver: mpsc::Sender<Incoming>,
}

/// A connected socket and its far end, joined by queues.
pub fn pair() -> (Socket, Remote) {
    let (outgoing, sent) = mpsc::channel(QUEUE);
    let (deliver, incoming) = mpsc::channel(QUEUE);
    (Socket { outgoing, incoming }, Remote { sent, deliver })
}

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Opens sockets: [`Tungstenite`] on the network, a closure in tests.
pub trait Connector: Send + Sync {
    fn open(&self, url: Url) -> BoxFuture<Result<Socket, String>>;
}

impl<F> Connector for F
where
    F: Fn(Url) -> Result<Socket, String> + Send + Sync,
{
    fn open(&self, url: Url) -> BoxFuture<Result<Socket, String>> {
        let result = self(url);
        Box::pin(async move { result })
    }
}

/// Opens the socket with tokio-tungstenite; two tasks move messages between it and the queues.
pub struct Tungstenite;

impl Connector for Tungstenite {
    fn open(&self, url: Url) -> BoxFuture<Result<Socket, String>> {
        Box::pin(async move {
            let socket = ws::connect(&url, &[]).await.map_err(|error| error.to_string())?;
            let (mut sink, mut stream) = socket.split();
            let (socket, mut remote) = pair();
            let deliver = remote.deliver.clone();
            tokio::spawn(async move {
                while let Some(message) = stream.next().await {
                    let incoming = match message {
                        Ok(ws::Message::Text(text)) => Incoming::Text(text.as_str().to_owned()),
                        Ok(ws::Message::Binary(data)) => Incoming::Binary(data.to_vec()),
                        Ok(ws::Message::Close(_)) => break,
                        Ok(_) => continue,
                        Err(error) => {
                            let _ = deliver.send(Incoming::Failed(error.to_string())).await;
                            return;
                        }
                    };
                    if deliver.send(incoming).await.is_err() {
                        return;
                    }
                }
                let _ = deliver.send(Incoming::Closed).await;
            });
            tokio::spawn(async move {
                while let Some(frame) = remote.sent.recv().await {
                    if sink.send(ws::Message::binary(frame)).await.is_err() {
                        return;
                    }
                }
                let _ = sink.close().await;
            });
            Ok(socket)
        })
    }
}

/// `createPersistentPtyClient(...).connect`'s input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectInput {
    pub pty_id: PtyID,
    /// The output offset to replay from.
    pub cursor: i64,
    pub attachment_id: String,
    pub takeover: bool,
}

/// Asks for a connect ticket, then opens the socket. Returns the URL it opened, too.
pub async fn connect(client: &Client, connector: &dyn Connector, input: &ConnectInput) -> Result<(Url, Socket), Error> {
    let token = client
        .experimental_persistent_pty_connect_token(&ExperimentalPersistentPtyConnectTokenInput {
            pty_id: input.pty_id.clone(),
            x_opencode_ticket: Some("1".to_owned()),
        })
        .await?;
    let url = client.transport().route(url(client.base_url(), input, &token.ticket)?);
    let socket = connector.open(url.clone()).await.map_err(Error::Transport)?;
    Ok((url, socket))
}

/// The socket URL, with the query in the TypeScript client's order.
pub fn url(base: &Url, input: &ConnectInput, ticket: &str) -> Result<Url, Error> {
    let path = format!("api/experimental/persistent-pty/{}/connect", crate::client::path_param(&input.pty_id)?);
    let cursor = input.cursor.to_string();
    Ok(ws::ticket_url(
        base,
        &path,
        ticket,
        &[
            ("cursor", &cursor),
            ("attachment_id", &input.attachment_id),
            ("takeover", if input.takeover { "true" } else { "false" }),
            ("input_protocol", "1"),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn info() -> Value {
        json!({
            "id": "pty_1",
            "title": "zsh",
            "command": "/bin/zsh",
            "args": [],
            "cwd": "/repo",
            "status": "running",
            "pid": 42,
            "sessionID": "ses_1",
            "foregroundProcess": null,
            "size": { "cols": 80, "rows": 24 },
            "output": { "head": 0, "tail": 128 },
        })
    }

    fn decoded(value: Value) -> Option<Message> {
        decode(&value.to_string())
    }

    const SIZE: Size = Size { cols: 80, rows: 24 };

    #[test]
    fn decodes_every_message_the_server_sends_keeping_only_the_fields_clients_read() {
        let replay = json!({ "requestedOffset": 128, "availableOffset": 0, "endOffset": 256, "truncated": false });
        let messages = [
            json!({ "type": "attached", "inputProtocol": 1, "info": info(), "role": "controller", "generation": 3, "replay": replay }),
            json!({ "type": "replay_complete", "endOffset": 256 }),
            json!({ "type": "resized", "cols": 100, "rows": 30, "generation": 4, "checkpoint": "G2M=" }),
            json!({ "type": "controller_changed", "attachmentID": "attachment-1", "generation": 5 }),
            json!({ "type": "exited", "exitCode": 0, "finalOffset": 512 }),
            json!({ "type": "title_changed", "title": "vim" }),
            json!({ "type": "foreground_process_changed", "process": "vim" }),
            json!({ "type": "foreground_process_changed", "process": null }),
        ];
        assert_eq!(
            messages.into_iter().map(decoded).collect::<Vec<_>>(),
            [
                Message::Attached { input_protocol: Some(1.0), size: SIZE, role: Some(Role::Controller) },
                Message::ReplayComplete,
                Message::Resized { size: Size { cols: 100, rows: 30 }, checkpoint: "G2M=".into() },
                Message::ControllerChanged { attachment_id: Some(Some("attachment-1".into())) },
                Message::Exited { exit_code: Some(Some(0.0)) },
                Message::TitleChanged { title: "vim".into() },
                Message::ForegroundProcessChanged { process: Some("vim".into()) },
                Message::ForegroundProcessChanged { process: None },
            ]
            .map(Some)
        );
    }

    #[test]
    fn reads_only_the_size_from_attached_terminal_info_whatever_else_the_server_version_sends() {
        let attached =
            |terminal: Value| json!({ "type": "attached", "inputProtocol": 1, "info": terminal, "role": "controller" });
        let expected = Some(Message::Attached { input_protocol: Some(1.0), size: SIZE, role: Some(Role::Controller) });
        assert_eq!(decoded(attached(info())), expected);
        let mut extra = info();
        extra["userTitle"] = json!("build");
        extra["sessionID"] = json!("dummy");
        assert_eq!(decoded(attached(extra)), expected);
        assert_eq!(decoded(attached(json!({ "id": "pty_1" }))), None);
    }

    #[test]
    fn decodes_minimal_messages_and_the_fields_json_stringify_drops() {
        assert_eq!(
            decoded(json!({ "type": "attached", "info": { "size": { "cols": 80, "rows": 24 } } })),
            Some(Message::Attached { input_protocol: None, size: SIZE, role: None })
        );
        assert_eq!(decoded(json!({ "type": "replay_complete" })), Some(Message::ReplayComplete));
        assert_eq!(
            decoded(json!({ "type": "controller_changed", "generation": 5 })),
            Some(Message::ControllerChanged { attachment_id: None })
        );
        assert_eq!(
            decoded(json!({ "type": "controller_changed", "attachmentID": null })),
            Some(Message::ControllerChanged { attachment_id: Some(None) })
        );
        assert_eq!(decoded(json!({ "type": "exited", "finalOffset": 512 })), Some(Message::Exited { exit_code: None }));
        assert_eq!(
            decoded(json!({ "type": "exited", "exitCode": null })),
            Some(Message::Exited { exit_code: Some(None) })
        );
    }

    #[test]
    fn ignores_fields_it_does_not_know() {
        assert_eq!(
            decoded(json!({ "type": "title_changed", "title": "vim", "extra": true })),
            Some(Message::TitleChanged { title: "vim".into() })
        );
    }

    #[test]
    fn returns_none_for_unknown_message_types() {
        assert_eq!(decoded(json!({ "type": "future_message", "value": 1 })), None);
    }

    #[test]
    fn returns_none_for_malformed_input() {
        let inputs = [
            String::new(),
            "not json".into(),
            "null".into(),
            "42".into(),
            json!({ "endOffset": 1 }).to_string(),
            json!({ "type": "resized", "cols": "100", "rows": 30, "generation": 4, "checkpoint": "" }).to_string(),
            json!({ "type": "resized", "cols": 100, "rows": 30, "generation": 4 }).to_string(),
            json!({ "type": "attached", "inputProtocol": 1, "role": "controller", "generation": 1 }).to_string(),
            json!({ "type": "foreground_process_changed" }).to_string(),
        ];
        for input in inputs {
            assert_eq!(decode(&input), None, "{input}");
        }
    }

    #[test]
    fn encodes_a_size_only_interaction_frame() {
        assert_eq!(frame(Size { cols: 300, rows: 24 }, None), [0, 1, 44, 0, 24]);
    }

    #[test]
    fn encodes_an_input_frame_with_its_data() {
        assert_eq!(frame(Size { cols: 80, rows: 513 }, Some(&[104, 105])), [1, 0, 80, 2, 1, 104, 105]);
    }

    #[test]
    fn encodes_empty_input_as_an_input_frame() {
        assert_eq!(frame(SIZE, Some(&[])), [1, 0, 80, 0, 24]);
    }

    #[test]
    fn the_socket_url_matches_the_typescript_client() {
        let input =
            ConnectInput { pty_id: PtyID("pty_1/x".into()), cursor: 128, attachment_id: "att".into(), takeover: true };
        let base = Url::parse("https://host/prefix").unwrap();
        assert_eq!(
            url(&base, &input, "tk").unwrap().as_str(),
            "wss://host/prefix/api/experimental/persistent-pty/pty_1%2Fx/connect?ticket=tk&cursor=128&attachment_id=att&takeover=true&input_protocol=1"
        );
    }

    #[tokio::test]
    async fn connect_asks_for_a_ticket_then_opens_the_socket() {
        use crate::memory::{Memory, Route};
        use std::sync::{Arc, Mutex};
        let memory = Memory::new(vec![Route::json(
            "POST",
            "/api/experimental/persistent-pty/pty_1/connect-token",
            200,
            &json!({ "data": { "ticket": "tk", "expires_in": 30 } }),
        )]);
        let client = Client::with_transport("http://opencode.local", Arc::new(memory.clone())).unwrap();
        let opened = Arc::new(Mutex::new(None));
        let remote = Arc::new(Mutex::new(None));
        let connector = {
            let opened = opened.clone();
            let remote = remote.clone();
            move |url: Url| {
                *opened.lock().unwrap() = Some(url);
                let (socket, far) = pair();
                *remote.lock().unwrap() = Some(far);
                Ok(socket)
            }
        };
        let input =
            ConnectInput { pty_id: PtyID("pty_1".into()), cursor: 0, attachment_id: "att".into(), takeover: false };
        let (url, socket) = connect(&client, &connector, &input).await.unwrap();
        assert_eq!(
            url.as_str(),
            "ws://opencode.local/api/experimental/persistent-pty/pty_1/connect?ticket=tk&cursor=0&attachment_id=att&takeover=false&input_protocol=1"
        );
        assert_eq!(opened.lock().unwrap().as_ref(), Some(&url));
        let request = &memory.requests()[0];
        assert_eq!(
            (request.method.as_str(), request.path.as_str()),
            ("POST", "/api/experimental/persistent-pty/pty_1/connect-token")
        );
        socket.outgoing.send(frame(SIZE, None)).await.unwrap();
        let mut far = remote.lock().unwrap().take().unwrap();
        assert_eq!(far.sent.recv().await, Some(vec![0, 0, 80, 0, 24]));
    }

    #[tokio::test]
    async fn tungstenite_moves_text_binary_and_close_through_the_queues() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            socket.send(ws::Message::text(r#"{"type":"replay_complete"}"#)).await.unwrap();
            socket.send(ws::Message::binary(vec![104, 105])).await.unwrap();
            let received = socket.next().await.unwrap().unwrap();
            socket.close(None).await.unwrap();
            received
        });
        let url = Url::parse(&format!("ws://{address}/connect")).unwrap();
        let mut socket = Tungstenite.open(url).await.unwrap();
        assert_eq!(socket.incoming.recv().await, Some(Incoming::Text(r#"{"type":"replay_complete"}"#.into())));
        assert_eq!(socket.incoming.recv().await, Some(Incoming::Binary(vec![104, 105])));
        socket.outgoing.send(vec![1, 0, 80, 0, 24, 120]).await.unwrap();
        assert_eq!(server.await.unwrap(), ws::Message::binary(vec![1, 0, 80, 0, 24, 120]));
        assert_eq!(socket.incoming.recv().await, Some(Incoming::Closed));
    }
}
