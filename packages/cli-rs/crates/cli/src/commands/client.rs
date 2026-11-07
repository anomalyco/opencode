//! What the commands that talk to a server share (C.1): the connection, a runtime,
//! and `localeCompare` ordering.

use std::future::Future;
use std::sync::Arc;

use opencode_api::client::Client;
use opencode_api::generated::types::LocationQueryInput;
use opencode_api::transport::{Reqwest, Transport};
use opencode_local::paths::Paths;
use opencode_service::connect::{self, Connection, Env, Options};
use opencode_service::probe::Endpoint;
use opencode_util::error;
use serde_json::Value;

use super::Context;

pub use opencode_api::js::locale_compare;

/// Runs `future` to completion on a runtime of its own; handlers are synchronous.
pub fn block_on<F: Future>(future: F) -> error::Result<F::Output> {
    Ok(tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(future))
}

/// A client and the connection it uses. The connection is private so that a caller cannot drop
/// it apart from the client: dropping a standalone connection stops its server.
pub struct Connected {
    pub client: Client,
    _connection: Connection,
}

impl Connected {
    /// The server's URL and credentials, for requests outside the generated client.
    pub fn endpoint(&self) -> &Endpoint {
        &self._connection.endpoint
    }
}

/// `ServerConnection.resolve()` with the command's `--server` and `--standalone`, and a client for it.
/// Keep the result for as long as the command talks to the server.
pub async fn connect(context: &Context) -> error::Result<Connected> {
    connect_in(context, &Paths::from_env()?, &Env::from_env(), false, false, Arc::new(Reqwest::default())).await
}

/// [`connect`] for a long-lived command (`mini`): a managed service's client follows the service when it
/// restarts on a new port or password (`service.reconnect`).
pub async fn connect_following(context: &Context) -> error::Result<Connected> {
    connect_in(context, &Paths::from_env()?, &Env::from_env(), false, true, Arc::new(Reqwest::default())).await
}

/// `ServerConnection.resolve({ autostart: false })` (`run`): a running service, else a standalone server, so a
/// one-off command never leaves a new service running.
pub async fn connect_without_autostart(context: &Context) -> error::Result<Connected> {
    connect_in(context, &Paths::from_env()?, &Env::from_env(), true, false, Arc::new(Reqwest::default())).await
}

impl Connected {
    /// True for a registered background service (`Resolved.service` in TS).
    pub fn is_service(&self) -> bool {
        matches!(self._connection.source, connect::Source::Service { .. })
    }
}

async fn connect_in(
    context: &Context,
    paths: &Paths,
    env: &Env,
    standalone_fallback: bool,
    follow: bool,
    transport: Arc<dyn Transport>,
) -> error::Result<Connected> {
    let connection = connect::resolve(
        transport.clone(),
        paths,
        env,
        &Options {
            server: context.server.server.clone(),
            standalone: context.server.standalone,
            client_version: crate::help::VERSION.to_owned(),
            // Without it, `ServerConnection.resolve()` with no arguments: start the service quietly when none runs.
            standalone_fallback,
            on_start: None,
        },
    )
    .await?;
    let client = if follow {
        opencode_service::follow::client(transport, &connection, paths, env)?
    } else {
        connection.endpoint.client(transport)?
    };
    Ok(Connected { client, _connection: connection })
}

/// `{ location: { directory: process.cwd() } }`, the location every read command sends.
pub fn here() -> error::Result<LocationQueryInput> {
    Ok(LocationQueryInput { directory: Some(std::env::current_dir()?.to_string_lossy().into_owned()) })
}

/// `JSON.stringify(value, null, 2)` plus a newline.
pub fn pretty(value: &Value) -> error::Result<String> {
    Ok(serde_json::to_string_pretty(value)? + "\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::ServerFlags;

    // A standalone server: it prints its ready line, answers `/api/info`, and exits when its stdin
    // lease closes.
    const STANDALONE: &str = r#"
const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: "test", pid: process.pid, urls: [], paths: { tmp: "/tmp" } }) })
console.log(JSON.stringify({ url: server.url.toString() }))
for await (const _ of Bun.stdin.stream()) {}
process.exit(0)
"#;

    /// Answers `/api/info` on port 5000, and on 4096 only for the first request: the service then restarts.
    #[derive(Default)]
    struct Restarting(std::sync::Mutex<Vec<String>>);

    impl Transport for Restarting {
        fn send(
            &self,
            request: opencode_api::transport::Request,
        ) -> opencode_api::transport::BoxFuture<'_, Result<opencode_api::transport::Response, String>> {
            let mut sent = self.0.lock().unwrap();
            sent.push(request.url.to_string());
            let old = sent.iter().filter(|url| url.contains(":4096/")).count();
            let up = request.url.port() == Some(5000) || old == 1;
            Box::pin(async move {
                if !up {
                    return Err("connection refused".to_owned());
                }
                let body = r#"{"version":"2.0.0","pid":9,"urls":[],"paths":{"tmp":"/tmp"}}"#;
                Ok(opencode_api::transport::Response {
                    status: 200,
                    headers: vec![("content-type".to_owned(), "application/json".to_owned())],
                    body: Box::pin(futures_util::stream::iter([Ok(body.as_bytes().to_vec().into())])),
                })
            })
        }
    }

    /// `mini` follows a background service that restarts on another port, as `service.reconnect` does.
    #[tokio::test]
    async fn a_following_client_finds_a_restarted_service() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let root = dir.path().to_owned();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(root.clone().into()),
            "XDG_STATE_HOME" => Some(root.join("state").into()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        let register = |port: u16| {
            let entry = format!(r#"{{"url":"http://127.0.0.1:{port}","pid":9,"password":"pw"}}"#);
            std::fs::write(paths.state.join("service-oc-x.json"), entry).unwrap();
        };
        register(4096);
        let env = Env { ts_bin: Some("/nonexistent/opencode-ts".to_owned()), ..Env::default() };
        let context = Context { server: ServerFlags { standalone: false, server: None } };
        let transport = Arc::new(Restarting::default());
        let server = connect_in(&context, &paths, &env, false, true, transport.clone()).await.unwrap();
        register(5000);
        assert!(server.client.server_info().await.is_err());
        assert_eq!(server.client.server_info().await.unwrap().version, "2.0.0");
        assert!(transport.0.lock().unwrap().last().unwrap().starts_with("http://127.0.0.1:5000/"));
    }

    #[tokio::test]
    async fn a_standalone_server_lives_as_long_as_the_connection() {
        if std::process::Command::new("bun").arg("--version").output().is_err() {
            eprintln!("skipped: bun is not on PATH");
            return;
        }
        let dir = opencode_util::temp::tempdir().unwrap();
        let script = dir.path().join("standalone.ts");
        std::fs::write(&script, STANDALONE).unwrap();
        // `OPENCODE_TS_BIN` names one executable.
        let program = dir.path().join("opencode-ts");
        opencode_service::ts_command::write_script(&program, &format!("#!/bin/sh\nexec bun {}\n", script.display()));
        let root = dir.path().to_owned();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(root.clone().into()),
            "XDG_STATE_HOME" => Some(root.join("state").into()),
            "XDG_CONFIG_HOME" => Some(root.join("config").into()),
            "XDG_DATA_HOME" => Some(root.join("data").into()),
            "XDG_CACHE_HOME" => Some(root.join("cache").into()),
            _ => None,
        })
        .unwrap();
        let env = Env { ts_bin: Some(program.to_string_lossy().into_owned()), ..Env::default() };
        let context = Context { server: ServerFlags { standalone: true, server: None } };
        // The commands bind the result as these lines do; `let (_, client)` stopped the server here.
        let server = connect_in(&context, &paths, &env, false, false, Arc::new(Reqwest::default())).await.unwrap();
        let info = server.client.server_info().await;
        assert_eq!(info.unwrap().version, "test");
    }
}
