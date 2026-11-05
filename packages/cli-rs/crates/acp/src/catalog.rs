//! Models, modes, and commands per directory, kept fresh from server events
//! (`packages/cli/src/acp/catalog.ts`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use opencode_api::client::Client;
use opencode_api::generated::{
    AgentInfoMode, AgentListInput, CommandInfo, CommandListInput, LocationQueryInput, ModelDefaultInput, ModelInfo,
    ModelListInput, ModelRef, PluginListInput,
};
use serde_json::Value;
use tokio::sync::{OnceCell, watch};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::client::{event_type, subscribe};
use crate::error::{Failure, NotReady};
use crate::paths::fs_resolve;

/// What a builtin command starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start {
    Compaction,
}

/// Commands the agent handles itself: name, description, and what they start.
pub const BUILTIN_COMMANDS: &[(&str, &str, Start)] = &[("compact", "Compact the session", Start::Compaction)];

pub fn builtin(name: &str) -> Option<Start> {
    BUILTIN_COMMANDS.iter().find(|(builtin, _, _)| *builtin == name).map(|(_, _, start)| *start)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Mode {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    pub models: Vec<ModelInfo>,
    pub default_model: ModelRef,
    pub modes: Vec<Mode>,
    pub default_mode_id: String,
    pub commands: Vec<CommandInfo>,
}

pub fn find_model<'a>(models: &'a [ModelInfo], model: &ModelRef) -> Option<&'a ModelInfo> {
    models.iter().find(|item| item.provider_id == model.provider_id && item.id == model.id)
}

struct Entry {
    cwd: String,
    catalog: watch::Sender<Catalog>,
    lock: tokio::sync::Mutex<()>,
    requested: AtomicU64,
    loaded: AtomicU64,
}

type Slot = Arc<OnceCell<Arc<Entry>>>;

pub struct Catalogs {
    client: Client,
    entries: Mutex<HashMap<String, Slot>>,
    connected: watch::Receiver<bool>,
    scope: CancellationToken,
}

const POLL: Duration = Duration::from_millis(25);
const POLL_FOR: Duration = Duration::from_secs(5);

impl Catalogs {
    /// Subscribes to events at once, so an update between the first read and the subscription is not
    /// lost.
    pub fn new(client: Client, scope: CancellationToken) -> Arc<Self> {
        let (connected_sender, connected) = watch::channel(false);
        let catalogs = Arc::new(Self { client, entries: Mutex::default(), connected, scope: scope.clone() });
        let events = catalogs.clone();
        tokio::spawn(async move {
            tokio::select! {
                () = events.follow(&connected_sender) => {}
                () = scope.cancelled() => {}
            }
            connected_sender.send_replace(true);
        });
        catalogs
    }

    async fn follow(self: &Arc<Self>, connected: &watch::Sender<bool>) {
        let mut stream = subscribe(&self.client);
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    log::warn!(cause = error.to_string().as_str(); "ACP catalog event stream failed");
                    return;
                }
            };
            let kind = event_type(&event);
            if kind == "server.connected" {
                connected.send_replace(true);
                continue;
            }
            if !matches!(kind, "model.updated" | "agent.updated" | "command.updated") {
                continue;
            }
            let directory =
                event.get("location").and_then(|location| location.get("directory")).and_then(Value::as_str);
            let targets: Vec<(String, Slot)> = {
                let entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
                match directory {
                    None => entries.iter().map(|(key, slot)| (key.clone(), slot.clone())).collect(),
                    Some(directory) => {
                        let key = fs_resolve(directory);
                        entries.get(&key).map(|slot| vec![(key, slot.clone())]).unwrap_or_default()
                    }
                }
            };
            for (_, slot) in targets {
                let catalogs = self.clone();
                let scope = self.scope.clone();
                tokio::spawn(async move {
                    tokio::select! {
                        () = async {
                            if let Some(entry) = catalogs.wait_entry(&slot).await {
                                catalogs.reload_entry(&entry).await;
                            }
                        } => {}
                        () = scope.cancelled() => {}
                    }
                });
            }
        }
    }

    async fn wait_entry(&self, slot: &Slot) -> Option<Arc<Entry>> {
        if let Some(entry) = slot.get() {
            return Some(entry.clone());
        }
        // A load in progress finishes first; a failed one left the slot empty.
        while !slot.initialized() {
            tokio::time::sleep(POLL).await;
            if !self.has_slot(slot) {
                return None;
            }
        }
        slot.get().cloned()
    }

    fn has_slot(&self, slot: &Slot) -> bool {
        self.entries.lock().unwrap_or_else(|p| p.into_inner()).values().any(|item| Arc::ptr_eq(item, slot))
    }

    async fn entry(&self, cwd: &str) -> Result<Arc<Entry>, Failure> {
        let key = fs_resolve(cwd);
        let slot = self.entries.lock().unwrap_or_else(|p| p.into_inner()).entry(key.clone()).or_default().clone();
        let result = slot
            .get_or_try_init(|| async {
                let mut connected = self.connected.clone();
                let _ = connected.wait_for(|connected| *connected).await;
                let catalog = load(&self.client, cwd).await?;
                Ok::<_, Failure>(Arc::new(Entry {
                    cwd: cwd.to_owned(),
                    catalog: watch::Sender::new(catalog),
                    lock: tokio::sync::Mutex::new(()),
                    requested: AtomicU64::new(0),
                    loaded: AtomicU64::new(0),
                }))
            })
            .await
            .cloned();
        if result.is_err() {
            let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            if entries.get(&key).is_some_and(|item| Arc::ptr_eq(item, &slot)) {
                entries.remove(&key);
            }
        }
        result
    }

    // Requests queued behind a running load share the next one.
    async fn reload_entry(&self, entry: &Entry) {
        let target = entry.requested.fetch_add(1, Ordering::SeqCst) + 1;
        let _permit = entry.lock.lock().await;
        if entry.loaded.load(Ordering::SeqCst) >= target {
            return;
        }
        let generation = entry.requested.load(Ordering::SeqCst);
        if let Ok(next) = load(&self.client, &entry.cwd).await {
            entry.catalog.send_replace(next);
        }
        entry.loaded.store(generation, Ordering::SeqCst);
    }

    pub async fn get(&self, cwd: &str) -> Result<Catalog, Failure> {
        Ok(self.entry(cwd).await?.catalog.borrow().clone())
    }

    pub async fn reload(&self, cwd: &str) -> Result<(), Failure> {
        let entry = self.entry(cwd).await?;
        self.reload_entry(&entry).await;
        Ok(())
    }

    /// The catalog of `cwd` as it changes; the receiver starts at the current value.
    pub async fn changes(&self, cwd: &str) -> Result<watch::Receiver<Catalog>, Failure> {
        Ok(self.entry(cwd).await?.catalog.subscribe())
    }
}

// A cold Location lists no plugins until activation finishes, and providers may still discover models after that.
async fn load(client: &Client, cwd: &str) -> Result<Catalog, Failure> {
    let location = || Some(LocationQueryInput { directory: Some(cwd.to_owned()) });
    let start = Instant::now();
    loop {
        match client.plugin_list(&PluginListInput { location: location() }).await {
            Ok(plugins) if plugins.data.is_empty() && start.elapsed() < POLL_FOR => {
                tokio::time::sleep(POLL).await;
            }
            _ => break,
        }
    }
    let start = Instant::now();
    loop {
        match read(client, cwd).await {
            Err(Failure::CatalogNotReady(_)) if start.elapsed() < POLL_FOR => {
                tokio::time::sleep(POLL).await;
            }
            result => return result,
        }
    }
}

async fn read(client: &Client, cwd: &str) -> Result<Catalog, Failure> {
    let location = || Some(LocationQueryInput { directory: Some(cwd.to_owned()) });
    let model_input = ModelListInput { location: location(), ..ModelListInput::default() };
    let default_input = ModelDefaultInput { location: location() };
    let agent_input = AgentListInput { location: location() };
    let command_input = CommandListInput { location: location() };
    let (models, default, agents, commands) = tokio::join!(
        client.model_list(&model_input),
        client.model_default(&default_input),
        client.agent_list(&agent_input),
        client.command_list(&command_input),
    );
    let load = |error| Failure::CatalogLoad(Arc::new(error));
    let models: Vec<ModelInfo> = models.map_err(load)?.data.into_iter().filter(|model| model.enabled).collect();
    let preferred = default.map_err(load)?.data;
    let agents = agents.map_err(load)?.data;
    let commands = commands.map_err(load)?.data;
    // The parallel default read can name a model missing from this list.
    let default_model = match &preferred {
        Some(preferred) => find_model(
            &models,
            &ModelRef { id: preferred.id.clone(), provider_id: preferred.provider_id.clone(), variant: None },
        ),
        None => models.first(),
    }
    .ok_or(Failure::CatalogNotReady(NotReady::Models))?;
    let modes: Vec<Mode> = agents
        .into_iter()
        .filter(|agent| agent.mode != AgentInfoMode::Subagent && !agent.hidden)
        .map(|agent| Mode { id: agent.id.0, name: agent.name, description: agent.description })
        .collect();
    // Core lists its resolved default agent first, the same one a new session runs.
    let default_mode_id =
        modes.first().map(|mode| mode.id.clone()).ok_or(Failure::CatalogNotReady(NotReady::Agents))?;
    Ok(Catalog {
        default_model: ModelRef {
            id: default_model.id.clone(),
            provider_id: default_model.provider_id.clone(),
            variant: default_model
                .variants
                .iter()
                .find(|variant| variant.id == "default")
                .map(|variant| variant.id.clone()),
        },
        models,
        modes,
        default_mode_id,
        commands: commands.into_iter().filter(|command| builtin(&command.name).is_none()).collect(),
    })
}
