//! `pair`: one-time links for a browser or app (C.9).
//!
//! Ports `packages/cli/src/commands/handlers/pair.ts`. `--remote` turns remote access on through the
//! TS `service set remote true` (D.1) after the user's consent, then waits for the tunnel URL to appear
//! in `/api/info`.

use std::time::Duration;

use opencode_api::client::{Client, RequestOptions};
use opencode_local::service_config::Info;
use opencode_service::delegate;
use opencode_service::ts_command::TsCommand;
use opencode_ui::qr;

use super::Context;
use super::client::block_on;
use super::service::Local;
use crate::args::PairArgs;
use crate::output::{Exit, print};
use crate::prompt;

const NOT_ENABLED: &str = "Remote access was not enabled. To pair locally, run `opencode pair`.";

pub const REMOTE_WARNING: &str = "This will expose your OpenCode server to the internet.\nTraffic is end-to-end encrypted, and access requires your server password.\nTo pair locally instead, run `opencode pair` without the --remote flag.";

pub fn run(_context: &Context, args: &PairArgs) -> anyhow::Result<()> {
    let local = Local::from_env()?;
    let config = local.config().read()?;
    if config.disabled == Some(true) {
        anyhow::bail!(
            "Pairing requires the background service; run `opencode service unset disabled` first"
        );
    }
    if args.remote && args.url.is_some() {
        anyhow::bail!("--remote cannot be combined with --url");
    }
    if args.remote && config.remote.is_none() {
        if !consent(&local, &config, args.yes)? {
            return Ok(());
        }
        // Changing the setting restarts the service, and the ensure below starts it again with the tunnel.
        let child = delegate::enable_remote(&TsCommand::from_env())?;
        match delegate::exit_code(crate::signals::wait_child(
            "enable remote access",
            child,
            false,
        )?) {
            0 => {}
            code => return Err(Exit(u8::try_from(code).unwrap_or(1)).into()),
        }
    }
    block_on(pair(&local, args))?
}

async fn pair(local: &Local, args: &PairArgs) -> anyhow::Result<()> {
    let found = local.ensure().await?;
    let endpoint = found.service.endpoint;
    let client = endpoint.client(local.transport())?;
    let urls = match &args.url {
        _ if args.remote => vec![remote_url(local, &client).await?],
        Some(url) => vec![url.clone()],
        None => client.server_info(&RequestOptions::default()).await?.urls,
    };
    let pairing = client.server_pair(&RequestOptions::default()).await?;
    print(&links(&urls, &pairing.code, pairing.expires_in))?;
    if args.remote || args.url.is_some() {
        return Ok(());
    }
    if let Some(hint) = ssh_hint(&endpoint.url) {
        eprint!("{hint}");
    }
    Ok(())
}

/// The links, and a QR code of the reachable ones, as TS prints them to stdout.
fn links(urls: &[String], code: &str, expires_in: i64) -> String {
    let links: Vec<String> = urls.iter().map(|url| connect_link(url, code)).collect();
    // Loopback URLs are useless to the scanning device, so the QR code only carries reachable addresses.
    let remote: Vec<&String> = urls
        .iter()
        .filter(|url| {
            !url::Url::parse(url).is_ok_and(|url| is_loopback(url.host_str().unwrap_or("")))
        })
        .collect();
    let mut lines = vec![
        String::new(),
        format!(
            "  Open a link to connect. Links work once and expire in {} minutes.",
            js_round(expires_in as f64 / 60.0)
        ),
        String::new(),
    ];
    if links.is_empty() {
        lines.push("  (no server URLs)".into());
    }
    lines.extend(links.iter().map(|link| format!("  {link}")));
    if !remote.is_empty() {
        let payload = serde_json::json!({ "code": code, "urls": remote }).to_string();
        lines.push(String::new());
        lines.push(
            qr::render_unicode_compact(&payload, 2)
                .split('\n')
                .map(|line| format!("  {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    lines.push(String::new());
    lines.join("\n") + "\n"
}

// `new URL(`/auth/connect/${code}`, url).href`.
fn connect_link(url: &str, code: &str) -> String {
    url::Url::parse(url)
        .and_then(|base| base.join(&format!("/auth/connect/{code}")))
        .map_or_else(|_| format!("{url}/auth/connect/{code}"), String::from)
}

/// The SSH port-forwarding hint for a service on a loopback address, for stderr.
fn ssh_hint(endpoint: &str) -> Option<String> {
    let url = url::Url::parse(endpoint).ok()?;
    let host = url.host_str()?;
    if !["localhost", "127.0.0.1", "[::1]"].contains(&host) {
        return None;
    }
    let port = url.port().map(|port| port.to_string()).unwrap_or_default();
    Some(
        [
            "  Over SSH? Forward the port, then open the link on your machine:".to_string(),
            format!("  ssh -L {port}:{host}:{port} <host>"),
            format!(
                "  If port {port} is busy locally, forward another port and use it in the link."
            ),
            String::new(),
            "  To connect from other devices, run `opencode service set hostname 0.0.0.0`.".into(),
            String::new(),
        ]
        .join("\n")
            + "\n",
    )
}

fn is_loopback(hostname: &str) -> bool {
    hostname == "localhost"
        || hostname.ends_with(".localhost")
        || hostname.starts_with("127.")
        || hostname == "[::1]"
}

// `Math.round`: halves round up.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// `remoteConsent`: remote access is explained and accepted only the first time it is turned on. Returns
/// whether it may be enabled; a refusal without a terminal or a cancel ends the command with its exit code.
fn consent(local: &Local, config: &Info, yes: bool) -> anyhow::Result<bool> {
    if config.remote.is_some() || config.remote_accepted {
        return Ok(true);
    }
    if !yes && !prompt::is_interactive() {
        eprintln!("{REMOTE_WARNING}\nRun interactively or pass --yes to continue.");
        return Err(Exit(1).into());
    }
    prompt::log::warn(REMOTE_WARNING);
    if !yes {
        match prompt::confirm("Expose your server to the internet?")
            .initial_value(true)
            .prompt()
        {
            Err(prompt::Cancelled) => {
                prompt::cancel(NOT_ENABLED);
                return Err(Exit(130).into());
            }
            Ok(false) => {
                prompt::log::info(NOT_ENABLED);
                return Ok(false);
            }
            Ok(true) => {}
        }
    }
    local.config().accept_remote()?;
    Ok(true)
}

/// The tunnel URL of the service, once the tunnel is attached: the service attaches it in the
/// background, so poll `/api/info` every second for up to 3 minutes. The route is read from this
/// client's channel (parity/deviations/C41-pair-remote-channel.md).
async fn remote_url(local: &Local, client: &Client) -> anyhow::Result<String> {
    let attempt = async || -> Option<String> {
        let route = local.config().read().ok()?.remote?.route;
        let hostname = delegate::tunnel_hostname(&local.paths, &route).ok()??;
        let info = client.server_info(&RequestOptions::default()).await.ok()?;
        info.urls.into_iter().find(|candidate| {
            url::Url::parse(candidate).is_ok_and(|url| url.host_str() == Some(hostname.as_str()))
        })
    };
    let poll = async {
        loop {
            if let Some(url) = attempt().await {
                return url;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(180), poll)
        .await
        .map_err(|_| {
            anyhow::anyhow!(
                "Timed out waiting for the remote tunnel; run `opencode pair --remote` again to retry.\nBehind an HTTP proxy, give the background service its address with `opencode service set env HTTPS_PROXY <url>` (and `NO_PROXY` for hosts to reach directly)."
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_follow_the_server_urls() {
        let text = links(
            &["http://127.0.0.1:4096".into(), "http://[::1]:4096/".into()],
            "abc",
            600,
        );
        assert_eq!(
            text,
            "\n  Open a link to connect. Links work once and expire in 10 minutes.\n\n  http://127.0.0.1:4096/auth/connect/abc\n  http://[::1]:4096/auth/connect/abc\n\n"
        );
        assert!(links(&[], "abc", 90).contains("expire in 2 minutes.\n\n  (no server URLs)\n"));
        let remote = links(&["https://x.example/base".into()], "abc", 600);
        assert!(remote.contains("  https://x.example/auth/connect/abc\n\n  ████"));
    }

    #[test]
    fn the_ssh_hint_is_only_for_loopback() {
        assert_eq!(
            ssh_hint("http://127.0.0.1:4096").unwrap().lines().nth(1),
            Some("  ssh -L 4096:127.0.0.1:4096 <host>")
        );
        assert!(ssh_hint("http://[::1]:5/").is_some());
        assert!(ssh_hint("http://0.0.0.0:4096").is_none());
        assert!(ssh_hint("http://127.0.0.2:4096").is_none());
    }

    #[test]
    fn loopback_hosts() {
        for host in [
            "localhost",
            "a.localhost",
            "127.0.0.1",
            "127.9.9.9",
            "[::1]",
        ] {
            assert!(is_loopback(host), "{host}");
        }
        for host in ["0.0.0.0", "10.0.0.1", "example.com", "[::2]"] {
            assert!(!is_loopback(host), "{host}");
        }
    }
}
