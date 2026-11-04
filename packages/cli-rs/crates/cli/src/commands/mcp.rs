//! `mcp`: MCP servers (`packages/cli/src/commands/handlers/mcp/*.ts`).

use std::path::{Path, PathBuf};

use opencode_api::generated::{
    ConnectionInfo, CredentialRemoveInput, IntegrationGetInput, IntegrationInfo, IntegrationMethod,
    McpListInput, McpServer, McpServerStatus,
};
use opencode_local::jsonc::{self, Segment};
use opencode_local::paths::Paths;
use serde_json::{Map, Value, json};

use super::Context;
use super::auth::{
    IntegrationChoice, Server, answer_form, js_length, load_integrations, location, oauth_login,
    pad_end, prompted, require_interactive, select_integration,
};
use super::client::locale_compare;
use crate::args::{McpAddArgs, McpArgs, McpAuthArgs, McpCommand, McpLogoutArgs};
use crate::output::print;
use crate::prompt;

pub fn run(context: &Context, args: &McpArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["mcp"]),
        Some(McpCommand::List(_)) => list(context),
        Some(McpCommand::Add(args)) => add(args),
        Some(McpCommand::Auth(args)) => prompted(auth(context, args)),
        Some(McpCommand::Logout(args)) => logout(context, args),
    }
}

// `list`, `add`, and `logout` let failures escape, so they print as `Error: ...` (C40-handler-errors).

fn servers(server: &Server) -> anyhow::Result<Vec<McpServer>> {
    let input = McpListInput {
        location: location()?,
    };
    Ok(server
        .run(server.client().mcp_list(&input, &Default::default()))?
        .data)
}

fn list(context: &Context) -> anyhow::Result<()> {
    let server = Server::connect(context)?;
    let mut servers = servers(&server)?;
    if servers.is_empty() {
        return print("No MCP servers configured\n");
    }
    servers.sort_by(|a, b| locale_compare(&a.name, &b.name));
    let width = servers
        .iter()
        .map(|server| js_length(&server.name))
        .max()
        .unwrap_or(0);
    let lines: Vec<String> = servers
        .iter()
        .map(|server| {
            let (icon, description) = match &server.status {
                McpServerStatus::Connected(_) => ("✓", "connected".to_owned()),
                McpServerStatus::NeedsAuth(_) => ("⚠", "needs authentication".to_owned()),
                McpServerStatus::Failed(failed) => ("✗", format!("failed: {}", failed.error)),
                status => ("○", status.tag().to_owned()),
            };
            format!("{icon} {}  {description}", pad_end(&server.name, width))
        })
        .collect();
    print(&(lines.join("\n") + "\n"))
}

fn add(args: &McpAddArgs) -> anyhow::Result<()> {
    let has_command = !args.command.is_empty();
    let url = args.url.as_deref();
    if url.is_some() && has_command {
        anyhow::bail!("Provide either --url <url> or a command after --, not both");
    }
    if url.is_none() && !has_command {
        anyhow::bail!("Provide either --url <url> or a command after --");
    }
    if let Some(url) = url
        && url::Url::parse(url).is_err()
    {
        anyhow::bail!("Invalid URL: {url}");
    }
    if url.is_some() && !args.env.is_empty() {
        anyhow::bail!("--env is only valid for local MCP servers");
    }
    if has_command && !args.header.is_empty() {
        anyhow::bail!("--header is only valid for remote MCP servers");
    }
    // Repeated keys keep their first place and take the last value, as an object built in order does.
    let record = |pairs: &[(String, String)]| {
        Value::Object(
            pairs
                .iter()
                .map(|(key, value)| (key.clone(), Value::from(value.as_str())))
                .collect::<Map<_, _>>(),
        )
    };
    let server = match url {
        Some(url) if args.header.is_empty() => json!({ "type": "remote", "url": url }),
        Some(url) => json!({ "type": "remote", "url": url, "headers": record(&args.header) }),
        None if args.env.is_empty() => json!({ "type": "local", "command": args.command }),
        None => {
            json!({ "type": "local", "command": args.command, "environment": record(&args.env) })
        }
    };
    let directory = if args.global {
        Paths::from_env()?.config
    } else {
        std::env::current_dir()?
    };
    let path = config_path(&directory);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "{}".to_owned(),
        Err(error) => return Err(error.into()),
    };
    let edited = jsonc::modify(
        &text,
        &[
            Segment::Key("mcp".into()),
            Segment::Key("servers".into()),
            Segment::Key(args.name.clone()),
        ],
        Some(&server),
    )?;
    std::fs::write(&path, edited)?;
    print(&format!(
        "MCP server \"{}\" added to {}\n",
        args.name,
        path.display()
    ))
}

/// `resolveConfigPath`: the first config file that exists, else `opencode.json` in `directory`.
fn config_path(directory: &Path) -> PathBuf {
    let candidates = [
        directory.join("opencode.json"),
        directory.join("opencode.jsonc"),
        directory.join(".opencode").join("opencode.json"),
        directory.join(".opencode").join("opencode.jsonc"),
    ];
    candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or(&candidates[0])
        .clone()
}

fn auth(context: &Context, args: &McpAuthArgs) -> anyhow::Result<()> {
    let name = args.name.as_deref();
    if name.is_none() {
        require_interactive(
            "Pass an MCP server name when running without an interactive terminal",
        )?;
    }
    prompt::intro("Authenticate an MCP server");
    let server = Server::connect(context)?;
    let integrations = load_integrations(&server)?;
    let servers = servers(&server)?;
    let choices = auth_choices(&servers, &integrations);
    if name.is_none() && choices.is_empty() {
        prompt::log::warn("No OAuth-capable MCP servers configured");
        prompt::log::info(&format!(
            "Remote MCP servers support OAuth by default. Add one with `opencode mcp add` or in opencode.json:\n{EXAMPLE}"
        ));
        prompt::outro("Done");
        return Ok(());
    }
    let found = name.and_then(|name| servers.iter().find(|server| server.name == name));
    if let Some(name) = name
        && found.is_none()
    {
        anyhow::bail!("MCP server not found: {name}");
    }
    let integration_id = match found {
        Some(found) => found.integration_id.as_ref().map(ToString::to_string),
        None => Some(select_integration(choices, "MCP server")?),
    };
    let integration = integrations
        .iter()
        .find(|integration| Some(integration.id.to_string()) == integration_id);
    let method = integration.and_then(|integration| {
        integration.methods.iter().find_map(|method| match method {
            IntegrationMethod::Oauth(method) => Some(method),
            _ => None,
        })
    });
    let (Some(integration), Some(method)) = (integration, method) else {
        anyhow::bail!(
            "MCP server \"{}\" is not an OAuth-capable remote server",
            name.unwrap_or("undefined")
        );
    };
    if !integration.connections.is_empty() {
        let needs_auth = servers
            .iter()
            .find(|server| server.integration_id.as_ref() == Some(&integration.id))
            .is_some_and(|server| matches!(server.status, McpServerStatus::NeedsAuth(_)));
        if needs_auth {
            prompt::log::warn(&format!(
                "{} has expired credentials. Re-authenticating...",
                integration.name
            ));
        }
        if !needs_auth && prompt::is_interactive() {
            let again = prompt::confirm(format!(
                "{} already has valid credentials. Re-authenticate?",
                integration.name
            ))
            .prompt()?;
            if !again {
                prompt::outro("Cancelled");
                return Ok(());
            }
        }
    }
    // Re-authenticating replaces the previous sign-in rather than adding an account. The new credential keeps
    // the active one's label, and the old ones go only once it is stored, so a failed attempt keeps them.
    let previous = credential_ids(integration);
    let label = integration
        .connections
        .iter()
        .find_map(|connection| match connection {
            ConnectionInfo::Credential(credential) => Some(credential.label.clone()),
            _ => None,
        });
    let answer = answer_form(method.form.as_deref(), &[])?;
    let _attempt = oauth_login(&server, integration, method, answer, label)?;
    remove(&server, &previous)?;
    prompt::outro("Done");
    Ok(())
}

const EXAMPLE: &str = r#"
  "mcp": {
    "servers": {
      "my-server": {
        "type": "remote",
        "url": "https://example.com/mcp"
      }
    }
  }"#;

/// `mcpAuthChoices`: the servers whose integration has an OAuth method, by name. Each carries the
/// server-owned integration ID, so provider integrations with colliding names never match.
fn auth_choices(servers: &[McpServer], integrations: &[IntegrationInfo]) -> Vec<IntegrationChoice> {
    let mut choices: Vec<IntegrationChoice> = servers
        .iter()
        .filter_map(|server| {
            let integration = integrations
                .iter()
                .find(|integration| Some(&integration.id) == server.integration_id.as_ref())?;
            integration
                .methods
                .iter()
                .any(|method| matches!(method, IntegrationMethod::Oauth(_)))
                .then(|| IntegrationChoice {
                    value: integration.id.to_string(),
                    label: server.name.clone(),
                    category: "MCP",
                    connected: !integration.connections.is_empty(),
                    hint: match &server.status {
                        McpServerStatus::NeedsAuth(_) => Some("needs authentication".to_owned()),
                        McpServerStatus::Failed(_) => Some("failed".to_owned()),
                        McpServerStatus::Disabled(_) => Some("disabled".to_owned()),
                        _ => None,
                    },
                })
        })
        .collect();
    choices.sort_by(|a, b| {
        locale_compare(&a.label, &b.label).then_with(|| locale_compare(&a.value, &b.value))
    });
    choices
}

fn credential_ids(integration: &IntegrationInfo) -> Vec<String> {
    integration
        .connections
        .iter()
        .filter_map(|connection| match connection {
            ConnectionInfo::Credential(credential) => Some(credential.id.to_string()),
            _ => None,
        })
        .collect()
}

fn remove(server: &Server, credentials: &[String]) -> anyhow::Result<()> {
    server.run(async {
        for credential in credentials {
            server
                .client()
                .credential_remove(
                    &CredentialRemoveInput {
                        credential_id: credential.clone().into(),
                    },
                    &Default::default(),
                )
                .await?;
        }
        anyhow::Ok(())
    })
}

fn logout(context: &Context, args: &McpLogoutArgs) -> anyhow::Result<()> {
    let server = Server::connect(context)?;
    let servers = servers(&server)?;
    let Some(found) = servers.iter().find(|server| server.name == args.name) else {
        anyhow::bail!("MCP server not found: {}", args.name);
    };
    // Resolved through the server's own integration ID: provider integrations may share its name.
    let integration = match &found.integration_id {
        Some(integration_id) => {
            let input = IntegrationGetInput {
                integration_id: integration_id.clone(),
                location: location()?,
            };
            Some(
                server
                    .run(server.client().integration_get(&input, &Default::default()))?
                    .data,
            )
        }
        None => None,
    };
    let credentials = integration.as_ref().map(credential_ids).unwrap_or_default();
    if credentials.is_empty() {
        return print(&format!("No stored credentials for {}\n", args.name));
    }
    remove(&server, &credentials)?;
    print(&format!("Removed OAuth credentials for {}\n", args.name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_path_prefers_existing_files_in_order() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(config_path(dir.path()), dir.path().join("opencode.json"));
        std::fs::create_dir(dir.path().join(".opencode")).unwrap();
        std::fs::write(dir.path().join(".opencode/opencode.jsonc"), "{}").unwrap();
        assert_eq!(
            config_path(dir.path()),
            dir.path().join(".opencode/opencode.jsonc")
        );
        std::fs::write(dir.path().join("opencode.jsonc"), "{}").unwrap();
        assert_eq!(config_path(dir.path()), dir.path().join("opencode.jsonc"));
    }
}
