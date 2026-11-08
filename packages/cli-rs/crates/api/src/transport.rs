//! The transport trait and its `reqwest` implementation.

use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::{Arc, LazyLock, OnceLock};

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::de::DeserializeOwned;

use crate::client::Auth;
use crate::error::Error;
use crate::generated::{SessionReasoningDelta, SessionTextDelta, V2Event};

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
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
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
        f.debug_struct("Response").field("status", &self.status).field("headers", &self.headers).finish_non_exhaustive()
    }
}

/// Sends requests. The `reqwest` implementation talks to a server; tests and P-APP use in-memory ones.
pub trait Transport: Send + Sync {
    /// Sends `request`. An error is a transport failure (no response), described as text.
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>>;

    /// Where a request to `url` would go now. A transport that follows a restarted service maps it to the
    /// service's current address; sockets opened beside the transport use this.
    fn route(&self, url: url::Url) -> url::Url {
        url
    }

    /// Where a socket to `url` that authenticates with `auth` would go now, and the credentials it would use. A
    /// transport that follows a restarted service answers with the service's current address and password.
    fn endpoint(&self, url: url::Url, auth: Option<&Auth>) -> (url::Url, Option<Auth>) {
        (self.route(url), auth.cloned())
    }

    /// Finds the server again after the event stream disconnected (the TS `service.reconnect`). Returns true when
    /// a server was resolved. The connection loop runs this between stream attempts, outside the connect timeout,
    /// so a managed service has time to start a replacement.
    fn reconnect(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { false })
    }
}

/// The checked response of a server-sent events endpoint: status and content type are verified, and
/// the body has not been read. F.3 parses it into events of type `T`.
pub struct SseResponse<T> {
    pub response: Response,
    event: PhantomData<fn() -> T>,
}

impl<T> SseResponse<T> {
    pub fn new(response: Response) -> Self {
        Self { response, event: PhantomData }
    }
}

impl<T: DeserializeOwned + Send> SseResponse<T> {
    /// The events, decoded by [`crate::sse::events`]. `activity` runs for every received chunk,
    /// keepalive comments included. The stream ends after the first error.
    pub fn events(self, activity: impl FnMut() + Send + 'static) -> impl Stream<Item = Result<T, Error>> + Send {
        crate::sse::events(self.response.body, activity).map(|item| item.map_err(Error::from))
    }
}

/// Lets F.3's connection loop and shared subscription carry the generated event type.
impl crate::events::Event for V2Event {
    fn kind(&self) -> &str {
        self.tag()
    }

    /// Joins adjacent deltas of one text or reasoning part (same session, message, and ordinal) or of
    /// one tool input (same session, message, and tool call). The store only appends deltas, so the
    /// joined event applies exactly as the two did.
    fn merge(&mut self, next: &Self) -> bool {
        match (self, next) {
            (
                Self::SessionTextDelta(SessionTextDelta { data: a, .. }),
                Self::SessionTextDelta(SessionTextDelta { data: b, .. }),
            )
            | (
                Self::SessionReasoningDelta(SessionReasoningDelta { data: a, .. }),
                Self::SessionReasoningDelta(SessionReasoningDelta { data: b, .. }),
            ) if a.session_id == b.session_id
                && a.assistant_message_id == b.assistant_message_id
                && a.ordinal == b.ordinal =>
            {
                a.delta.push_str(&b.delta);
                true
            }
            (Self::SessionToolInputDelta(a), Self::SessionToolInputDelta(b))
                if a.data.session_id == b.data.session_id
                    && a.data.assistant_message_id == b.data.assistant_message_id
                    && a.data.id == b.data.id =>
            {
                a.data.delta.push_str(&b.data.delta);
                true
            }
            _ => false,
        }
    }
}

impl<T> std::fmt::Debug for SseResponse<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("SseResponse").field(&self.response).finish()
    }
}

/// The `reqwest` transport, with rustls. The default one uses [`http_client`].
#[derive(Debug, Clone)]
pub struct Reqwest {
    client: reqwest::Client,
}

impl Reqwest {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

impl Default for Reqwest {
    fn default() -> Self {
        Self::new(http_client())
    }
}

/// The process's HTTP client, built once, so its connections are pooled across transports.
pub fn http_client() -> reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> =
        LazyLock::new(|| client_builder().build().expect("a client on a preconfigured TLS backend builds"));
    CLIENT.clone()
}

/// A `reqwest` client builder on [`tls_config`]. `reqwest` has no crypto provider of its own here, so every client
/// is built from this. It does not follow redirects: `reqwest` would parse `Location` past `js::join_url`, so
/// send requests with [`fetch`]. This and [`fetch`] are the only functions allowed to build clients and send
/// requests on them (see `clippy.toml`).
#[allow(clippy::disallowed_methods)]
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .tls_backend_preconfigured(rustls::ClientConfig::clone(&tls_config()))
        .redirect(reqwest::redirect::Policy::none())
}

/// The redirects Bun's `fetch` follows before it fails with `TooManyRedirects` (the spec says 20).
const MAX_REDIRECTS: usize = 126;

/// Why [`fetch`] has no response.
#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error("TooManyRedirects: The response redirected too many times")]
    TooManyRedirects,
    #[error("UnsupportedRedirectProtocol: {0}")]
    UnsupportedRedirectProtocol(url::Url),
    #[error(transparent)]
    Location(#[from] crate::js::UrlError),
    #[error("a streamed request body cannot follow a redirect")]
    StreamedBody,
}

/// Sends `request` and follows redirects as Bun's `fetch` does: `Location` resolves through `js::join_url`; 301
/// and 302 turn a POST into a GET, and 303 turns anything but HEAD into a GET, without the body; 307 and 308 keep
/// the method and body; a change of origin drops the credentials; a target that is not HTTP(S) is an error.
#[allow(clippy::disallowed_methods)]
pub async fn fetch(request: reqwest::RequestBuilder) -> Result<reqwest::Response, FetchError> {
    let (client, request) = request.build_split();
    let mut request = request?;
    let mut redirects = 0;
    loop {
        let next = request.try_clone();
        let response = client.execute(request).await?;
        let status = response.status().as_u16();
        let Some(location) =
            response.headers().get(reqwest::header::LOCATION).filter(|_| matches!(status, 301 | 302 | 303 | 307 | 308))
        else {
            return Ok(response);
        };
        redirects += 1;
        if redirects > MAX_REDIRECTS {
            return Err(FetchError::TooManyRedirects);
        }
        let mut next = next.ok_or(FetchError::StreamedBody)?;
        let mut url = crate::js::join_url(next.url(), &String::from_utf8_lossy(location.as_bytes()))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(FetchError::UnsupportedRedirectProtocol(url));
        }
        // Bun sends no credentials from the `Location` userinfo.
        let _ = url.set_username("");
        let _ = url.set_password(None);
        if url.origin() != next.url().origin() {
            for name in ["authorization", "cookie", "proxy-authorization"] {
                next.headers_mut().remove(name);
            }
        }
        let method = next.method();
        if (matches!(status, 301 | 302) && method == reqwest::Method::POST)
            || (status == 303 && method != reqwest::Method::GET && method != reqwest::Method::HEAD)
        {
            for name in ["content-encoding", "content-language", "content-length", "content-location", "content-type"] {
                next.headers_mut().remove(name);
            }
            *next.method_mut() = reqwest::Method::GET;
            *next.body_mut() = None;
        }
        *next.url_mut() = url;
        request = next;
    }
}

/// The TLS configuration of every HTTPS request and `wss://` socket: rustls on ring, HTTP/1.1, and the platform's
/// root store. The roots load on the first certificate check, so a plain `http://` server never reads them.
pub fn tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: LazyLock<Arc<rustls::ClientConfig>> = LazyLock::new(|| {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut config = rustls::ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .expect("ring supports the default TLS versions")
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PlatformVerifier { provider, verifier: OnceLock::new() }))
            .with_no_client_auth();
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Arc::new(config)
    });
    CONFIG.clone()
}

/// `rustls_platform_verifier::Verifier`, created on the first certificate check.
#[derive(Debug)]
struct PlatformVerifier {
    provider: Arc<rustls::crypto::CryptoProvider>,
    verifier: OnceLock<Result<rustls_platform_verifier::Verifier, rustls::Error>>,
}

impl PlatformVerifier {
    fn get(&self) -> Result<&rustls_platform_verifier::Verifier, rustls::Error> {
        self.verifier
            .get_or_init(|| rustls_platform_verifier::Verifier::new(self.provider.clone()))
            .as_ref()
            .map_err(Clone::clone)
    }
}

impl ServerCertVerifier for PlatformVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        self.get()?.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.get()?.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.get()?.verify_tls13_signature(message, cert, dss)
    }

    /// What the platform verifier answers, without loading the roots for the client hello.
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

impl Transport for Reqwest {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        Box::pin(async move {
            let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|error| error.to_string())?;
            let mut builder = self.client.request(method, request.url);
            for (name, value) in &request.headers {
                builder = builder.header(name, value);
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let response = fetch(builder).await.map_err(|error| error.to_string())?;
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned())))
                .collect();
            Ok(Response {
                status: response.status().as_u16(),
                headers,
                body: Box::pin(response.bytes_stream().map(|chunk| chunk.map_err(|error| error.to_string()))),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    /// A request a test server saw. Header names are lowercase.
    #[derive(Debug)]
    struct Seen {
        port: u16,
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl Seen {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
        }
    }

    type Log = Arc<Mutex<Vec<Seen>>>;

    /// A server that answers `/r/<status>/<location, percent-encoded>` with that redirect (no `Location` when
    /// the segment is missing), `/chain/<n>` with a 302 to `/chain/<n - 1>`, and anything else with 200.
    async fn server(log: &Log) -> url::Url {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let log = log.clone();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buffer = Vec::new();
                    let mut chunk = [0; 4096];
                    let mut read = async |buffer: &mut Vec<u8>| {
                        let n = socket.read(&mut chunk).await.unwrap();
                        buffer.extend_from_slice(&chunk[..n]);
                        n
                    };
                    let head = loop {
                        if read(&mut buffer).await == 0 {
                            return;
                        }
                        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                            break index + 4;
                        }
                    };
                    let text = String::from_utf8_lossy(&buffer[..head]).into_owned();
                    let mut lines = text.split("\r\n");
                    let mut start = lines.next().unwrap().split(' ');
                    let method = start.next().unwrap().to_owned();
                    let path = start.next().unwrap().to_owned();
                    let headers: Vec<(String, String)> = lines
                        .filter_map(|line| line.split_once(": "))
                        .map(|(name, value)| (name.to_ascii_lowercase(), value.to_owned()))
                        .collect();
                    let length: usize = headers
                        .iter()
                        .find(|(name, _)| name == "content-length")
                        .map_or(0, |(_, v)| v.parse().unwrap());
                    while buffer.len() < head + length {
                        read(&mut buffer).await;
                    }
                    let body = String::from_utf8_lossy(&buffer[head..]).into_owned();
                    let segments: Vec<&str> = path.split('/').skip(1).collect();
                    let (status, location) = match segments[..] {
                        ["r", status, location] => (
                            status.parse().unwrap(),
                            Some(percent_decode_str(location).decode_utf8_lossy().into_owned()),
                        ),
                        ["r", status] => (status.parse().unwrap(), None),
                        ["chain", n] if n != "0" => (302, Some(format!("/chain/{}", n.parse::<u32>().unwrap() - 1))),
                        _ => (200, None),
                    };
                    log.lock().unwrap().push(Seen { port, method, path, headers, body });
                    let location = location.map(|location| format!("location: {location}\r\n")).unwrap_or_default();
                    let response =
                        format!("HTTP/1.1 {status} X\r\n{location}content-length: 2\r\nconnection: close\r\n\r\nok");
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        crate::js::parse_url(&format!("http://127.0.0.1:{port}")).unwrap()
    }

    fn redirect(base: &url::Url, status: u16, location: &str) -> url::Url {
        crate::js::join_url(base, &format!("/r/{status}/{}", utf8_percent_encode(location, NON_ALPHANUMERIC))).unwrap()
    }

    fn client() -> reqwest::Client {
        client_builder().build().unwrap()
    }

    #[tokio::test]
    async fn follows_a_chain_of_redirects() {
        let log = Log::default();
        let base = server(&log).await;
        let start = redirect(&base, 301, crate::js::join_url(&base, "/chain/2").unwrap().as_str());
        let response = fetch(client().get(start)).await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.url().path(), "/chain/0");
        let paths: Vec<_> = log.lock().unwrap().iter().map(|seen| seen.path.clone()).collect();
        assert_eq!(paths[1..], ["/chain/2", "/chain/1", "/chain/0"]);

        let response = fetch(client().get(crate::js::join_url(&base, "/r/302").unwrap())).await.unwrap();
        assert_eq!(response.status(), 302, "a redirect without Location is the response");
    }

    #[tokio::test]
    async fn each_status_keeps_or_drops_the_method_and_body() {
        let log = Log::default();
        let base = server(&log).await;
        let cases = [
            (301, "POST", "GET"),
            (301, "PUT", "PUT"),
            (301, "HEAD", "HEAD"),
            (302, "POST", "GET"),
            (302, "PUT", "PUT"),
            (302, "GET", "GET"),
            (303, "POST", "GET"),
            (303, "PUT", "GET"),
            (303, "HEAD", "HEAD"),
            (307, "POST", "POST"),
            (307, "PUT", "PUT"),
            (308, "POST", "POST"),
            (308, "DELETE", "DELETE"),
        ];
        for (status, method, expected) in cases {
            log.lock().unwrap().clear();
            let bodied = !matches!(method, "GET" | "HEAD");
            let mut request = client()
                .request(reqwest::Method::from_bytes(method.as_bytes()).unwrap(), redirect(&base, status, "/done"))
                .header("content-type", "text/plain")
                .header("content-language", "en")
                .header("authorization", "Bearer secret");
            if bodied {
                request = request.body("payload");
            }
            let response = fetch(request).await.unwrap();
            assert_eq!(response.status(), 200, "{status} {method}");
            let log = log.lock().unwrap();
            let [_, last] = &log[..] else { panic!("{status} {method}: {log:?}") };
            let kept = expected == method;
            assert_eq!((last.path.as_str(), last.method.as_str()), ("/done", expected), "{status} {method}");
            assert_eq!(last.body, if kept && bodied { "payload" } else { "" }, "{status} {method}");
            assert_eq!(last.header("content-type").is_some(), kept, "{status} {method}");
            assert_eq!(last.header("content-language").is_some(), kept, "{status} {method}");
            assert_eq!(last.header("content-length").is_some(), kept && bodied, "{status} {method}");
            assert_eq!(last.header("authorization"), Some("Bearer secret"), "{status} {method}: same origin");
        }
    }

    #[tokio::test]
    async fn a_change_of_origin_drops_the_credentials() {
        let log = Log::default();
        let a = server(&log).await;
        let b = server(&log).await;
        let request = client()
            .post(redirect(&a, 307, crate::js::join_url(&b, "/done").unwrap().as_str()))
            .header("authorization", "Bearer secret")
            .header("cookie", "c=1")
            .header("proxy-authorization", "Basic cA==")
            .header("x-custom", "kept")
            .body("payload");
        assert_eq!(fetch(request).await.unwrap().status(), 200);
        let log = log.lock().unwrap();
        let [first, last] = &log[..] else { panic!("{log:?}") };
        assert_eq!(first.port, a.port().unwrap());
        assert_eq!(first.header("cookie"), Some("c=1"));
        assert_eq!((last.port, last.method.as_str(), last.body.as_str()), (b.port().unwrap(), "POST", "payload"));
        for name in ["authorization", "cookie", "proxy-authorization"] {
            assert_eq!(last.header(name), None, "{name}");
        }
        assert_eq!(last.header("x-custom"), Some("kept"));
    }

    #[tokio::test]
    async fn stops_after_the_hop_limit() {
        let log = Log::default();
        let base = server(&log).await;
        let chain = |n: usize| crate::js::join_url(&base, &format!("/chain/{n}")).unwrap();
        assert_eq!(fetch(client().get(chain(MAX_REDIRECTS))).await.unwrap().status(), 200);
        assert_eq!(log.lock().unwrap().len(), MAX_REDIRECTS + 1);
        log.lock().unwrap().clear();
        let error = fetch(client().get(chain(MAX_REDIRECTS + 1))).await.unwrap_err();
        assert!(matches!(error, FetchError::TooManyRedirects), "{error}");
        assert_eq!(log.lock().unwrap().len(), MAX_REDIRECTS + 1);
    }

    #[tokio::test]
    async fn refuses_targets_it_cannot_follow() {
        let log = Log::default();
        let base = server(&log).await;
        let error = fetch(client().get(redirect(&base, 302, "ftp://example.com/x"))).await.unwrap_err();
        assert!(matches!(error, FetchError::UnsupportedRedirectProtocol(_)), "{error}");
        // The idna_adapter stub asserts on this host in a debug build; the boundary rejects it first.
        let error = fetch(client().get(redirect(&base, 302, "https://B%C3%BCcher.example/"))).await.unwrap_err();
        assert!(matches!(error, FetchError::Location(crate::js::UrlError::NonAsciiHost(_))), "{error}");
        assert_eq!(error.to_string(), format!("https://B%C3%BCcher.example/: {}", crate::js::ASCII_HOST));
        assert_eq!(log.lock().unwrap().len(), 2);
    }
}
