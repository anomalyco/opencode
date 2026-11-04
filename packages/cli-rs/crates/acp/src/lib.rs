//! The ACP agent (C.11): `opencode acp`, the Agent Client Protocol over stdio JSON-RPC
//! (`packages/cli/src/acp`, `packages/cli/src/commands/handlers/acp.ts`).
//!
//! The agent starts a private TypeScript server, as TS `Standalone.start()` does, and talks to it over
//! HTTP. C.12 (`rs-acp-rest`) owns `tools`, `permission`, `elicitation`, `config_option`, `replay`,
//! `compaction`, `directories`, and `login`.

pub mod agent;
pub mod capabilities;
pub mod catalog;
pub mod child;
pub mod client;
pub mod compaction;
pub mod config_option;
pub mod connection;
pub mod content;
pub mod directories;
pub mod elicitation;
pub mod error;
pub mod login;
pub mod paths;
pub mod permission;
pub mod prompt;
pub mod replay;
pub mod service;
pub mod sessions;
pub mod tools;
pub mod translate;
pub mod turn;

use std::ffi::OsString;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::transport::Reqwest;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::sync::CancellationToken;

pub use connection::Closed;

#[derive(Debug, Clone)]
pub struct Options {
    /// `agentInfo.version`.
    pub version: String,
    /// How long a cancelled turn waits for the server's wind-down (`CancelDrainTimeout`).
    pub drain_timeout: Duration,
}

impl Options {
    pub fn new(version: impl Into<String>) -> Self {
        Self {
            version: version.into(),
            drain_timeout: turn::CANCEL_DRAIN_TIMEOUT,
        }
    }
}

/// Serves ACP on `input` and `output` with `client` until the connection closes (`ACP.connect`).
pub async fn serve<R, W>(client: Client, input: R, output: W, options: Options) -> Closed
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let scope = CancellationToken::new();
    let _guard = scope.clone().drop_guard();
    let (connection, writer) = connection::Connection::new();
    let catalogs = catalog::Catalogs::new(client.clone(), scope.clone());
    let sessions = sessions::Sessions::new(
        client.clone(),
        connection.clone(),
        catalogs.clone(),
        scope.clone(),
    );
    let capabilities = Arc::new(Mutex::new(capabilities::Capabilities::default()));
    let turns = turn::Turns::new(
        client.clone(),
        connection.clone(),
        sessions.clone(),
        catalogs.clone(),
        capabilities.clone(),
        options.drain_timeout,
        scope.clone(),
    );
    let service = Arc::new(service::Service {
        client,
        connection: connection.clone(),
        catalogs,
        sessions,
        capabilities,
        turns,
        version: options.version,
    });
    connection::run(
        connection,
        writer,
        input,
        output,
        Arc::new(agent::Agent { service }),
    )
    .await
}

/// `opencode acp`: starts the private server with `server_command` (`TsCommand::standalone`), serves
/// stdio, and returns the failure to report, if any. The caller exits 1 when there is one.
pub fn run(
    server_command: &[OsString],
    print_logs: bool,
    version: &str,
) -> anyhow::Result<Option<String>> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let cwd = std::env::current_dir()?;
    let result = runtime.block_on(serve_stdio(server_command, &cwd, print_logs, version));
    // The stdin reader blocks a thread until EOF; do not wait for it.
    runtime.shutdown_background();
    result
}

async fn serve_stdio(
    server_command: &[OsString],
    cwd: &Path,
    print_logs: bool,
    version: &str,
) -> anyhow::Result<Option<String>> {
    let mut server = opencode_service::standalone::start(server_command, cwd, print_logs).await?;
    let client = server.endpoint.client(Arc::new(Reqwest::default()))?;
    let served = serve(
        client,
        tokio::io::stdin(),
        tokio::io::stdout(),
        Options::new(version),
    );
    tokio::select! {
        closed = served => Ok(match closed {
            Closed::TooLarge(limit) => Some(format!(
                "incoming message exceeded the {} MiB limit",
                limit / 1024 / 1024
            )),
            Closed::Eof | Closed::Read(_) | Closed::Write(_) => None,
        }),
        exited = server.wait() => Ok(Some(format!(
            "server exited unexpectedly ({})",
            match exited {
                Ok(status) => exit_reason(status),
                Err(error) => error.to_string(),
            }
        ))),
    }
}

fn exit_reason(status: std::process::ExitStatus) -> String {
    use std::os::unix::process::ExitStatusExt as _;
    if let Some(code) = status.code() {
        return format!("code {code}");
    }
    let signal = status.signal().unwrap_or_default();
    let name = match signal {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        7 => "SIGBUS",
        8 => "SIGFPE",
        9 => "SIGKILL",
        10 => "SIGUSR1",
        11 => "SIGSEGV",
        12 => "SIGUSR2",
        13 => "SIGPIPE",
        14 => "SIGALRM",
        15 => "SIGTERM",
        _ => return format!("signal {signal}"),
    };
    format!("signal {name}")
}
