//! Locations and their catalogs (F.8): location info, VCS, agents, commands, config, integrations,
//! MCP servers and resources, models, providers, references, skills, shells, web search, and usage
//! limits, each read once per invalidation and refreshed by the events that name its location.

use std::time::Duration;

use futures_util::future::try_join_all;
use indexmap::IndexMap;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::*;

use crate::connection::Follow;
use crate::shells::Shell;
use crate::state::{Data, Error, State, Task};

/// Trailing window for event bursts that each ask for the same refetch (`settleMs`).
pub const SETTLE: Duration = Duration::from_millis(150);

/// A location: a directory, and a workspace once placement uses one (`LocationRef`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct Location {
    pub directory: String,
    pub workspace_id: Option<String>,
}

impl Location {
    pub fn new(directory: impl Into<String>) -> Self {
        Self {
            directory: directory.into(),
            workspace_id: None,
        }
    }

    /// `locationKey`, the spelling of the TS sync keys.
    pub fn key(&self) -> String {
        serde_json::to_string(&(&self.directory, &self.workspace_id)).unwrap_or_default()
    }

    /// The request query names the directory only (`locationQuery`).
    pub(crate) fn query(&self) -> Option<LocationQueryInput> {
        Some(LocationQueryInput {
            directory: Some(self.directory.clone()),
        })
    }
}

impl From<&LocationRef> for Location {
    fn from(value: &LocationRef) -> Self {
        Self {
            directory: value.directory.0.clone(),
            workspace_id: value.workspace_id.as_ref().map(|id| id.0.clone()),
        }
    }
}

impl From<&LocationPublicRef> for Location {
    fn from(value: &LocationPublicRef) -> Self {
        Self::new(value.directory.0.clone())
    }
}

/// A cached per-location catalog, by its TS field name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Catalog {
    Vcs,
    UsageLimits,
    Agent,
    Command,
    Config,
    Integration,
    McpServer,
    McpResource,
    Model,
    Provider,
    Reference,
    Skill,
    Shell,
}

impl Catalog {
    fn field(self) -> &'static str {
        match self {
            Catalog::Vcs => "vcs",
            Catalog::UsageLimits => "usageLimits",
            Catalog::Agent => "agent",
            Catalog::Command => "command",
            Catalog::Config => "config",
            Catalog::Integration => "integration",
            Catalog::McpServer => "mcpServer",
            Catalog::McpResource => "mcpResource",
            Catalog::Model => "model",
            Catalog::Provider => "provider",
            Catalog::Reference => "reference",
            Catalog::Skill => "skill",
            Catalog::Shell => "shell",
        }
    }

    pub(crate) fn key(self, location: &Location) -> String {
        format!("location.{}:{}", self.field(), location.key())
    }

    /// Model and provider reads also publish under the requested location when the server
    /// answers with another.
    fn alias(self) -> bool {
        matches!(self, Catalog::Model | Catalog::Provider)
    }
}

/// What the store knows about one location. `None` means not read yet.
#[derive(Debug, Clone, Default)]
pub struct LocationData {
    pub info: Option<LocationPublicInfo>,
    pub vcs: Option<VcsInfo>,
    pub agent: Option<Vec<AgentInfo>>,
    pub command: Option<Vec<CommandInfo>>,
    pub config: Option<Vec<ConfigEntry>>,
    pub integration: Option<Vec<IntegrationInfo>>,
    pub mcp_server: Option<Vec<McpServer>>,
    pub mcp_resource: Option<Vec<McpResource>>,
    pub model: Option<Vec<ModelInfo>>,
    pub provider: Option<Vec<ProviderInfo>>,
    pub reference: Option<Vec<ReferenceInfo>>,
    pub websearch: Option<Vec<WebSearchProvider>>,
    /// The Go allowance and Console budgets of the signed-in OpenCode Console workspace; the
    /// inner `None` means not signed in.
    pub usage_limits: Option<Option<UsageLimitsInfo>>,
    /// Running shells by ID. Exited and deleted shells are removed.
    pub shell: Option<IndexMap<ShellID, Shell>>,
    pub skill: Option<Vec<SkillInfo>>,
}

impl LocationData {
    fn has(&self, catalog: Catalog) -> bool {
        match catalog {
            Catalog::Vcs => self.vcs.is_some(),
            Catalog::UsageLimits => self.usage_limits.is_some(),
            Catalog::Agent => self.agent.is_some(),
            Catalog::Command => self.command.is_some(),
            Catalog::Config => self.config.is_some(),
            Catalog::Integration => self.integration.is_some(),
            Catalog::McpServer => self.mcp_server.is_some(),
            Catalog::McpResource => self.mcp_resource.is_some(),
            Catalog::Model => self.model.is_some(),
            Catalog::Provider => self.provider.is_some(),
            Catalog::Reference => self.reference.is_some(),
            Catalog::Skill => self.skill.is_some(),
            Catalog::Shell => self.shell.is_some(),
        }
    }
}

/// One catalog read, ready to publish.
#[derive(Clone)]
enum Loaded {
    Vcs(VcsInfo),
    UsageLimits(Option<UsageLimitsInfo>),
    Agent(Vec<AgentInfo>),
    Command(Vec<CommandInfo>),
    Config(Vec<ConfigEntry>),
    Integration(Vec<IntegrationInfo>),
    McpServer(Vec<McpServer>),
    McpResource(Vec<McpResource>),
    Model(Vec<ModelInfo>),
    Provider(Vec<ProviderInfo>),
    Reference(Vec<ReferenceInfo>),
    Skill(Vec<SkillInfo>),
    Shell(IndexMap<ShellID, Shell>),
}

impl Loaded {
    fn publish(self, data: &mut LocationData) {
        match self {
            Loaded::Vcs(value) => data.vcs = Some(value),
            Loaded::UsageLimits(value) => data.usage_limits = Some(value),
            Loaded::Agent(value) => data.agent = Some(value),
            Loaded::Command(value) => data.command = Some(value),
            Loaded::Config(value) => data.config = Some(value),
            Loaded::Integration(value) => data.integration = Some(value),
            Loaded::McpServer(value) => data.mcp_server = Some(value),
            Loaded::McpResource(value) => data.mcp_resource = Some(value),
            Loaded::Model(value) => data.model = Some(value),
            Loaded::Provider(value) => data.provider = Some(value),
            Loaded::Reference(value) => data.reference = Some(value),
            Loaded::Skill(value) => data.skill = Some(value),
            Loaded::Shell(value) => data.shell = Some(value),
        }
    }
}

impl State {
    /// The location new sessions and unqualified reads use. A read of the default location's
    /// info replaces it with the server's directory.
    pub fn default_location(&self) -> &Location {
        &self.default_location
    }

    /// Everything known about a location (the default one for `None`).
    pub fn location(&self, location: Option<&Location>) -> Option<&LocationData> {
        self.locations
            .get(location.unwrap_or(&self.default_location))
    }

    /// Every location the store holds data for.
    pub fn locations(&self) -> impl Iterator<Item = (&Location, &LocationData)> {
        self.locations.iter()
    }

    /// `hasLocation`: read, or being read.
    pub(crate) fn has_catalog(&self, catalog: Catalog, location: &Location) -> bool {
        self.locations
            .get(location)
            .is_some_and(|data| data.has(catalog))
            || self.syncs.has(&catalog.key(location))
    }

    pub(crate) fn location_mut(&mut self, location: &Location) -> &mut LocationData {
        self.log.location(location);
        self.locations.entry(location.clone()).or_default()
    }

    fn publish(&mut self, location: &Location, loaded: Loaded) {
        loaded.publish(self.location_mut(location));
    }

    /// `refreshLocation`: invalidates the catalog and reads it again where something read it.
    fn refresh_catalog(&mut self, catalog: Catalog, location: &Location) -> Vec<Follow> {
        let active = self.has_catalog(catalog, location);
        self.syncs.invalidate(&catalog.key(location));
        follow_if(active, vec![catalog], location)
    }

    /// Invalidates `catalogs` and reads them again together when any of `watched` was read.
    fn refresh_together(
        &mut self,
        watched: &[Catalog],
        catalogs: Vec<Catalog>,
        location: &Location,
    ) -> Vec<Follow> {
        let active = watched
            .iter()
            .any(|catalog| self.has_catalog(*catalog, location));
        for catalog in &catalogs {
            self.syncs.invalidate(&catalog.key(location));
        }
        follow_if(active, catalogs, location)
    }

    /// The catalog arms of `handleEvent`: credentials, then the events that name a location.
    pub(crate) fn on_catalog_event(&mut self, event: &V2Event) -> Vec<Follow> {
        match event {
            V2Event::CredentialUpdated(_) => {
                let locations: Vec<Location> = self.locations.keys().cloned().collect();
                return locations
                    .iter()
                    .flat_map(|location| {
                        let mut follow = self.refresh_catalog(Catalog::UsageLimits, location);
                        follow.extend(self.refresh_catalog(Catalog::Integration, location));
                        follow
                    })
                    .collect();
            }
            V2Event::CredentialSwitched(event) => {
                let locations: Vec<Location> = self.locations.keys().cloned().collect();
                return locations
                    .iter()
                    .flat_map(|location| {
                        let mut follow = self.refresh_catalog(Catalog::UsageLimits, location);
                        self.promote_credential(location, &event.data);
                        follow.extend(self.refresh_together(
                            &[Catalog::Integration, Catalog::Model, Catalog::Provider],
                            vec![Catalog::Model, Catalog::Provider],
                            location,
                        ));
                        follow
                    })
                    .collect();
            }
            _ => {}
        }
        let Some(location) = located(event) else {
            return Vec::new();
        };
        let location = Location::from(location);
        match event {
            V2Event::ProviderUpdated(_) => self.refresh_catalog(Catalog::Provider, &location),
            V2Event::ModelUpdated(_) => self.refresh_catalog(Catalog::Model, &location),
            V2Event::AgentUpdated(_) => self.refresh_catalog(Catalog::Agent, &location),
            V2Event::CommandUpdated(_) => self.refresh_catalog(Catalog::Command, &location),
            V2Event::SkillUpdated(_) => self.refresh_catalog(Catalog::Skill, &location),
            // The event names only the current branch. Reload the rest: the default branch and
            // provider can change with it, and a read served before the location's VCS provider
            // loaded has neither.
            V2Event::VcsBranchUpdated(_) => self.refresh_catalog(Catalog::Vcs, &location),
            V2Event::FormCreated(event) => {
                self.on_form_created(&event.data.form, &location);
                Vec::new()
            }
            V2Event::ShellCreated(event) => {
                self.on_shell_created(&event.data.info, &location);
                Vec::new()
            }
            V2Event::ShellExited(event) => {
                self.remove_shell(&event.data.id, &location);
                Vec::new()
            }
            V2Event::ShellDeleted(event) => {
                self.remove_shell(&event.data.id, &location);
                Vec::new()
            }
            V2Event::ReferenceUpdated(_) => self.refresh_catalog(Catalog::Reference, &location),
            V2Event::IntegrationUpdated(_) => {
                let mut follow = self.refresh_catalog(Catalog::UsageLimits, &location);
                let catalogs = vec![Catalog::Integration, Catalog::Model, Catalog::Provider];
                follow.extend(self.refresh_together(&catalogs.clone(), catalogs, &location));
                follow
            }
            V2Event::ConfigUpdated(_) => {
                let mut follow = self.refresh_catalog(Catalog::Config, &location);
                if self.has_websearch(&location) {
                    follow.push(Follow::Websearch(location));
                }
                follow
            }
            V2Event::WebsearchUpdated(_) if self.has_websearch(&location) => {
                vec![Follow::Websearch(location)]
            }
            // Authenticating an MCP integration reconnects its server, which emits
            // mcp.status.changed, so the MCP list syncs here rather than off integration.updated.
            // The server emits one event per MCP server as each settles, so the read waits for the
            // burst to go quiet.
            V2Event::McpStatusChanged(_) => {
                let active = self.has_catalog(Catalog::McpServer, &location);
                self.syncs.invalidate(&Catalog::McpServer.key(&location));
                if !active {
                    return Vec::new();
                }
                vec![Follow::Settle(
                    format!("mcp.status:{}", location.key()),
                    Catalog::McpServer,
                    location,
                )]
            }
            V2Event::McpResourcesChanged(_) => {
                self.refresh_catalog(Catalog::McpResource, &location)
            }
            _ => Vec::new(),
        }
    }

    fn has_websearch(&self, location: &Location) -> bool {
        self.locations
            .get(location)
            .is_some_and(|data| data.websearch.is_some())
    }

    /// `credential.switched`: the switched credential becomes the integration's first connection.
    fn promote_credential(&mut self, location: &Location, data: &CredentialSwitchedData) {
        let Some(credential) = &data.credential_id else {
            return;
        };
        let Some(integrations) = self
            .locations
            .get_mut(location)
            .and_then(|data| data.integration.as_mut())
        else {
            return;
        };
        let mut changed = false;
        for integration in integrations
            .iter_mut()
            .filter(|integration| integration.id == data.integration_id)
        {
            let Some(at) = integration.connections.iter().position(|connection| {
                matches!(connection, ConnectionInfo::Credential(info) if info.id == *credential)
            }) else {
                continue;
            };
            let active = integration.connections.remove(at);
            integration.connections.insert(0, active);
            changed = true;
        }
        if changed {
            self.log.location(location);
        }
    }
}

fn follow_if(active: bool, catalogs: Vec<Catalog>, location: &Location) -> Vec<Follow> {
    if !active {
        return Vec::new();
    }
    vec![Follow::Catalogs(catalogs, location.clone())]
}

/// The location of the events the catalog arms handle.
fn located(event: &V2Event) -> Option<&LocationRef> {
    let location = match event {
        V2Event::ProviderUpdated(event) => &event.location,
        V2Event::ModelUpdated(event) => &event.location,
        V2Event::AgentUpdated(event) => &event.location,
        V2Event::CommandUpdated(event) => &event.location,
        V2Event::SkillUpdated(event) => &event.location,
        V2Event::VcsBranchUpdated(event) => &event.location,
        V2Event::FormCreated(event) => &event.location,
        V2Event::ShellCreated(event) => &event.location,
        V2Event::ShellExited(event) => &event.location,
        V2Event::ShellDeleted(event) => &event.location,
        V2Event::ReferenceUpdated(event) => &event.location,
        V2Event::IntegrationUpdated(event) => &event.location,
        V2Event::ConfigUpdated(event) => &event.location,
        V2Event::WebsearchUpdated(event) => &event.location,
        V2Event::McpStatusChanged(event) => &event.location,
        V2Event::McpResourcesChanged(event) => &event.location,
        _ => return None,
    };
    location.as_ref()
}

impl Data {
    fn resolve(&self, location: Option<&Location>) -> Location {
        location
            .cloned()
            .unwrap_or_else(|| self.read(|state| state.default_location.clone()))
    }

    /// Reads a catalog once per invalidation. It publishes under the location the server
    /// answers with; model and provider reads also under the requested one.
    pub fn catalog_sync(&self, catalog: Catalog, location: Option<&Location>) -> Task<()> {
        let location = self.resolve(location);
        self.sync_run(catalog.key(&location), move |data| async move {
            let (at, loaded) = load(data.client(), catalog, &location)
                .await
                .map_err(Error::new)?;
            data.write(|state| {
                if catalog.alias() && at != location {
                    state.publish(&location, loaded.clone());
                }
                state.publish(&at, loaded);
            });
            Ok(())
        })
    }

    pub fn catalog_invalidate(&self, catalog: Catalog, location: Option<&Location>) {
        let location = self.resolve(location);
        self.write(|state| state.syncs.invalidate(&catalog.key(&location)));
    }

    /// Reads location info once per invalidation (`location.syncInfo`). A read of the default
    /// location adopts the server's directory as the default.
    pub fn location_sync_info(&self, location: Option<&Location>) -> Task<()> {
        let default = location.is_none();
        let current = self.resolve(location);
        self.sync_run(
            format!("location:{}", current.key()),
            move |data| async move {
                let info = data
                    .client()
                    .location_get(
                        &LocationGetInput {
                            location: current.query(),
                        },
                        &RequestOptions::default(),
                    )
                    .await
                    .map_err(Error::new)?;
                data.write(|state| {
                    let at = Location::new(info.directory.0.clone());
                    if default {
                        state.default_location = at.clone();
                    }
                    state.location_mut(&at).info = Some(info);
                });
                Ok(())
            },
        )
    }

    /// Reads location info, then every catalog a session view shows (`location.sync`).
    pub fn location_sync(&self, location: Option<&Location>) -> Task<()> {
        let data = self.clone();
        let requested = location.cloned();
        self.spawn(async move {
            data.location_sync_info(requested.as_ref()).await?;
            let location = data.resolve(requested.as_ref());
            let mut reads: Vec<Task<()>> = [
                Catalog::Vcs,
                Catalog::Agent,
                Catalog::Command,
                Catalog::Integration,
                Catalog::McpServer,
                Catalog::McpResource,
                Catalog::Model,
                Catalog::Provider,
                Catalog::Reference,
                Catalog::Skill,
                Catalog::Shell,
            ]
            .into_iter()
            .map(|catalog| data.catalog_sync(catalog, Some(&location)))
            .collect();
            reads.push(data.form_sync(crate::forms::GLOBAL, Some(&location)));
            try_join_all(reads).await?;
            Ok(())
        })
    }

    /// Invalidates location info and every catalog except usage limits (`location.invalidate`).
    pub fn location_invalidate(&self, location: Option<&Location>) {
        let location = self.resolve(location);
        self.write(|state| {
            state
                .syncs
                .invalidate(&format!("location:{}", location.key()));
            for catalog in [
                Catalog::Vcs,
                Catalog::Agent,
                Catalog::Command,
                Catalog::Config,
                Catalog::Integration,
                Catalog::McpServer,
                Catalog::McpResource,
                Catalog::Model,
                Catalog::Provider,
                Catalog::Reference,
                Catalog::Skill,
                Catalog::Shell,
            ] {
                state.syncs.invalidate(&catalog.key(&location));
            }
            state
                .syncs
                .invalidate(&crate::forms::sync_key(crate::forms::GLOBAL, &location));
        });
    }

    /// Reads web search providers on every call; there is no cached read.
    pub fn websearch_refresh(&self, location: Option<&Location>) -> Task<()> {
        let location = self.resolve(location);
        let data = self.clone();
        self.spawn(async move {
            let providers = data
                .client()
                .websearch_providers(
                    &WebsearchProvidersInput {
                        location: location.query(),
                    },
                    &RequestOptions::default(),
                )
                .await
                .map_err(Error::new)?;
            data.write(|state| {
                state
                    .location_mut(&Location::from(&providers.location))
                    .websearch = Some(providers.data);
            });
            Ok(())
        })
    }

    /// `server.connected`: reads the default location's info without the sync key, as TS does.
    pub(crate) fn rehydrate_location(&self) {
        let data = self.clone();
        let location = self.resolve(None);
        self.refresh(async move {
            let info = data
                .client()
                .location_get(
                    &LocationGetInput {
                        location: location.query(),
                    },
                    &RequestOptions::default(),
                )
                .await
                .map_err(Error::new)?;
            let at = Location::new(info.directory.0.clone());
            data.write(|state| state.location_mut(&at).info = Some(info));
            Ok(())
        });
    }

    pub(crate) fn refresh_catalogs(&self, catalogs: Vec<Catalog>, location: Location) {
        let reads: Vec<Task<()>> = catalogs
            .into_iter()
            .map(|catalog| self.catalog_sync(catalog, Some(&location)))
            .collect();
        self.refresh(async move { try_join_all(reads).await.map(|_| ()) });
    }

    /// Reads `catalog` once a burst of events under `key` goes quiet for [`SETTLE`].
    pub(crate) fn settle(&self, key: String, catalog: Catalog, location: Location) {
        let data = self.clone();
        let mut state = self.lock();
        let token = state.token();
        let timer = key.clone();
        // Spawned under the lock, so the timer cannot fire before its entry exists.
        let handle = self.runtime().spawn(async move {
            tokio::time::sleep(SETTLE).await;
            let current = {
                let mut state = data.lock();
                let current = state
                    .settling
                    .get(&timer)
                    .is_some_and(|(owner, _)| *owner == token);
                if current {
                    state.settling.remove(&timer);
                }
                current
            };
            if current {
                data.refresh_catalogs(vec![catalog], location);
            }
        });
        if let Some((_, previous)) = state.settling.insert(key, (token, handle.abort_handle())) {
            previous.abort();
        }
    }
}

async fn load(
    client: &Client,
    catalog: Catalog,
    location: &Location,
) -> Result<(Location, Loaded), opencode_api::error::Error> {
    let query = location.query();
    let options = RequestOptions::default();
    Ok(match catalog {
        Catalog::Vcs => {
            let response = client
                .vcs_get(&VcsGetInput { location: query }, &options)
                .await?;
            ((&response.location).into(), Loaded::Vcs(response.data))
        }
        Catalog::UsageLimits => {
            let response = client
                .experimental_usage_limits(
                    &ExperimentalUsageLimitsInput { location: query },
                    &options,
                )
                .await?;
            (
                (&response.location).into(),
                Loaded::UsageLimits(response.data),
            )
        }
        Catalog::Agent => {
            let response = client
                .agent_list(&AgentListInput { location: query }, &options)
                .await?;
            ((&response.location).into(), Loaded::Agent(response.data))
        }
        Catalog::Command => {
            let response = client
                .command_list(&CommandListInput { location: query }, &options)
                .await?;
            ((&response.location).into(), Loaded::Command(response.data))
        }
        // Config answers without a location; it publishes under the requested directory.
        Catalog::Config => {
            let entries = client
                .config_get(&ConfigGetInput { location: query }, &options)
                .await?;
            (
                Location::new(location.directory.clone()),
                Loaded::Config(entries),
            )
        }
        Catalog::Integration => {
            let response = client
                .integration_list(&IntegrationListInput { location: query }, &options)
                .await?;
            (
                (&response.location).into(),
                Loaded::Integration(response.data),
            )
        }
        Catalog::McpServer => {
            let response = client
                .mcp_list(&McpListInput { location: query }, &options)
                .await?;
            (
                (&response.location).into(),
                Loaded::McpServer(response.data),
            )
        }
        Catalog::McpResource => {
            let response = client
                .mcp_resource_catalog(&McpResourceCatalogInput { location: query }, &options)
                .await?;
            (
                (&response.location).into(),
                Loaded::McpResource(response.data.resources),
            )
        }
        Catalog::Model => {
            let response = client
                .model_list(
                    &ModelListInput {
                        location: query,
                        types: None,
                    },
                    &options,
                )
                .await?;
            ((&response.location).into(), Loaded::Model(response.data))
        }
        Catalog::Provider => {
            let response = client
                .provider_list(&ProviderListInput { location: query }, &options)
                .await?;
            ((&response.location).into(), Loaded::Provider(response.data))
        }
        Catalog::Reference => {
            let response = client
                .reference_list(&ReferenceListInput { location: query }, &options)
                .await?;
            (
                (&response.location).into(),
                Loaded::Reference(response.data),
            )
        }
        Catalog::Skill => {
            let response = client
                .skill_list(&SkillListInput { location: query }, &options)
                .await?;
            ((&response.location).into(), Loaded::Skill(response.data))
        }
        Catalog::Shell => {
            let response = client
                .shell_list(&ShellListInput { location: query }, &options)
                .await?;
            let at = Location::from(&response.location);
            let shells = response
                .data
                .into_iter()
                .map(|info| {
                    let info = crate::shells::from_list(info);
                    (
                        info.id.clone(),
                        Shell {
                            info,
                            location: at.clone(),
                        },
                    )
                })
                .collect();
            (at, Loaded::Shell(shells))
        }
    })
}
