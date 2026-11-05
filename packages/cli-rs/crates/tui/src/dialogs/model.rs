//! Models and agents (E.16): the model dialog (`component/dialog-model.tsx`, `component/model-options.tsx`), the
//! model and agent state of `context/local.tsx`, and the app commands that reach them (`app.tsx:903-1018`).
//!
//! [`Local`] holds the current location's catalog (models, providers, agents, integrations, and the configured
//! model, read through the store; and the usage limits), `model.json`, and the per-session and per-agent
//! selections. It sends no mutating request: the prompt commits a selection when it submits
//! (`prompt/index.tsx:1293`), and the session's `session.agent.selected` and `session.model.selected` settle the
//! drafts that commit sent. `model.json` writes run in order on one worker thread, because its file lock blocks.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::mpsc;
use std::time::Duration;

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    AgentInfo, AgentInfoMode, ExperimentalUsageLimitsInput, IntegrationInfo, LocationQueryInput,
    ModelInfo, ModelInfoStatus, ModelRef, ProviderInfo, SessionID, SessionInfo, UsageLimitsInfo,
};
use opencode_local::model_pref::{self, Model, ModelPreferences, Preference};
use opencode_local::storage::Storage;
use opencode_local::watch::Watch;
use opencode_store::location::{Catalog, Location};
use opencode_store::{Changes, Data};
use opencode_ui::dialog::{DialogOptions, Dialogs};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::select::{self, ActionRun, SelectAction, SelectOption, SelectProps, fuzzy};
use opencode_ui::toast::{ToastOptions, Toasts, Variant};
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

/// A model with its variant (`ModelSelection`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub model: Model,
    pub variant: Option<String>,
}

impl Selection {
    // `selectionKey`.
    fn key(&self) -> String {
        format!(
            "{}:{}",
            self.model.key(),
            model_pref::normalize_variant(self.variant.as_deref()).unwrap_or("default")
        )
    }
}

/// The routed session, as [`Local`] reads it.
pub struct Routed {
    pub id: SessionID,
    pub session: Option<SessionInfo>,
}

/// Where the TUI is: the routed session, or `None` on home.
pub type RouteFn = Rc<dyn Fn() -> Option<Routed>>;

/// The location the TUI works in (`location.ref ?? data.location.default()`).
pub type LocationFn = Rc<dyn Fn() -> Location>;

/// The store catalogs [`Local`] reads.
const CATALOGS: [Catalog; 5] = [
    Catalog::Model,
    Catalog::Provider,
    Catalog::Agent,
    Catalog::Integration,
    Catalog::Config,
];

/// The client-local files [`Local`] uses.
pub struct Files {
    /// The state directory that holds `model.json`.
    pub state: PathBuf,
    /// TUI storage, for `go-upsell`.
    pub storage: Option<Storage>,
}

type Job = Box<dyn FnOnce() + Send>;
type Listeners = Rc<RefCell<Vec<(u64, Rc<dyn Fn()>)>>>;
/// Opens a URL in the browser.
pub type OpenUrl = Rc<dyn Fn(&str) -> Result<(), String>>;

/// The location's catalog and the user's selections (`useLocal().model`, `useLocal().agent`).
pub struct Local {
    pub app: App,
    pub client: Client,
    data: Data,
    pub dialogs: Dialogs,
    pub toasts: Toasts,
    route: RouteFn,
    location: LocationFn,
    preferences: Option<ModelPreferences>,
    pub(crate) storage: Option<Storage>,
    writer: Option<mpsc::Sender<Job>>,
    state: RefCell<State>,
    listeners: Listeners,
    next_listener: Cell<u64>,
    /// The keys of the locations whose usage limits are loading.
    usage_loading: RefCell<HashSet<String>>,
    /// The usage warnings shown, once per model and level while the TUI runs (`usage.tsx` `warned`).
    warned: RefCell<HashSet<String>>,
    /// `--agent`, which a session without an agent draft shows over its own agent (`local.tsx:90-96`).
    startup_agent: RefCell<Option<String>>,
    watch: RefCell<Option<Watch>>,
    layers: RefCell<Vec<Disposer>>,
    /// The in-memory `go-upsell` record (`storage.memory`).
    pub(crate) go_memory: RefCell<crate::dialogs::go_upsell::Seen>,
    /// Opens a URL in the browser; tests replace it.
    pub open_url: RefCell<OpenUrl>,
    this: Weak<Local>,
}

#[derive(Default)]
struct State {
    /// Where the catalog below is read from.
    location: Option<Location>,
    models: Option<Vec<ModelInfo>>,
    providers: Option<Vec<ProviderInfo>>,
    agents: Option<Vec<AgentInfo>>,
    integrations: Option<Vec<IntegrationInfo>>,
    configured: Option<Selection>,
    /// The usage limits by the key of the location the server answered for (`data.location.usage`): absent until
    /// loaded, `None` when the location is not signed in to OpenCode Console.
    usage: HashMap<String, Option<UsageLimitsInfo>>,
    preference: Preference,
    ready: bool,
    agent: Option<String>,
    /// Per session: the agent chosen there, if any (`draftBySession`).
    agent_drafts: HashMap<String, Option<String>>,
    /// Per agent: the model chosen for a new session (`newSessionModelByLocationAgent`).
    new_session: HashMap<String, Model>,
    /// Per session and agent: the model chosen there (`selectionBySessionAgent`).
    selections: HashMap<String, HashMap<String, Selection>>,
    /// Per session: the agent and selection key a submit committed, until the session reports them
    /// (`pendingSelectionCommits`).
    commits: HashMap<String, (String, String)>,
}

/// Posted from the `model.json` watcher thread.
struct PreferencesChanged;

impl Local {
    pub fn new(
        app: &App,
        data: Data,
        dialogs: Dialogs,
        toasts: Toasts,
        files: Option<Files>,
        route: RouteFn,
        location: LocationFn,
    ) -> Rc<Self> {
        let (preferences, storage) = match files {
            Some(files) => (Some(ModelPreferences::new(&files.state)), files.storage),
            None => (None, None),
        };
        let writer = preferences.as_ref().map(|_| {
            let (send, receive) = mpsc::channel::<Job>();
            std::thread::spawn(move || {
                for job in receive {
                    job();
                }
            });
            send
        });
        Rc::new_cyclic(|this| Local {
            app: app.clone(),
            client: data.client().clone(),
            data,
            dialogs,
            toasts,
            route,
            location,
            preferences,
            storage,
            writer,
            state: RefCell::new(State::default()),
            listeners: Rc::default(),
            next_listener: Cell::new(0),
            usage_loading: RefCell::default(),
            warned: RefCell::default(),
            startup_agent: RefCell::default(),
            watch: RefCell::new(None),
            layers: RefCell::new(Vec::new()),
            go_memory: RefCell::default(),
            open_url: RefCell::new(Rc::new(crate::dialogs::go_upsell::open_url)),
            this: this.clone(),
        })
    }

    /// Reads the location's catalog, loads `model.json`, and watches `model.json`.
    pub fn load(&self) {
        self.relocate((self.location)());
        self.load_preferences();
        let Some(preferences) = &self.preferences else {
            self.state.borrow_mut().ready = true;
            return;
        };
        let weak = self.this.clone();
        self.app.on_message(move |_, _: &PreferencesChanged| {
            if let Some(local) = weak.upgrade() {
                local.load_preferences();
            }
        });
        let proxy = self.app.proxy();
        *self.watch.borrow_mut() = preferences.watch(move || {
            let _ = proxy.send(PreferencesChanged);
        });
    }

    /// Reads the integrations again, for example after a connect.
    pub fn load_integrations(&self) {
        let Some(location) = self.state.borrow().location.clone() else {
            return;
        };
        self.data
            .catalog_invalidate(Catalog::Integration, Some(&location));
        self.read(Catalog::Integration, &location);
    }

    /// Follows the store (`Tui::sync`): the catalog of the location the TUI moved to or whose catalog
    /// changed, and the drafts of sessions that changed.
    pub fn sync(&self, changes: &Changes) {
        let location = (self.location)();
        if self.state.borrow().location.as_ref() != Some(&location) {
            self.relocate(location);
        } else if changes.all || changes.location(&location) {
            self.read_catalog();
        }
        let sessions: Vec<String> = if changes.all {
            self.state
                .borrow()
                .commits
                .keys()
                .cloned()
                .chain(self.state.borrow().agent_drafts.keys().cloned())
                .collect()
        } else {
            changes.session.iter().map(|id| id.0.clone()).collect()
        };
        for id in sessions {
            self.reconcile(&SessionID(id));
        }
    }

    // Takes the catalog of `location` from the store, and asks the store to read what it lacks.
    fn relocate(&self, location: Location) {
        self.state.borrow_mut().location = Some(location.clone());
        self.read_catalog();
        for catalog in CATALOGS {
            self.read(catalog, &location);
        }
    }

    fn read(&self, catalog: Catalog, location: &Location) {
        let weak = self.this.clone();
        let task = self.data.catalog_sync(catalog, Some(location));
        self.app.spawn(task, move |_, result| {
            let Some(local) = weak.upgrade() else { return };
            match result {
                Ok(()) => local.read_catalog(),
                Err(error) => log::warn!("model catalog: {error}"),
            }
        });
    }

    fn read_catalog(&self) {
        let Some(location) = self.state.borrow().location.clone() else {
            return;
        };
        let read = self.data.read(|state| {
            let data = state.location(Some(&location))?;
            Some((
                data.model.clone(),
                data.provider.clone(),
                data.agent.clone(),
                data.integration.clone(),
                data.config
                    .as_deref()
                    .and_then(crate::prompt::metadata::configured),
            ))
        });
        {
            let mut state = self.state.borrow_mut();
            let (models, providers, agents, integrations, configured) = read.unwrap_or_default();
            state.models = models;
            state.providers = providers;
            state.agents = agents;
            state.integrations = integrations;
            state.configured = configured.map(|choice| Selection {
                model: Model::new(&choice.provider_id, &choice.model_id),
                variant: choice.variant,
            });
        }
        self.notify();
    }

    /// Replaces the integrations, models, and providers that a connect reloaded.
    pub(crate) fn set_catalog(
        &self,
        integrations: Vec<IntegrationInfo>,
        models: Vec<ModelInfo>,
        providers: Vec<ProviderInfo>,
    ) {
        {
            let mut state = self.state.borrow_mut();
            state.integrations = Some(integrations);
            state.models = Some(models);
            state.providers = Some(providers);
        }
        self.notify();
    }

    /// `useUsageLimits().load`: loads the current location's limits once, or again with `refresh`, keeping the
    /// loaded ones meanwhile.
    pub fn load_usage(&self, refresh: bool) {
        let key = self.usage_location().key();
        if self.usage_loading.borrow().contains(&key)
            || (!refresh && self.state.borrow().usage.contains_key(&key))
        {
            return;
        }
        self.usage_loading.borrow_mut().insert(key.clone());
        let client = self.client.clone();
        let input = ExperimentalUsageLimitsInput {
            location: self.location(),
        };
        let weak = self.this.clone();
        self.app.spawn(
            async move {
                client
                    .experimental_usage_limits(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(local) = weak.upgrade() else { return };
                local.usage_loading.borrow_mut().remove(&key);
                match result {
                    Ok(output) => {
                        // Filed under the location the server answered for, as `locationResource` publishes.
                        local
                            .state
                            .borrow_mut()
                            .usage
                            .insert(Location::from(&output.location).key(), output.data);
                        local.notify();
                    }
                    Err(error) => log::warn!("usage limits: {error}"),
                }
            },
        );
    }

    /// The location the usage limits are read for (`location.ref ?? data.location.default()`).
    fn usage_location(&self) -> Location {
        let location = self.state.borrow().location.clone();
        location.unwrap_or_else(|| (self.location)())
    }

    /// Calls `listener` after the catalog, the preferences, or a selection change.
    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Disposer {
        let id = self.next_listener.get();
        self.next_listener.set(id + 1);
        self.listeners.borrow_mut().push((id, Rc::new(listener)));
        let listeners = Rc::downgrade(&self.listeners);
        Disposer::new(move || {
            if let Some(listeners) = listeners.upgrade() {
                listeners.borrow_mut().retain(|(other, _)| *other != id);
            }
        })
    }

    fn notify(&self) {
        let listeners: Vec<_> = self
            .listeners
            .borrow()
            .iter()
            .map(|(_, listener)| listener.clone())
            .collect();
        for listener in listeners {
            listener();
        }
        self.app.request_redraw();
    }

    /// The location the catalog is read from, as a request names it.
    pub(crate) fn location(&self) -> Option<LocationQueryInput> {
        let location = self.state.borrow().location.clone();
        let location = location.unwrap_or_else(|| (self.location)());
        Some(LocationQueryInput {
            directory: Some(location.directory),
        })
    }

    fn load_preferences(&self) {
        let Some(preferences) = self.preferences.clone() else {
            return;
        };
        let weak = self.this.clone();
        self.app.spawn(
            async move { tokio::task::spawn_blocking(move || preferences.load()).await },
            move |_, result| {
                let Some(local) = weak.upgrade() else { return };
                let mut state = local.state.borrow_mut();
                if let Ok(preference) = result {
                    state.preference = preference;
                }
                state.ready = true;
                drop(state);
                local.notify();
            },
        );
    }

    // `model.json` writes, in order, off the UI thread.
    fn write(
        &self,
        job: impl FnOnce(&ModelPreferences) -> Result<(), opencode_local::lock::Error> + Send + 'static,
    ) {
        let (Some(writer), Some(preferences)) = (&self.writer, self.preferences.clone()) else {
            return;
        };
        let _ = writer.send(Box::new(move || {
            if let Err(error) = job(&preferences) {
                log::warn!("model.json: {error}");
            }
        }));
    }

    // Catalog reads.

    /// Whether `model.json` has been read.
    pub fn ready(&self) -> bool {
        self.state.borrow().ready
    }

    /// Whether the model list has loaded (`catalogReady`).
    pub fn catalog_ready(&self) -> bool {
        self.state.borrow().models.is_some()
    }

    pub fn models(&self) -> Vec<ModelInfo> {
        self.state.borrow().models.clone().unwrap_or_default()
    }

    pub fn model_info(&self, model: &Model) -> Option<ModelInfo> {
        self.state
            .borrow()
            .models
            .as_ref()?
            .iter()
            .find(|item| is(item, model))
            .cloned()
    }

    pub fn providers(&self) -> Vec<ProviderInfo> {
        self.state.borrow().providers.clone().unwrap_or_default()
    }

    pub fn provider(&self, id: &str) -> Option<ProviderInfo> {
        self.state
            .borrow()
            .providers
            .as_ref()?
            .iter()
            .find(|item| item.id.0 == id)
            .cloned()
    }

    pub fn integrations(&self) -> Option<Vec<IntegrationInfo>> {
        self.state.borrow().integrations.clone()
    }

    /// `useUsageLimits().info`: `None` until loaded, `Some(None)` when not signed in.
    /// The current location's usage limits: `None` until loaded, `Some(None)` when it is not signed in to
    /// OpenCode Console.
    pub fn usage(&self) -> Option<Option<UsageLimitsInfo>> {
        let key = self.usage_location().key();
        self.state.borrow().usage.get(&key).cloned()
    }

    /// The selected model and what the usage limits leave it, when some limit applies (`limits.usage(model)`).
    fn current_usage(&self) -> Option<(ModelInfo, crate::dialogs::usage::ModelUsage)> {
        let model = self.model_info(&self.current()?)?;
        let info = self.usage().flatten()?;
        let provider = self.provider(&model.provider_id.0);
        let usage = crate::dialogs::usage::model_usage(&info, &model, provider.as_ref())?;
        Some((model, usage))
    }

    /// `limitLabel` of the selected model for the prompt's metadata row: `$x left` while it runs low, in the error
    /// color (`true`) when it cannot take another request, or `Limit reached`.
    pub fn limit_label(&self) -> Option<(String, bool)> {
        use crate::dialogs::usage::{Level, format_dollars, level};
        let (model, usage) = self.current_usage()?;
        match level(&usage, &model) {
            Level::Plenty => None,
            Level::Reached => Some(("Limit reached".to_owned(), true)),
            level => Some((
                format!("{} left", format_dollars(usage.left)),
                level == Level::Out,
            )),
        }
    }

    /// The prompt's effect (`prompt/index.tsx:1578-1582`): loads the limits once when OpenCode Console serves the
    /// selected model.
    fn load_served_usage(&self) {
        let served = self.current().is_some_and(|model| {
            crate::dialogs::usage::served_by_console(self.provider(&model.provider_id).as_ref())
        });
        if served && self.usage().is_none() {
            self.load_usage(false);
        }
    }

    /// `useConnected`: some integration has a connection.
    pub fn connected(&self) -> bool {
        self.state
            .borrow()
            .integrations
            .as_ref()
            .is_some_and(|list| list.iter().any(|item| !item.connections.is_empty()))
    }

    pub fn recent(&self) -> Vec<Model> {
        self.state.borrow().preference.recent.clone()
    }

    pub fn favorite(&self) -> Vec<Model> {
        self.state.borrow().preference.favorite.clone()
    }

    fn is_valid(&self, model: &Model) -> bool {
        self.state
            .borrow()
            .models
            .as_ref()
            .is_some_and(|models| models.iter().any(|item| is(item, model)))
    }

    // Agents.

    /// The agents a user can pick: not subagents, not hidden.
    pub fn agents(&self) -> Vec<AgentInfo> {
        self.state
            .borrow()
            .agents
            .iter()
            .flatten()
            .filter(|agent| !matches!(agent.mode, AgentInfoMode::Subagent) && !agent.hidden)
            .cloned()
            .collect()
    }

    pub fn agent(&self) -> Option<AgentInfo> {
        let agents = self.agents();
        let selected = {
            let state = self.state.borrow();
            match (self.route)() {
                // An acknowledged draft (`Some(None)`) gives way to the session's agent.
                Some(routed) => state
                    .agent_drafts
                    .get(&routed.id.0)
                    .cloned()
                    .flatten()
                    .or_else(|| {
                        let draft = state.agent_drafts.contains_key(&routed.id.0);
                        let startup = self.startup_agent.borrow().clone();
                        startup.filter(|_| !draft)
                    })
                    .or_else(|| {
                        routed
                            .session
                            .and_then(|session| session.agent.map(|agent| agent.0))
                    })
                    .or_else(|| state.agent.clone()),
                None => state.agent.clone(),
            }
        };
        agents
            .iter()
            .find(|agent| Some(&agent.id.0) == selected.as_ref())
            .or(agents.first())
            .cloned()
    }

    /// `agent.set`: a warning toast for an unknown agent.
    pub fn set_agent(&self, id: &str) {
        if !self.agents().iter().any(|agent| agent.id.0 == id) {
            self.toasts.show(
                ToastOptions::new(Variant::Warning, format!("Agent not found: {id}"))
                    .duration(Duration::from_millis(3000)),
            );
            return;
        }
        let changed = self.agent().is_none_or(|agent| agent.id.0 != id);
        if changed {
            self.remember();
        }
        let routed = (self.route)();
        {
            let mut state = self.state.borrow_mut();
            state.agent = Some(id.to_owned());
            if let Some(routed) = &routed {
                state
                    .agent_drafts
                    .insert(routed.id.0.clone(), Some(id.to_owned()));
            }
        }
        // Retain both selections while agent and model commits arrive separately.
        if changed
            && routed.is_some()
            && let Some(selected) = self.current()
        {
            self.set(&selected, false);
        }
        self.notify();
    }

    /// `agent.move`.
    pub fn move_agent(&self, direction: i64) {
        let agents = self.agents();
        let Some(current) = self.agent() else { return };
        let index = agents.iter().position(|agent| agent.id == current.id);
        let next = index.map_or(-1, |index| index as i64) + direction;
        let next = if next < 0 {
            agents.len() as i64 - 1
        } else if next >= agents.len() as i64 {
            0
        } else {
            next
        };
        if let Some(agent) = agents.get(next as usize) {
            self.set_agent(&agent.id.0.clone());
        }
    }

    // Models.

    // `configuredModel`.
    fn configured(&self) -> Option<Selection> {
        self.state.borrow().configured.clone()
    }

    // `fallbackModel`. `--model` is E.1's.
    fn fallback(&self) -> Option<Model> {
        if let Some(configured) = self.configured().filter(|c| self.is_valid(&c.model)) {
            return Some(configured.model);
        }
        let recent = self.recent();
        if let Some(model) = recent.into_iter().find(|item| self.is_valid(item)) {
            return Some(model);
        }
        let state = self.state.borrow();
        let first = state.models.as_ref()?.first()?;
        Some(Model::new(&first.provider_id.0, &first.id))
    }

    // `newSessionModel`.
    fn new_session_model(&self) -> Option<Model> {
        let agent = self.agent();
        let chosen = agent.as_ref().and_then(|agent| {
            self.state
                .borrow()
                .new_session
                .get(&self.location_agent_key(&agent.id.0))
                .cloned()
        });
        let configured = agent
            .as_ref()
            .and_then(|agent| agent.model.as_ref())
            .map(|model| Model::new(&model.provider_id.0, &model.id));
        [chosen, configured]
            .into_iter()
            .flatten()
            .find(|model| self.is_valid(model))
            .or_else(|| self.fallback().filter(|model| self.is_valid(model)))
    }

    // `preferredSelection`.
    fn preferred(&self, model: &Model) -> Selection {
        let configured = self.agent().and_then(|agent| agent.model);
        let fallback = self.configured();
        let preferred = self
            .state
            .borrow()
            .preference
            .variant
            .get(&model.key())
            .cloned();
        let variant = preferred
            .or_else(|| {
                configured
                    .filter(|c| c.provider_id.0 == model.provider_id && c.id == model.model_id)
                    .and_then(|c| c.variant)
            })
            .or_else(|| {
                fallback
                    .filter(|f| f.model == *model)
                    .and_then(|f| f.variant)
            });
        let variant = model_pref::normalize_variant(variant.as_deref()).map(str::to_owned);
        let info = self.model_info(model);
        Selection {
            model: model.clone(),
            variant: variant.filter(|variant| {
                info.is_some_and(|info| info.variants.iter().any(|item| item.id == *variant))
            }),
        }
    }

    // `durableSelection`.
    fn durable(session: Option<&SessionInfo>) -> Option<Selection> {
        let model = session?.model.as_ref()?;
        Some(Selection {
            model: Model::new(&model.provider_id.0, &model.id),
            variant: model_pref::normalize_variant(model.variant.as_deref()).map(str::to_owned),
        })
    }

    // `sessionSelection`.
    fn session_selection(&self, routed: &Routed) -> Option<Selection> {
        let agent = self.agent()?;
        let session = routed.session.as_ref();
        let drafted = self
            .state
            .borrow()
            .selections
            .get(&routed.id.0)
            .and_then(|drafts| drafts.get(&agent.id.0))
            .cloned();
        let own = session
            .and_then(|session| session.agent.as_ref())
            .is_none_or(|other| *other == agent.id);
        let selected = drafted.or_else(|| own.then(|| Self::durable(session)).flatten());
        if let Some(selected) = selected {
            let info = self.model_info(&selected.model);
            let keep = info.is_none_or(|info| {
                info.variants
                    .iter()
                    .any(|item| Some(&item.id) == selected.variant.as_ref())
            });
            return Some(Selection {
                variant: selected.variant.filter(|_| keep),
                ..selected
            });
        }
        self.new_session_model().map(|model| self.preferred(&model))
    }

    /// The model and variant the next prompt uses (`model.selection`).
    pub fn selection(&self) -> Option<Selection> {
        match (self.route)() {
            Some(routed) => self.session_selection(&routed),
            None => self.new_session_model().map(|model| self.preferred(&model)),
        }
    }

    /// `model.current`.
    pub fn current(&self) -> Option<Model> {
        self.selection().map(|selection| selection.model)
    }

    /// `model.parsed`: the provider and model names the prompt footer shows.
    pub fn parsed(&self) -> (String, String, bool) {
        let Some(selection) = self.selection() else {
            return (
                "Connect a provider".into(),
                "No provider selected".into(),
                false,
            );
        };
        let provider = self
            .provider(&selection.model.provider_id)
            .map_or(selection.model.provider_id.clone(), |provider| {
                provider.name
            });
        let info = self.model_info(&selection.model);
        let reasoning = info.as_ref().is_some_and(|info| !info.variants.is_empty());
        let model = info.map_or_else(
            || format!("{} (unavailable)", selection.model.model_id),
            |info| info.name,
        );
        (provider, model, reasoning)
    }

    fn set_session_draft(&self, routed: &Routed, selection: Selection) {
        let Some(agent) = self.agent() else { return };
        let session = routed.session.as_ref();
        let own = session
            .and_then(|session| session.agent.as_ref())
            .is_none_or(|other| *other == agent.id);
        let same = Self::durable(session).is_some_and(|durable| durable.key() == selection.key());
        let mut state = self.state.borrow_mut();
        let drafts = state.selections.entry(routed.id.0.clone()).or_default();
        if own && same {
            drafts.remove(&agent.id.0);
        } else {
            drafts.insert(agent.id.0.clone(), selection);
        }
    }

    // `selectModel`.
    fn select_model(&self, model: &Model) -> bool {
        if let Some(routed) = (self.route)() {
            let current = self.session_selection(&routed);
            let selection = match current {
                Some(current) if current.model == *model => current,
                _ => self.preferred(model),
            };
            self.set_session_draft(&routed, selection);
            return true;
        }
        let Some(agent) = self.agent() else {
            return false;
        };
        let key = self.location_agent_key(&agent.id.0);
        self.state
            .borrow_mut()
            .new_session
            .insert(key, model.clone());
        true
    }

    // `locationAgentKey`: a model chosen for a new session belongs to the location and the agent.
    fn location_agent_key(&self, agent: &str) -> String {
        let location = self.state.borrow().location.clone();
        format!(
            "{}:{agent}",
            location.unwrap_or_else(|| (self.location)()).key()
        )
    }

    /// `trackSessionCommit`: a submit is committing `model` and `agent` to `session`; once the session
    /// reports both, the draft that chose them gives way to the session's own selection.
    pub fn track_commit(&self, session: &SessionID, model: &ModelRef, agent: &str) {
        let selection = Selection {
            model: Model::new(&model.provider_id.0, &model.id),
            variant: model.variant.clone(),
        };
        self.state
            .borrow_mut()
            .commits
            .insert(session.0.clone(), (agent.to_owned(), selection.key()));
        // An unchanged model emits no event; the agent may be the only durable change.
        self.reconcile(session);
    }

    // `reconcileSessionSelection` and the agent arm of `session.agent.selected`, from the session as the
    // store holds it after the event.
    fn reconcile(&self, id: &SessionID) {
        let session = self.data.read(|state| state.session(id).cloned());
        let Some(session) = session else { return };
        let agent = session.agent.as_ref().map(|agent| agent.0.clone());
        {
            let mut state = self.state.borrow_mut();
            // Keep an entry after acknowledgment: CLI defaults must not override a user's later choice.
            if let Some(draft) = state.agent_drafts.get_mut(&id.0)
                && draft.is_some()
                && *draft == agent
            {
                *draft = None;
            }
        }
        let expected = self.state.borrow().commits.get(&id.0).cloned();
        let Some((expected_agent, expected_selection)) = expected else {
            return;
        };
        let durable = Self::durable(Some(&session));
        if agent.as_ref() != Some(&expected_agent)
            || durable.is_none_or(|durable| durable.key() != expected_selection)
        {
            return;
        }
        self.state.borrow_mut().commits.remove(&id.0);
        // Inactive agents keep their remembered choices after another agent commits.
        let here = (self.route)().is_some_and(|routed| routed.id == *id);
        if !here
            || self
                .agent()
                .is_none_or(|agent| agent.id.0 != expected_agent)
        {
            return;
        }
        let mut state = self.state.borrow_mut();
        if let Some(drafts) = state.selections.get_mut(&id.0)
            && drafts
                .get(&expected_agent)
                .is_some_and(|draft| draft.key() == expected_selection)
        {
            drafts.remove(&expected_agent);
        }
        drop(state);
        self.notify();
    }

    /// `session.deleted`: drops the session's drafts.
    pub fn forget(&self, id: &SessionID) {
        let mut state = self.state.borrow_mut();
        state.agent_drafts.remove(&id.0);
        state.selections.remove(&id.0);
        state.commits.remove(&id.0);
    }

    /// `model.remember`: keeps the current selection for the current agent in this session.
    fn remember(&self) {
        let (Some(routed), Some(agent), Some(selection)) =
            ((self.route)(), self.agent(), self.selection())
        else {
            return;
        };
        self.state
            .borrow_mut()
            .selections
            .entry(routed.id.0)
            .or_default()
            .insert(agent.id.0, selection);
    }

    /// `model.set`: selects a model, and with `recent` adds it to the recent models.
    pub fn set(&self, model: &Model, recent: bool) {
        if !self.is_valid(model) || !self.select_model(model) {
            return;
        }
        if recent {
            self.add_recent(model);
        }
        self.notify();
    }

    fn add_recent(&self, model: &Model) {
        {
            let mut state = self.state.borrow_mut();
            state.preference.recent = model_pref::recent_models(model, &state.preference.recent);
        }
        let model = model.clone();
        self.write(move |file| file.add_recent(&model));
    }

    /// `model.toggleFavorite`.
    pub fn toggle_favorite(&self, model: &Model) {
        if !self.is_valid(model) {
            return;
        }
        let enabled = {
            let mut state = self.state.borrow_mut();
            let enabled = !state.preference.favorite.contains(model);
            state.preference.favorite =
                model_pref::favorite_models(model, &state.preference.favorite, enabled);
            enabled
        };
        let model = model.clone();
        self.write(move |file| file.set_favorite(&model, enabled));
        self.notify();
    }

    /// `model.cycle`: the next or previous recent model.
    pub fn cycle(&self, direction: i64) {
        let Some(current) = self.selection() else {
            return;
        };
        let recent: Vec<Model> = self
            .recent()
            .into_iter()
            .filter(|item| self.is_valid(item))
            .collect();
        let len = recent.len() as i64;
        let next = match recent.iter().position(|item| *item == current.model) {
            None if direction == 1 => 0,
            None => len - 1,
            Some(index) => index as i64 + direction,
        };
        let next = if next < 0 {
            len - 1
        } else if next >= len {
            0
        } else {
            next
        };
        let Some(model) = usize::try_from(next).ok().and_then(|next| recent.get(next)) else {
            return;
        };
        self.select_model(model);
        self.notify();
    }

    /// `model.cycleFavorite`: the next or previous favorite, added to the recent models.
    pub fn cycle_favorite(&self, direction: i64) {
        let favorites: Vec<Model> = self
            .favorite()
            .into_iter()
            .filter(|item| self.is_valid(item))
            .collect();
        if favorites.is_empty() {
            self.toasts.show(
                ToastOptions::new(Variant::Info, "Add a favorite model to use this shortcut")
                    .duration(Duration::from_millis(3000)),
            );
            return;
        }
        let len = favorites.len() as i64;
        let index = self
            .selection()
            .and_then(|current| favorites.iter().position(|item| *item == current.model));
        let index = match index {
            None if direction == 1 => 0,
            None => len - 1,
            Some(index) => {
                let next = index as i64 + direction;
                if next < 0 {
                    len - 1
                } else if next >= len {
                    0
                } else {
                    next
                }
            }
        };
        let next = favorites[index as usize].clone();
        if !self.select_model(&next) {
            return;
        }
        self.add_recent(&next);
        self.notify();
    }

    /// `model.variant.list`: the current model's variant IDs.
    pub fn variants(&self) -> Vec<String> {
        self.selection()
            .and_then(|selection| self.model_info(&selection.model))
            .map(|info| {
                info.variants
                    .into_iter()
                    .map(|variant| variant.id)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `model.variant.current`.
    pub fn variant(&self) -> Option<String> {
        self.selection().and_then(|selection| selection.variant)
    }

    /// `model.variant.set`: `None` is the default variant.
    pub fn set_variant(&self, value: Option<&str>) {
        let Some(current) = self.selection() else {
            return;
        };
        if let Some(routed) = (self.route)() {
            self.set_session_draft(
                &routed,
                Selection {
                    variant: model_pref::normalize_variant(value).map(str::to_owned),
                    ..current.clone()
                },
            );
        }
        self.state
            .borrow_mut()
            .preference
            .variant
            .insert(current.model.key(), value.unwrap_or("default").to_owned());
        let model = current.model;
        let value = value.map(str::to_owned);
        self.write(move |file| file.save_variant(&model, value.as_deref()));
        self.notify();
    }

    /// `model.variant.cycle`.
    pub fn cycle_variant(&self) {
        let variants = self.variants();
        if variants.is_empty() {
            return;
        }
        let names: Vec<&str> = variants.iter().map(String::as_str).collect();
        let next = model_pref::cycle_variant(self.variant().as_deref(), &names);
        self.set_variant(next.as_deref());
    }
}

fn is(info: &ModelInfo, model: &Model) -> bool {
    info.provider_id.0 == model.provider_id && info.id == model.model_id
}

/// `isFreeModel`.
pub fn is_free(model: &ModelInfo) -> bool {
    !model.cost.is_empty() && model.cost.iter().all(|cost| cost.input == 0.0)
}

/// An option of the model list before it becomes a select row.
#[derive(Clone)]
struct Row {
    value: Model,
    provider_id: String,
    provider_name: String,
    title: String,
    category: Option<String>,
    favorite: bool,
    free: bool,
    model: ModelInfo,
}

/// `sortModelOptions`: OpenCode Go, then OpenCode, then by provider name, free models first; stable otherwise.
fn sort_rows(rows: &mut [Row], grouped: bool) {
    rows.sort_by(|a, b| {
        let provider = if grouped {
            (b.provider_id == "opencode-go")
                .cmp(&(a.provider_id == "opencode-go"))
                .then((b.provider_id == "opencode").cmp(&(a.provider_id == "opencode")))
        } else {
            std::cmp::Ordering::Equal
        };
        let name = if grouped {
            locale_compare(&a.provider_name, &b.provider_name)
        } else {
            std::cmp::Ordering::Equal
        };
        provider.then(name).then(b.free.cmp(&a.free))
    });
}

/// `prioritizeFavorites`: favorites first, stable otherwise.
fn prioritize<T>(items: &mut [T], value: impl Fn(&T) -> &Model, favorites: &[String]) {
    items.sort_by_key(|item| !favorites.contains(&value(item).key()));
}

/// fuzzysort's default score over several keys: the best key, with a bonus for matching more than one.
fn best_key<const N: usize>(scores: &[f64; N]) -> f64 {
    let mut best = f64::NEG_INFINITY;
    for &score in scores {
        let raw = denormalize(score);
        if raw > -1000.0 && best > f64::NEG_INFINITY {
            best = best.max((best + raw) / 4.0);
        }
        best = best.max(raw);
    }
    normalize(best)
}

fn normalize(score: f64) -> f64 {
    if score == f64::NEG_INFINITY {
        return 0.0;
    }
    if score > 1.0 {
        return score;
    }
    std::f64::consts::E.powf(((-score + 1.0).powf(0.04307) - 1.0) * -2.0)
}

fn denormalize(score: f64) -> f64 {
    if score == 0.0 {
        return f64::NEG_INFINITY;
    }
    if score > 1.0 {
        return score;
    }
    1.0 - (score.ln() / -2.0 + 1.0).powf(1.0 / 0.04307)
}

/// `a.localeCompare(b)` for the root locale over ASCII, as `opencode-cli`'s `locale_compare`.
pub fn locale_compare(a: &str, b: &str) -> std::cmp::Ordering {
    const SYMBOLS: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    let primary = |c: char| -> (u8, u32) {
        if let Some(index) = SYMBOLS.find(c) {
            return (0, index as u32);
        }
        if c.is_ascii_digit() {
            return (1, c as u32);
        }
        if c.is_ascii_alphabetic() {
            return (2, c.to_ascii_lowercase() as u32);
        }
        (3, c as u32)
    };
    let primaries = |s: &str| s.chars().map(primary).collect::<Vec<_>>();
    let tertiary = |s: &str| s.chars().map(char::is_uppercase).collect::<Vec<_>>();
    primaries(a)
        .cmp(&primaries(b))
        .then_with(|| tertiary(a).cmp(&tertiary(b)))
        .then_with(|| a.cmp(b))
}

/// Opens the model dialog (`DialogModel`): the free models picker with nothing connected, else the connected
/// models, of one provider when `provider` is set.
pub fn show(local: &Rc<Local>, provider: Option<String>) {
    if !local.connected() && provider.is_none() {
        crate::dialogs::free_models::show(local);
        return;
    }
    local.load_usage(true);
    open(local, provider, String::new());
}

// Opens the connected models with `filter` typed, as a reopen keeps it.
fn open(local: &Rc<Local>, provider: Option<String>, filter: String) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| {
            let Some(local) = weak.upgrade() else {
                return View::new(&cx.app);
            };
            build(cx, &local, provider, &filter)
        },
        None,
        DialogOptions::default(),
    );
}

impl Local {}

// The select of `DialogConnectedModels`.
fn build(
    cx: &Rc<opencode_ui::dialog::DialogCx>,
    local: &Rc<Local>,
    provider: Option<String>,
    filter: &str,
) -> View {
    // Favoriting does not reorder the list until the dialog is reopened.
    let favorites_at_open = local.favorite();
    let marker = cx.theme.text.formfield.selected;
    let options: select::Options<Model> = {
        let weak = Rc::downgrade(local);
        let provider = provider.clone();
        Rc::new(move |query: &str| {
            weak.upgrade().map_or_else(Vec::new, |local| {
                options(
                    &local,
                    provider.as_deref(),
                    query,
                    &favorites_at_open,
                    marker,
                )
            })
        })
    };
    let title = provider
        .as_deref()
        .and_then(|id| local.provider(id))
        .map_or("Select model".to_owned(), |provider| provider.name);
    let connected = local.connected();
    let mut props = SelectProps::dynamic(title, options.clone());
    props.flat = true;
    props.skip_filter = true;
    props.current = local.current();
    props.search_in_title = true;
    props.title_placeholder = Some("Search models".to_owned());
    let on_select = {
        let weak = Rc::downgrade(local);
        Rc::new(move |option: &SelectOption<Model>| {
            if let Some(local) = weak.upgrade() {
                choose(&local, &option.value);
            }
        })
    };
    props.on_select = Some(on_select);
    let connect = {
        let weak = Rc::downgrade(local);
        Rc::new(move || {
            if let Some(local) = weak.upgrade() {
                connect(&local);
            }
        })
    };
    let usage = {
        let weak = Rc::downgrade(local);
        Rc::new(move || {
            if let Some(local) = weak.upgrade() {
                crate::dialogs::usage::show(&local);
            }
        })
    };
    let provider_title = if connected {
        "connect integration"
    } else {
        "view all integrations"
    };
    let favorite_title = {
        let weak = Rc::downgrade(local);
        move |option: Option<&SelectOption<Model>>| -> String {
            let favorite = weak.upgrade().is_some_and(|local| {
                option.is_some_and(|option| local.favorite().contains(&option.value))
            });
            if favorite { "unfavorite" } else { "favorite" }.into()
        }
    };
    props.actions = vec![
        SelectAction {
            run: ActionRun::Dialog(connect),
            ..SelectAction::new("model.dialog.provider", provider_title, |_| {})
        },
        SelectAction {
            run: ActionRun::Dialog(usage),
            hidden: !matches!(local.usage(), Some(Some(_))),
            ..SelectAction::new("model.dialog.usage", "usage", |_| {})
        },
        SelectAction {
            title: Rc::new(favorite_title),
            hidden: !connected,
            ..SelectAction::new("model.dialog.favorite", "Favorite", {
                let weak = Rc::downgrade(local);
                move |option| {
                    if let Some(local) = weak.upgrade() {
                        local.toggle_favorite(&option.value);
                    }
                }
            })
        },
    ];
    let (view, handle) = select::select(cx, props);
    if !filter.is_empty() {
        handle.set_filter(filter);
    }
    // Refresh the rows as the catalog, the favorites, or the connections change. When the usage action or the
    // connected state would change the footer, the dialog opens again with the same filter.
    let weak = Rc::downgrade(local);
    let usage_shown = matches!(local.usage(), Some(Some(_)));
    let reopened = Rc::new(Cell::new(false));
    cx.on_close(local.subscribe(move || {
        let Some(local) = weak.upgrade() else { return };
        if reopened.get() {
            return;
        }
        if matches!(local.usage(), Some(Some(_))) != usage_shown || local.connected() != connected {
            reopened.set(true);
            let provider = provider.clone();
            let again = local.clone();
            let filter = handle.filter();
            local.app.defer(move |_| open(&again, provider, filter));
            return;
        }
        handle.set_options(options(&handle.filter()));
    }));
    view
}

// The rows of `DialogConnectedModels` for `query`.
fn options(
    local: &Local,
    provider: Option<&str>,
    query: &str,
    favorites_at_open: &[Model],
    marker: Color,
) -> Vec<SelectOption<Model>> {
    let needle = query.trim();
    let connected = local.connected();
    let show_sections = connected && provider.is_none() && needle.is_empty();
    let favorites: Vec<Model> = if connected {
        favorites_at_open.to_vec()
    } else {
        Vec::new()
    };
    let favorite_now = local.favorite();
    let favorite_priority: Vec<String> = favorites_at_open.iter().map(Model::key).collect();
    let recents = local.recent();
    let models = local.models();
    let providers = local.providers();
    let provider_name = |id: &str| {
        providers
            .iter()
            .find(|item| item.id.0 == id)
            .map_or(id.to_owned(), |provider| provider.name.clone())
    };
    let usage = local.usage().flatten();
    // The detail row shows the price, so the trailing slot only marks favorites.
    let marked = |option: &mut SelectOption<Model>, model: &ModelInfo, favorite: bool| {
        if favorite {
            option.footer = Some("*".to_owned());
            option.footer_fg = Some(marker);
        }
        let provider = providers.iter().find(|item| item.id == model.provider_id);
        option.detail = Some(detail(
            model,
            true,
            usage_label(usage.as_ref(), model, provider),
        ));
    };
    let section = |items: &[Model], category: &str| -> Vec<SelectOption<Model>> {
        if !show_sections {
            return Vec::new();
        }
        items
            .iter()
            .filter_map(|item| {
                let model = models.iter().find(|model| is(model, item))?;
                let mut option = SelectOption::new(
                    model.name.clone(),
                    Model::new(&model.provider_id.0, &model.id),
                )
                .description(provider_name(&model.provider_id.0))
                .category(category);
                marked(&mut option, model, favorite_now.contains(item));
                Some(option)
            })
            .collect()
    };
    let favorite_options = section(&favorites, "Favorites");
    let recent_items: Vec<Model> = recents
        .iter()
        .filter(|item| !favorites.contains(item))
        .cloned()
        .collect();
    let recent_options = section(&recent_items, "Recent");

    // OpenCode's own free models get their own group at the end of the list instead of joining "OpenCode".
    let free_group = |model: &ModelInfo| {
        provider.is_none() && model.provider_id.0 == "opencode" && is_free(model)
    };
    let mut rows: Vec<Row> = models
        .iter()
        .filter(|model| !matches!(model.status, ModelInfoStatus::Deprecated))
        .filter(|model| provider.is_none_or(|id| model.provider_id.0 == id))
        .map(|model| {
            let value = Model::new(&model.provider_id.0, &model.id);
            let name = provider_name(&model.provider_id.0);
            let favorite = connected && favorite_now.contains(&value);
            Row {
                provider_id: model.provider_id.0.clone(),
                provider_name: name.clone(),
                title: model.name.clone(),
                category: connected.then(|| {
                    if free_group(model) {
                        "Free".to_owned()
                    } else {
                        name
                    }
                }),
                favorite,
                free: is_free(model),
                model: model.clone(),
                value,
            }
        })
        .filter(|row| {
            !show_sections || (!favorites.contains(&row.value) && !recents.contains(&row.value))
        })
        .collect();
    sort_rows(&mut rows, connected);

    let to_option = |row: Row| {
        let mut option = SelectOption::new(row.title, row.value);
        option.category = row.category;
        marked(&mut option, &row.model, row.favorite);
        option
    };
    if !needle.is_empty() {
        let matches = fuzzy::go(
            needle,
            &rows,
            |row| [Some(row.title.as_str()), row.category.as_deref()],
            best_key,
            0.0,
        );
        let mut results: Vec<Row> = matches
            .into_iter()
            .map(|index| rows[index].clone())
            .collect();
        sort_rows(&mut results, false);
        prioritize(&mut results, |row| &row.value, &favorite_priority);
        return results
            .into_iter()
            .map(|row| {
                // Search results name the provider inline. Without a category, the trailing slot keeps the
                // favorite marker instead of falling back to the provider name.
                let name = row.provider_name.clone();
                let mut option = to_option(row);
                option.description = Some(name);
                option.category = None;
                option
            })
            .collect();
    }
    let (free, paid): (Vec<Row>, Vec<Row>) = rows
        .into_iter()
        .partition(|row| row.category.as_deref() == Some("Free"));
    favorite_options
        .into_iter()
        .chain(recent_options)
        .chain(paid.into_iter().map(to_option))
        .chain(free.into_iter().map(to_option))
        .collect()
}

/// What the model picker says the usage limits leave a model: `$x left`, in the error color when it cannot take
/// another request, or `No limit` for a paid model OpenCode Console serves without one.
fn usage_label(
    info: Option<&UsageLimitsInfo>,
    model: &ModelInfo,
    provider: Option<&ProviderInfo>,
) -> Option<(String, bool)> {
    let info = info?;
    let usage = crate::dialogs::usage::model_usage(info, model, provider);
    if let Some(usage) = usage {
        let level = crate::dialogs::usage::level(&usage, model);
        return Some((
            format!("{} left", crate::dialogs::usage::format_dollars(usage.left)),
            matches!(
                level,
                crate::dialogs::usage::Level::Out | crate::dialogs::usage::Level::Reached
            ),
        ));
    }
    let paid = !model.cost.iter().all(|cost| cost.input == 0.0);
    (crate::dialogs::usage::served_by_console(provider) && paid)
        .then(|| ("No limit".to_owned(), false))
}

/// `ModelDetail`: the selected model's price (unless `price` is false), input modalities, context window, and
/// reasoning support, below the list; after what its usage limits leave when `usage` says so.
pub fn detail(model: &ModelInfo, price: bool, usage: Option<(String, bool)>) -> select::Detail {
    let model = model.clone();
    select::Detail::View(Rc::new(move |cx| {
        let (app, theme) = (&cx.app, &cx.theme);
        let cost = if is_free(&model) {
            "Free".to_owned()
        } else {
            model.cost.first().map_or(String::new(), |cost| {
                format!("${}/${}", dollars(cost.input), dollars(cost.output))
            })
        };
        let mut facts: Vec<String> = vec![
            model
                .capabilities
                .input
                .iter()
                .map(|value| modality(value))
                .collect::<Vec<_>>()
                .join(", "),
            tokens(model.limit.context),
        ];
        if !model.variants.is_empty() {
            facts.push("Reasoning".to_owned());
        }
        let list = |items: Vec<String>| {
            let spans: Vec<Span> = items
                .into_iter()
                .filter(|item| !item.is_empty())
                .enumerate()
                .flat_map(|(index, item)| {
                    let separator = (index > 0).then(|| " · ".fg(theme.neutral().step(400)));
                    separator.into_iter().chain([item.fg(theme.text.muted)])
                })
                .collect();
            Text::new(app, spans).wrap(WrapMode::None).shrink(0.0)
        };
        let row = View::new(app).row().gap(2).justify(Justify::SpaceBetween);
        match &usage {
            Some((text, danger)) => {
                row.add(
                    &Text::new(app, text.as_str())
                        .fg(if *danger {
                            theme.text.feedback.error.base
                        } else {
                            theme.text.muted
                        })
                        .wrap(WrapMode::None),
                );
                let price = if !cost.is_empty() && cost != "Free" {
                    format!("{cost} per 1M")
                } else {
                    cost.clone()
                };
                row.add(&list([vec![price], facts.clone()].concat()));
            }
            None => {
                if price {
                    row.add(
                        &Text::new(app, cost.as_str())
                            .fg(theme.text.muted)
                            .wrap(WrapMode::None),
                    );
                } else {
                    row.justify(Justify::Start);
                }
                row.add(&list(facts.clone()));
            }
        }
        row.as_any()
    }))
}

// `String(Number(value.toFixed(2)))`.
fn dollars(value: f64) -> String {
    format!("{}", (value * 100.0).round() / 100.0)
}

fn modality(value: &str) -> String {
    if value == "pdf" {
        return "PDF".to_owned();
    }
    let mut chars = value.chars();
    chars.next().map_or(String::new(), |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn tokens(value: i64) -> String {
    if value >= 1_000_000 {
        return format!("{}M", (value as f64 / 100_000.0).round() / 10.0);
    }
    if value >= 1_000 {
        return format!("{}K", (value as f64 / 1_000.0).round());
    }
    value.to_string()
}

/// `DialogModel`'s `select`: selects the model, then offers its variants unless the current one still applies.
pub fn choose(local: &Rc<Local>, model: &Model) {
    local.set(model, true);
    let variants = local.variants();
    let current = local.variant();
    if current.is_some_and(|current| variants.contains(&current)) {
        local.dialogs.clear();
        return;
    }
    if !variants.is_empty() {
        crate::dialogs::variant::show(local);
        return;
    }
    local.dialogs.clear();
}

/// `DialogModel`'s `connect`: the integration dialog, which reopens this dialog on the connected provider.
pub fn connect(local: &Rc<Local>) {
    crate::dialogs::integration::show(local, Some(crate::dialogs::integration::show_models()));
}

/// Registers the model, agent, variant, and usage commands and their keys (`app.tsx:903-1018`).
pub fn install(tui: &Rc<Tui>) {
    let local = tui.local.clone();
    let command = |id: &str, run: fn(&Rc<Local>)| {
        let weak = Rc::downgrade(&local);
        TuiCommand::new(id, move |_, _| {
            if let Some(local) = weak.upgrade() {
                run(&local);
            }
        })
        .bind(Bind::Off)
        .group("Agent")
    };
    let slash = |name: &str, aliases: &[&str]| Slash {
        name: name.to_owned(),
        aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
        arguments: false,
    };
    let commands = vec![
        command("model.list", |local| show(local, None))
            .title("Switch model")
            .palette()
            .suggested(opentui::keymap::Condition::Always)
            .slash(slash("models", &[])),
        command("model.cycle_recent", |local| local.cycle(1)).title("Model cycle"),
        command("model.cycle_recent_reverse", |local| local.cycle(-1)).title("Model cycle reverse"),
        command("model.cycle_favorite", |local| local.cycle_favorite(1)).title("Favorite cycle"),
        command("model.cycle_favorite_reverse", |local| {
            local.cycle_favorite(-1)
        })
        .title("Favorite cycle reverse"),
        command("agent.list", crate::dialogs::agent::show)
            .title("Switch agent")
            .palette()
            .slash(slash("agents", &[])),
        command("usage.show", crate::dialogs::usage::show)
            .title("View usage")
            .palette()
            .slash(slash("usage", &[])),
        command("agent.cycle", |local| local.move_agent(1)).title("Agent cycle"),
        command("variant.cycle", |local| local.cycle_variant())
            .title("Variant cycle")
            .palette(),
        command("variant.list", |local| {
            if local.variants().is_empty() {
                local.toasts.show(
                    ToastOptions::new(
                        Variant::Info,
                        "The current model does not support any variants.",
                    )
                    .title("No variants available"),
                );
                return;
            }
            crate::dialogs::variant::show(local);
        })
        .title("Switch model variant")
        .palette()
        .slash(slash("variants", &["thinking", "effort"])),
        command("agent.cycle.reverse", |local| local.move_agent(-1)).title("Agent cycle reverse"),
    ];
    let names: Vec<String> = commands
        .iter()
        .filter_map(|command| command.id.clone())
        .collect();
    let layers = [
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands,
            ..KeymapLayer::default()
        },
        KeymapLayer {
            bindings: names,
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => local.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("model keymap layer: {error}"),
        }
    }
    let weak = Rc::downgrade(&local);
    let listener = local.subscribe(move || {
        if let Some(local) = weak.upgrade() {
            local.load_served_usage();
            usage_alerts(&local);
        }
    });
    local.layers.borrow_mut().push(listener);
    local.load();
}

/// Applies `--agent` and `--model` once the agents, the models, and `model.json` have loaded (`app.tsx:666-678`).
/// `model` is already parsed; an invalid one only got its toast.
pub fn startup(local: &Rc<Local>, agent: Option<String>, model: Option<Model>) {
    if agent.is_none() && model.is_none() {
        return;
    }
    local.startup_agent.replace(agent.clone());
    let pending = Rc::new(RefCell::new(Some((agent, model))));
    let listener: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let apply = {
        let weak = Rc::downgrade(local);
        let pending = pending.clone();
        let listener = listener.clone();
        move || {
            let Some(local) = weak.upgrade() else { return };
            if !local.ready() || !local.catalog_ready() || local.agents().is_empty() {
                return;
            }
            let Some((agent, model)) = pending.borrow_mut().take() else {
                return;
            };
            drop(listener.borrow_mut().take());
            if let Some(agent) = agent {
                local.set_agent(&agent);
            }
            if let Some(model) = model {
                local.set(&model, true);
            }
        }
    };
    *listener.borrow_mut() = Some(local.subscribe(apply.clone()));
    apply();
}

/// `useUsageAlerts` (`usage.tsx:224-251`): on a session, warns once per model as the selected model runs low and once
/// as it reaches its limit.
pub fn usage_alerts(local: &Local) {
    use crate::dialogs::usage::{Level, format_dollars, format_reset, level};
    if (local.route)().is_none() {
        return;
    }
    let Some((model, usage)) = local.current_usage() else {
        return;
    };
    let level = level(&usage, &model);
    if level == Level::Plenty {
        return;
    }
    let reached = level == Level::Reached;
    let key = format!(
        "{}/{}:{}",
        model.provider_id.0,
        model.id,
        if reached { "reached" } else { "low" }
    );
    if !local.warned.borrow_mut().insert(key) {
        return;
    }
    let weak = local.this.clone();
    let toast = if reached {
        ToastOptions::new(
            Variant::Error,
            format!("Resets {}", format_reset(usage.resets_at)),
        )
        .title(format!("{} limit reached", model.name))
        .action("Switch model", move || {
            if let Some(local) = weak.upgrade() {
                show(&local, None);
            }
        })
    } else {
        ToastOptions::new(
            Variant::Warning,
            format!(
                "{} left · resets {}",
                format_dollars(usage.left),
                format_reset(usage.resets_at)
            ),
        )
        .title(format!("Running low on {}", model.name))
        .action("View usage", move || {
            if let Some(local) = weak.upgrade() {
                crate::dialogs::usage::show(&local);
            }
        })
    };
    local.toasts.show(toast);
}

/// The agent and model the prompt shows and submits: what the user chose here (`useLocal`) once this
/// state has its catalog, else the prompt's own reading of the catalog.
pub fn prompt_selection(
    tui: &Tui,
    catalog: &crate::prompt::metadata::Catalog,
    session: Option<&SessionInfo>,
) -> Option<crate::prompt::metadata::Selection> {
    let base = catalog.selection(session);
    let local = &tui.local;
    let Some(agent) = local.agent().filter(|_| local.catalog_ready()) else {
        return base;
    };
    let model = local
        .selection()
        .map(|selection| crate::prompt::metadata::Choice {
            provider_id: selection.model.provider_id,
            model_id: selection.model.model_id,
            variant: selection.variant,
        })
        .or_else(|| base.and_then(|base| base.model));
    Some(crate::prompt::metadata::Selection { agent, model })
}

/// The [`LocationFn`] of the TUI: the current location, else the default one.
pub fn location_fn(tui: Weak<Tui>) -> LocationFn {
    Rc::new(move || {
        let Some(tui) = tui.upgrade() else {
            return Location::default();
        };
        crate::features::location::current(&tui)
            .unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()))
    })
}

/// The [`RouteFn`] of the TUI: the routed session and what the store held of it at the last sync. It does not
/// lock the store, as `Local` is read from keymap conditions.
pub fn route_fn(tui: Weak<Tui>) -> RouteFn {
    Rc::new(move || {
        let tui = tui.upgrade()?;
        let Route::Session { id } = tui.route() else {
            return None;
        };
        let session = tui.routed();
        Some(Routed { id, session })
    })
}
