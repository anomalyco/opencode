//! A client that follows a managed service across restarts.
//!
//! A restarted background service may register a new port or password. The TypeScript TUI then
//! runs `service.reconnect` (an ensure) after each event-stream disconnect and swaps its client's
//! URL and headers (`packages/tui/src/context/client.tsx:33-41`). Every part of the Rust TUI holds
//! a clone of one [`Client`], so the swap happens below it, in the transport: requests to the
//! origin the client was built for go to the current service with its current password. A request
//! that fails to connect or is refused with 401 finds the service again, through
//! [`connect::reconnect`], before it returns its error. The request is not retried, so a request
//! that may have reached the old service is never sent twice; the event stream retries itself.

use std::sync::{Arc, RwLock};

use opencode_api::client::{Auth, Client};
use opencode_api::error::Error as ApiError;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::paths::Paths;

use crate::connect::{self, Connection, Env, Source};

/// An API client for `connection`. For a managed service it follows the service when it restarts;
/// otherwise it is `connection.endpoint.client(transport)`.
pub fn client(
    transport: Arc<dyn Transport>,
    connection: &Connection,
    paths: &Paths,
    env: &Env,
) -> Result<Client, ApiError> {
    let Source::Service { .. } = connection.source else {
        return connection.endpoint.client(transport);
    };
    let origin = url::Url::parse(&connection.endpoint.url)
        .map_err(|error| ApiError::Transport(format!("{}: {error}", connection.endpoint.url)))?;
    let follow = Follow {
        inner: transport,
        origin: origin.origin(),
        route: RwLock::new(Route { url: origin, auth: connection.endpoint.auth.clone(), generation: 0 }),
        resolving: tokio::sync::Mutex::new(()),
        paths: paths.clone(),
        env: env.clone(),
    };
    connection.endpoint.client(Arc::new(follow))
}

struct Follow {
    inner: Arc<dyn Transport>,
    /// The origin the client was built for. Only requests to it are rerouted.
    origin: url::Origin,
    route: RwLock<Route>,
    /// Held while the service is found again, so concurrent failures find it once.
    resolving: tokio::sync::Mutex<()>,
    paths: Paths,
    env: Env,
}

/// Where requests go now.
struct Route {
    url: url::Url,
    auth: Option<Auth>,
    /// Counts the times the service was found again.
    generation: u64,
}

impl Transport for Follow {
    fn send(&self, mut request: Request) -> BoxFuture<'_, Result<Response, String>> {
        Box::pin(async move {
            if request.url.origin() != self.origin {
                return self.inner.send(request).await;
            }
            let generation = self.reroute(&mut request);
            let result = self.inner.send(request).await;
            // A transport error or 401.
            if !result.as_ref().is_ok_and(|response| response.status != 401) {
                self.reconnect(generation).await;
            }
            result
        })
    }

    fn route(&self, url: url::Url) -> url::Url {
        self.endpoint(url, None).0
    }

    // The terminal socket's `ws:` URL has another origin than the client's `http:` one, so this compares host and
    // port only.
    fn endpoint(&self, mut url: url::Url, auth: Option<&Auth>) -> (url::Url, Option<Auth>) {
        let url::Origin::Tuple(_, host, port) = &self.origin else {
            return (url, auth.cloned());
        };
        if url.host_str() != Some(&host.to_string()) || url.port_or_known_default() != Some(*port) {
            return (url, auth.cloned());
        }
        let route = self.route.read().expect("route lock");
        point(&route.url, &mut url);
        (url, route.auth.clone())
    }
}

// Points `url` at `route`'s host and port, keeping a socket scheme a socket scheme.
fn point(route: &url::Url, url: &mut url::Url) {
    let secure = route.scheme() == "https";
    let scheme = match url.scheme() {
        "ws" | "wss" if secure => "wss",
        "ws" | "wss" => "ws",
        _ => route.scheme(),
    };
    // The URL has a host, so these cannot fail.
    let _ = url.set_scheme(scheme);
    let _ = url.set_host(route.host_str());
    let _ = url.set_port(route.port());
}

impl Follow {
    // Points `request` at the current route and returns the route's generation.
    fn reroute(&self, request: &mut Request) -> u64 {
        let route = self.route.read().expect("route lock");
        point(&route.url, &mut request.url);
        request.headers.retain(|(name, _)| name != "authorization");
        if let Some(auth) = &route.auth {
            request.headers.push(("authorization".to_owned(), format!("Basic {}", auth.token())));
        }
        route.generation
    }

    // Finds the service again, unless another request did since `generation`.
    async fn reconnect(&self, generation: u64) {
        let _resolving = self.resolving.lock().await;
        if self.route.read().expect("route lock").generation != generation {
            return;
        }
        let found = connect::reconnect(self.inner.clone(), &self.paths, &self.env).await;
        let endpoint = match found {
            Ok(found) => found.service.endpoint,
            Err(error) => {
                log::warn!("service.reconnect failed: {error}");
                return;
            }
        };
        let Ok(url) = url::Url::parse(&endpoint.url) else {
            log::warn!("service.reconnect found an invalid url: {}", endpoint.url);
            return;
        };
        log::info!("service.reconnect url={url}");
        *self.route.write().expect("route lock") = Route { url, auth: endpoint.auth, generation: generation + 1 };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::Endpoint;
    use crate::testing::{Reply, Server};
    use opencode_api::client::RequestOptions;
    use opencode_api::generated::PtyID;
    use opencode_api::pty;
    use std::ffi::OsString;
    use std::sync::Mutex;

    const OLD: &str = "http://127.0.0.1:4096/api/info";
    const NEW: &str = "http://127.0.0.1:5000/api/info";
    const HEALTH: &str = r#"{"version":"2.0.0","pid":9,"urls":[],"paths":{"tmp":"/tmp"}}"#;

    fn register(paths: &Paths, port: u16, password: &str) {
        std::fs::write(
            paths.state.join("service-oc-x.json"),
            format!(r#"{{"url":"http://127.0.0.1:{port}","pid":9,"password":"{password}"}}"#),
        )
        .unwrap();
    }

    fn basic(password: &str) -> Option<String> {
        Some(format!("Basic {}", Auth::password(password).token()))
    }

    #[tokio::test]
    async fn a_managed_client_follows_a_restarted_service() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(dir.path())),
            "XDG_STATE_HOME" => Some(dir.path().join("state").into()),
            "XDG_CONFIG_HOME" => Some(dir.path().join("config").into()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        register(&paths, 4096, "old");
        // The old service answers discovery, then is gone; the new one answers from the start.
        let server = Arc::new(
            Server::default()
                .replies(OLD, [Reply::json(200, HEALTH), Reply::Refused])
                .reply(NEW, Reply::json(200, HEALTH)),
        );
        let env = Env { ts_bin: Some("/nonexistent/opencode-ts".to_owned()), ..Env::default() };
        let options = connect::Options::default();
        let connection = connect::resolve(server.clone(), &paths, &env, &options).await.unwrap();
        let client = client(server.clone(), &connection, &paths, &env).unwrap();
        register(&paths, 5000, "new");
        let request = RequestOptions::default();
        let info = || client.server_info(&request);
        // The failed request finds the service again but is not retried.
        assert!(info().await.is_err());
        assert_eq!(info().await.unwrap().version, "2.0.0");
        let requests = server.requests();
        assert_eq!(
            requests,
            [
                (OLD.to_owned(), basic("old")),
                (OLD.to_owned(), basic("old")),
                (NEW.to_owned(), basic("new")),
                (NEW.to_owned(), basic("new")),
            ]
        );
    }

    #[tokio::test]
    async fn a_terminal_socket_follows_a_restarted_service() {
        const OLD_TOKEN: &str = "http://127.0.0.1:4096/api/experimental/persistent-pty/pty_1/connect-token";
        const NEW_TOKEN: &str = "http://127.0.0.1:5000/api/experimental/persistent-pty/pty_1/connect-token";
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(dir.path())),
            "XDG_STATE_HOME" => Some(dir.path().join("state").into()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        register(&paths, 4096, "old");
        let server = Arc::new(
            Server::default()
                .reply(OLD, Reply::json(200, HEALTH))
                .reply(OLD_TOKEN, Reply::Refused)
                .reply(NEW, Reply::json(200, HEALTH))
                .reply(NEW_TOKEN, Reply::json(200, r#"{"data":{"ticket":"t1","expires_in":60}}"#)),
        );
        let env = Env { ts_bin: Some("/nonexistent/opencode-ts".to_owned()), ..Env::default() };
        let connection = connect::resolve(server.clone(), &paths, &env, &Default::default()).await.unwrap();
        let client = client(server.clone(), &connection, &paths, &env).unwrap();
        register(&paths, 5000, "new");
        let input = pty::ConnectInput {
            pty_id: PtyID("pty_1".to_owned()),
            cursor: 0,
            attachment_id: "attachment-1".to_owned(),
            takeover: false,
        };
        let opened = Mutex::new(Vec::new());
        let connector = |url: url::Url| {
            opened.lock().unwrap().push(url.to_string());
            Ok(pty::pair().0)
        };
        // The refused ticket request finds the restarted service; the next connect goes there.
        assert!(pty::connect(&client, &connector, &input).await.is_err());
        pty::connect(&client, &connector, &input).await.unwrap();
        assert_eq!(
            *opened.lock().unwrap(),
            [
                "ws://127.0.0.1:5000/api/experimental/persistent-pty/pty_1/connect?ticket=t1&cursor=0&attachment_id=attachment-1&takeover=false&input_protocol=1"
            ]
        );
    }

    #[tokio::test]
    async fn a_socket_endpoint_follows_a_restarted_service() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(dir.path())),
            "XDG_STATE_HOME" => Some(dir.path().join("state").into()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        register(&paths, 4096, "old");
        let server = Arc::new(
            Server::default()
                .replies(OLD, [Reply::json(200, HEALTH), Reply::Refused])
                .reply(NEW, Reply::json(200, HEALTH)),
        );
        let env = Env { ts_bin: Some("/nonexistent/opencode-ts".to_owned()), ..Env::default() };
        let connection = connect::resolve(server.clone(), &paths, &env, &Default::default()).await.unwrap();
        let client = client(server.clone(), &connection, &paths, &env).unwrap();
        let endpoint = || {
            let (url, auth) = client.transport().endpoint(client.base_url().clone(), client.credentials());
            (url.to_string(), auth.map(|auth| auth.token()))
        };
        let token = |password: &str| Some(Auth::password(password).token());
        assert_eq!(endpoint(), ("http://127.0.0.1:4096/".to_owned(), token("old")));
        register(&paths, 5000, "new");
        assert!(client.server_info(&RequestOptions::default()).await.is_err());
        assert_eq!(endpoint(), ("http://127.0.0.1:5000/".to_owned(), token("new")));
        // Another origin keeps its own address and credentials.
        let other = Auth::password("other");
        let (url, auth) = client.transport().endpoint(url::Url::parse("http://example.com/").unwrap(), Some(&other));
        assert_eq!(url.as_str(), "http://example.com/");
        assert!(auth == Some(other));
    }

    #[tokio::test]
    async fn a_client_of_an_explicit_server_is_not_rerouted() {
        let server = Arc::new(Server::default());
        let connection = Connection {
            endpoint: Endpoint::new("http://127.0.0.1:4096", Some("pw".to_owned())),
            version: String::new(),
            source: Source::Server,
            warning: None,
        };
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::from_vars(|name| (name == "HOME").then(|| dir.path().into())).unwrap();
        let client = client(server.clone(), &connection, &paths, &Env::default()).unwrap();
        assert!(client.server_info(&RequestOptions::default()).await.is_err());
        // Only the request itself: no discovery ran.
        assert_eq!(server.requests().len(), 1);
    }
}
