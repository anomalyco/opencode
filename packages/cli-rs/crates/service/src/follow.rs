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
        route: RwLock::new(Route {
            url: origin,
            auth: connection.endpoint.auth.clone(),
            generation: 0,
        }),
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
}

impl Follow {
    // Points `request` at the current route and returns the route's generation.
    fn reroute(&self, request: &mut Request) -> u64 {
        let route = self.route.read().expect("route lock");
        // The URL has a host, so these cannot fail.
        let _ = request.url.set_scheme(route.url.scheme());
        let _ = request.url.set_host(route.url.host_str());
        let _ = request.url.set_port(route.url.port());
        request.headers.retain(|(name, _)| name != "authorization");
        if let Some(auth) = &route.auth {
            request.headers.push((
                "authorization".to_owned(),
                format!("Basic {}", auth.token()),
            ));
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
        *self.route.write().expect("route lock") = Route {
            url,
            auth: endpoint.auth,
            generation: generation + 1,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::probe::Endpoint;
    use crate::testing::{Reply, Server};
    use opencode_api::client::RequestOptions;
    use std::ffi::OsString;

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
        let env = Env {
            ts_bin: Some("/nonexistent/opencode-ts".to_owned()),
            ..Env::default()
        };
        let options = connect::Options::default();
        let connection = connect::resolve(server.clone(), &paths, &env, &options)
            .await
            .unwrap();
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
        assert!(
            client
                .server_info(&RequestOptions::default())
                .await
                .is_err()
        );
        // Only the request itself: no discovery ran.
        assert_eq!(server.requests().len(), 1);
    }
}
