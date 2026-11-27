//! Location catalogs are read once per invalidation. Events refresh only their affected location.

use std::sync::Arc;
use std::time::Duration;

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::changes::Parts;
use crate::core::{CatalogRead, Effect, LocationRead, Ticket};
use crate::reads::{Read, ReadKey};
use crate::shells::{Shell, ShellRead};
use crate::state::State;

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
        Self { directory: directory.into(), workspace_id: None }
    }

    /// `locationKey`, the spelling of the TS sync keys.
    pub fn key(&self) -> String {
        serde_json::to_string(&(&self.directory, &self.workspace_id)).unwrap_or_default()
    }

    /// The request query names the directory only (`locationQuery`).
    pub(crate) fn query(&self) -> Option<LocationQueryInput> {
        Some(LocationQueryInput { directory: Some(self.directory.clone()) })
    }
}

impl From<&LocationRef> for Location {
    fn from(value: &LocationRef) -> Self {
        Self { directory: value.directory.0.clone(), workspace_id: value.workspace_id.as_ref().map(|id| id.0.clone()) }
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
    /// Model and provider reads also publish under the requested location when the server
    /// answers with another.
    fn alias(self) -> bool {
        matches!(self, Catalog::Model | Catalog::Provider)
    }
}

/// What the store knows about one location. `None` means not read yet; a catalog is shared, so a copy is a count.
#[derive(Debug, Clone, Default)]
pub struct LocationData {
    pub info: Option<LocationPublicInfo>,
    pub vcs: Option<VcsInfo>,
    pub agent: Option<Arc<[AgentInfo]>>,
    pub command: Option<Arc<[CommandInfo]>>,
    pub config: Option<Arc<[ConfigEntry]>>,
    pub integration: Option<Arc<[IntegrationInfo]>>,
    pub mcp_server: Option<Arc<[McpServer]>>,
    pub mcp_resource: Option<Arc<[McpResource]>>,
    pub model: Option<Arc<[ModelInfo]>>,
    pub provider: Option<Arc<[ProviderInfo]>>,
    pub reference: Option<Arc<[ReferenceInfo]>>,
    pub websearch: Option<Vec<WebSearchProvider>>,
    /// The Go allowance and Console budgets of the signed-in OpenCode Console workspace; the
    /// inner `None` means not signed in.
    pub usage_limits: Option<Option<UsageLimitsInfo>>,
    /// Running shells by ID. Exited and deleted shells are removed.
    pub shell: Option<IndexMap<ShellID, Shell>>,
    pub skill: Option<Arc<[SkillInfo]>>,
    pub(crate) shell_read: Option<ShellRead>,
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
pub(crate) enum Loaded {
    Vcs(VcsInfo),
    UsageLimits(Option<UsageLimitsInfo>),
    Agent(Arc<[AgentInfo]>),
    Command(Arc<[CommandInfo]>),
    Config(Arc<[ConfigEntry]>),
    Integration(Arc<[IntegrationInfo]>),
    McpServer(Arc<[McpServer]>),
    McpResource(Arc<[McpResource]>),
    Model(Arc<[ModelInfo]>),
    Provider(Arc<[ProviderInfo]>),
    Reference(Arc<[ReferenceInfo]>),
    Skill(Arc<[SkillInfo]>),
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
        self.locations.get(location.unwrap_or(&self.default_location))
    }

    /// Every location the store holds data for.
    pub fn locations(&self) -> impl Iterator<Item = (&Location, &LocationData)> {
        self.locations.iter()
    }

    /// `hasLocation`: read, or being read.
    pub(crate) fn has_catalog(&self, catalog: Catalog, location: &Location) -> bool {
        self.locations.get(location).is_some_and(|data| data.has(catalog))
            || self.has_read(Read::Catalog(catalog, location))
    }

    /// The data of `location`, whose `parts` change.
    pub(crate) fn location_mut(&mut self, location: &Location, parts: Parts) -> &mut LocationData {
        self.touch_location(location, parts);
        self.locations.entry(location.clone()).or_default()
    }

    fn publish(&mut self, location: &Location, catalog: Catalog, loaded: Loaded) {
        loaded.publish(self.location_mut(location, Parts::catalogs(&[catalog])));
    }

    /// `refreshLocation`: invalidates the catalog and reads it again where something read it.
    pub(crate) fn refresh_catalog(&mut self, catalog: Catalog, location: &Location, effects: &mut Vec<Effect>) {
        self.refresh_together(&[catalog], vec![catalog], location, effects);
    }

    /// Invalidates `catalogs` and reads them again together when any of `watched` was read.
    fn refresh_together(
        &mut self,
        watched: &[Catalog],
        catalogs: Vec<Catalog>,
        location: &Location,
        effects: &mut Vec<Effect>,
    ) {
        let active = watched.iter().any(|catalog| self.has_catalog(*catalog, location));
        for catalog in &catalogs {
            self.invalidate(Read::Catalog(*catalog, location));
        }
        if active {
            effects.push(Effect::Catalogs(catalogs, location.clone()));
        }
    }

    /// The catalog arms of `handleEvent`: credentials, then the events that name a location.
    pub(crate) fn on_catalog_event(&mut self, event: &V2Event, effects: &mut Vec<Effect>) {
        match event {
            V2Event::CredentialUpdated(_) => {
                let locations: Vec<Location> = self.locations.keys().cloned().collect();
                for location in &locations {
                    self.refresh_catalog(Catalog::UsageLimits, location, effects);
                    self.refresh_catalog(Catalog::Integration, location, effects);
                }
                return;
            }
            V2Event::CredentialSwitched(event) => {
                let locations: Vec<Location> = self.locations.keys().cloned().collect();
                for location in &locations {
                    self.refresh_catalog(Catalog::UsageLimits, location, effects);
                    self.promote_credential(location, &event.data);
                    let watched = [Catalog::Integration, Catalog::Model, Catalog::Provider];
                    self.refresh_together(&watched, vec![Catalog::Model, Catalog::Provider], location, effects);
                }
                return;
            }
            _ => {}
        }
        let Some(location) = located(event) else { return };
        let location = Location::from(location);
        match event {
            V2Event::ProviderUpdated(_) => self.refresh_catalog(Catalog::Provider, &location, effects),
            V2Event::ModelUpdated(_) => self.refresh_catalog(Catalog::Model, &location, effects),
            V2Event::AgentUpdated(_) => self.refresh_catalog(Catalog::Agent, &location, effects),
            V2Event::CommandUpdated(_) => self.refresh_catalog(Catalog::Command, &location, effects),
            V2Event::SkillUpdated(_) => self.refresh_catalog(Catalog::Skill, &location, effects),
            // The event names only the current branch. Reload the rest: the default branch and
            // provider can change with it, and a read served before the location's VCS provider
            // loaded has neither.
            V2Event::VcsBranchUpdated(_) => self.refresh_catalog(Catalog::Vcs, &location, effects),
            V2Event::FormCreated(event) => self.on_form_created(&event.data.form, &location),
            V2Event::ShellCreated(event) => self.on_shell_created(&event.data.info, &location),
            V2Event::ShellExited(event) => self.remove_shell(&event.data.id, &location),
            V2Event::ShellDeleted(event) => self.remove_shell(&event.data.id, &location),
            V2Event::ReferenceUpdated(_) => self.refresh_catalog(Catalog::Reference, &location, effects),
            V2Event::IntegrationUpdated(_) => {
                self.refresh_catalog(Catalog::UsageLimits, &location, effects);
                let catalogs = [Catalog::Integration, Catalog::Model, Catalog::Provider];
                self.refresh_together(&catalogs, catalogs.to_vec(), &location, effects);
            }
            V2Event::ConfigUpdated(_) => {
                self.refresh_catalog(Catalog::Config, &location, effects);
                if self.has_websearch(&location) {
                    effects.push(Effect::Websearch(location));
                }
            }
            V2Event::WebsearchUpdated(_) if self.has_websearch(&location) => effects.push(Effect::Websearch(location)),
            // Authenticating an MCP integration reconnects its server, which emits
            // mcp.status.changed, so the MCP list syncs here rather than off integration.updated.
            // The server emits one event per MCP server as each settles, so the read waits for the
            // burst to go quiet.
            V2Event::McpStatusChanged(_) => {
                let active = self.has_catalog(Catalog::McpServer, &location);
                self.invalidate(Read::Catalog(Catalog::McpServer, &location));
                if active {
                    effects.push(Effect::Settle(Catalog::McpServer, location));
                }
            }
            V2Event::McpResourcesChanged(_) => self.refresh_catalog(Catalog::McpResource, &location, effects),
            _ => {}
        }
    }

    /// Begins a read of `catalog` at the location `at`.
    pub(crate) fn begin_catalog(&mut self, ticket: Ticket) -> CatalogRead {
        let ReadKey::Catalog(catalog, at) = ticket.key else { unreachable!("a catalog read") };
        CatalogRead { ticket, catalog, location: self.read_location(at) }
    }

    /// Publishes a catalog under the location the server answered with; model and provider reads also under the
    /// requested one.
    pub(crate) fn complete_catalog(&mut self, read: CatalogRead, at: Location, loaded: Loaded) {
        if read.catalog.alias() && at != read.location {
            self.publish(&read.location, read.catalog, loaded.clone());
        }
        self.publish(&at, read.catalog, loaded);
    }

    /// Begins a read of the location info of `ticket`'s location; one of the default location `adopt`s the server's
    /// directory as the default.
    pub(crate) fn begin_location(&mut self, ticket: Ticket, adopt: bool) -> LocationRead {
        let ReadKey::Location(at) = ticket.key else { unreachable!("a location read") };
        LocationRead { ticket: Some(ticket), location: self.read_location(at), adopt }
    }

    /// Stores location info, under the directory the server answered with.
    pub(crate) fn complete_location(&mut self, adopt: bool, info: LocationPublicInfo) {
        let at = Location::new(info.directory.0.clone());
        if adopt {
            self.default_location = at.clone();
        }
        self.location_mut(&at, Parts::INFO).info = Some(info);
    }

    /// Begins the trailing refetch of `catalog` at `location`: its key, its token, and the token of the timer it
    /// replaces.
    pub(crate) fn begin_settle(&mut self, catalog: Catalog, location: &Location) -> (ReadKey, u64, Option<u64>) {
        let token = self.token();
        let key = self.read_key(Read::Catalog(catalog, location));
        let previous = self.settling.insert(key, token);
        (key, token, previous)
    }

    /// The trailing refetch `token` of `key` fires, unless a newer one replaced it.
    pub(crate) fn complete_settle(
        &mut self,
        key: ReadKey,
        token: u64,
        catalog: Catalog,
        location: Location,
        effects: &mut Vec<Effect>,
    ) {
        if self.settling.get(&key) != Some(&token) {
            return;
        }
        self.settling.remove(&key);
        effects.push(Effect::Catalogs(vec![catalog], location));
    }

    fn has_websearch(&self, location: &Location) -> bool {
        self.locations.get(location).is_some_and(|data| data.websearch.is_some())
    }

    /// `credential.switched`: the switched credential becomes the integration's first connection.
    fn promote_credential(&mut self, location: &Location, data: &CredentialSwitchedData) {
        let Some(credential) = &data.credential_id else { return };
        let Some(integrations) = self.locations.get_mut(location).and_then(|data| data.integration.as_mut()) else {
            return;
        };
        let mut changed = false;
        for integration in
            Arc::make_mut(integrations).iter_mut().filter(|integration| integration.id == data.integration_id)
        {
            let Some(at) = integration.connections.iter().position(
                |connection| matches!(connection, ConnectionInfo::Credential(info) if info.id == *credential),
            ) else {
                continue;
            };
            let active = integration.connections.remove(at);
            integration.connections.insert(0, active);
            changed = true;
        }
        if changed {
            self.touch_location(location, Parts::catalogs(&[Catalog::Integration]));
        }
    }
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
