//! WebSocket helper with tickets (F.3).
//!
//! Builds socket URLs the way the TypeScript clients do (`packages/client/src/solid/pty.ts:69-77`,
//! `packages/client/src/mcp.ts:166-174`) and opens them with tokio-tungstenite. A ticket socket, such as
//! the persistent PTY, authenticates with a `ticket` query parameter that the caller first requests over
//! HTTP with `x-opencode-ticket: 1`; other sockets send the `authorization` header in the handshake.

use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

pub use tokio_tungstenite::tungstenite::{Error, Message};

pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The socket URL for `path` (relative, without a leading slash) under `base`: a path prefix and the
/// query on `base` are kept, `query` pairs are set in order, and `http`/`https` become `ws`/`wss`.
pub fn url(base: &Url, path: &str, query: &[(&str, &str)]) -> Url {
    let mut base = base.clone();
    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());
        base.set_path(&path);
    }
    let mut url = base.join(path).unwrap_or_else(|_| base.clone());
    // `URLSearchParams.set`: replace the first pair with the key in place and drop the others, or append.
    let mut pairs = base
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
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
    let scheme = if matches!(url.scheme(), "https" | "wss") {
        "wss"
    } else {
        "ws"
    };
    // Switching between the special schemes http(s) and ws(s) always succeeds.
    let _ = url.set_scheme(scheme);
    url
}

/// The URL of a ticket socket: `url` with `ticket` set first, as the PTY client does.
pub fn ticket_url(base: &Url, path: &str, ticket: &str, query: &[(&str, &str)]) -> Url {
    let pairs = std::iter::once(("ticket", ticket))
        .chain(query.iter().copied())
        .collect::<Vec<_>>();
    url(base, path, &pairs)
}

/// Opens a socket, sending `headers` (for example `authorization`) in the handshake.
pub async fn connect(url: &Url, headers: &[(String, String)]) -> Result<Socket, Error> {
    let mut request = url.as_str().into_client_request()?;
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| Error::HttpFormat(error.into()))?;
        let value =
            HeaderValue::from_str(value).map_err(|error| Error::HttpFormat(error.into()))?;
        request.headers_mut().insert(name, value);
    }
    let (socket, _) = tokio_tungstenite::connect_async(request).await?;
    Ok(socket)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};

    fn base(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn a_pty_ticket_url_matches_the_typescript_client() {
        let url = ticket_url(
            &base("http://127.0.0.1:4096/prefix"),
            "api/experimental/persistent-pty/pty_1%2Fx/connect",
            "tk",
            &[
                ("cursor", "0"),
                ("attachment_id", "att"),
                ("takeover", "false"),
                ("input_protocol", "1"),
            ],
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
        assert_eq!(
            super::url(&base("http://host"), "a", &[]).as_str(),
            "ws://host/a"
        );
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
            let callback = |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                            response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                seen = request.headers().get("authorization").map(|value| value.to_str().unwrap().to_owned());
                Ok(response)
            };
            let mut socket = tokio_tungstenite::accept_hdr_async(stream, callback)
                .await
                .unwrap();
            socket.send(Message::text("hello")).await.unwrap();
            seen
        });
        let url = url(&base(&format!("http://{address}")), "socket", &[]);
        let mut socket = connect(
            &url,
            &[("authorization".into(), "Basic b3BlbmNvZGU6cHc=".into())],
        )
        .await
        .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap(),
            Message::text("hello")
        );
        assert_eq!(
            server.await.unwrap().as_deref(),
            Some("Basic b3BlbmNvZGU6cHc=")
        );
    }
}
