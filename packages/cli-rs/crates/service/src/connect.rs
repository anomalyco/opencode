//! `--server`, standalone, registered service, or ensure (F.6).
//!
//! Ports `ServerConnection.resolve` (`packages/cli/src/services/server-connection.ts:25-64`) with
//! two changes (plan 6.6, decision O-21): a service is found through [`discover`], which tries more
//! than one registration, and a service of another version is used with a warning, never
//! replaced. When none is found, [`ensure`] starts the TypeScript service (F.9, `docs/F.9.md`).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::error::Error as ApiError;
use opencode_api::transport::Transport;
use opencode_local::channel::Channels;
use opencode_local::paths::Paths;
use opencode_local::registration;
use opencode_local::service_config::{self, ServiceConfig};

use crate::discover;
use crate::ensure;
use crate::probe::Endpoint;
use crate::standalone;
use crate::ts_command::TsCommand;

/// How long `--server` waits for `/api/info` (`server-connection.ts:40`).
pub const SERVER_TIMEOUT: Duration = Duration::from_secs(5);

/// What the command line asked for.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub server: Option<String>,
    pub standalone: bool,
    /// This client's version, for the mismatch warning.
    pub client_version: String,
    /// Use a standalone server instead of starting the service when none runs (`autostart: false`,
    /// which `run` uses so a one-off run leaves no service behind).
    pub standalone_fallback: bool,
    /// Runs once before the service is started, for "Starting background server...".
    pub on_start: Option<fn()>,
}

/// The environment `resolve` reads.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Env {
    /// `OPENCODE_PASSWORD`, else `OPENCODE_SERVER_PASSWORD` (`packages/cli/src/env.ts:10-13`).
    pub password: Option<String>,
    /// `OPENCODE_CHANNEL`.
    pub channel: Option<String>,
    /// `OPENCODE_PRINT_LOGS=1`, which `--print-logs` sets.
    pub print_logs: bool,
    /// `OPENCODE_TS_BIN`, the TypeScript binary that serves.
    pub ts_bin: Option<String>,
}

impl std::fmt::Debug for Env {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Env")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("channel", &self.channel)
            .field("print_logs", &self.print_logs)
            .field("ts_bin", &self.ts_bin)
            .finish()
    }
}

impl Env {
    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var(name).ok())
    }

    pub fn from_vars(var: impl Fn(&str) -> Option<String>) -> Self {
        // Effect's `Config.Redacted` takes an empty value as set, so an empty password is sent.
        Self {
            password: var("OPENCODE_PASSWORD").or_else(|| var("OPENCODE_SERVER_PASSWORD")),
            channel: var("OPENCODE_CHANNEL").filter(|channel| !channel.is_empty()),
            print_logs: var("OPENCODE_PRINT_LOGS").as_deref() == Some("1"),
            ts_bin: var(TsCommand::VAR),
        }
    }

    fn ts(&self) -> TsCommand {
        TsCommand::from_vars(|_| self.ts_bin.clone().map(Into::into))
    }
}

/// A server the client can use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    pub endpoint: Endpoint,
    /// The version the server reported.
    pub version: String,
    pub source: Source,
    /// The mismatch warning for `--server`, already written to stderr. A mismatch with a
    /// discovered service is only logged (decision O-22): a Rust client is always another version.
    pub warning: Option<String>,
}

/// Where the server came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// `--server`.
    Server,
    /// A registered background service, found or started.
    Service { channel: String, file: PathBuf },
    /// A private server for this client; dropping the last handle stops it.
    Standalone(Arc<standalone::Server>),
}

/// A connection failure, with the TypeScript client's text.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct Error {
    pub message: String,
}

impl Error {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// Finds the server to use: `--server`, else standalone, else a registered service.
pub async fn resolve(
    transport: Arc<dyn Transport>,
    paths: &Paths,
    env: &Env,
    options: &Options,
) -> Result<Connection, Error> {
    if options.server.is_some() && options.standalone {
        return Err(Error::new("--server and --standalone cannot be combined"));
    }
    if let Some(url) = &options.server {
        let endpoint = Endpoint::new(url, env.password.clone());
        let version = server_version(transport, &endpoint).await?;
        let warning = mismatch(&endpoint, &version, options);
        if let Some(warning) = &warning {
            eprintln!("{warning}");
        }
        return Ok(Connection {
            endpoint,
            version,
            source: Source::Server,
            warning,
        });
    }
    let channels = Channels::from_vars(|name| match name {
        "OPENCODE_CHANNEL" => env.channel.clone().map(Into::into),
        _ => None,
    });
    let config = ServiceConfig::new(paths, &channels.channel)
        .read()
        .map_err(|error| Error::new(format!("Failed to read the service config: {error}")))?;
    if options.standalone || config.disabled == Some(true) {
        return start_standalone(env).await;
    }
    let found = match discover::discover(transport.as_ref(), paths, env.channel.as_deref()).await {
        Ok(found) => found,
        Err(_) if options.standalone_fallback => return start_standalone(env).await,
        Err(missing) => {
            let file = registration::Files::new(paths, &channels.channel).file;
            ensure_missing(
                transport,
                paths,
                env,
                &config,
                file,
                options.on_start,
                missing,
            )
            .await?
        }
    };
    if env.print_logs {
        eprintln!(
            "INFO  service.connect channel={} file={} url={}",
            found.channel,
            found.file.display(),
            found.service.endpoint.url
        );
    }
    let version = found.service.version.clone().unwrap_or_default();
    if env.print_logs
        && let Some(warning) = mismatch(&found.service.endpoint, &version, options)
    {
        eprintln!("WARN  service.connect {warning}");
    }
    Ok(Connection {
        endpoint: found.service.endpoint,
        version,
        source: Source::Service {
            channel: found.channel,
            file: found.file,
        },
        warning: None,
    })
}

/// Finds the registered service again, for a client that lost it (`managedService.reconnect`,
/// `packages/cli/src/services/server-connection.ts:66-75`): discovered, waited for, or started
/// quietly when none is registered.
pub async fn reconnect(
    transport: Arc<dyn Transport>,
    paths: &Paths,
    env: &Env,
) -> Result<discover::Found, Error> {
    match discover::discover(transport.as_ref(), paths, env.channel.as_deref()).await {
        Ok(found) => Ok(found),
        Err(missing) => {
            let channel = Channels::from_vars(|name| match name {
                "OPENCODE_CHANNEL" => env.channel.clone().map(Into::into),
                _ => None,
            })
            .channel;
            let config = ServiceConfig::new(paths, &channel)
                .read()
                .unwrap_or_default();
            let file = registration::Files::new(paths, &channel).file;
            ensure_missing(transport, paths, env, &config, file, None, missing).await
        }
    }
}

// `ensure` when discovery found no ready service: waits for a pending one, reports a failed one,
// and starts the service in `file` only when no live service is registered. It never starts a
// service beside one that is starting or not answering (O-21).
async fn ensure_missing(
    transport: Arc<dyn Transport>,
    paths: &Paths,
    env: &Env,
    config: &service_config::Info,
    file: PathBuf,
    on_start: Option<fn()>,
    missing: discover::Missing,
) -> Result<discover::Found, Error> {
    if missing.pending.is_none()
        && let Some(reason) = missing.reason
    {
        return Err(Error::new(reason));
    }
    let mut ensure_options = ensure::Options::new(
        missing.pending.unwrap_or(file),
        paths.state.clone(),
        &env.ts(),
    );
    ensure_options.env = service_config::process_env(config.env.as_ref())
        .unwrap_or_default()
        .into_iter()
        .collect();
    let ensured = ensure::ensure(transport, &ensure_options, &mut || {
        if let Some(on_start) = on_start {
            on_start();
        }
    })
    .await
    .map_err(|error| Error::new(error.0))?;
    Ok(discover::Found {
        channel: discover::channel_of(&ensured.file),
        service: ensured.service,
        file: ensured.file,
    })
}

fn mismatch(endpoint: &Endpoint, version: &str, options: &Options) -> Option<String> {
    (version != options.client_version).then(|| {
        format!(
            "Warning: Server at {} has version {version}; this client is {}. Continuing anyway.",
            endpoint.url, options.client_version
        )
    })
}

async fn server_version(
    transport: Arc<dyn Transport>,
    endpoint: &Endpoint,
) -> Result<String, Error> {
    let client = endpoint
        .client(transport)
        .map_err(|error| connect_error(endpoint, &error))?;
    match tokio::time::timeout(
        SERVER_TIMEOUT,
        client.server_info(&RequestOptions::default()),
    )
    .await
    {
        Ok(Ok(info)) => Ok(info.version),
        Ok(Err(error)) => Err(connect_error(endpoint, &error)),
        // The abort signal of the TypeScript client fails the fetch as a transport error.
        Err(_) => Err(Error::new(format!(
            "Could not reach server at {}: The operation timed out.",
            endpoint.url
        ))),
    }
}

// `connectError` (`server-connection.ts:99-114`).
fn connect_error(endpoint: &Endpoint, error: &ApiError) -> Error {
    let url = &endpoint.url;
    if error.reason() == "UnauthorizedError" {
        return Error::new(match endpoint.auth {
            None => format!("Server at {url} requires a password; set OPENCODE_PASSWORD"),
            Some(_) => format!("Server at {url} rejected the password"),
        });
    }
    if let ApiError::Transport(cause) = error {
        return Error::new(format!("Could not reach server at {url}: {cause}"));
    }
    Error::new(format!(
        "Server at {url} did not provide a compatible V2 health response: {error}"
    ))
}

async fn start_standalone(env: &Env) -> Result<Connection, Error> {
    let directory = std::env::current_dir()
        .map_err(|error| Error::new(format!("Failed to read the working directory: {error}")))?;
    let server = standalone::start(&env.ts().standalone(), &directory, env.print_logs)
        .await
        .map_err(|error| Error::new(error.0))?;
    Ok(Connection {
        endpoint: server.endpoint.clone(),
        // The child is the TS binary this client runs; its version is not asked for.
        version: String::new(),
        source: Source::Standalone(Arc::new(server)),
        warning: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Reply, Server};
    use std::ffi::OsString;
    use std::path::Path;

    fn paths(root: &Path) -> Paths {
        let state = root.join("state").into_os_string();
        let config = root.join("config").into_os_string();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(root)),
            "XDG_STATE_HOME" => Some(state.clone()),
            "XDG_CONFIG_HOME" => Some(config.clone()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        std::fs::create_dir_all(&paths.config).unwrap();
        paths
    }

    fn options(server: Option<&str>) -> Options {
        Options {
            server: server.map(str::to_owned),
            standalone: false,
            client_version: "1.0.0".to_owned(),
            standalone_fallback: false,
            on_start: None,
        }
    }

    const URL: &str = "http://127.0.0.1:4096";
    const INFO: &str = "http://127.0.0.1:4096/api/info";
    const HEALTH: &str = r#"{"version":"2.0.0","pid":9,"urls":[],"paths":{"tmp":"/tmp"}}"#;

    async fn run(
        server: Server,
        env: Env,
        options: Options,
    ) -> (Result<Connection, Error>, Arc<Server>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        let server = Arc::new(server);
        let result = resolve(server.clone(), &paths, &env, &options).await;
        (result, server)
    }

    fn message(result: Result<Connection, Error>) -> String {
        result.unwrap_err().message
    }

    #[tokio::test]
    async fn server_flag_connects_with_the_password_and_warns_on_a_mismatch() {
        let env =
            Env::from_vars(|name| (name == "OPENCODE_SERVER_PASSWORD").then(|| "pw".to_owned()));
        let (result, server) = run(
            Server::default().reply(INFO, Reply::json(200, HEALTH)),
            env,
            options(Some(URL)),
        )
        .await;
        let connection = result.unwrap();
        assert_eq!(connection.version, "2.0.0");
        assert_eq!(connection.source, Source::Server);
        assert_eq!(
            connection.warning.as_deref(),
            Some(
                "Warning: Server at http://127.0.0.1:4096 has version 2.0.0; this client is 1.0.0. Continuing anyway."
            )
        );
        assert_eq!(
            server.requests()[0].1.as_deref(),
            Some(
                format!(
                    "Basic {}",
                    opencode_api::client::Auth::password("pw").token()
                )
                .as_str()
            )
        );
        assert!(!format!("{connection:?}").contains("pw"));
    }

    #[tokio::test]
    async fn server_flag_errors_use_the_typescript_texts() {
        let unauthorized = || {
            Server::default().reply(
                INFO,
                Reply::json(401, r#"{"_tag":"UnauthorizedError","message":"no"}"#),
            )
        };
        let (result, _) = run(unauthorized(), Env::default(), options(Some(URL))).await;
        assert_eq!(
            message(result),
            "Server at http://127.0.0.1:4096 requires a password; set OPENCODE_PASSWORD"
        );
        let env = Env::from_vars(|name| (name == "OPENCODE_PASSWORD").then(|| "pw".to_owned()));
        let (result, _) = run(unauthorized(), env, options(Some(URL))).await;
        assert_eq!(
            message(result),
            "Server at http://127.0.0.1:4096 rejected the password"
        );
        let (result, _) = run(Server::default(), Env::default(), options(Some(URL))).await;
        assert_eq!(
            message(result),
            "Could not reach server at http://127.0.0.1:4096: connection refused"
        );
        let (result, _) = run(
            Server::default().reply(INFO, Reply::json(200, "{}")),
            Env::default(),
            options(Some(URL)),
        )
        .await;
        assert!(message(result).starts_with(
            "Server at http://127.0.0.1:4096 did not provide a compatible V2 health response: "
        ));
        let both = Options {
            standalone: true,
            ..options(Some(URL))
        };
        let (result, _) = run(Server::default(), Env::default(), both).await;
        assert_eq!(
            message(result),
            "--server and --standalone cannot be combined"
        );
    }

    #[tokio::test]
    async fn a_registered_service_is_used_without_flags() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        std::fs::write(
            paths.state.join("service-oc-x.json"),
            r#"{"url":"http://127.0.0.1:4096","pid":9,"version":"2.0.0","password":"p"}"#,
        )
        .unwrap();
        let server: Arc<dyn Transport> =
            Arc::new(Server::default().reply(INFO, Reply::json(200, HEALTH)));
        let connection = resolve(server.clone(), &paths, &Env::default(), &options(None))
            .await
            .unwrap();
        assert_eq!(connection.version, "2.0.0");
        assert_eq!(
            connection.source,
            Source::Service {
                channel: "oc-x".to_owned(),
                file: paths.state.join("service-oc-x.json")
            }
        );
        // Versions differ (2.0.0 against 1.0.0), but a discovered service's mismatch is only
        // logged (O-22).
        assert_eq!(connection.warning, None);
        let endpoint = Endpoint::new(URL, None);
        assert!(mismatch(&endpoint, "2.0.0", &options(None)).is_some());
        let same = Options {
            client_version: "2.0.0".to_owned(),
            ..options(None)
        };
        assert_eq!(mismatch(&endpoint, "2.0.0", &same), None);
    }

    // Never the real `opencode`: the child would inherit this process's real state directories.
    fn missing_ts() -> Env {
        Env {
            ts_bin: Some("/nonexistent/opencode-ts".to_owned()),
            ..Env::default()
        }
    }

    #[tokio::test]
    async fn no_service_starts_the_typescript_one() {
        let (result, _) = run(Server::default(), missing_ts(), options(None)).await;
        let text = message(result);
        assert!(
            text.starts_with("Failed to start server: /nonexistent/opencode-ts: "),
            "{text}"
        );
        assert!(text.contains("OPENCODE_TS_BIN"), "{text}");
    }

    const OTHER: &str = "http://127.0.0.1:4097/api/info";

    // A registration of another channel whose service answers `replies` in order. The TS binary is
    // missing, so starting a service fails with "Failed to start server".
    async fn other_channel(replies: Vec<Reply>) -> Result<Connection, Error> {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path());
        std::fs::write(
            paths.state.join("service-oc-x.json"),
            r#"{"url":"http://127.0.0.1:4097","pid":9,"password":"p"}"#,
        )
        .unwrap();
        let server: Arc<dyn Transport> = Arc::new(Server::default().replies(OTHER, replies));
        resolve(server, &paths, &missing_ts(), &options(None)).await
    }

    #[tokio::test]
    async fn a_starting_service_of_another_channel_is_waited_for() {
        let starting = Reply::json(503, HEALTH);
        let connection = other_channel(vec![starting.clone(), starting, Reply::json(200, HEALTH)])
            .await
            .unwrap();
        assert_eq!(connection.endpoint.url, "http://127.0.0.1:4097");
        assert!(matches!(connection.source, Source::Service { channel, .. } if channel == "oc-x"));
    }

    #[tokio::test]
    async fn a_failed_or_incompatible_service_of_another_channel_is_reported() {
        assert_eq!(
            message(other_channel(vec![Reply::json(500, HEALTH)]).await),
            "Background service failed to start"
        );
        assert!(
            message(other_channel(vec![Reply::json(404, "")]).await)
                .starts_with("Background service uses an incompatible health protocol.")
        );
    }

    // Paused time: each probe times out at once.
    #[tokio::test(start_paused = true)]
    async fn an_unresponsive_service_of_another_channel_is_reported() {
        assert_eq!(
            message(other_channel(vec![Reply::Hang]).await),
            "Background service at http://127.0.0.1:4097 (pid 9) is not responding. Stop it with `opencode service stop`, or pass --server."
        );
    }

    #[tokio::test]
    async fn standalone_runs_the_typescript_binary() {
        let standalone = Options {
            standalone: true,
            ..options(None)
        };
        let (result, _) = run(Server::default(), missing_ts(), standalone).await;
        assert!(
            message(result)
                .starts_with("Failed to start standalone server: /nonexistent/opencode-ts: ")
        );
        let fallback = Options {
            standalone_fallback: true,
            ..options(None)
        };
        let (result, _) = run(Server::default(), missing_ts(), fallback).await;
        assert!(message(result).starts_with("Failed to start standalone server: "));
    }
}
