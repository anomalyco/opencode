//! `auth`: integrations and credentials (`packages/cli/src/commands/handlers/auth/*.ts`), and the
//! integration picker of `packages/cli/src/ui/integration-picker.ts`. `mcp auth` (C.6) shares the
//! connection, the OAuth login, and the form.

use std::collections::HashSet;
use std::future::Future;
use std::io::{IsTerminal, Read};
use std::time::Duration;

use indexmap::IndexMap;
use opencode_api::client::{Call, Client, RequestOptions};
use opencode_api::error::Error as ApiError;
use opencode_api::generated::{
    ConnectionInfo, CredentialActivateInput, CredentialRemoveInput,
    ExperimentalIntegrationWellknownAddInput, FormAnswer, FormField, FormValue, FormWhenOp,
    FormWhenValue, IntegrationAttemptMode, IntegrationAttemptStatus,
    IntegrationCommandAttemptStatus, IntegrationCommandCancelInput, IntegrationCommandConnectInput,
    IntegrationCommandStatusInput, IntegrationConnectExternalInput, IntegrationConnectKeyInput,
    IntegrationInfo, IntegrationListInput, IntegrationMethod, IntegrationOAuthMethod,
    IntegrationOauthCancelInput, IntegrationOauthCompleteInput, IntegrationOauthConnectInput,
    IntegrationOauthStatusInput, LocationQueryInput, ModelDefaultInput, SessionMessageShellExit,
};
use serde_json::{Value, json};

use super::Context;
use super::client::{Connected, connect, here, locale_compare, pretty};
use crate::args::{
    AuthAccountArgs, AuthArgs, AuthCommand, AuthExportArgs, AuthImportArgs, AuthListArgs,
    AuthLoginArgs, OutputFormat,
};
use crate::output::{Exit, print};
use crate::prompt::{self, Cancelled, Choice, State, View};

pub fn run(context: &Context, args: &AuthArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["auth"]),
        Some(AuthCommand::List(args)) => caught(list(context, args)),
        Some(AuthCommand::Login(args)) => prompted(login(context, args)),
        Some(AuthCommand::Logout(args)) => prompted(account(context, args, Action::Logout)),
        Some(AuthCommand::Export(args)) => caught(export(context, args)),
        Some(AuthCommand::Import(args)) => caught(import(context, args)),
        Some(AuthCommand::Switch(args)) => prompted(account(context, args, Action::Switch)),
    }
}

// `list`, `export`, and `import` print the bare `errorMessage` of a failure and exit 1.
fn caught(result: anyhow::Result<()>) -> anyhow::Result<()> {
    let Err(error) = result else { return Ok(()) };
    if error.is::<Exit>() {
        return Err(error);
    }
    eprintln!("{}", error_message(&error));
    Err(Exit(1).into())
}

/// `handlePromptErrors`: a cancelled prompt ends with `└  Cancelled` and exit 130; any other failure with
/// its message under `■`, `└  Failed`, and exit 1. All of it on stdout, as Clack writes.
pub(super) fn prompted(result: anyhow::Result<()>) -> anyhow::Result<()> {
    let Err(error) = result else { return Ok(()) };
    if error.is::<Exit>() {
        return Err(error);
    }
    if error.is::<Cancelled>() {
        prompt::cancel("Cancelled");
        return Err(Exit(130).into());
    }
    prompt::log::error(&error_message(&error));
    prompt::outro("Failed");
    Err(Exit(1).into())
}

/// `errorMessage`: a declared error's message, else the client error (`reason: detail`), else the text.
pub(super) fn error_message(error: &anyhow::Error) -> String {
    match error
        .downcast_ref::<ApiError>()
        .and_then(ApiError::declared)
    {
        Some(declared) => declared.message.clone().unwrap_or_default(),
        None => format!("{error:#}"),
    }
}

/// `requireInteractive`: stdin and stdout are terminals.
pub(super) fn require_interactive(message: &str) -> anyhow::Result<()> {
    if prompt::is_interactive() {
        return Ok(());
    }
    anyhow::bail!("{message}")
}

/// A connection and the runtime its requests run on. Prompts block the main thread between requests,
/// so the runtime has a worker of its own that keeps the connection's I/O going.
pub(super) struct Server {
    connected: Connected,
    runtime: tokio::runtime::Runtime,
}

impl Server {
    pub fn connect(context: &Context) -> anyhow::Result<Server> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let connected = runtime.block_on(connect(context))?;
        Ok(Server { connected, runtime })
    }

    pub fn client(&self) -> &Client {
        &self.connected.client
    }

    pub fn run<F: Future>(&self, future: F) -> F::Output {
        self.runtime.block_on(future)
    }
}

pub(super) fn location() -> anyhow::Result<Option<LocationQueryInput>> {
    Ok(Some(here()?))
}

fn options() -> RequestOptions {
    RequestOptions::default()
}

/// `loadIntegrations`: the default model first (the readiness boundary of the plugins that add
/// integrations), then the integrations, OpenCode Go first.
pub(super) fn load_integrations(server: &Server) -> anyhow::Result<Vec<IntegrationInfo>> {
    let location = location()?;
    let mut integrations = server.run(async {
        server
            .client()
            .model_default(
                &ModelDefaultInput {
                    location: location.clone(),
                },
                &options(),
            )
            .await?;
        let list = server
            .client()
            .integration_list(&IntegrationListInput { location }, &options())
            .await?;
        anyhow::Ok(list.data)
    })?;
    integrations.sort_by_key(|integration| integration.id.as_str() != "opencode-go");
    Ok(integrations)
}

// ---------------------------------------------------------------------------------------------------------------
// list, export, import
// ---------------------------------------------------------------------------------------------------------------

fn list(context: &Context, args: &AuthListArgs) -> anyhow::Result<()> {
    let server = Server::connect(context)?;
    let integrations: Vec<IntegrationInfo> = load_integrations(&server)?
        .into_iter()
        .filter(|integration| !integration.connections.is_empty())
        .collect();
    if args.format == OutputFormat::Json {
        let items: Vec<Value> = integrations
            .iter()
            .map(|integration| {
                json!({ "id": integration.id, "name": integration.name, "connections": integration.connections })
            })
            .collect();
        return print(&pretty(&Value::Array(items))?);
    }
    let rows: Vec<(&str, &str, &str)> = integrations
        .iter()
        .flat_map(|integration| {
            integration
                .connections
                .iter()
                .map(|connection| match connection {
                    ConnectionInfo::Credential(credential) => (
                        integration.name.as_str(),
                        credential.label.as_str(),
                        "stored",
                    ),
                    ConnectionInfo::Env(env) => {
                        (integration.name.as_str(), env.name.as_str(), "environment")
                    }
                    ConnectionInfo::Unknown(value) => (
                        integration.name.as_str(),
                        value["name"].as_str().unwrap_or("undefined"),
                        "environment",
                    ),
                })
        })
        .collect();
    if rows.is_empty() {
        return print("No authenticated integrations\n");
    }
    let width = rows.iter().map(|row| js_length(row.0)).max().unwrap_or(0) + 2;
    let lines: Vec<String> = rows
        .iter()
        .map(|(integration, source, kind)| {
            format!(
                "{}{}{kind}",
                pad_end(integration, width),
                pad_end(source, 28)
            )
        })
        .collect();
    print(&(lines.join("\n") + "\n"))
}

fn export(context: &Context, args: &AuthExportArgs) -> anyhow::Result<()> {
    let server = Server::connect(context)?;
    let integration = match &args.target {
        Some(target) => Some(
            resolve_integration(&load_integrations(&server)?, target)?
                .id
                .to_string(),
        ),
        None => None,
    };
    // The credentials as the server sent them; `JSON.stringify` keeps every field.
    let mut credentials = server.run(get(server.client(), "/api/credential"))?;
    let credentials: Vec<Value> = match credentials["data"].take() {
        Value::Array(items) => items,
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|credential| {
        integration
            .as_deref()
            .is_none_or(|id| credential["integrationID"].as_str() == Some(id))
    })
    .collect();
    if std::io::stdout().is_terminal() {
        eprintln!(
            "Warning: the output contains secrets; redirect it to a file or pipe it to auth import"
        );
    }
    print(&pretty(&Value::Array(credentials))?)
}

fn import(context: &Context, args: &AuthImportArgs) -> anyhow::Result<()> {
    if args.file.is_none() && std::io::stdin().is_terminal() {
        anyhow::bail!("Pipe auth export output into stdin or pass a file to import");
    }
    let text = match &args.file {
        Some(file) => read_file(file)?,
        None => {
            let mut text = String::new();
            std::io::stdin().read_to_string(&mut text)?;
            text
        }
    };
    let credentials = legacy::decode(&text).map_err(|error| anyhow::anyhow!("{error}"))?;
    let server = Server::connect(context)?;
    let existing = server.run(get(server.client(), "/api/credential"))?;
    let existing = existing["data"].as_array().cloned().unwrap_or_default();
    let ids: HashSet<&str> = existing
        .iter()
        .filter_map(|credential| credential["id"].as_str())
        .collect();
    let integrations: HashSet<&str> = existing
        .iter()
        .filter_map(|credential| credential["integrationID"].as_str())
        .collect();
    let mut imported = 0;
    for credential in &credentials {
        if ids.contains(credential.id.as_str()) {
            continue;
        }
        // Keep the destination's selections; only integrations new to it adopt the exported one.
        let body = json!({
            "id": credential.id,
            "integrationID": credential.integration_id,
            "label": credential.label,
            "value": credential.value,
            "activate": credential.active && !integrations.contains(credential.integration_id.as_str()),
        });
        let mut call = Call::new("POST", "/api/credential".to_owned(), 200, &[400, 401, 409]);
        call.json(&body)?;
        match server.run(server.client().json::<Value>(call, &options())) {
            Ok(_) => imported += 1,
            Err(ApiError::Declared(error)) if error.status == 409 => {}
            Err(error) => return Err(error.into()),
        }
    }
    let skipped = credentials.len() - imported;
    eprintln!(
        "Imported {imported} {}{}",
        if imported == 1 {
            "credential"
        } else {
            "credentials"
        },
        if skipped > 0 {
            format!(", skipped {skipped} already present")
        } else {
            String::new()
        }
    );
    Ok(())
}

// `Bun.file(file).text()`, with Bun's wording for the common failures.
fn read_file(file: &str) -> anyhow::Result<String> {
    std::fs::read_to_string(file).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => {
            anyhow::anyhow!("ENOENT: no such file or directory, open '{file}'")
        }
        std::io::ErrorKind::PermissionDenied => {
            anyhow::anyhow!("EACCES: permission denied, open '{file}'")
        }
        _ => error.into(),
    })
}

async fn get(client: &Client, path: &str) -> Result<Value, ApiError> {
    client
        .json(
            Call::new("GET", path.to_owned(), 200, &[400, 401]),
            &options(),
        )
        .await
}

/// `CredentialLegacy.Entry` decoding of an `auth export` file, with Effect Schema's messages. Entries come
/// out in schema order; a legacy key credential's `configuration` merges into its `metadata`.
mod legacy {
    use serde_json::{Map, Value};

    pub struct Entry {
        pub id: String,
        pub integration_id: String,
        pub label: String,
        pub active: bool,
        pub value: Value,
    }

    pub fn decode(text: &str) -> Result<Vec<Entry>, String> {
        let value: Value =
            serde_json::from_str(text).map_err(|_| "Expected a valid JSON string".to_owned())?;
        let Value::Array(items) = value else {
            return Err("Expected array".to_owned());
        };
        items
            .iter()
            .enumerate()
            .map(|(index, item)| entry(item, &format!("[{index}]")))
            .collect()
    }

    fn fail(message: &str, at: &str) -> String {
        format!("{message}\n  at {at}")
    }

    fn object<'v>(value: &'v Value, at: &str) -> Result<&'v Map<String, Value>, String> {
        value.as_object().ok_or_else(|| fail("Expected object", at))
    }

    fn field<'v>(object: &'v Map<String, Value>, key: &str, at: &str) -> Result<&'v Value, String> {
        object
            .get(key)
            .ok_or_else(|| fail("Missing key", &format!("{at}[\"{key}\"]")))
    }

    fn string(
        object: &Map<String, Value>,
        key: &str,
        at: &str,
        name: &str,
    ) -> Result<String, String> {
        field(object, key, at)?
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| fail(&format!("Expected {name}"), &format!("{at}[\"{key}\"]")))
    }

    fn entry(item: &Value, at: &str) -> Result<Entry, String> {
        let object = object(item, at)?;
        let id = string(object, "id", at, "Credential.ID")?;
        let integration_id = string(object, "integrationID", at, "Integration.ID")?;
        let label = string(object, "label", at, "string")?;
        let active = field(object, "active", at)?
            .as_bool()
            .ok_or_else(|| fail("Expected boolean", &format!("{at}[\"active\"]")))?;
        let value = credential(field(object, "value", at)?, &format!("{at}[\"value\"]"))?;
        Ok(Entry {
            id,
            integration_id,
            label,
            active,
            value,
        })
    }

    fn credential(value: &Value, at: &str) -> Result<Value, String> {
        let union = || {
            fail(
                "Expected { readonly \"type\": \"oauth\", ... } | { readonly \"type\": \"key\", ... } | { readonly \"type\": \"external\", ... }",
                at,
            )
        };
        let object = value.as_object().ok_or_else(union)?;
        let tag = object.get("type").and_then(Value::as_str);
        let mut out = Map::new();
        out.insert("type".into(), Value::from(tag.unwrap_or_default()));
        match tag {
            Some("oauth") => {
                out.insert(
                    "methodID".into(),
                    string(object, "methodID", at, "Integration.MethodID")?.into(),
                );
                out.insert(
                    "refresh".into(),
                    string(object, "refresh", at, "string")?.into(),
                );
                out.insert(
                    "access".into(),
                    string(object, "access", at, "string")?.into(),
                );
                let expires = field(object, "expires", at)?;
                let at_expires = format!("{at}[\"expires\"]");
                if !expires.is_number() {
                    return Err(fail("Expected number", &at_expires));
                }
                if !expires
                    .as_f64()
                    .is_some_and(|n| n.fract() == 0.0 && n >= 0.0)
                {
                    return Err(fail("Expected an integer", &at_expires));
                }
                out.insert("expires".into(), expires.clone());
                metadata(object, at, &mut out, None)?;
            }
            Some("key") => {
                out.insert("key".into(), string(object, "key", at, "string")?.into());
                let configuration = match object.get("configuration") {
                    Some(configuration) => {
                        Some(answer(configuration, &format!("{at}[\"configuration\"]"))?)
                    }
                    None => None,
                };
                metadata(object, at, &mut out, configuration)?;
            }
            Some("external") => {
                out.insert(
                    "methodID".into(),
                    string(object, "methodID", at, "Integration.MethodID")?.into(),
                );
                metadata(object, at, &mut out, None)?;
            }
            _ => return Err(union()),
        }
        Ok(Value::Object(out))
    }

    fn metadata(
        object: &Map<String, Value>,
        at: &str,
        out: &mut Map<String, Value>,
        configuration: Option<Map<String, Value>>,
    ) -> Result<(), String> {
        let mut metadata = match object.get("metadata") {
            Some(value) => Some(
                value
                    .as_object()
                    .cloned()
                    .ok_or_else(|| fail("Expected object", &format!("{at}[\"metadata\"]")))?,
            ),
            None => None,
        };
        // Form answers overrode metadata when both reached provider settings, so they keep precedence.
        if let Some(configuration) = configuration {
            let merged = metadata.get_or_insert_default();
            merged.extend(configuration);
        }
        if let Some(metadata) = metadata {
            out.insert("metadata".into(), Value::Object(metadata));
        }
        Ok(())
    }

    // `Form.Answer`: a record of strings, numbers, booleans, and string arrays.
    fn answer(value: &Value, at: &str) -> Result<Map<String, Value>, String> {
        let object = object(value, at)?;
        for (key, value) in object {
            let at = format!("{at}[\"{key}\"]");
            match value {
                Value::String(_) | Value::Number(_) | Value::Bool(_) => {}
                Value::Array(items) => {
                    if let Some(index) = items.iter().position(|item| !item.is_string()) {
                        return Err(fail("Expected string", &format!("{at}[{index}]")));
                    }
                }
                _ => return Err(fail("Expected Form.Value", &at)),
            }
        }
        Ok(object.clone())
    }
}

// ---------------------------------------------------------------------------------------------------------------
// logout, switch
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Logout,
    Switch,
}

fn account(context: &Context, args: &AuthAccountArgs, action: Action) -> anyhow::Result<()> {
    if args.target.is_none() {
        require_interactive(
            "Pass an integration ID or name when running without an interactive terminal",
        )?;
    }
    if args.credential.is_none() {
        require_interactive(
            "Pass a credential ID or label when running without an interactive terminal",
        )?;
    }
    prompt::intro(match action {
        Action::Logout => "Log out of an account",
        Action::Switch => "Switch account",
    });
    let server = Server::connect(context)?;
    let integrations = load_integrations(&server)?;
    let integration = choose_integration(&integrations, args.target.as_deref())?;
    let credential = choose_credential(integration, action, args.credential.as_deref())?;
    let mut progress = prompt::spinner();
    let (start, done, failed) = match action {
        Action::Logout => (
            "Removing credential...",
            format!("Removed account from {}", integration.name),
            "Failed to remove credential",
        ),
        Action::Switch => (
            "Switching account...",
            format!("Switched account for {}", integration.name),
            "Failed to switch account",
        ),
    };
    progress.start(start);
    let result = server.run(async {
        match action {
            Action::Logout => {
                server
                    .client()
                    .credential_remove(
                        &CredentialRemoveInput {
                            credential_id: credential.clone().into(),
                        },
                        &options(),
                    )
                    .await
            }
            Action::Switch => {
                server
                    .client()
                    .credential_activate(
                        &CredentialActivateInput {
                            credential_id: credential.clone().into(),
                        },
                        &options(),
                    )
                    .await
            }
        }
    });
    if let Err(error) = result {
        progress.stop_with(failed, 1);
        return Err(error.into());
    }
    progress.stop(&done);
    prompt::outro("Done");
    Ok(())
}

fn choose_integration<'a>(
    integrations: &'a [IntegrationInfo],
    target: Option<&str>,
) -> anyhow::Result<&'a IntegrationInfo> {
    if let Some(target) = target {
        return resolve_integration(integrations, target);
    }
    let configured: Vec<&IntegrationInfo> = integrations
        .iter()
        .filter(|integration| !credentials(integration).is_empty())
        .collect();
    if configured.is_empty() {
        anyhow::bail!("No stored credentials found");
    }
    let choices = configured
        .iter()
        .map(|integration| {
            let labels: Vec<&str> = credentials(integration)
                .iter()
                .map(|credential| credential.1)
                .collect();
            Choice::new(integration.id.to_string(), integration.name.clone())
                .hint(labels.join(", "))
        })
        .collect();
    let id = prompt::autocomplete("Select integration", choices)
        .max_items(8)
        .prompt()?;
    let Some(id) = id else {
        anyhow::bail!("No integration selected");
    };
    configured
        .into_iter()
        .find(|integration| integration.id.as_str() == id)
        .ok_or_else(|| anyhow::anyhow!("Integration not found: {id}"))
}

fn choose_credential(
    integration: &IntegrationInfo,
    action: Action,
    target: Option<&str>,
) -> anyhow::Result<String> {
    let credentials = credentials(integration);
    if credentials.is_empty() {
        let environment: Vec<&str> = integration
            .connections
            .iter()
            .filter_map(|connection| match connection {
                ConnectionInfo::Env(env) => Some(env.name.as_str()),
                _ => None,
            })
            .collect();
        if !environment.is_empty() && action == Action::Logout {
            anyhow::bail!(
                "{} is authenticated through {}; unset the environment variable to disconnect",
                integration.name,
                environment.join(", ")
            );
        }
        anyhow::bail!("No stored credentials for {}", integration.name);
    }
    if let Some(target) = target {
        if let Some((id, _)) = credentials.iter().find(|(id, _)| *id == target) {
            return Ok(id.to_string());
        }
        let matches: Vec<&(&str, &str)> = credentials
            .iter()
            .filter(|(_, label)| label.to_lowercase() == target.to_lowercase())
            .collect();
        if matches.len() == 1 {
            return Ok(matches[0].0.to_string());
        }
        if matches.len() > 1 {
            let ids: Vec<&str> = matches.iter().map(|(id, _)| *id).collect();
            anyhow::bail!(
                "Credential label \"{target}\" is ambiguous. Use an ID: {}",
                ids.join(", ")
            );
        }
        anyhow::bail!("Credential not found for {}: {target}", integration.name);
    }
    let verb = match action {
        Action::Logout => "log out",
        Action::Switch => "switch to",
    };
    let choices = credentials
        .iter()
        .enumerate()
        .map(|(index, (id, label))| {
            let label = if index == 0 {
                format!("{label} (active)")
            } else {
                label.to_string()
            };
            Choice::new(id.to_string(), label).hint(*id)
        })
        .collect();
    prompt::autocomplete(
        format!("Select {} account to {verb}", integration.name),
        choices,
    )
    .max_items(8)
    .prompt()?
    .ok_or_else(|| anyhow::anyhow!("No credential selected"))
}

/// The stored credentials of an integration as `(id, label)`, the active one first.
fn credentials(integration: &IntegrationInfo) -> Vec<(&str, &str)> {
    integration
        .connections
        .iter()
        .filter_map(|connection| match connection {
            ConnectionInfo::Credential(credential) => {
                Some((credential.id.as_str(), credential.label.as_str()))
            }
            _ => None,
        })
        .collect()
}

/// `resolveIntegration`: by ID (without trailing slashes), else by a unique name, ignoring case.
pub(super) fn resolve_integration<'a>(
    integrations: &'a [IntegrationInfo],
    target: &str,
) -> anyhow::Result<&'a IntegrationInfo> {
    let normalized = target.trim_end_matches('/');
    if let Some(integration) = integrations
        .iter()
        .find(|integration| integration.id.as_str() == normalized)
    {
        return Ok(integration);
    }
    let matches: Vec<&IntegrationInfo> = integrations
        .iter()
        .filter(|integration| integration.name.to_lowercase() == normalized.to_lowercase())
        .collect();
    match matches.as_slice() {
        [integration] => Ok(integration),
        [] => anyhow::bail!("Integration not found: {target}"),
        _ => {
            let ids: Vec<&str> = matches
                .iter()
                .map(|integration| integration.id.as_str())
                .collect();
            anyhow::bail!(
                "Integration name \"{target}\" is ambiguous: {}",
                ids.join(", ")
            )
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------------------------------------------

// `login.ts`: these come first in the picker, in this order, under "Popular".
const PRIORITY: [&str; 6] = [
    "opencode-go",
    "opencode",
    "openai",
    "github-copilot",
    "anthropic",
    "google",
];

fn login(context: &Context, args: &AuthLoginArgs) -> anyhow::Result<()> {
    if args.target.is_none() {
        require_interactive(
            "Pass an integration ID or name when running without an interactive terminal",
        )?;
    }
    prompt::intro("Connect an integration");
    let server = Server::connect(context)?;
    let integration = find_integration(&server, args.target.as_deref())?;
    let methods = connect_methods(&integration);
    if methods.is_empty() {
        anyhow::bail!("{} has no interactive login methods", integration.name);
    }
    let method = choose_method(&methods, args.method.as_deref())?;
    let form = match method {
        IntegrationMethod::Oauth(method) => method.form.as_deref(),
        IntegrationMethod::Key(method) => method.form.as_deref(),
        IntegrationMethod::External(method) => method.form.as_deref(),
        _ => None,
    };
    let answer = answer_form(form, &args.answer)?;
    let _attempt = match method {
        IntegrationMethod::Key(method) => {
            key_login(&server, &integration, method.label.as_deref(), answer).map(|()| None)
        }
        IntegrationMethod::Command(method) => {
            command_login(&server, &integration, method.id.as_str()).map(Some)
        }
        IntegrationMethod::External(method) => {
            external_login(&server, &integration, method.id.as_str(), answer).map(|()| None)
        }
        IntegrationMethod::Oauth(method) => {
            oauth_login(&server, &integration, method, answer, None).map(Some)
        }
        _ => anyhow::bail!("Unsupported authentication method"),
    }?;
    prompt::outro("Done");
    Ok(())
}

fn find_integration(server: &Server, target: Option<&str>) -> anyhow::Result<IntegrationInfo> {
    if let Some(target) = target
        && url::Url::parse(target).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
    {
        let mut progress = prompt::spinner();
        progress.start("Discovering authentication provider...");
        let input = ExperimentalIntegrationWellknownAddInput {
            location: location()?,
            url: target.to_owned(),
        };
        match server.run(
            server
                .client()
                .experimental_integration_wellknown_add(&input, &options()),
        ) {
            Ok(()) => progress.stop("Authentication provider discovered"),
            Err(error) => {
                progress.stop_with("Discovery failed", 1);
                return Err(error.into());
            }
        }
    }
    let integrations = load_integrations(server)?;
    if let Some(target) = target {
        return resolve_integration(&integrations, target).cloned();
    }
    let choices = login_choices(&integrations);
    if choices.is_empty() {
        anyhow::bail!("No authentication integrations are available");
    }
    let id = select_integration(choices, "integration")?;
    resolve_integration(&integrations, &id).cloned()
}

fn login_choices(integrations: &[IntegrationInfo]) -> Vec<IntegrationChoice> {
    let mcp = |integration: &IntegrationInfo| {
        integration
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .and_then(Value::as_str)
            == Some("mcp")
    };
    let priority = |integration: &IntegrationInfo| {
        PRIORITY
            .iter()
            .position(|id| *id == integration.id.as_str())
            .unwrap_or(PRIORITY.len())
    };
    let mut choices: Vec<&IntegrationInfo> = integrations
        .iter()
        .filter(|integration| !connect_methods(integration).is_empty())
        .collect();
    choices.sort_by(|a, b| {
        mcp(b)
            .cmp(&mcp(a))
            .then_with(|| priority(a).cmp(&priority(b)))
            .then_with(|| locale_compare(&a.name, &b.name))
            .then_with(|| locale_compare(a.id.as_str(), b.id.as_str()))
    });
    choices
        .into_iter()
        .map(|integration| IntegrationChoice {
            value: integration.id.to_string(),
            label: integration.name.clone(),
            category: if mcp(integration) {
                "MCP"
            } else if priority(integration) < PRIORITY.len() {
                "Popular"
            } else {
                "Services"
            },
            connected: !integration.connections.is_empty(),
            hint: None,
        })
        .collect()
}

/// The methods a person can log in with (all but environment variables), API keys last.
fn connect_methods(integration: &IntegrationInfo) -> Vec<&IntegrationMethod> {
    let mut methods: Vec<&IntegrationMethod> = integration
        .methods
        .iter()
        .filter(|method| {
            !matches!(
                method,
                IntegrationMethod::Env(_) | IntegrationMethod::Unknown(_)
            )
        })
        .collect();
    methods.sort_by_key(|method| matches!(method, IntegrationMethod::Key(_)));
    methods
}

fn method_id(method: &IntegrationMethod) -> &str {
    match method {
        IntegrationMethod::Oauth(method) => method.id.as_str(),
        IntegrationMethod::Command(method) => method.id.as_str(),
        IntegrationMethod::External(method) => method.id.as_str(),
        _ => "key",
    }
}

fn choose_method<'a>(
    methods: &[&'a IntegrationMethod],
    target: Option<&str>,
) -> anyhow::Result<&'a IntegrationMethod> {
    if let Some(target) = target {
        return resolve_method(methods, target);
    }
    if let [method] = methods {
        return Ok(method);
    }
    require_interactive("Pass --method when running without an interactive terminal")?;
    let choices = methods
        .iter()
        .map(|method| {
            let label = match method {
                IntegrationMethod::Key(method) => {
                    method.label.clone().unwrap_or_else(|| "API key".to_owned())
                }
                IntegrationMethod::Oauth(method) => method.label.clone(),
                IntegrationMethod::Command(method) => method.label.clone(),
                IntegrationMethod::External(method) => method.label.clone(),
                _ => String::new(),
            };
            Choice::new(method_id(method).to_owned(), label)
        })
        .collect();
    let id = prompt::select("Select login method", choices).prompt()?;
    resolve_method(methods, &id)
}

fn resolve_method<'a>(
    methods: &[&'a IntegrationMethod],
    target: &str,
) -> anyhow::Result<&'a IntegrationMethod> {
    let normalized = target.to_lowercase();
    let matches: Vec<&'a IntegrationMethod> = methods
        .iter()
        .copied()
        .filter(|method| {
            let label = match method {
                IntegrationMethod::Key(method) => {
                    return normalized == "key"
                        || method.label.as_ref().map(|label| label.to_lowercase())
                            == Some(normalized.clone());
                }
                IntegrationMethod::Oauth(method) => &method.label,
                IntegrationMethod::Command(method) => &method.label,
                IntegrationMethod::External(method) => &method.label,
                _ => return false,
            };
            method_id(method) == target || label.to_lowercase() == normalized
        })
        .collect();
    match matches.as_slice() {
        [method] => Ok(method),
        [] => {
            let available: Vec<&str> = methods.iter().map(|method| method_id(method)).collect();
            let available = if available.is_empty() {
                String::new()
            } else {
                format!(". Available: {}", available.join(", "))
            };
            anyhow::bail!("Authentication method not found: {target}{available}")
        }
        _ => anyhow::bail!("Authentication method \"{target}\" is ambiguous"),
    }
}

/// Runs `request` under a spinner that ends with `done` or, on failure, with `Authentication failed`.
fn saving<T, E: Into<anyhow::Error>>(
    start: &str,
    done: &str,
    request: impl FnOnce() -> Result<T, E>,
) -> anyhow::Result<T> {
    let mut progress = prompt::spinner();
    progress.start(start);
    match request() {
        Ok(value) => {
            progress.stop(done);
            Ok(value)
        }
        Err(error) => {
            progress.stop_with("Authentication failed", 1);
            Err(error.into())
        }
    }
}

fn key_login(
    server: &Server,
    integration: &IntegrationInfo,
    label: Option<&str>,
    answer: Option<FormAnswer>,
) -> anyhow::Result<()> {
    require_interactive("API key input requires an interactive terminal")?;
    let message = label
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Enter your {} API key", integration.name));
    let key = prompt::password(message).validate(required).prompt()?;
    let input = IntegrationConnectKeyInput {
        integration_id: integration.id.clone(),
        location: location()?,
        key,
        answer,
        label: None,
    };
    saving(
        "Saving credential...",
        &format!("Connected to {}", integration.name),
        || server.run(server.client().integration_connect_key(&input, &options())),
    )
}

fn external_login(
    server: &Server,
    integration: &IntegrationInfo,
    method: &str,
    answer: Option<FormAnswer>,
) -> anyhow::Result<()> {
    let input = IntegrationConnectExternalInput {
        integration_id: integration.id.clone(),
        location: location()?,
        method_id: method.into(),
        answer,
        label: None,
    };
    saving(
        "Saving credential...",
        &format!("Connected to {}", integration.name),
        || {
            server.run(
                server
                    .client()
                    .integration_connect_external(&input, &options()),
            )
        },
    )
}

/// The attempt's cancel request, sent when the login ends however it ends (the TS finalizer), and from the
/// shutdown teardown when a signal ends the wait. Errors are ignored.
pub(super) struct Attempt {
    cancel: std::sync::Arc<dyn Fn() + Send + Sync>,
    _registration: crate::signals::Registration,
}

impl Attempt {
    fn new(cancel: impl Fn() + Send + Sync + 'static) -> Attempt {
        let cancel: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(cancel);
        let teardown = cancel.clone();
        Attempt {
            _registration: crate::signals::on_shutdown("cancel the login attempt", move || {
                teardown();
                prompt::cancel("Cancelled");
            }),
            cancel,
        }
    }
}

impl Drop for Attempt {
    fn drop(&mut self) {
        (self.cancel)();
    }
}

/// `oauthLogin`: starts the attempt, shows its instructions and URL (opening it on a terminal), then takes
/// a pasted code or waits for the browser. `label` names the new credential. The attempt is cancelled when
/// the returned guard drops, as the TS finalizer does at the end of the command.
pub(super) fn oauth_login(
    server: &Server,
    integration: &IntegrationInfo,
    method: &IntegrationOAuthMethod,
    answer: Option<FormAnswer>,
    label: Option<String>,
) -> anyhow::Result<Attempt> {
    let location = location()?;
    let input = IntegrationOauthConnectInput {
        integration_id: integration.id.clone(),
        location: location.clone(),
        method_id: method.id.clone(),
        answer,
        label,
    };
    let mut progress = prompt::spinner();
    progress.start("Starting authorization...");
    let attempt = match server.run(
        server
            .client()
            .integration_oauth_connect(&input, &options()),
    ) {
        Ok(started) => started.data,
        Err(error) => {
            progress.stop_with("Authentication failed", 1);
            return Err(error.into());
        }
    };
    let ids = (integration.id.clone(), attempt.attempt_id.clone());
    let guard = {
        let client = server.client().clone();
        let location = location.clone();
        Attempt::new(move || {
            let input = IntegrationOauthCancelInput {
                integration_id: ids.0.clone(),
                attempt_id: ids.1.clone(),
                location: location.clone(),
            };
            let client = client.clone();
            cancel_now(async move { client.integration_oauth_cancel(&input, &options()).await });
        })
    };
    progress.stop("Authorization started");
    prompt::log::info(&attempt.instructions);
    prompt::log::info(&attempt.url);
    if prompt::is_interactive() {
        // Best effort: without a browser opener, the URL is printed above.
        let _ = opencode_tui::features::links::open_url(&attempt.url);
    }
    let connected = format!("Connected to {}", integration.name);
    if attempt.mode == IntegrationAttemptMode::Code {
        require_interactive(
            "This login requires an interactive terminal to enter the authorization code",
        )?;
        let code = prompt::text("Paste the authorization code")
            .validate(required)
            .prompt()?;
        let input = IntegrationOauthCompleteInput {
            integration_id: integration.id.clone(),
            attempt_id: attempt.attempt_id.clone(),
            location,
            code: Some(code),
        };
        saving("Completing authorization...", &connected, || {
            server.run(
                server
                    .client()
                    .integration_oauth_complete(&input, &options()),
            )
        })?;
        return Ok(guard);
    }
    // Waits that can last minutes use log lines, not a spinner, so Ctrl+C reaches the signal teardown,
    // which cancels the attempt.
    prompt::log::step("Waiting for authorization...");
    let input = IntegrationOauthStatusInput {
        integration_id: integration.id.clone(),
        attempt_id: attempt.attempt_id.clone(),
        location,
    };
    let status = server.run(async {
        loop {
            let status = server
                .client()
                .integration_oauth_status(&input, &options())
                .await?
                .data;
            if !matches!(status, IntegrationAttemptStatus::Pending(_)) {
                return anyhow::Ok(status);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })?;
    match status {
        IntegrationAttemptStatus::Complete(_) => {
            prompt::log::success(&connected);
            Ok(guard)
        }
        IntegrationAttemptStatus::Failed(failed) => anyhow::bail!("{}", failed.message),
        _ => anyhow::bail!("Authorization expired"),
    }
}

fn command_login(
    server: &Server,
    integration: &IntegrationInfo,
    method: &str,
) -> anyhow::Result<Attempt> {
    let location = location()?;
    let input = IntegrationCommandConnectInput {
        integration_id: integration.id.clone(),
        location: location.clone(),
        method_id: method.into(),
        label: None,
    };
    let mut progress = prompt::spinner();
    progress.start("Starting authentication command...");
    let attempt = match server.run(
        server
            .client()
            .integration_command_connect(&input, &options()),
    ) {
        Ok(started) => started.data,
        Err(error) => {
            progress.stop_with("Authentication failed", 1);
            return Err(error.into());
        }
    };
    let guard = {
        let client = server.client().clone();
        let input = IntegrationCommandCancelInput {
            integration_id: integration.id.clone(),
            attempt_id: attempt.attempt_id.clone(),
            location: location.clone(),
        };
        Attempt::new(move || {
            let client = client.clone();
            let input = input.clone();
            cancel_now(async move { client.integration_command_cancel(&input, &options()).await });
        })
    };
    progress.stop("Authentication command started");
    prompt::log::step("Waiting for authentication command...");
    let input = IntegrationCommandStatusInput {
        integration_id: integration.id.clone(),
        attempt_id: attempt.attempt_id.clone(),
        location,
    };
    // The status message accumulates the command's stderr; each completed line prints once.
    let mut printed = 0;
    let status = server.run(async {
        loop {
            let status = server
                .client()
                .integration_command_status(&input, &options())
                .await?
                .data;
            let IntegrationCommandAttemptStatus::Pending(pending) = &status else {
                return anyhow::Ok(status);
            };
            if let Some(message) = &pending.message {
                printed = print_completed_lines(message, printed);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })?;
    match status {
        IntegrationCommandAttemptStatus::Complete(_) => {
            prompt::log::success(&format!("Connected to {}", integration.name));
            Ok(guard)
        }
        IntegrationCommandAttemptStatus::Failed(failed) => anyhow::bail!("{}", failed.message),
        _ => anyhow::bail!("Authentication expired"),
    }
}

/// Prints the lines of `message` completed since `printed` (a byte offset) and returns the new offset.
fn print_completed_lines(message: &str, printed: usize) -> usize {
    let (end, output) = completed_lines(message, printed);
    if !output.is_empty() {
        prompt::log::message(output);
    }
    end
}

fn completed_lines(message: &str, printed: usize) -> (usize, &str) {
    let end = message.rfind('\n').map_or(0, |index| index + 1);
    if end <= printed {
        return (printed, "");
    }
    (end, message[printed..end].trim())
}

/// Runs a cancel request to completion within 5 s, on a runtime of its own; errors are ignored.
fn cancel_now(request: impl Future<Output = Result<(), ApiError>> + Send + 'static) {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return;
    };
    let _ = runtime.block_on(async { tokio::time::timeout(Duration::from_secs(5), request).await });
}

fn required(value: &str) -> Option<String> {
    value.is_empty().then(|| "Required".to_owned())
}

// ---------------------------------------------------------------------------------------------------------------
// The form (`auth/form.ts`)
// ---------------------------------------------------------------------------------------------------------------

/// `answerForm`: answers from `--answer key=value`, the defaults of hidden fields, and prompts for the rest.
/// `None` when the method has no form.
pub(super) fn answer_form(
    fields: Option<&[FormField]>,
    input: &[String],
) -> anyhow::Result<Option<FormAnswer>> {
    let mut supplied = IndexMap::new();
    for item in input {
        let Some(separator) = item.find('=').filter(|separator| *separator >= 1) else {
            anyhow::bail!("Expected --answer key=value");
        };
        let key = &item[..separator];
        if !fields.is_some_and(|fields| fields.iter().any(|field| form::key(field) == key)) {
            anyhow::bail!("Unknown form field: {key}");
        }
        supplied.insert(key.to_owned(), item[separator + 1..].to_owned());
    }
    let Some(fields) = fields else {
        return Ok(None);
    };
    let mut answer = FormAnswer::new();
    for field in fields {
        if matches!(field, FormField::Unknown(_)) {
            continue;
        }
        let key = form::key(field);
        if !active(field, &answer) {
            if supplied.contains_key(key) {
                anyhow::bail!("Form field is not active: {key}");
            }
            continue;
        }
        let external = matches!(field, FormField::External(_));
        let value = match supplied.get(key) {
            Some(provided) => Some(supplied_answer(field, provided)?),
            None if !external && hidden(field) => default(field),
            None => answer_field(field)?,
        };
        if !external && let Some(invalid) = form::validate(field, value.as_ref()) {
            anyhow::bail!("{key}: {invalid}");
        }
        if let Some(value) = value {
            answer.insert(key.to_owned(), value);
        }
    }
    Ok(Some(answer))
}

mod form {
    pub use opencode_tui::routes::session::form::{key, validate};
}

fn supplied_answer(field: &FormField, input: &str) -> anyhow::Result<FormValue> {
    match field {
        FormField::External(_) => anyhow::bail!(
            "External form field requires interactive confirmation: {}",
            form::key(field)
        ),
        FormField::String(_) => Ok(FormValue::String(input.to_owned())),
        _ => {
            let value = serde_json::from_str::<Value>(input)
                .ok()
                .and_then(|value| match value {
                    Value::String(text) => Some(FormValue::String(text)),
                    Value::Bool(value) => Some(FormValue::Bool(value)),
                    Value::Number(number) => number.as_f64().map(FormValue::Number),
                    Value::Array(items) => items
                        .into_iter()
                        .map(|item| item.as_str().map(str::to_owned))
                        .collect::<Option<Vec<_>>>()
                        .map(FormValue::Array),
                    _ => None,
                });
            value.ok_or_else(|| {
                anyhow::anyhow!("Expected a JSON value for form field: {}", form::key(field))
            })
        }
    }
}

// The answer kinds of a select: an option's value, Yes or No, "Type your own answer", and Skip.
#[derive(Clone, PartialEq)]
enum Pick {
    Text(String),
    Bool(bool),
    Custom,
    Skip,
}

fn answer_field(field: &FormField) -> anyhow::Result<Option<FormValue>> {
    require_interactive("Authentication form input requires an interactive terminal")?;
    let (title, description) = match field {
        FormField::String(field) => (&field.title, &field.description),
        FormField::Number(field) => (&field.title, &field.description),
        FormField::Integer(field) => (&field.title, &field.description),
        FormField::Boolean(field) => (&field.title, &field.description),
        FormField::Multiselect(field) => (&field.title, &field.description),
        FormField::External(field) => (&field.title, &field.description),
        FormField::Unknown(_) => return Ok(None),
    };
    let message = title.clone().unwrap_or_else(|| form::key(field).to_owned());
    if let Some(description) = description {
        prompt::log::info(description);
    }
    match field {
        FormField::External(external) => {
            prompt::log::info(&external.url);
            let _ = opencode_tui::features::links::open_url(&external.url);
            let question = if message.is_empty() {
                "Continue after completing this step?".to_owned()
            } else {
                message.clone()
            };
            if !prompt::confirm(question).initial_value(true).prompt()? {
                let step = if message.is_empty() {
                    "External step"
                } else {
                    &message
                };
                anyhow::bail!("{step} is required");
            }
            Ok(Some(FormValue::Bool(true)))
        }
        FormField::Boolean(boolean) => {
            if boolean.required == Some(true) {
                let value = prompt::confirm(message)
                    .initial_value(boolean.default.unwrap_or(true))
                    .prompt()?;
                return Ok(Some(FormValue::Bool(value)));
            }
            let choices = vec![
                Choice::new(Pick::Bool(true), "Yes"),
                Choice::new(Pick::Bool(false), "No"),
                Choice::new(Pick::Skip, "Skip"),
            ];
            let initial = boolean.default.map_or(Pick::Skip, Pick::Bool);
            match prompt::select(message, choices)
                .initial_value(initial)
                .prompt()?
            {
                Pick::Bool(value) => Ok(Some(FormValue::Bool(value))),
                _ => Ok(None),
            }
        }
        FormField::Multiselect(multiselect) => {
            let mut choices: Vec<Choice<Pick>> = multiselect
                .options
                .iter()
                .map(|option| option_choice(&option.value, &option.label, &option.description))
                .collect();
            if multiselect.custom == Some(true) {
                choices.push(Choice::new(Pick::Custom, "Type another value"));
            }
            let mut builder = prompt::multiselect(message, choices).required(
                multiselect.required == Some(true) || multiselect.min_items.unwrap_or(0) > 0,
            );
            if let Some(default) = &multiselect.default {
                builder = builder.initial_values(default.iter().cloned().map(Pick::Text).collect());
            }
            let values = builder.prompt()?;
            let mut selected: Vec<String> = values
                .iter()
                .filter_map(|value| match value {
                    Pick::Text(text) => Some(text.clone()),
                    _ => None,
                })
                .collect();
            if values.contains(&Pick::Custom) {
                selected.push(prompt::text("Enter value").validate(required).prompt()?);
            }
            let count = selected.len() as i64;
            if let Some(min) = multiselect.min_items.filter(|min| count < *min) {
                anyhow::bail!("Select at least {min}");
            }
            if let Some(max) = multiselect.max_items.filter(|max| count > *max) {
                anyhow::bail!("Select at most {max}");
            }
            Ok(Some(FormValue::Array(selected)))
        }
        FormField::String(string) if string.options.is_some() => {
            let mut choices: Vec<Choice<Pick>> = string
                .options
                .iter()
                .flatten()
                .map(|option| option_choice(&option.value, &option.label, &option.description))
                .collect();
            if string.custom == Some(true) {
                choices.push(Choice::new(Pick::Custom, "Type your own answer"));
            }
            if string.required != Some(true) {
                choices.push(Choice::new(Pick::Skip, "Skip"));
            }
            let mut select = prompt::select(message.clone(), choices);
            if let Some(default) = &string.default {
                select = select.initial_value(Pick::Text(default.clone()));
            }
            match select.prompt()? {
                Pick::Skip => Ok(None),
                Pick::Text(value) => Ok(Some(FormValue::String(value))),
                _ => text_answer(field, message),
            }
        }
        _ => text_answer(field, message),
    }
}

fn option_choice(value: &str, label: &str, description: &Option<String>) -> Choice<Pick> {
    let choice = Choice::new(Pick::Text(value.to_owned()), label);
    match description {
        Some(description) => choice.hint(description.clone()),
        None => choice,
    }
}

fn text_answer(field: &FormField, message: String) -> anyhow::Result<Option<FormValue>> {
    let (placeholder, initial) = match field {
        FormField::String(field) => (field.placeholder.clone(), field.default.clone()),
        FormField::Number(field) => (None, field.default.as_ref().map(shell_exit_text)),
        FormField::Integer(field) => (None, field.default.as_ref().map(shell_exit_text)),
        _ => (None, None),
    };
    let mut text = prompt::text(message).validate(|input| validate_text(field, input));
    if let Some(placeholder) = placeholder {
        text = text.placeholder(placeholder);
    }
    if let Some(initial) = initial {
        text = text.initial_value(initial);
    }
    let value = text.prompt()?;
    if value.is_empty() && !is_required(field) {
        return Ok(None);
    }
    if matches!(field, FormField::String(_)) {
        return Ok(Some(FormValue::String(value)));
    }
    Ok(Some(FormValue::Number(
        js_number(&value).unwrap_or(f64::NAN),
    )))
}

/// `validateText`, the checks of the text prompt (its messages differ from `formValidateValue`'s).
fn validate_text(field: &FormField, value: &str) -> Option<String> {
    if value.is_empty() {
        return is_required(field).then(|| "Required".to_owned());
    }
    let bounds = match field {
        FormField::Number(field) => Some((false, &field.minimum, &field.maximum)),
        FormField::Integer(field) => Some((true, &field.minimum, &field.maximum)),
        _ => None,
    };
    if let Some((integer, minimum, maximum)) = bounds {
        let Some(number) = js_number(value).filter(|number| number.is_finite()) else {
            return Some("Expected a number".to_owned());
        };
        if integer && number.fract() != 0.0 {
            return Some("Expected an integer".to_owned());
        }
        if let Some(SessionMessageShellExit::Number(minimum)) = minimum
            && number < *minimum
        {
            return Some(format!(
                "Must be at least {}",
                shell_exit_text(&SessionMessageShellExit::Number(*minimum))
            ));
        }
        if let Some(SessionMessageShellExit::Number(maximum)) = maximum
            && number > *maximum
        {
            return Some(format!(
                "Must be at most {}",
                shell_exit_text(&SessionMessageShellExit::Number(*maximum))
            ));
        }
        return None;
    }
    let FormField::String(field) = field else {
        return None;
    };
    let length = value.encode_utf16().count() as i64;
    if let Some(min) = field.min_length.filter(|min| length < *min) {
        return Some(format!("Must be at least {min} characters"));
    }
    if let Some(max) = field.max_length.filter(|max| length > *max) {
        return Some(format!("Must be at most {max} characters"));
    }
    if let Some(pattern) = &field.pattern
        && !regex::Regex::new(pattern).is_ok_and(|pattern| pattern.is_match(value))
    {
        return Some("Invalid format".to_owned());
    }
    use opencode_api::generated::FormStringFieldFormat as Format;
    match &field.format {
        Some(Format::Uri) if url::Url::parse(value).is_err() => Some("Expected a URL".to_owned()),
        Some(Format::Email) if !email(value) => Some("Expected an email address".to_owned()),
        Some(Format::Date) if !date(value) => Some("Expected a date".to_owned()),
        Some(Format::DateTime) if !date_time(value) => Some("Expected a date and time".to_owned()),
        _ => None,
    }
}

fn email(text: &str) -> bool {
    regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").is_ok_and(|email| email.is_match(text))
}

fn date(text: &str) -> bool {
    text.len() == 10
        && text.as_bytes()[4] == b'-'
        && text.as_bytes()[7] == b'-'
        && chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").is_ok()
}

// What `Date.parse` accepts, for the ISO shapes forms use.
fn date_time(text: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(text).is_ok()
        || [
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%d %H:%M:%S",
        ]
        .iter()
        .any(|format| chrono::NaiveDateTime::parse_from_str(text, format).is_ok())
        || chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").is_ok()
}

/// `Number(text)` for decimal input: surrounding whitespace is ignored and an empty text is 0.
fn js_number(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return Some(0.0);
    }
    if text.contains(|c: char| c.is_ascii_alphabetic() && !matches!(c, 'e' | 'E'))
        && !matches!(text.trim_start_matches(['+', '-']), "Infinity")
    {
        return None;
    }
    text.parse().ok()
}

fn shell_exit_text(value: &SessionMessageShellExit) -> String {
    match value {
        SessionMessageShellExit::Number(value) if value.fract() == 0.0 && value.abs() < 1e21 => {
            format!("{value:.0}")
        }
        SessionMessageShellExit::Number(value) => value.to_string(),
        SessionMessageShellExit::String(text) => text.clone(),
        SessionMessageShellExit::Unknown(value) => value.to_string(),
    }
}

fn is_required(field: &FormField) -> bool {
    let required = match field {
        FormField::String(field) => field.required,
        FormField::Number(field) => field.required,
        FormField::Integer(field) => field.required,
        FormField::Boolean(field) => field.required,
        FormField::Multiselect(field) => field.required,
        _ => None,
    };
    required == Some(true)
}

fn hidden(field: &FormField) -> bool {
    let hidden = match field {
        FormField::String(field) => field.hidden,
        FormField::Number(field) => field.hidden,
        FormField::Integer(field) => field.hidden,
        FormField::Boolean(field) => field.hidden,
        FormField::Multiselect(field) => field.hidden,
        _ => None,
    };
    hidden == Some(true)
}

fn default(field: &FormField) -> Option<FormValue> {
    let number = |value: &Option<SessionMessageShellExit>| match value {
        Some(SessionMessageShellExit::Number(value)) => Some(FormValue::Number(*value)),
        Some(SessionMessageShellExit::String(text)) => Some(FormValue::String(text.clone())),
        _ => None,
    };
    match field {
        FormField::String(field) => field.default.clone().map(FormValue::String),
        FormField::Number(field) => number(&field.default),
        FormField::Integer(field) => number(&field.default),
        FormField::Boolean(field) => field.default.map(FormValue::Bool),
        FormField::Multiselect(field) => field.default.clone().map(FormValue::Array),
        _ => None,
    }
}

/// `active` in `auth/form.ts`: every `when` condition holds on the answers so far. An array answer matches
/// when it includes the condition's value as a string.
fn active(field: &FormField, answer: &FormAnswer) -> bool {
    let when = match field {
        FormField::String(field) => &field.when,
        FormField::Number(field) => &field.when,
        FormField::Integer(field) => &field.when,
        FormField::Boolean(field) => &field.when,
        FormField::Multiselect(field) => &field.when,
        _ => return true,
    };
    when.iter().flatten().all(|condition| {
        let Some(value) = answer.get(&condition.key) else {
            return false;
        };
        let matches = match (value, &condition.value) {
            (FormValue::Array(items), want) => {
                let want = match want {
                    FormWhenValue::String(text) => text.clone(),
                    FormWhenValue::Number(number) => {
                        shell_exit_text(&SessionMessageShellExit::Number(*number))
                    }
                    FormWhenValue::Bool(value) => value.to_string(),
                    FormWhenValue::Unknown(value) => value.to_string(),
                };
                items.contains(&want)
            }
            (FormValue::String(a), FormWhenValue::String(b)) => a == b,
            (FormValue::Number(a), FormWhenValue::Number(b)) => a == b,
            (FormValue::Bool(a), FormWhenValue::Bool(b)) => a == b,
            _ => false,
        };
        if condition.op == FormWhenOp::Eq {
            matches
        } else {
            !matches
        }
    })
}

// ---------------------------------------------------------------------------------------------------------------
// The integration picker (`ui/integration-picker.ts`)
// ---------------------------------------------------------------------------------------------------------------

/// One row of the integration picker, under its category heading.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct IntegrationChoice {
    pub value: String,
    pub label: String,
    pub category: &'static str,
    pub connected: bool,
    pub hint: Option<String>,
}

impl std::fmt::Display for IntegrationChoice {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.value)
    }
}

/// `selectIntegration`: an autocomplete grouped by category, sized to the terminal, that matches the
/// label, ID, or category. Enter on an empty match asks again.
pub(super) fn select_integration(
    choices: Vec<IntegrationChoice>,
    kind: &str,
) -> anyhow::Result<String> {
    let options = choices
        .iter()
        .map(|choice| Choice::new(choice.clone(), choice.label.clone()))
        .collect();
    let result = prompt::autocomplete("", options)
        .filter(|search, choice| {
            let search = search.to_lowercase();
            [
                &choice.value.label,
                &choice.value.value,
                choice.value.category,
            ]
            .iter()
            .any(|value| value.to_lowercase().contains(&search))
        })
        .validate(|value| value.is_none().then(|| format!("Select an {kind}")))
        .render(|view| render_picker(view, kind))
        .prompt()?;
    result
        .map(|choice| choice.value)
        .ok_or_else(|| anyhow::anyhow!("No {kind} selected"))
}

fn render_picker(view: &View<'_, IntegrationChoice>, kind: &str) -> String {
    use prompt::{
        S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE, bold, cyan, dim, gray, green,
        strikethrough, symbol, yellow,
    };
    let title = format!("{}\n{}  Select {kind}", gray(S_BAR()), symbol(view.state));
    match view.state {
        State::Submit => {
            let label = view.value.map_or("", |choice| choice.label.as_str());
            return format!("{title}\n{}  {}", gray(S_BAR()), dim(label));
        }
        State::Cancel => {
            return format!(
                "{title}\n{}  {}",
                gray(S_BAR()),
                strikethrough(&dim(view.user_input))
            );
        }
        _ => {}
    }
    let (rows, columns) = prompt::stdout_size();
    let rows = rows.unwrap_or(24) as i64;
    // Leave room for the category headings as well as Clack's title and footer.
    let max_items = (rows - 14 - i64::from(view.state == State::Error)).clamp(2, 8);
    let compact = rows < 18;
    let length = view.filtered.len() as i64;
    let cursor = view.cursor as i64;
    let start = (cursor - 2.min(max_items - 1))
        .max(0)
        .min((length - max_items).max(0));
    let end = (start + max_items).min(length);
    let visible = &view.filtered[start as usize..end.max(start) as usize];
    let bar = cyan(S_BAR());
    let mut lines = vec![
        title,
        format!(
            "{bar}  {} {}",
            dim("Search:"),
            if view.is_navigating {
                dim(view.user_input)
            } else {
                view.user_input_with_cursor.clone()
            }
        ),
    ];
    if visible.is_empty() && !view.user_input.is_empty() {
        lines.push(format!("{bar}  {}", yellow(&format!("No {kind}s found"))));
    }
    if view.state == State::Error && !visible.is_empty() {
        lines.push(format!("{}  {}", yellow(S_BAR()), yellow(view.error)));
    }
    if start > 0 {
        lines.push(format!("{bar}  {}", dim("…")));
    }
    for (index, option) in visible.iter().enumerate() {
        let choice = &option.value;
        if index == 0 || visible[index - 1].value.category != choice.category {
            if !compact {
                lines.push(format!("{bar}  "));
            }
            lines.push(format!("{bar}  {}", bold(choice.category)));
        }
        let focused = start + index as i64 == cursor;
        lines.push(format!(
            "{bar}  {} {}{}{}",
            if focused {
                green(S_RADIO_ACTIVE())
            } else {
                dim(S_RADIO_INACTIVE())
            },
            if focused {
                choice.label.clone()
            } else {
                dim(&choice.label)
            },
            if choice.connected {
                format!(" {}", green("✓"))
            } else {
                String::new()
            },
            choice
                .hint
                .as_ref()
                .map(|hint| format!(" {}", dim(&format!("({hint})"))))
                .unwrap_or_default()
        ));
    }
    if start + max_items < length {
        lines.push(format!("{bar}  {}", dim("…")));
    }
    lines.push(format!(
        "{bar}  {}",
        dim(if columns.unwrap_or(80) < 50 {
            "↑/↓ navigate • Enter select"
        } else {
            "↑/↓ to select • Enter: confirm • Type: to search"
        })
    ));
    lines.push(cyan(S_BAR_END()));
    lines.join("\n")
}

/// `text.length` in JavaScript: UTF-16 code units.
pub(super) fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `text.padEnd(width)`.
pub(super) fn pad_end(text: &str, width: usize) -> String {
    format!(
        "{text}{}",
        " ".repeat(width.saturating_sub(js_length(text)))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_lines_print_each_line_once() {
        assert_eq!(completed_lines("partial", 0), (0, ""));
        assert_eq!(completed_lines("one\ntw", 0), (4, "one"));
        assert_eq!(completed_lines("one\ntwo\nthr", 4), (8, "two"));
        assert_eq!(completed_lines("one\ntwo\nthr", 8), (8, ""));
    }

    #[test]
    fn legacy_exports_decode_with_effect_messages() {
        let error = |text: &str| legacy::decode(text).err().unwrap();
        assert_eq!(error("nope"), "Expected a valid JSON string");
        assert_eq!(error("{}"), "Expected array");
        assert_eq!(error("[1]"), "Expected object\n  at [0]");
        assert_eq!(
            error(r#"[{"id":"c","integrationID":"x","label":"l","active":true}]"#),
            "Missing key\n  at [0][\"value\"]"
        );
        assert_eq!(
            error(
                r#"[{"id":"c","integrationID":"x","label":"l","active":true,"value":{"type":"key","key":"k","configuration":{"a":[1]}}}]"#
            ),
            "Expected string\n  at [0][\"value\"][\"configuration\"][\"a\"][0]"
        );
        assert_eq!(
            error(
                r#"[{"id":5,"integrationID":"x","label":"l","active":true,"value":{"type":"key","key":"k"}}]"#
            ),
            "Expected Credential.ID\n  at [0][\"id\"]"
        );
        let entries = legacy::decode(
            r#"[{"label":"L","id":"c","integrationID":"x","active":false,"value":{"key":"k","type":"key","metadata":{"a":1,"b":2},"configuration":{"b":3}}}]"#,
        )
        .unwrap();
        assert_eq!(
            entries[0].value.to_string(),
            r#"{"type":"key","key":"k","metadata":{"a":1,"b":3}}"#
        );
    }

    #[test]
    fn pad_end_counts_utf16_units() {
        assert_eq!(pad_end("ab", 4), "ab  ");
        assert_eq!(pad_end("abcde", 4), "abcde");
    }
}
