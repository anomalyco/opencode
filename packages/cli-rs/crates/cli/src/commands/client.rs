//! What the commands that talk to a server share (C.1): the connection, a runtime, raw JSON reads,
//! and `localeCompare` ordering.

use std::cmp::Ordering;
use std::future::Future;
use std::sync::Arc;

use opencode_api::client::{Call, Client, RequestOptions};
use opencode_api::generated::types::LocationQueryInput;
use opencode_api::transport::{Reqwest, Transport};
use opencode_local::paths::Paths;
use opencode_service::connect::{self, Connection, Env, Options};
use opencode_service::probe::Endpoint;
use serde_json::Value;

use super::Context;

/// Runs `future` to completion on a runtime of its own; handlers are synchronous.
pub fn block_on<F: Future>(future: F) -> anyhow::Result<F::Output> {
    Ok(tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(future))
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
pub async fn connect(context: &Context) -> anyhow::Result<Connected> {
    connect_in(context, &Paths::from_env()?, &Env::from_env(), false).await
}

/// `ServerConnection.resolve({ autostart: false })` (`run`): a running service, else a standalone server, so a
/// one-off command never leaves a new service running.
pub async fn connect_without_autostart(context: &Context) -> anyhow::Result<Connected> {
    connect_in(context, &Paths::from_env()?, &Env::from_env(), true).await
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
) -> anyhow::Result<Connected> {
    let transport: Arc<dyn Transport> = Arc::new(Reqwest::default());
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
    Ok(Connected {
        client: connection.endpoint.client(transport)?,
        _connection: connection,
    })
}

/// `{ location: { directory: process.cwd() } }`, the location every read command sends.
pub fn here() -> anyhow::Result<LocationQueryInput> {
    Ok(LocationQueryInput {
        directory: Some(std::env::current_dir()?.to_string_lossy().into_owned()),
    })
}

/// `GET path?location[directory]=<cwd>` as JSON, undecoded. The TypeScript Promise client returns
/// the wire JSON, and `debug agents` and `debug config` print it as it came, unknown fields included.
pub async fn get_located(
    client: &Client,
    path: &str,
    declared: &'static [u16],
) -> anyhow::Result<Value> {
    let mut call = Call::new("GET", path.to_owned(), 200, declared);
    call.query("location", &here()?)?;
    Ok(client.json(call, &RequestOptions::default()).await?)
}

/// `JSON.stringify(value, null, 2)` plus a newline.
pub fn pretty(value: &Value) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(value)? + "\n")
}

/// `a.localeCompare(b)` for the root locale, as Bun's ICU orders ASCII: punctuation and symbols
/// first in ICU's order, then digits, then letters without regard to case; ties go to lowercase
/// first, then to code points. Other characters sort after letters by code point.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let primary = |s: &str| s.chars().map(primary).collect::<Vec<_>>();
    let tertiary = |s: &str| s.chars().map(|c| c.is_uppercase()).collect::<Vec<_>>();
    primary(a)
        .cmp(&primary(b))
        .then_with(|| tertiary(a).cmp(&tertiary(b)))
        .then_with(|| a.cmp(b))
}

// ICU's root order of the ASCII punctuation and symbols, checked against Bun.
const SYMBOLS: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary(c: char) -> (u8, u32) {
    if let Some(index) = SYMBOLS.find(c) {
        return (0, index as u32);
    }
    if c.is_ascii_digit() {
        return (1, c as u32);
    }
    if c.is_ascii_alphabetic() {
        return (2, c.to_ascii_lowercase() as u32);
    }
    (3, c as u32)
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

    #[tokio::test]
    async fn a_standalone_server_lives_as_long_as_the_connection() {
        if std::process::Command::new("bun")
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("skipped: bun is not on PATH");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("standalone.ts");
        std::fs::write(&script, STANDALONE).unwrap();
        // `OPENCODE_TS_BIN` names one executable.
        let program = dir.path().join("opencode-ts");
        std::fs::write(
            &program,
            format!("#!/bin/sh\nexec bun {}\n", script.display()),
        )
        .unwrap();
        std::fs::set_permissions(
            &program,
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .unwrap();
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
        let env = Env {
            ts_bin: Some(program.to_string_lossy().into_owned()),
            ..Env::default()
        };
        let context = Context {
            server: ServerFlags {
                standalone: true,
                server: None,
            },
        };
        // The commands bind the result as these lines do; `let (_, client)` stopped the server here.
        let server = connect_in(&context, &paths, &env, false).await.unwrap();
        let info = server.client.server_info(&RequestOptions::default()).await;
        assert_eq!(info.unwrap().version, "test");
    }

    #[test]
    fn locale_compare_matches_bun() {
        // From `bun -e` with `toSorted((a, b) => a.localeCompare(b))`.
        let mut words = [
            "a-b",
            "a/b",
            "ab",
            "a.b",
            "A-b",
            "a_b",
            "aB",
            "Ab",
            "ab",
            "9",
            "10",
            "~",
            "openai/gpt-5",
            "openai-x/a",
            "OpenAI/b",
        ];
        words.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(
            words,
            [
                "~",
                "10",
                "9",
                "a_b",
                "a-b",
                "A-b",
                "a.b",
                "a/b",
                "ab",
                "ab",
                "aB",
                "Ab",
                "openai-x/a",
                "OpenAI/b",
                "openai/gpt-5",
            ]
        );
    }
}
