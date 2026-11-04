//! Sessions attached to this connection: their selection, MCP servers, and the commands and config
//! options pushed to the client (`packages/cli/src/acp/sessions.ts`).

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::StreamExt;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    AgentID, ExperimentalMcpAddInput, ExperimentalMcpAddInputConfig, LocationQueryInput, ModelRef,
    SessionID, SessionInfo, SessionSwitchAgentInput, SessionSwitchModelInput,
};
use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

use crate::catalog::{Catalog, Catalogs};
use crate::client::{check, event_type, subscribe};
use crate::config_option::{Change, Selection, available_commands, config_options};
use crate::connection::{Connection, Responded};
use crate::error::Failure;

/// A session attached to this connection.
#[derive(Debug)]
pub struct Attached {
    pub id: String,
    pub cwd: String,
    selection: Mutex<Selection>,
}

impl Attached {
    pub fn new(id: &str, cwd: &str, selection: Selection) -> Self {
        Self {
            id: id.to_owned(),
            cwd: cwd.to_owned(),
            selection: Mutex::new(selection),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Selection> {
        self.selection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn selection(&self) -> Selection {
        self.lock().clone()
    }

    /// Applies `change` and returns the selection before it.
    fn update(&self, change: Option<&Change>) -> Selection {
        let mut selection = self.lock();
        let previous = selection.clone();
        if let Some(change) = change {
            *selection = previous.apply(change);
        }
        previous
    }
}

struct Entry {
    attached: Arc<Attached>,
    scope: CancellationToken,
    selected: mpsc::UnboundedSender<Change>,
}

pub struct Sessions {
    client: Client,
    connection: Connection,
    catalogs: Arc<Catalogs>,
    entries: Mutex<HashMap<String, Entry>>,
    // Outlives entries so re-attaching does not re-add servers.
    registered_mcp: Mutex<HashMap<String, HashMap<String, Value>>>,
    connected: watch::Receiver<bool>,
    scope: CancellationToken,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Sessions {
    /// Subscribes before any attach, so a switch right after attaching reaches the session.
    pub fn new(
        client: Client,
        connection: Connection,
        catalogs: Arc<Catalogs>,
        scope: CancellationToken,
    ) -> Arc<Self> {
        let (connected_sender, connected) = watch::channel(false);
        let sessions = Arc::new(Self {
            client,
            connection,
            catalogs,
            entries: Mutex::default(),
            registered_mcp: Mutex::default(),
            connected,
            scope: scope.clone(),
        });
        let events = sessions.clone();
        tokio::spawn(async move {
            tokio::select! {
                () = events.follow(&connected_sender) => {}
                () = scope.cancelled() => {}
            }
            connected_sender.send_replace(true);
        });
        sessions
    }

    async fn follow(&self, connected: &watch::Sender<bool>) {
        let mut stream = subscribe(&self.client);
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    log::warn!(cause = error.to_string().as_str(); "ACP selection event stream failed");
                    return;
                }
            };
            let data = event.get("data").unwrap_or(&Value::Null);
            let change = match event_type(&event) {
                "server.connected" => {
                    connected.send_replace(true);
                    continue;
                }
                "session.model.selected" => data
                    .get("model")
                    .and_then(|model| serde_json::from_value::<ModelRef>(model.clone()).ok())
                    .map(Change::Model),
                "session.agent.selected" => data
                    .get("agent")
                    .and_then(Value::as_str)
                    .map(|agent| Change::Mode(agent.to_owned())),
                _ => None,
            };
            let (Some(change), Some(session_id)) =
                (change, data.get("sessionID").and_then(Value::as_str))
            else {
                continue;
            };
            if let Some(entry) = lock(&self.entries).get(session_id) {
                let _ = entry.selected.send(change);
            }
        }
    }

    pub async fn attach(
        self: &Arc<Self>,
        session: &SessionInfo,
        cwd: &str,
        mcp_servers: &[Value],
        responded: Responded,
    ) -> Result<(Arc<Attached>, Vec<Value>), Failure> {
        let mut connected = self.connected.clone();
        let _ = connected.wait_for(|connected| *connected).await;
        let current = self.catalogs.get(cwd).await?;
        let attached = Arc::new(Attached::new(
            &session.id.0,
            cwd,
            Selection {
                model: session.model.clone(),
                mode_id: session.agent.as_ref().map(|agent| agent.0.clone()),
            },
        ));
        let (selected, mut selections) = mpsc::unbounded_channel();
        let scope = self.scope.child_token();
        // Swap at once so concurrent attaches of one ID cannot both keep a scope.
        let replaced = lock(&self.entries).insert(
            attached.id.clone(),
            Entry {
                attached: attached.clone(),
                scope: scope.clone(),
                selected,
            },
        );
        if let Some(replaced) = replaced {
            replaced.scope.cancel();
        }
        if let Err(error) = self.register_mcp(&attached, mcp_servers).await {
            self.remove(&attached.id, &attached);
            return Err(error);
        }
        let options = config_options(&current, &attached.selection());
        let sessions = self.clone();
        let background = attached.clone();
        tokio::spawn(async move {
            tokio::select! {
                () = sessions.publish(&background, current, &mut selections, responded) => {}
                () = scope.cancelled() => {}
            }
        });
        Ok((attached, options))
    }

    // `changes` starts at the latest catalog, so a reload since `current` still pushes. One loop keeps
    // catalog and selection consistent.
    async fn publish(
        &self,
        attached: &Attached,
        current: Catalog,
        selections: &mut mpsc::UnboundedReceiver<Change>,
        responded: Responded,
    ) {
        if !responded.wait().await {
            return;
        }
        if self.send_commands(&attached.id, &current).is_err() {
            return;
        }
        let Ok(mut changes) = self.catalogs.changes(&attached.cwd).await else {
            return;
        };
        let mut previous = current;
        let next = changes.borrow_and_update().clone();
        self.changed(attached, &previous, &next, None);
        previous = next;
        loop {
            tokio::select! {
                changed = changes.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    let next = changes.borrow_and_update().clone();
                    self.changed(attached, &previous, &next, None);
                    previous = next;
                }
                change = selections.recv() => {
                    let Some(change) = change else { return };
                    self.changed(attached, &previous, &previous, Some(&change));
                }
            }
        }
    }

    fn send_commands(&self, session_id: &str, catalog: &Catalog) -> Result<(), Failure> {
        self.connection.session_update(
            session_id,
            json!({
                "sessionUpdate": "available_commands_update",
                "availableCommands": available_commands(catalog),
            }),
        )
    }

    fn changed(
        &self,
        attached: &Attached,
        previous: &Catalog,
        next: &Catalog,
        patch: Option<&Change>,
    ) {
        let selection = attached.update(patch);
        let patched = patch.map_or_else(|| selection.clone(), |change| selection.apply(change));
        let options = config_options(next, &patched);
        if options != config_options(previous, &selection) {
            let _ = self.connection.session_update(
                &attached.id,
                json!({ "sessionUpdate": "config_option_update", "configOptions": options }),
            );
        }
        if next.commands != previous.commands {
            let _ = self.send_commands(&attached.id, next);
        }
    }

    async fn register_mcp(&self, attached: &Attached, servers: &[Value]) -> Result<(), Failure> {
        let additions: Vec<(String, Value)> = {
            let mut registered = lock(&self.registered_mcp);
            let registered = registered.entry(attached.id.clone()).or_default();
            servers
                .iter()
                .filter_map(|server| {
                    let name = server.get("name").and_then(Value::as_str)?.to_owned();
                    let config = mcp_config(server);
                    if registered.get(&name) == Some(&config) {
                        return None;
                    }
                    registered.insert(name.clone(), config.clone());
                    Some((name, config))
                })
                .collect()
        };
        let results =
            futures_util::future::join_all(additions.into_iter().map(|(name, config)| {
                let client = self.client.clone();
                let cwd = attached.cwd.clone();
                // A spawned task finishes even when the caller stops waiting (TS: uninterruptible).
                tokio::spawn(async move {
                    let result = client
                        .experimental_mcp_add(
                            &ExperimentalMcpAddInput {
                                server: name.clone(),
                                location: Some(LocationQueryInput {
                                    directory: Some(cwd),
                                }),
                                config: ExperimentalMcpAddInputConfig::Unknown(config),
                            },
                            &RequestOptions::default(),
                        )
                        .await;
                    (name, check(result))
                })
            }))
            .await;
        let mut failure = None;
        for result in results {
            let Ok((name, result)) = result else { continue };
            if let Err(error) = result {
                if let Some(registered) = lock(&self.registered_mcp).get_mut(&attached.id) {
                    registered.remove(&name);
                }
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    fn remove(&self, session_id: &str, attached: &Arc<Attached>) {
        let removed = {
            let mut entries = lock(&self.entries);
            match entries.get(session_id) {
                Some(entry) if Arc::ptr_eq(&entry.attached, attached) => entries.remove(session_id),
                _ => None,
            }
        };
        if let Some(entry) = removed {
            lock(&self.registered_mcp).remove(session_id);
            entry.scope.cancel();
        }
    }

    pub fn detach(&self, session_id: &str) {
        let attached = lock(&self.entries)
            .get(session_id)
            .map(|entry| entry.attached.clone());
        if let Some(attached) = attached {
            self.remove(session_id, &attached);
        }
    }

    pub fn release(&self, attached: &Arc<Attached>) {
        self.remove(&attached.id, attached);
    }

    pub fn require(&self, session_id: &str) -> Result<Arc<Attached>, Failure> {
        lock(&self.entries)
            .get(session_id)
            .map(|entry| entry.attached.clone())
            .ok_or_else(|| Failure::SessionNotFound {
                session_id: session_id.to_owned(),
            })
    }

    /// Runs `work` until it ends or the session detaches.
    pub fn fork(
        &self,
        attached: &Arc<Attached>,
        work: impl Future<Output = ()> + Send + 'static,
    ) -> Result<(), Failure> {
        let scope = lock(&self.entries)
            .get(&attached.id)
            .filter(|entry| Arc::ptr_eq(&entry.attached, attached))
            .map(|entry| entry.scope.clone())
            .ok_or_else(|| Failure::SessionNotFound {
                session_id: attached.id.clone(),
            })?;
        tokio::spawn(async move {
            tokio::select! {
                () = work => {}
                () = scope.cancelled() => {}
            }
        });
        Ok(())
    }

    // Updates the selection before switching, so the echoed event changes nothing.
    pub async fn select(&self, attached: &Attached, change: Change) -> Result<(), Failure> {
        attached.update(Some(&change));
        let session_id = SessionID(attached.id.clone());
        let options = RequestOptions::default();
        check(match change {
            Change::Model(model) => {
                self.client
                    .session_switch_model(&SessionSwitchModelInput { session_id, model }, &options)
                    .await
            }
            Change::Mode(agent) => {
                self.client
                    .session_switch_agent(
                        &SessionSwitchAgentInput {
                            session_id,
                            agent: AgentID(agent),
                        },
                        &options,
                    )
                    .await
            }
        })
    }
}

fn pairs(items: Option<&Value>) -> Value {
    let mut object = Map::new();
    for item in items.and_then(Value::as_array).into_iter().flatten() {
        if let (Some(name), Some(value)) = (
            item.get("name").and_then(Value::as_str),
            item.get("value").cloned(),
        ) {
            object.insert(name.to_owned(), value);
        }
    }
    Value::Object(object)
}

fn mcp_config(server: &Value) -> Value {
    if server.get("type").is_some() {
        return json!({
            "type": "remote",
            "url": server.get("url").cloned().unwrap_or(Value::Null),
            "headers": pairs(server.get("headers")),
            "oauth": false,
        });
    }
    let mut command = vec![server.get("command").cloned().unwrap_or(Value::Null)];
    command.extend(
        server
            .get("args")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .cloned(),
    );
    json!({
        "type": "local",
        "command": command,
        "environment": pairs(server.get("env")),
    })
}
