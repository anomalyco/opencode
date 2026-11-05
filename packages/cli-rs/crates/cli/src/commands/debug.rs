//! `debug`: debugging and troubleshooting tools (`packages/cli/src/commands/handlers/debug/*.ts`).

use std::path::Path;
use std::sync::{Arc, LazyLock};

use opencode_api::client::RequestOptions;
use opencode_api::error::Error as ApiError;
use opencode_api::generated::types::DebugHeapDumpInput;
use opencode_api::transport::{Reqwest, Transport};
use opencode_local::channel::Channels;
use opencode_local::paths::Paths;
use opencode_service::connect::{self, Env, Options};
use opencode_service::discover;
use opencode_service::probe::Endpoint;
use regex::Regex;
use serde_json::Value;

use super::Context;
use super::client::{block_on, connect, get_located, locale_compare, pretty};
use crate::args::{DebugArgs, DebugCommand, HeapDumpArgs, PathName, PathsArgs};
use crate::output::{Exit, print};

pub fn run(context: &Context, args: &DebugArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["debug"]),
        Some(DebugCommand::Agents(_)) => agents(context),
        Some(DebugCommand::Config(_)) => config(context),
        Some(DebugCommand::HeapDump(args)) => heap_dump(context, args),
        Some(DebugCommand::Paths(args)) => paths(args),
    }
}

fn agents(context: &Context) -> anyhow::Result<()> {
    let response = block_on(async {
        let server = connect(context).await?;
        get_located(&server.client, "/api/agent", &[400, 401, 404, 503]).await
    })??;
    let mut agents = super::models::data(&response).to_vec();
    agents.sort_by(|a, b| locale_compare(a["id"].as_str().unwrap_or_default(), b["id"].as_str().unwrap_or_default()));
    print(&pretty(&Value::Array(agents))?)
}

fn config(context: &Context) -> anyhow::Result<()> {
    let entries = block_on(async {
        let server = connect(context).await?;
        get_located(&server.client, "/api/config", &[400, 401, 404]).await
    })??;
    print(&pretty(&redact(&entries, false))?)
}

// Redact only the debug output; the resolved configuration must remain usable by providers
// (`debug/redact.ts`).
static SECRET_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:api.?key|secret|password|token$|authorization$|cookie$|credential|private.?key)")
        .expect("valid pattern")
});

fn redact(value: &Value, headers: bool) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(|item| redact(item, headers)).collect()),
        Value::Object(map) => {
            Value::Object(map.iter().map(|(key, item)| (key.clone(), redact_entry(key, item, headers))).collect())
        }
        value => value.clone(),
    }
}

fn redact_entry(key: &str, item: &Value, headers: bool) -> Value {
    let hidden = || Value::String("***".to_owned());
    if let Value::String(text) = item {
        if headers || SECRET_NAME.is_match(key) {
            return hidden();
        }
        let lower = text.get(..8).unwrap_or(text).to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            let Ok(url) = url::Url::parse(text) else {
                return hidden();
            };
            if !url.username().is_empty()
                || url.password().is_some()
                || url.query_pairs().any(|(name, _)| SECRET_NAME.is_match(&name))
            {
                return hidden();
            }
        }
    }
    redact(item, headers || key.eq_ignore_ascii_case("headers"))
}

// Every failure goes to stderr as its bare message with exit 1, as the TS handler's `Effect.catch`
// does.
fn heap_dump(context: &Context, args: &HeapDumpArgs) -> anyhow::Result<()> {
    match block_on(capture(context, args))? {
        Ok(()) => Ok(()),
        Err(error) => {
            eprintln!("{}", super::auth::error_message(&error));
            Err(Exit(1).into())
        }
    }
}

async fn capture(context: &Context, args: &HeapDumpArgs) -> anyhow::Result<()> {
    let transport: Arc<dyn Transport> = Arc::new(Reqwest::default());
    let endpoint = running(transport.clone(), context.server.server.clone()).await?;
    let client = endpoint.client(transport)?;
    // The server writes the file, so a relative directory resolves against this shell. An absolute
    // one passes through untouched, which keeps a POSIX path for a remote server intact on Windows.
    let directory = match &args.directory {
        Some(value) if Path::new(value).is_absolute() => Some(value.clone()),
        Some(value) => Some(normalize(&format!("{}/{value}", std::env::current_dir()?.display()), false)),
        None => None,
    };
    let snapshot = client
        .debug_heap_dump(&DebugHeapDumpInput { directory: directory.clone() }, &RequestOptions::default())
        .await
        .map_err(|error| match error {
            ApiError::UnexpectedStatus { status: 404 } => anyhow::anyhow!(
                "The server at {} does not support heap dumps. Update and restart it first.",
                endpoint.url
            ),
            error => error.into(),
        })?;
    // Servers released before `directory` existed ignore it and write into their log directory.
    // Join the way the server does, with the path style of its machine.
    if let Some(directory) = directory
        && !written_in(&snapshot.path, &directory)
    {
        eprintln!("The server ignored --directory. Update and restart it to choose where snapshots go.");
    }
    print(&format!("{}\n", snapshot.path))
}

// A fresh server has nothing worth capturing, so only an already-running one is used: never
// start, replace, or restart the background service.
async fn running(transport: Arc<dyn Transport>, server: Option<String>) -> anyhow::Result<Endpoint> {
    let paths = Paths::from_env()?;
    let env = Env::from_env();
    if server.is_some() {
        let options = Options {
            server,
            standalone: false,
            client_version: crate::help::VERSION.to_owned(),
            standalone_fallback: false,
            on_start: None,
        };
        return Ok(connect::resolve(transport, &paths, &env, &options).await?.endpoint);
    }
    match discover::discover(transport.as_ref(), &paths, env.channel.as_deref()).await {
        Ok(found) => Ok(found.service.endpoint),
        Err(_) => anyhow::bail!(
            "No background server is running. Pass --server <url> to capture a server started another way."
        ),
    }
}

/// Whether the server joined `directory` and the snapshot's file name into `path`.
fn written_in(path: &str, directory: &str) -> bool {
    let windows =
        path.starts_with("\\\\") || path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic();
    let separators: &[char] = if windows { &['/', '\\'] } else { &['/'] };
    let name = path.trim_end_matches(separators).rsplit(separators).next().unwrap_or_default();
    let separator = if windows { '\\' } else { '/' };
    normalize(&format!("{directory}{separator}{name}"), windows) == path
}

/// `path.normalize` without a trailing separator: collapses separators, `.`, and `..`. Windows
/// paths keep their drive or UNC prefix and use `\`.
pub(super) fn normalize(path: &str, windows: bool) -> String {
    let separator = if windows { '\\' } else { '/' };
    let path = if windows { path.replace('/', "\\") } else { path.to_owned() };
    let (prefix, rest) = match windows && path.as_bytes().get(1) == Some(&b':') {
        true => path.split_at(2),
        false => ("", path.as_str()),
    };
    let unc = windows && rest.starts_with("\\\\");
    let rooted = rest.starts_with(separator);
    let mut parts: Vec<&str> = Vec::new();
    for part in rest.split(separator).filter(|part| !part.is_empty() && *part != ".") {
        match part {
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            ".." if rooted => {}
            part => parts.push(part),
        }
    }
    let root = match (unc, rooted) {
        (true, _) => "\\\\",
        (false, true) if windows => "\\",
        (false, true) => "/",
        (false, false) => "",
    };
    let body = parts.join(&separator.to_string());
    if prefix.is_empty() && root.is_empty() && body.is_empty() {
        return ".".to_owned();
    }
    format!("{prefix}{root}{body}")
}

fn paths(args: &PathsArgs) -> anyhow::Result<()> {
    let mut paths = Paths::from_env()?;
    // The TS `Global` layer creates the directories and resolves tmp before any command runs.
    for directory in [&paths.data, &paths.config, &paths.state, &paths.log, &paths.bin, &paths.repos, &paths.tmp] {
        std::fs::create_dir_all(directory)?;
    }
    paths.tmp = paths.tmp.canonicalize()?;
    let db = database(&paths.data);
    let show = |path: &Path| path.display().to_string();
    let entries = [
        ("home", show(&paths.home)),
        ("data", show(&paths.data)),
        ("cache", show(&paths.cache)),
        ("config", show(&paths.config)),
        ("state", show(&paths.state)),
        ("tmp", show(&paths.tmp)),
        ("bin", show(&paths.bin)),
        ("log", show(&paths.log)),
        ("repos", show(&paths.repos)),
        ("db", db),
    ];
    let Some(name) = args.name else {
        return print(&entries.iter().map(|(key, value)| format!("{key:<10} {value}\n")).collect::<String>());
    };
    let key = match name {
        PathName::Db => "db",
        PathName::Home => "home",
        PathName::Data => "data",
        PathName::Config => "config",
        PathName::Cache => "cache",
        PathName::State => "state",
        PathName::Tmp => "tmp",
        PathName::Bin => "bin",
        PathName::Log => "log",
        PathName::Repos => "repos",
    };
    let value = entries.iter().find(|(entry, _)| *entry == key).map(|(_, value)| value.as_str()).unwrap_or_default();
    print(&format!("{value}\n"))
}

/// `databasePath` (`packages/cli/src/database-path.ts`), with the channel read at run time
/// (`OPENCODE_CHANNEL`, else `latest`) instead of the TS build's embedded channel.
fn database(data: &Path) -> String {
    let filename = std::env::var("OPENCODE_DB").unwrap_or_else(|_| {
        let channel = Channels::from_env().channel;
        let disabled = matches!(std::env::var("OPENCODE_DISABLE_CHANNEL_DB").as_deref(), Ok("1" | "true"));
        if disabled || matches!(channel.as_str(), "latest" | "dev" | "beta" | "next" | "prod") {
            return "opencode.db".to_owned();
        }
        let safe: String = channel
            .chars()
            .map(|c| match c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                true => c,
                false => '-',
            })
            .collect();
        format!("opencode-{safe}.db")
    });
    if filename == ":memory:" {
        return filename;
    }
    if Path::new(&filename).is_absolute() {
        return normalize(&filename, false);
    }
    normalize(&format!("{}/{filename}", data.display()), false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redact_matches_the_ts_cases() {
        // Cases of `packages/cli/test/debug-redact.test.ts` where they exist, plus each branch.
        let input = json!({
            "provider": {
                "openai": {
                    "options": {
                        "apiKey": "sk-1",
                        "baseURL": "https://api.openai.com/v1",
                        "headers": { "X-Custom": "v", "nested": { "a": "b" } },
                    },
                },
            },
            "mcp": {
                "a": { "url": "https://user:pw@example.com" },
                "b": { "url": "https://example.com/?access_token=1" },
                "c": { "url": "https://example.com/?q=1" },
                "d": { "url": "http://[bad" },
            },
            "list": [{ "password": "x" }, "plain"],
            "githubToken": "t",
            "tokenizer": "kept",
            "count": 3,
        });
        assert_eq!(
            redact(&input, false),
            json!({
                "provider": {
                    "openai": {
                        "options": {
                            "apiKey": "***",
                            "baseURL": "https://api.openai.com/v1",
                            "headers": { "X-Custom": "***", "nested": { "a": "***" } },
                        },
                    },
                },
                "mcp": {
                    "a": { "url": "***" },
                    "b": { "url": "***" },
                    "c": { "url": "https://example.com/?q=1" },
                    "d": { "url": "***" },
                },
                "list": [{ "password": "***" }, "plain"],
                "githubToken": "***",
                "tokenizer": "kept",
                "count": 3,
            })
        );
    }

    // The two redaction cases of `packages/cli/test/debug-config.test.ts`.
    #[test]
    fn redact_matches_debug_config_test() {
        let providers = json!({
            "settings": { "apiKey": "sk-example", "timeout": 1200 },
            "headers": { "Authorization": "Bearer example", "X-API-Key": "key", "X-Custom": "opaque" },
            "models": { "demo": { "request": { "headers": { "x-auth-token": "model-secret" } } } },
            "oauth": { "client_secret": "oauth-secret", "client_id": "public" },
        });
        assert_eq!(
            redact(&providers, false),
            json!({
                "settings": { "apiKey": "***", "timeout": 1200 },
                "headers": { "Authorization": "***", "X-API-Key": "***", "X-Custom": "***" },
                "models": { "demo": { "request": { "headers": { "x-auth-token": "***" } } } },
                "oauth": { "client_secret": "***", "client_id": "public" },
            })
        );
        let input = json!({
            "mcp": {
                "local": { "environment": { "SERVICE_TOKEN": "token-value", "PATH": "/usr/bin" } },
                "remote": { "url": "https://user:pass@example.com/mcp", "headers": { "x-custom": "opaque" } },
            },
            "url": "https://example.com/api?api_key=secret&mode=debug",
            "max_tokens": 100,
        });
        assert_eq!(
            redact(&input, false),
            json!({
                "mcp": {
                    "local": { "environment": { "SERVICE_TOKEN": "***", "PATH": "/usr/bin" } },
                    "remote": { "url": "***", "headers": { "x-custom": "***" } },
                },
                "url": "***",
                "max_tokens": 100,
            })
        );
    }

    #[test]
    fn normalize_follows_node_path() {
        assert_eq!(normalize("/a//b/./c/../d/", false), "/a/b/d");
        assert_eq!(normalize("/../a", false), "/a");
        assert_eq!(normalize("a/../../b", false), "../b");
        assert_eq!(normalize("C:/snap\\x/../y", true), "C:\\snap\\y");
        assert_eq!(normalize("\\\\host\\share\\a", true), "\\\\host\\share\\a");
    }

    #[test]
    fn written_in_tolerates_a_trailing_separator() {
        assert!(written_in("/tmp/snaps/heap-1.heapsnapshot", "/tmp/snaps/"));
        assert!(!written_in("/var/log/heap-1.heapsnapshot", "/tmp/snaps"));
        assert!(written_in("C:\\snaps\\heap.heapsnapshot", "C:/snaps"));
    }
}
