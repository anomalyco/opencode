//! Sessions attached to this connection and the selection, commands and configuration advertised to the client.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures_util::StreamExt;
use opencode_api::client::Client;
use opencode_api::generated::{
    AgentID, ExperimentalMcpAddInput, ExperimentalMcpAddInputConfig, LocationQueryInput, ModelRef, SessionID,
    SessionInfo, SessionSwitchAgentInput, SessionSwitchModelInput,
};
use opencode_util::lock;
use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;

use crate::catalog::{Catalog, Catalogs};
use crate::client::{check, event_type, subscribe};
use crate::config_option::{Change, Selection, available_commands, config_options};
use crate::connection::{Connection, Responded};
use crate::error::Failure;
use crate::paths::fs_resolve;

/// A session attached to this connection.
#[derive(Debug)]
pub struct Attached {
    pub id: String,
    pub cwd: String,
    selection: Mutex<Selection>,
}

impl Attached {
    pub fn new(id: &str, cwd: &str, selection: Selection) -> Self {
        Self { id: id.to_owned(), cwd: cwd.to_owned(), selection: Mutex::new(selection) }
    }

    fn lock(&self) -> MutexGuard<'_, Selection> {
        lock(&self.selection)
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

    /// Restores the field that `change` switches to its value in `base`.
    fn restore_field(&self, base: &Selection, change: &Change) {
        let mut selection = self.lock();
        match change {
            Change::Model(_) => selection.model = base.model.clone(),
            Change::Mode(_) => selection.mode_id = base.mode_id.clone(),
        }
    }
}

struct Entry {
    attached: Arc<Attached>,
    scope: CancellationToken,
    selected: mpsc::UnboundedSender<Change>,
    /// The selection the server last reported, which a switch to the same value leaves alone without an echo.
    confirmed: Selection,
    /// This adapter's switches whose echo has not arrived, oldest first.
    pending: Vec<(u64, Change)>,
}

#[derive(Default)]
struct McpState {
    servers: HashMap<String, Value>,
    registered: HashMap<String, Value>,
}

pub struct Sessions {
    client: Client,
    connection: Connection,
    catalogs: Arc<Catalogs>,
    entries: Mutex<HashMap<String, Entry>>,
    // Outlives entries so re-attaching does not re-add servers.
    mcp: Mutex<HashMap<String, McpState>>,
    next_pending: AtomicU64,
    connected: watch::Receiver<bool>,
    scope: CancellationToken,
}

impl Sessions {
    /// Subscribes before any attach, so a switch right after attaching reaches the session.
    pub fn new(client: Client, connection: Connection, catalogs: Arc<Catalogs>, scope: CancellationToken) -> Arc<Self> {
        let (connected_sender, connected) = watch::channel(false);
        let sessions = Arc::new(Self {
            client,
            connection,
            catalogs,
            entries: Mutex::default(),
            mcp: Mutex::default(),
            next_pending: AtomicU64::new(0),
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
        let mut stream = subscribe::<Value>(&self.client);
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    log::warn!(cause = error.to_string().as_str(); "ACP selection event stream failed");
                    return;
                }
            };
            let data = event.get("data").unwrap_or(&Value::Null);
            match event_type(&event) {
                "server.connected" => {
                    connected.send_replace(true);
                }
                "location.shutdown" => {
                    let directory =
                        event.get("location").and_then(|location| location.get("directory")).and_then(Value::as_str);
                    self.shutdown(directory);
                }
                "session.renamed" => {
                    let Some(session_id) = data.get("sessionID").and_then(Value::as_str) else { continue };
                    let target = lock(&self.entries).get(session_id).map(|entry| entry.attached.id.clone());
                    if let (Some(target), Some(title)) = (target, data.get("title").and_then(Value::as_str)) {
                        let _ = self.connection.session_update(
                            &target,
                            &json!({ "sessionUpdate": "session_info_update", "title": title }),
                        );
                    }
                }
                "session.model.selected" => {
                    let Some(session_id) = data.get("sessionID").and_then(Value::as_str) else { continue };
                    let Some(model) =
                        data.get("model").and_then(|model| serde_json::from_value::<ModelRef>(model.clone()).ok())
                    else {
                        continue;
                    };
                    self.echoed(session_id, Change::Model(model));
                }
                "session.agent.selected" => {
                    let Some(session_id) = data.get("sessionID").and_then(Value::as_str) else { continue };
                    let Some(agent) = data.get("agent").and_then(Value::as_str) else { continue };
                    self.echoed(session_id, Change::Mode(agent.to_owned()));
                }
                _ => {}
            }
        }
    }

    // A Location shutdown drops the MCP servers added to it, so they are added again before the next prompt.
    fn shutdown(&self, directory: Option<&str>) {
        let target = directory.map(fs_resolve);
        let matching: Vec<String> = lock(&self.entries)
            .iter()
            .filter(|(_, entry)| target.as_deref().is_none_or(|target| fs_resolve(&entry.attached.cwd) == target))
            .map(|(session_id, _)| session_id.clone())
            .collect();
        let mut mcp = lock(&self.mcp);
        for session_id in matching {
            if let Some(state) = mcp.get_mut(&session_id) {
                state.registered.clear();
            }
        }
    }

    // Echoes arrive in switch order, so a matched echo also settles this adapter's earlier switches of the same kind,
    // and while one of them is in flight it, not the echo, decides the selection.
    fn echoed(&self, session_id: &str, change: Change) {
        let mut entries = lock(&self.entries);
        let Some(entry) = entries.get_mut(session_id) else { return };
        entry.confirmed = entry.confirmed.apply(&change);
        if let Some(index) = entry.pending.iter().position(|(_, item)| same_change(item, &change)) {
            let mut position = 0;
            entry.pending.retain(|(_, item)| {
                let keep = !(position <= index && same_kind(item, &change));
                position += 1;
                keep
            });
            return;
        }
        if entry.pending.iter().any(|(_, item)| same_kind(item, &change)) {
            return;
        }
        let _ = entry.selected.send(change);
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
        let initial =
            Selection { model: session.model.clone(), mode_id: session.agent.as_ref().map(|agent| agent.0.clone()) };
        let attached = Arc::new(Attached::new(&session.id.0, cwd, initial.clone()));
        let (selected, mut selections) = mpsc::unbounded_channel();
        let scope = self.scope.child_token();
        // Swap at once so concurrent attaches of one ID cannot both keep a scope.
        let replaced = lock(&self.entries).insert(
            attached.id.clone(),
            Entry {
                attached: attached.clone(),
                scope: scope.clone(),
                selected,
                confirmed: initial,
                pending: Vec::new(),
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
        let Ok(mut changes) = self.catalogs.changes(&attached.cwd).await else { return };
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
            &json!({
                "sessionUpdate": "available_commands_update",
                "availableCommands": available_commands(catalog),
            }),
        )
    }

    fn changed(&self, attached: &Attached, previous: &Catalog, next: &Catalog, patch: Option<&Change>) {
        let selection = attached.update(patch);
        let patched = patch.map_or_else(|| selection.clone(), |change| selection.apply(change));
        let options = config_options(next, &patched);
        if options != config_options(previous, &selection) {
            let _ = self.connection.session_update(
                &attached.id,
                &json!({ "sessionUpdate": "config_option_update", "configOptions": options }),
            );
        }
        if next.commands != previous.commands {
            let _ = self.send_commands(&attached.id, next);
        }
    }

    async fn register_mcp(&self, attached: &Attached, servers: &[Value]) -> Result<(), Failure> {
        let additions: Vec<(String, Value)> = {
            let mut mcp = lock(&self.mcp);
            let state = mcp.entry(attached.id.clone()).or_default();
            for server in servers {
                if let Some(name) = server.get("name").and_then(Value::as_str) {
                    state.servers.insert(name.to_owned(), mcp_config(server));
                }
            }
            let pending: Vec<(String, Value)> = state
                .servers
                .iter()
                .filter(|(name, config)| state.registered.get(*name) != Some(*config))
                .map(|(name, config)| (name.clone(), config.clone()))
                .collect();
            for (name, config) in &pending {
                state.registered.insert(name.clone(), config.clone());
            }
            pending
        };
        let results = futures_util::future::join_all(additions.into_iter().map(|(name, config)| {
            let client = self.client.clone();
            let cwd = attached.cwd.clone();
            // A spawned task finishes even when the caller stops waiting (TS: uninterruptible).
            tokio::spawn(async move {
                let result = client
                    .experimental_mcp_add(&ExperimentalMcpAddInput {
                        server: name.clone(),
                        location: Some(LocationQueryInput { directory: Some(cwd) }),
                        config: ExperimentalMcpAddInputConfig::Unknown(config),
                    })
                    .await;
                (name, check(result))
            })
        }))
        .await;
        let mut failure = None;
        for result in results {
            let Ok((name, result)) = result else { continue };
            if let Err(error) = result {
                if let Some(state) = lock(&self.mcp).get_mut(&attached.id) {
                    state.registered.remove(&name);
                }
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    /// Adds the session's MCP servers again after its Location was shut down, which drops them.
    pub async fn restore_mcp(&self, attached: &Attached) -> Result<(), Failure> {
        if lock(&self.mcp).contains_key(&attached.id) {
            self.register_mcp(attached, &[]).await?;
        }
        Ok(())
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
            lock(&self.mcp).remove(session_id);
            entry.scope.cancel();
        }
    }

    pub fn detach(&self, session_id: &str) {
        let attached = lock(&self.entries).get(session_id).map(|entry| entry.attached.clone());
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
            .ok_or_else(|| Failure::SessionNotFound { session_id: session_id.to_owned() })
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
            .ok_or_else(|| Failure::SessionNotFound { session_id: attached.id.clone() })?;
        tokio::spawn(async move {
            tokio::select! {
                () = work => {}
                () = scope.cancelled() => {}
            }
        });
        Ok(())
    }

    // Updates the selection before switching so the echoed event is a no-op, and restores it if the switch fails.
    pub async fn select(&self, attached: &Arc<Attached>, change: Change) -> Result<(), Failure> {
        // The server publishes nothing for a switch to its current value, so only a real change waits for an echo.
        let tracked = {
            let mut entries = lock(&self.entries);
            entries.get_mut(&attached.id).filter(|entry| Arc::ptr_eq(&entry.attached, attached)).and_then(|entry| {
                if holds(&entry.confirmed, &change) {
                    return None;
                }
                let id = self.next_pending.fetch_add(1, Ordering::Relaxed);
                entry.pending.push((id, change.clone()));
                Some(id)
            })
        };
        let previous = attached.update(Some(&change));
        let session_id = SessionID(attached.id.clone());
        let result = check(match &change {
            Change::Model(model) => {
                self.client.session_switch_model(&SessionSwitchModelInput { session_id, model: model.clone() }).await
            }
            Change::Mode(agent) => {
                self.client
                    .session_switch_agent(&SessionSwitchAgentInput { session_id, agent: AgentID(agent.clone()) })
                    .await
            }
        });
        if let Err(error) = result {
            let mut entries = lock(&self.entries);
            let mut entry = entries.get_mut(&attached.id).filter(|entry| Arc::ptr_eq(&entry.attached, attached));
            if let (Some(entry), Some(id)) = (entry.as_deref_mut(), tracked) {
                entry.pending.retain(|(pending, _)| *pending != id);
            }
            let latest = entry
                .as_ref()
                .and_then(|entry| entry.pending.iter().rev().find(|(_, item)| same_kind(item, &change)))
                .map(|(_, item)| item.clone());
            match latest {
                Some(latest) => {
                    attached.update(Some(&latest));
                }
                None => {
                    let base = entry.as_ref().map_or(&previous, |entry| &entry.confirmed);
                    attached.restore_field(base, &change);
                }
            }
            return Err(error);
        }
        Ok(())
    }
}

fn same_kind(a: &Change, b: &Change) -> bool {
    matches!((a, b), (Change::Model(_), Change::Model(_)) | (Change::Mode(_), Change::Mode(_)))
}

fn same_change(a: &Change, b: &Change) -> bool {
    match (a, b) {
        (Change::Model(a), Change::Model(b)) => same_model(Some(a), Some(b)),
        (Change::Mode(a), Change::Mode(b)) => a == b,
        _ => false,
    }
}

// Core treats a missing variant as the default one.
fn same_model(a: Option<&ModelRef>, b: Option<&ModelRef>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => {
            a.provider_id == b.provider_id
                && a.id == b.id
                && a.variant.as_deref().unwrap_or("default") == b.variant.as_deref().unwrap_or("default")
        }
        (None, None) => true,
        _ => false,
    }
}

fn holds(selection: &Selection, change: &Change) -> bool {
    match change {
        Change::Model(model) => same_model(selection.model.as_ref(), Some(model)),
        Change::Mode(mode) => selection.mode_id.as_deref() == Some(mode.as_str()),
    }
}

fn pairs(items: Option<&Value>) -> Value {
    let mut object = Map::new();
    for item in items.and_then(Value::as_array).into_iter().flatten() {
        if let (Some(name), Some(value)) = (item.get("name").and_then(Value::as_str), item.get("value").cloned()) {
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
    command.extend(server.get("args").and_then(Value::as_array).into_iter().flatten().cloned());
    json!({
        "type": "local",
        "command": command,
        "environment": pairs(server.get("env")),
    })
}
