//! The ACP methods (`packages/cli/src/acp/service.ts`).

use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    AbsolutePath, LocationPublicRef, SessionCreateInput, SessionForkInput, SessionGetInput, SessionID, SessionInfo,
    SessionListInput, SessionListInputOrder, SessionRemoveInput, SessionsCursor,
};
use serde_json::{Map, Value, json};

use crate::capabilities::{self, CHILD_SESSION_UPDATES, Capabilities};
use crate::catalog::Catalogs;
use crate::client::{check, decode_session_id, is_declared};
use crate::config_option::{config_options, resolve_change};
use crate::connection::{Connection, Responded};
use crate::directories;
use crate::error::Failure;
use crate::paths::fs_resolve;
use crate::replay;
use crate::sessions::{Attached, Sessions};
use crate::turn::Turns;

const AUTH_METHOD_ID: &str = "opencode-login";

/// `cwd`, the session, additional directories, and MCP servers of `session/new`, `load`, `resume`,
/// and `fork`.
#[derive(Debug, Clone, Default)]
pub struct Setup {
    pub cwd: String,
    pub session_id: String,
    pub additional_directories: Vec<String>,
    pub mcp_servers: Vec<Value>,
}

pub struct Service {
    pub client: Client,
    pub connection: Connection,
    pub catalogs: Arc<Catalogs>,
    pub sessions: Arc<Sessions>,
    pub capabilities: Arc<Mutex<Capabilities>>,
    pub turns: Arc<Turns>,
    pub version: String,
}

impl Service {
    pub fn initialize(&self, params: &Value) -> Value {
        let client = params.get("clientCapabilities");
        *self.capabilities.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = capabilities::parse(client);
        let mut auth = Map::new();
        auth.insert("description".to_owned(), json!("Run `opencode auth login` in the terminal"));
        auth.insert("name".to_owned(), json!("Login with opencode"));
        auth.insert("id".to_owned(), json!(AUTH_METHOD_ID));
        let terminal = client
            .and_then(|client| client.get("auth"))
            .and_then(|auth| auth.get("terminal"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if terminal {
            auth.insert("type".to_owned(), json!("terminal"));
            auth.insert("args".to_owned(), json!(["--login"]));
        }
        if client.and_then(|client| client.get("_meta")).and_then(|meta| meta.get("terminal-auth"))
            == Some(&Value::Bool(true))
        {
            auth.insert(
                "_meta".to_owned(),
                json!({
                    "terminal-auth": { "command": "opencode", "args": ["auth", "login"], "label": "OpenCode Login" },
                }),
            );
        }
        json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "loadSession": true,
                "mcpCapabilities": { "http": true, "sse": false },
                "promptCapabilities": { "embeddedContext": true, "image": true },
                "sessionCapabilities": {
                    "additionalDirectories": {},
                    "close": {},
                    "delete": {},
                    "fork": {},
                    "list": {},
                    "resume": {},
                },
                "_meta": { (CHILD_SESSION_UPDATES): true },
            },
            "authMethods": [auth],
            "agentInfo": { "name": "OpenCode", "version": self.version },
        })
    }

    pub fn authenticate(&self, method_id: &str) -> Result<Value, Failure> {
        if method_id != AUTH_METHOD_ID {
            return Err(Failure::UnknownAuthMethod { method_id: method_id.to_owned() });
        }
        Ok(json!({}))
    }

    pub async fn new_session(&self, setup: Setup, responded: Responded) -> Result<Value, Failure> {
        let directories = directories::parse(&setup.cwd, &setup.additional_directories)?;
        let mcp_servers = supported_mcp_servers(&setup.mcp_servers)?;
        // Load first so a catalog failure leaves no session.
        self.catalogs.get(&setup.cwd).await?;
        let (permissions, metadata) = directories::grant(&directories);
        let created = check(
            self.client
                .session_create(
                    &SessionCreateInput {
                        location: Some(Some(LocationPublicRef { directory: AbsolutePath(setup.cwd.clone()) })),
                        permissions: permissions.map(Some),
                        metadata: metadata.map(Some),
                        ..SessionCreateInput::default()
                    },
                    &RequestOptions::default(),
                )
                .await,
        )?;
        let (attached, options) = self.sessions.attach(&created, &setup.cwd, &mcp_servers, responded).await?;
        Ok(json!({ "sessionId": attached.id, "configOptions": options }))
    }

    pub async fn load_session(&self, setup: Setup, responded: Responded) -> Result<Value, Failure> {
        let directories = directories::parse(&setup.cwd, &setup.additional_directories)?;
        let mcp_servers = supported_mcp_servers(&setup.mcp_servers)?;
        let session = self.get_session(&setup.session_id, &setup.cwd).await?;
        directories::activate(&self.client, &session, &directories).await?;
        let (attached, _) =
            self.sessions.attach(&session, &session.location.directory.0, &mcp_servers, responded).await?;
        let capabilities = *self.capabilities.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let loaded = async {
            replay::history(&self.client, &self.connection, &attached, &capabilities).await?;
            self.current_options(&attached).await
        }
        .await;
        match loaded {
            Ok(options) => Ok(json!({ "configOptions": options })),
            Err(failure) => {
                self.sessions.release(&attached);
                Err(failure)
            }
        }
    }

    pub async fn list_sessions(&self, cwd: Option<String>, cursor: Option<String>) -> Result<Value, Failure> {
        let directory = cwd.map(|cwd| directories::parse_cwd(&cwd).map(AbsolutePath)).transpose()?;
        let page = check(
            self.client
                .session_list(
                    &SessionListInput {
                        directory,
                        order: Some(SessionListInputOrder::Desc),
                        limit: Some(100),
                        cursor: cursor.filter(|cursor| !cursor.is_empty()).map(SessionsCursor),
                        ..SessionListInput::default()
                    },
                    &RequestOptions::default(),
                )
                .await,
        )?;
        let sessions: Vec<Value> = page
            .data
            .iter()
            .map(|session| {
                let mut item = Map::new();
                item.insert("sessionId".to_owned(), json!(session.id.0));
                item.insert("cwd".to_owned(), json!(session.location.directory.0));
                let additional = directories::list(session);
                if !additional.is_empty() {
                    item.insert("additionalDirectories".to_owned(), json!(additional));
                }
                item.insert("title".to_owned(), json!(title(session)));
                item.insert("updatedAt".to_owned(), json!(iso(session.time.updated)));
                Value::Object(item)
            })
            .collect();
        let mut response = Map::new();
        response.insert("sessions".to_owned(), json!(sessions));
        if let Some(Some(next)) =
            page.cursor.next.as_ref().filter(|next| next.as_ref().is_some_and(|next| !next.0.is_empty()))
        {
            response.insert("nextCursor".to_owned(), json!(next.0));
        }
        Ok(Value::Object(response))
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<Value, Failure> {
        self.turns.cancel(session_id).await;
        if let Ok(id) = decode_session_id(session_id) {
            let result = self
                .client
                .session_remove(&SessionRemoveInput { session_id: SessionID(id) }, &RequestOptions::default())
                .await;
            match result {
                Err(error) if is_declared(&error, "SessionNotFoundError") => {}
                result => check(result)?,
            }
        }
        self.sessions.detach(session_id);
        Ok(json!({}))
    }

    pub async fn resume_session(&self, setup: Setup, responded: Responded) -> Result<Value, Failure> {
        let directories = directories::parse(&setup.cwd, &setup.additional_directories)?;
        let mcp_servers = supported_mcp_servers(&setup.mcp_servers)?;
        let session = self.get_session(&setup.session_id, &setup.cwd).await?;
        directories::activate(&self.client, &session, &directories).await?;
        let (_, options) =
            self.sessions.attach(&session, &session.location.directory.0, &mcp_servers, responded).await?;
        Ok(json!({ "configOptions": options }))
    }

    pub async fn close_session(&self, session_id: &str) -> Result<Value, Failure> {
        self.turns.close(session_id).await?;
        self.sessions.detach(session_id);
        Ok(json!({}))
    }

    pub async fn fork_session(&self, setup: Setup, responded: Responded) -> Result<Value, Failure> {
        let directories = directories::parse(&setup.cwd, &setup.additional_directories)?;
        let mcp_servers = supported_mcp_servers(&setup.mcp_servers)?;
        let session = self.get_session(&setup.session_id, &setup.cwd).await?;
        let forked = check(
            self.client
                .session_fork(
                    &SessionForkInput { session_id: session.id.clone(), before: None },
                    &RequestOptions::default(),
                )
                .await,
        )?;
        // Forks inherit the source's grants; replace them with this request's.
        directories::activate(&self.client, &forked, &directories).await?;
        let (attached, options) =
            self.sessions.attach(&forked, &forked.location.directory.0, &mcp_servers, responded).await?;
        Ok(json!({ "sessionId": attached.id, "configOptions": options }))
    }

    pub async fn set_config_option(&self, session_id: &str, config_id: &str, value: &Value) -> Result<Value, Failure> {
        let attached = self.sessions.require(session_id)?;
        let Some(value) = value.as_str() else {
            return Err(Failure::InvalidConfigOption { config_id: config_id.to_owned() });
        };
        self.with_reload(&attached, config_id, value).await?;
        Ok(json!({ "configOptions": self.current_options(&attached).await? }))
    }

    pub async fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<Value, Failure> {
        let attached = self.sessions.require(session_id)?;
        self.with_reload(&attached, "mode", mode_id).await?;
        Ok(json!({}))
    }

    /// Sends a prompt; the turn registered before this future runs.
    pub fn prompt(
        &self,
        session_id: String,
        prompt: Vec<Value>,
        cancel: &tokio_util::sync::CancellationToken,
        responded: Responded,
    ) -> BoxFuture<'static, Result<Value, Failure>> {
        match self.turns.start(session_id, prompt, cancel, responded) {
            Ok(result) => Box::pin(async move {
                result.await.unwrap_or_else(|_| {
                    Err(Failure::Defect { name: None, detail: "ACP turn ended without a response".to_owned() })
                })
            }),
            Err(failure) => Box::pin(async move { Err(failure) }),
        }
    }

    async fn current_options(&self, attached: &Attached) -> Result<Vec<Value>, Failure> {
        Ok(config_options(&self.catalogs.get(&attached.cwd).await?, &attached.selection()))
    }

    async fn with_reload(&self, attached: &Attached, config_id: &str, value: &str) -> Result<(), Failure> {
        match self.select(attached, config_id, value).await {
            Err(Failure::InvalidModel { .. } | Failure::InvalidMode { .. } | Failure::InvalidEffort { .. }) => {
                self.catalogs.reload(&attached.cwd).await?;
                self.select(attached, config_id, value).await
            }
            result => result,
        }
    }

    async fn select(&self, attached: &Attached, config_id: &str, value: &str) -> Result<(), Failure> {
        let catalog = self.catalogs.get(&attached.cwd).await?;
        let change = resolve_change(&catalog, &attached.selection(), config_id, value)?;
        self.sessions.select(attached, change).await
    }

    async fn get_session(&self, session_id: &str, cwd: &str) -> Result<SessionInfo, Failure> {
        let id = decode_session_id(session_id)?;
        let session = check(
            self.client.session_get(&SessionGetInput { session_id: SessionID(id) }, &RequestOptions::default()).await,
        )?;
        if fs_resolve(cwd) != fs_resolve(&session.location.directory.0) {
            return Err(Failure::SessionDirectoryMismatch { session_id: session_id.to_owned(), cwd: cwd.to_owned() });
        }
        Ok(session)
    }
}

fn supported_mcp_servers(servers: &[Value]) -> Result<Vec<Value>, Failure> {
    let supported: Vec<Value> = servers
        .iter()
        .filter(|server| match server.get("type") {
            None => true,
            Some(kind) => kind == "http",
        })
        .cloned()
        .collect();
    if supported.len() < servers.len() {
        return Err(Failure::invalid_request("Only stdio and HTTP MCP servers are supported", Some("mcpServers")));
    }
    Ok(supported)
}

/// `withTimestampedFallback`.
fn title(session: &SessionInfo) -> String {
    if let Some(title) = &session.title {
        return title.clone();
    }
    let kind = if session.parent_id.is_some() { "Child" } else { "New" };
    format!("{kind} session - {}", iso(session.time.created))
}

/// `Date.prototype.toISOString`.
fn iso(millis: f64) -> String {
    #[allow(clippy::cast_possible_truncation)]
    chrono::DateTime::from_timestamp_millis(millis as i64)
        .map(|time| time.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default()
}
