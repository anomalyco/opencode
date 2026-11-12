//! WebSocket helper with tickets (F.3).
//!
//! Builds socket URLs the way the TypeScript clients do (`packages/client/src/solid/pty.ts:69-77`,
//! `packages/client/src/mcp.ts:166-174`) and opens them with tokio-tungstenite. A ticket socket, such as
//! the persistent PTY, authenticates with a `ticket` query parameter that the caller first requests over
//! HTTP with `x-opencode-ticket: 1`; other sockets send the `authorization` header in the handshake.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

pub use tokio_tungstenite::tungstenite::{Error, Message};

pub type Stream = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Messages a socket queue holds in each direction.
pub const QUEUE: usize = 256;

/// What a socket delivers. `Closed` and `Failed` end it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Incoming {
    Text(String),
    Binary(Vec<u8>),
    Closed,
    Failed(String),
}

/// An open socket as two bounded queues: frames out, [`Incoming`] in. Dropping `outgoing` closes it.
pub struct Socket<T> {
    pub outgoing: mpsc::Sender<T>,
    pub incoming: mpsc::Receiver<Incoming>,
}

/// The far end of [`pair`], for fake servers in tests.
pub struct Remote<T> {
    pub sent: mpsc::Receiver<T>,
    pub deliver: mpsc::Sender<Incoming>,
}

/// A connected socket and its far end, joined by queues.
pub fn pair<T>() -> (Socket<T>, Remote<T>) {
    let (outgoing, sent) = mpsc::channel(QUEUE);
    let (deliver, incoming) = mpsc::channel(QUEUE);
    (Socket { outgoing, incoming }, Remote { sent, deliver })
}

/// A frame a [`Socket`] sends: binary for the PTY, text for client MCP.
pub trait Frame: Send + 'static {
    fn message(self) -> Message;

    /// The close frame sent once `outgoing` drops; `None` closes without one of its own.
    fn close() -> Option<CloseFrame> {
        None
    }
}

impl Frame for Vec<u8> {
    fn message(self) -> Message {
        Message::binary(self)
    }
}

impl Frame for String {
    fn message(self) -> Message {
        Message::text(self)
    }

    fn close() -> Option<CloseFrame> {
        Some(CloseFrame { code: CloseCode::Normal, reason: "".into() })
    }
}

/// Opens sockets with tokio-tungstenite: [`open`] behind the PTY's and client MCP's connectors.
pub struct Tungstenite;

/// Opens the socket; two tasks move frames between it and the queues.
pub async fn open<T: Frame>(url: Url, headers: Vec<(String, String)>) -> Result<Socket<T>, String> {
    let socket = connect(&url, &headers).await.map_err(|error| error.to_string())?;
    let (mut sink, mut stream) = socket.split();
    let (socket, remote) = pair::<T>();
    let (mut sent, deliver) = (remote.sent, remote.deliver);
    let (written, writer) = oneshot::channel::<()>();
    let reader = async move {
        while let Some(message) = stream.next().await {
            let incoming = match message {
                Ok(Message::Text(text)) => Incoming::Text(text.as_str().to_owned()),
                Ok(Message::Binary(data)) => Incoming::Binary(data.to_vec()),
                Ok(Message::Close(_)) => break,
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
    };
    tokio::spawn(read_until_closed(reader, writer));
    tokio::spawn(async move {
        let _written = written;
        while let Some(frame) = sent.recv().await {
            if sink.send(frame.message()).await.is_err() {
                return;
            }
        }
        let closing = async {
            if let Some(close) = T::close() {
                let _ = sink.send(Message::Close(Some(close))).await;
            }
            let _ = sink.close().await;
        };
        let _ = tokio::time::timeout(CLOSE_GRACE, closing).await;
    });
    Ok(socket)
}

/// The socket URL for `path` (relative, without a leading slash) under `base`: a path prefix and the
/// query on `base` are kept, `query` pairs are set in order, and `http`/`https` become `ws`/`wss`.
pub fn url(base: &Url, path: &str, query: &[(&str, &str)]) -> Url {
    let mut base = base.clone();
    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());
        base.set_path(&path);
    }
    let mut url = crate::js::join_url(&base, path).unwrap_or_else(|_| base.clone());
    // `URLSearchParams.set`: replace the first pair with the key in place and drop the others, or append.
    let mut pairs = base.query_pairs().map(|(key, value)| (key.into_owned(), value.into_owned())).collect::<Vec<_>>();
    for (key, value) in query {
        match pairs.iter().position(|pair| pair.0 == *key) {
            Some(index) => {
                pairs[index].1 = (*value).to_owned();
                let mut seen = 0;
                pairs.retain(|pair| {
                    seen += usize::from(pair.0 == *key);
                    pair.0 != *key || seen == 1
                });
            }
            None => pairs.push(((*key).to_owned(), (*value).to_owned())),
        }
    }
    url.set_query(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    let scheme = if matches!(url.scheme(), "https" | "wss") { "wss" } else { "ws" };
    // Switching between the special schemes http(s) and ws(s) always succeeds.
    let _ = url.set_scheme(scheme);
    url
}

/// The URL of a ticket socket: `url` with `ticket` set first, as the PTY client does.
pub fn ticket_url(base: &Url, path: &str, ticket: &str, query: &[(&str, &str)]) -> Url {
    let pairs = std::iter::once(("ticket", ticket)).chain(query.iter().copied()).collect::<Vec<_>>();
    url(base, path, &pairs)
}

/// Opens a socket, sending `headers` (for example `authorization`) in the handshake.
pub async fn connect(url: &Url, headers: &[(String, String)]) -> Result<Stream, Error> {
    let mut request = url.as_str().into_client_request()?;
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| Error::HttpFormat(error.into()))?;
        let value = HeaderValue::from_str(value).map_err(|error| Error::HttpFormat(error.into()))?;
        request.headers_mut().insert(name, value);
    }
    let connector = tokio_tungstenite::Connector::Rustls(crate::transport::tls_config());
    let (socket, _) = tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(connector)).await?;
    Ok(socket)
}

/// How long a closing socket waits for the peer to answer its close frame.
pub const CLOSE_GRACE: Duration = Duration::from_secs(1);

/// Runs `reader` until it ends, or until `writer` ends (its sender dropped after the close frame went out,
/// at most [`CLOSE_GRACE`] later) and the peer had [`CLOSE_GRACE`] to answer. The split halves share one
/// stream, so a reader parked on a silent peer would otherwise keep the TCP stream open for good.
pub async fn read_until_closed(reader: impl Future<Output = ()>, writer: oneshot::Receiver<()>) {
    let closed = async {
        let _ = writer.await;
        tokio::time::sleep(CLOSE_GRACE).await;
    };
    tokio::select! {
        () = reader => {}
        () = closed => {}
    }
}

/// A server that accepts one socket and then never reads it, so it never answers a close frame. The
/// task ends once the client closes the TCP stream.
#[cfg(test)]
pub(crate) async fn silent_peer() -> (Url, tokio::task::JoinHandle<()>) {
    use tokio::io::AsyncReadExt;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        let mut buffer = [0_u8; 256];
        let eof = async { while socket.get_mut().read(&mut buffer).await.unwrap_or(0) > 0 {} };
        tokio::time::timeout(std::time::Duration::from_secs(10), eof).await.expect("the client kept the stream open");
    });
    (crate::js::parse_url(&format!("ws://{address}/socket")).unwrap(), server)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};

    fn base(text: &str) -> Url {
        crate::js::parse_url(text).unwrap()
    }

    #[test]
    fn a_pty_ticket_url_matches_the_typescript_client() {
        let url = ticket_url(
            &base("http://127.0.0.1:4096/prefix"),
            "api/experimental/persistent-pty/pty_1%2Fx/connect",
            "tk",
            &[("cursor", "0"), ("attachment_id", "att"), ("takeover", "false"), ("input_protocol", "1")],
        );
        assert_eq!(
            url.as_str(),
            "ws://127.0.0.1:4096/prefix/api/experimental/persistent-pty/pty_1%2Fx/connect?ticket=tk&cursor=0&attachment_id=att&takeover=false&input_protocol=1"
        );
    }

    #[test]
    fn a_client_mcp_url_keeps_the_base_query_and_uses_wss_for_https() {
        let url = url(
            &base("https://host/?token=a"),
            "api/experimental/client-mcp",
            &[("location[directory]", "/tmp/x"), ("name", "tui")],
        );
        assert_eq!(
            url.as_str(),
            "wss://host/api/experimental/client-mcp?token=a&location%5Bdirectory%5D=%2Ftmp%2Fx&name=tui"
        );
        assert_eq!(super::url(&base("http://host"), "a", &[]).as_str(), "ws://host/a");
    }

    #[tokio::test]
    async fn connect_sends_handshake_headers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut seen = None;
            // The callback's error type is tungstenite's.
            #[allow(clippy::result_large_err)]
            let callback =
                |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                 response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    seen = request.headers().get("authorization").map(|value| value.to_str().unwrap().to_owned());
                    Ok(response)
                };
            let mut socket = tokio_tungstenite::accept_hdr_async(stream, callback).await.unwrap();
            socket.send(Message::text("hello")).await.unwrap();
            seen
        });
        let url = url(&base(&format!("http://{address}")), "socket", &[]);
        let mut socket = connect(&url, &[("authorization".into(), "Basic b3BlbmNvZGU6cHc=".into())]).await.unwrap();
        assert_eq!(socket.next().await.unwrap().unwrap(), Message::text("hello"));
        assert_eq!(server.await.unwrap().as_deref(), Some("Basic b3BlbmNvZGU6cHc="));
    }
}
