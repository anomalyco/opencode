//! `--server`, standalone, registered service, or ensure (F.6).
//!
//! Ports `ServerConnection.resolve` (`packages/cli/src/services/server-connection.ts:25-64`) with
//! two changes (plan 6.6, decision O-21): a service is found through [`discover`], which tries more
//! than one registration, and a service of another version is used with a warning, never
//! replaced. Starting a service or a standalone server is F.9; until then those paths are errors.

use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::error::Error as ApiError;
use opencode_api::transport::Transport;
use opencode_local::channel::Channels;
use opencode_local::paths::Paths;
use opencode_local::service_config::ServiceConfig;

use crate::discover::{self, Missing};
use crate::probe::Endpoint;

/// How long `--server` waits for `/api/info` (`server-connection.ts:40`).
pub const SERVER_TIMEOUT: Duration = Duration::from_secs(5);

/// What the command line asked for.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub server: Option<String>,
    pub standalone: bool,
    /// This client's version, for the mismatch warning.
    pub client_version: String,
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
}

impl std::fmt::Debug for Env {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Env")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("channel", &self.channel)
            .field("print_logs", &self.print_logs)
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
        }
    }
}

/// A server the client can use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    pub endpoint: Endpoint,
    /// The version the server reported.
    pub version: String,
    pub source: Source,
    /// The mismatch warning, already written to stderr, if any.
    pub warning: Option<String>,
}

/// Where the server came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// `--server`.
    Server,
    /// A registered background service.
    Service { channel: String, file: PathBuf },
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
        return Ok(connected(endpoint, version, Source::Server, options));
    }
    let channels = Channels::from_vars(|name| match name {
        "OPENCODE_CHANNEL" => env.channel.clone().map(Into::into),
        _ => None,
    });
    let disabled = ServiceConfig::new(paths, &channels.channel)
        .read()
        .map_err(|error| Error::new(format!("Failed to read the service config: {error}")))?
        .disabled
        == Some(true);
    if options.standalone || disabled {
        return Err(Error::new(
            "A standalone server is not supported yet (plan step F.9); pass --server",
        ));
    }
    let found = discover::discover(transport.as_ref(), paths, env.channel.as_deref())
        .await
        .map_err(|missing| not_found(paths, missing))?;
    if env.print_logs {
        eprintln!(
            "INFO  service.connect channel={} file={} url={}",
            found.channel,
            found.file.display(),
            found.service.endpoint.url
        );
    }
    let version = found.service.version.clone().unwrap_or_default();
    let source = Source::Service {
        channel: found.channel,
        file: found.file,
    };
    Ok(connected(found.service.endpoint, version, source, options))
}

fn connected(endpoint: Endpoint, version: String, source: Source, options: &Options) -> Connection {
    let warning = (version != options.client_version).then(|| {
        format!(
            "Warning: Server at {} has version {version}; this client is {}. Continuing anyway.",
            endpoint.url, options.client_version
        )
    });
    if let Some(warning) = &warning {
        eprintln!("{warning}");
    }
    Connection {
        endpoint,
        version,
        source,
        warning,
    }
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

fn not_found(paths: &Paths, missing: Missing) -> Error {
    let mut message = format!(
        "No running OpenCode service found in {}. Start one with `opencode service start`, or pass --server.",
        paths.state.display()
    );
    if let Some(reason) = missing.reason {
        let _ = write!(message, " {reason}");
    }
    Error::new(message)
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
        assert!(connection.warning.is_some());
        // The same version gives no warning.
        let same = Options {
            client_version: "2.0.0".to_owned(),
            ..options(None)
        };
        let connection = resolve(server, &paths, &Env::default(), &same)
            .await
            .unwrap();
        assert_eq!(connection.warning, None);
    }

    #[tokio::test]
    async fn no_service_says_how_to_start_one() {
        let (result, _) = run(Server::default(), Env::default(), options(None)).await;
        let text = message(result);
        assert!(
            text.starts_with("No running OpenCode service found in "),
            "{text}"
        );
        assert!(text.contains("`opencode service start`"), "{text}");
    }
}
