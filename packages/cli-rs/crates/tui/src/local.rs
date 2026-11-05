//! The model and agent state of `context/local.tsx` (E.16).
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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::generated::{
    AgentInfo, AgentInfoMode, ExperimentalUsageLimitsInput, IntegrationInfo, LocationQueryInput, ModelInfo, ModelRef,
    ProviderInfo, SessionID, SessionInfo, UsageLimitsInfo,
};
use opencode_local::model_pref::{self, Model, ModelPreferences, Preference};
use opencode_local::storage::Storage;
use opencode_local::watch::Watch;
use opencode_store::location::{Catalog, Location, LocationData};
use opencode_store::{Changes, Data};
use opencode_ui::bind;
use opencode_ui::dialog::Dialogs;
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
        format!("{}:{}", self.model.key(), model_pref::normalize_variant(self.variant.as_deref()).unwrap_or("default"))
    }
}

/// The routed session, as [`Local`] reads it.
pub struct Routed {
    pub id: SessionID,
    pub session: Option<SessionInfo>,
}

/// The store catalogs [`Local`] reads.
const CATALOGS: [Catalog; 5] =
    [Catalog::Model, Catalog::Provider, Catalog::Agent, Catalog::Integration, Catalog::Config];

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
    /// The TUI whose route and location this follows; without it, home at the store's default location.
    tui: Weak<Tui>,
    preferences: Option<ModelPreferences>,
    pub(crate) storage: Option<Storage>,
    writer: Option<mpsc::Sender<Job>>,
    /// `model.json` writes sent to the writer, and those it finished. A read made while they differ may miss a change
    /// already in memory.
    writes: Cell<u64>,
    written: Arc<AtomicU64>,
    state: RefCell<State>,
    listeners: Listeners,
    next_listener: Cell<u64>,
    /// The keys of the locations whose usage limits are loading.
    usage_loading: RefCell<HashSet<String>>,
    /// The usage warnings shown, once per model and level while the TUI runs (`usage.tsx` `warned`).
    pub(crate) warned: RefCell<HashSet<String>>,
    /// `--agent`, which a session without an agent draft shows over its own agent (`local.tsx:90-96`).
    pub(crate) startup_agent: RefCell<Option<String>>,
    watch: RefCell<Option<Watch>>,
    pub(crate) layers: RefCell<Vec<Disposer>>,
    /// The in-memory `go-upsell` record (`storage.memory`).
    pub(crate) go_memory: RefCell<crate::dialogs::go_upsell::Seen>,
    /// Opens a URL in the browser; tests replace it.
    pub open_url: RefCell<OpenUrl>,
    pub(crate) this: Weak<Local>,
}

#[derive(Default)]
struct State {
    /// Where the catalog is read from in the store.
    location: Option<Location>,
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
        tui: Weak<Tui>,
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
            tui,
            preferences,
            storage,
            writer,
            writes: Cell::new(0),
            written: Arc::default(),
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
        self.relocate(self.tui_location());
        self.load_preferences();
        let Some(preferences) = &self.preferences else {
            self.state.borrow_mut().ready = true;
            return;
        };
        let weak = self.this.clone();
        self.app.on_message(bind!(weak, |local, _, _: &PreferencesChanged| local.load_preferences()));
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
        self.data.catalog_invalidate(Catalog::Integration, Some(&location));
        self.read(Catalog::Integration, &location);
    }

    /// Follows the store (`Tui::sync`): the catalog of the location the TUI moved to or whose catalog
    /// changed, and the drafts of sessions that changed.
    pub fn sync(&self, changes: &Changes) {
        let location = self.tui_location();
        if self.state.borrow().location.as_ref() != Some(&location) {
            self.relocate(location);
        } else if changes.all || changes.location(&location) {
            self.notify();
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

    // Reads the catalog of `location` from the store, and asks the store to read what it lacks.
    fn relocate(&self, location: Location) {
        self.state.borrow_mut().location = Some(location.clone());
        self.notify();
        for catalog in CATALOGS {
            self.read(catalog, &location);
        }
    }

    fn read(&self, catalog: Catalog, location: &Location) {
        let weak = self.this.clone();
        let task = self.data.catalog_sync(catalog, Some(location));
        self.app.spawn(
            task,
            bind!(weak, |local, _, result| {
                match result {
                    Ok(()) => local.notify(),
                    Err(error) => log::warn!("model catalog: {error}"),
                }
            }),
        );
    }

    /// Reads `catalog` again into the store when polled, as a connect does.
    pub(crate) fn reload(
        &self,
        catalog: Catalog,
    ) -> impl Future<Output = Result<(), opencode_store::Error>> + Send + use<> {
        let data = self.data.clone();
        let location = self.catalog_location();
        async move {
            data.catalog_invalidate(catalog, Some(&location));
            data.catalog_sync(catalog, Some(&location)).await
        }
    }

    /// Runs `f` on the store's data of the catalog's location, `None` until the store holds some.
    fn catalog<R>(&self, f: impl FnOnce(Option<&LocationData>) -> R) -> R {
        let location = self.catalog_location();
        self.data.read(|state| f(state.location(Some(&location))))
    }

    /// Where the TUI works (`location.ref ?? data.location.default()`).
    fn tui_location(&self) -> Location {
        self.tui
            .upgrade()
            .and_then(|tui| crate::features::location::current(&tui))
            .unwrap_or_else(|| self.data.read(|state| state.default_location().clone()))
    }

    /// The routed session, or `None` on home.
    pub(crate) fn route(&self) -> Option<Routed> {
        let Route::Session { id } = self.tui.upgrade()?.route() else {
            return None;
        };
        let session = self.data.read(|state| state.session(&id).cloned());
        Some(Routed { id, session })
    }

    /// `useUsageLimits().load`: loads the current location's limits once, or again with `refresh`, keeping the
    /// loaded ones meanwhile.
    pub fn load_usage(&self, refresh: bool) {
        let key = self.catalog_location().key();
        if self.usage_loading.borrow().contains(&key) || (!refresh && self.state.borrow().usage.contains_key(&key)) {
            return;
        }
        self.usage_loading.borrow_mut().insert(key.clone());
        let client = self.client.clone();
        let input = ExperimentalUsageLimitsInput { location: self.location() };
        let weak = self.this.clone();
        self.app.spawn(
            async move { client.experimental_usage_limits(&input).await },
            bind!(weak, |local, _, result| {
                local.usage_loading.borrow_mut().remove(&key);
                match result {
                    Ok(output) => {
                        // Filed under the location the server answered for, as `locationResource` publishes.
                        local.state.borrow_mut().usage.insert(Location::from(&output.location).key(), output.data);
                        local.notify();
                    }
                    Err(error) => log::warn!("usage limits: {error}"),
                }
            }),
        );
    }

    /// The location the catalog and the usage limits are read for (`location.ref ?? data.location.default()`).
    fn catalog_location(&self) -> Location {
        let location = self.state.borrow().location.clone();
        location.unwrap_or_else(|| self.tui_location())
    }

    /// Calls `listener` after the catalog, the preferences, or a selection change.
    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Disposer {
        let id = self.next_listener.get();
        self.next_listener.set(id + 1);
        self.listeners.borrow_mut().push((id, Rc::new(listener)));
        let listeners = Rc::downgrade(&self.listeners);
        Disposer::new(bind!(listeners, |listeners| listeners.borrow_mut().retain(|(other, _)| *other != id)))
    }

    fn notify(&self) {
        let listeners: Vec<_> = self.listeners.borrow().iter().map(|(_, listener)| listener.clone()).collect();
        for listener in listeners {
            listener();
        }
        self.app.request_redraw();
    }

    /// The location the catalog is read from, as a request names it.
    pub(crate) fn location(&self) -> Option<LocationQueryInput> {
        let location = self.state.borrow().location.clone();
        let location = location.unwrap_or_else(|| self.tui_location());
        Some(LocationQueryInput { directory: Some(location.directory) })
    }

    fn load_preferences(&self) {
        let Some(preferences) = self.preferences.clone() else {
            return;
        };
        let weak = self.this.clone();
        let started = self.writes.get();
        let written = self.written.clone();
        self.app.spawn(
            async move {
                // Settled when every write sent before the read had landed before it.
                let settled = written.load(Ordering::SeqCst) == started;
                tokio::task::spawn_blocking(move || preferences.load()).await.map(|preference| (preference, settled))
            },
            bind!(weak, |local, _, result| {
                // A read that may predate a write would undo the change the write carries; read again once it lands.
                if let Ok((_, settled)) = &result
                    && (!settled || local.writes.get() != started)
                {
                    return local.load_after_writes();
                }
                let mut state = local.state.borrow_mut();
                if let Ok((preference, _)) = result {
                    state.preference = preference;
                }
                state.ready = true;
                drop(state);
                local.notify();
            }),
        );
    }

    /// Reads `model.json` again once the writer has finished every write sent so far.
    fn load_after_writes(&self) {
        let (Some(writer), Some(_)) = (&self.writer, &self.preferences) else {
            return;
        };
        let proxy = self.app.proxy();
        let _ = writer.send(Box::new(move || {
            let _ = proxy.send(PreferencesChanged);
        }));
    }

    // `model.json` writes, in order, off the UI thread.
    fn write(&self, job: impl FnOnce(&ModelPreferences) -> Result<(), opencode_local::lock::Error> + Send + 'static) {
        let (Some(writer), Some(preferences)) = (&self.writer, self.preferences.clone()) else {
            return;
        };
        self.writes.set(self.writes.get() + 1);
        let written = self.written.clone();
        let _ = writer.send(Box::new(move || {
            if let Err(error) = job(&preferences) {
                log::warn!("model.json: {error}");
            }
            written.fetch_add(1, Ordering::SeqCst);
        }));
    }

    // Catalog reads.

    /// Whether `model.json` has been read.
    pub fn ready(&self) -> bool {
        self.state.borrow().ready
    }

    /// Whether the model list has loaded (`catalogReady`).
    pub fn catalog_ready(&self) -> bool {
        self.catalog(|data| data.is_some_and(|data| data.model.is_some()))
    }

    /// Runs `f` on the models (empty until loaded).
    pub fn models<R>(&self, f: impl FnOnce(&[ModelInfo]) -> R) -> R {
        self.catalog(|data| f(data.and_then(|data| data.model.as_deref()).unwrap_or_default()))
    }

    pub fn model_info(&self, model: &Model) -> Option<ModelInfo> {
        self.models(|models| models.iter().find(|item| is(item, model)).cloned())
    }

    /// Runs `f` on the providers (empty until loaded).
    pub fn providers<R>(&self, f: impl FnOnce(&[ProviderInfo]) -> R) -> R {
        self.catalog(|data| f(data.and_then(|data| data.provider.as_deref()).unwrap_or_default()))
    }

    pub fn provider(&self, id: &str) -> Option<ProviderInfo> {
        self.providers(|providers| providers.iter().find(|item| item.id.0 == id).cloned())
    }

    pub fn integrations(&self) -> Option<Vec<IntegrationInfo>> {
        self.catalog(|data| data?.integration.clone())
    }

    /// The integration `id`, once the integrations have loaded.
    pub fn integration(&self, id: &str) -> Option<IntegrationInfo> {
        self.catalog(|data| data?.integration.as_ref()?.iter().find(|item| item.id.0 == id).cloned())
    }

    /// `useUsageLimits().info`: `None` until loaded, `Some(None)` when not signed in.
    /// The current location's usage limits: `None` until loaded, `Some(None)` when it is not signed in to
    /// OpenCode Console.
    pub fn usage(&self) -> Option<Option<UsageLimitsInfo>> {
        let key = self.catalog_location().key();
        self.state.borrow().usage.get(&key).cloned()
    }

    /// The selected model and what the usage limits leave it, when some limit applies (`limits.usage(model)`).
    pub(crate) fn current_usage(&self) -> Option<(ModelInfo, crate::dialogs::usage::ModelUsage)> {
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
            level => Some((format!("{} left", format_dollars(usage.left)), level == Level::Out)),
        }
    }

    /// The prompt's effect (`prompt/index.tsx:1578-1582`): loads the limits once when OpenCode Console serves the
    /// selected model.
    pub(crate) fn load_served_usage(&self) {
        let served = self
            .current()
            .is_some_and(|model| crate::dialogs::usage::served_by_console(self.provider(&model.provider_id).as_ref()));
        if served && self.usage().is_none() {
            self.load_usage(false);
        }
    }

    /// `useConnected`: some integration has a connection.
    pub fn connected(&self) -> bool {
        self.catalog(|data| {
            data.and_then(|data| data.integration.as_ref())
                .is_some_and(|list| list.iter().any(|item| !item.connections.is_empty()))
        })
    }

    pub fn recent(&self) -> Vec<Model> {
        self.state.borrow().preference.recent.clone()
    }

    pub fn favorite(&self) -> Vec<Model> {
        self.state.borrow().preference.favorite.clone()
    }

    fn is_valid(&self, model: &Model) -> bool {
        self.models(|models| models.iter().any(|item| is(item, model)))
    }

    // Agents.

    /// The agents a user can pick: not subagents, not hidden.
    pub fn agents(&self) -> Vec<AgentInfo> {
        self.catalog(|data| {
            data.and_then(|data| data.agent.as_ref())
                .into_iter()
                .flatten()
                .filter(|agent| !matches!(agent.mode, AgentInfoMode::Subagent) && !agent.hidden)
                .cloned()
                .collect()
        })
    }

    pub fn agent(&self) -> Option<AgentInfo> {
        let agents = self.agents();
        let selected = {
            let state = self.state.borrow();
            match self.route() {
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
                    .or_else(|| routed.session.and_then(|session| session.agent.map(|agent| agent.0)))
                    .or_else(|| state.agent.clone()),
                None => state.agent.clone(),
            }
        };
        agents.iter().find(|agent| Some(&agent.id.0) == selected.as_ref()).or(agents.first()).cloned()
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
        let routed = self.route();
        {
            let mut state = self.state.borrow_mut();
            state.agent = Some(id.to_owned());
            if let Some(routed) = &routed {
                state.agent_drafts.insert(routed.id.0.clone(), Some(id.to_owned()));
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
        let choice = self.catalog(|data| data?.config.as_deref().and_then(crate::prompt::metadata::configured))?;
        Some(Selection { model: Model::new(&choice.provider_id, &choice.model_id), variant: choice.variant })
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
        self.models(|models| models.first().map(|first| Model::new(&first.provider_id.0, &first.id)))
    }

    // `newSessionModel`.
    fn new_session_model(&self) -> Option<Model> {
        let agent = self.agent();
        let chosen = agent
            .as_ref()
            .and_then(|agent| self.state.borrow().new_session.get(&self.location_agent_key(&agent.id.0)).cloned());
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
        let preferred = self.state.borrow().preference.variant.get(&model.key()).cloned();
        let variant = preferred
            .or_else(|| {
                configured
                    .filter(|c| c.provider_id.0 == model.provider_id && c.id == model.model_id)
                    .and_then(|c| c.variant)
            })
            .or_else(|| fallback.filter(|f| f.model == *model).and_then(|f| f.variant));
        let variant = model_pref::normalize_variant(variant.as_deref()).map(str::to_owned);
        let info = self.model_info(model);
        Selection {
            model: model.clone(),
            variant: variant
                .filter(|variant| info.is_some_and(|info| info.variants.iter().any(|item| item.id == *variant))),
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
        let drafted =
            self.state.borrow().selections.get(&routed.id.0).and_then(|drafts| drafts.get(&agent.id.0)).cloned();
        let own = session.and_then(|session| session.agent.as_ref()).is_none_or(|other| *other == agent.id);
        let selected = drafted.or_else(|| own.then(|| Self::durable(session)).flatten());
        if let Some(selected) = selected {
            let info = self.model_info(&selected.model);
            let keep =
                info.is_none_or(|info| info.variants.iter().any(|item| Some(&item.id) == selected.variant.as_ref()));
            return Some(Selection { variant: selected.variant.filter(|_| keep), ..selected });
        }
        self.new_session_model().map(|model| self.preferred(&model))
    }

    /// The model and variant the next prompt uses (`model.selection`).
    pub fn selection(&self) -> Option<Selection> {
        match self.route() {
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
            return ("Connect a provider".into(), "No provider selected".into(), false);
        };
        let provider = self
            .provider(&selection.model.provider_id)
            .map_or(selection.model.provider_id.clone(), |provider| provider.name);
        let info = self.model_info(&selection.model);
        let reasoning = info.as_ref().is_some_and(|info| !info.variants.is_empty());
        let model = info.map_or_else(|| format!("{} (unavailable)", selection.model.model_id), |info| info.name);
        (provider, model, reasoning)
    }

    fn set_session_draft(&self, routed: &Routed, selection: Selection) {
        let Some(agent) = self.agent() else { return };
        let session = routed.session.as_ref();
        let own = session.and_then(|session| session.agent.as_ref()).is_none_or(|other| *other == agent.id);
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
        if let Some(routed) = self.route() {
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
        self.state.borrow_mut().new_session.insert(key, model.clone());
        true
    }

    // `locationAgentKey`: a model chosen for a new session belongs to the location and the agent.
    fn location_agent_key(&self, agent: &str) -> String {
        let location = self.state.borrow().location.clone();
        format!("{}:{agent}", location.unwrap_or_else(|| self.tui_location()).key())
    }

    /// `trackSessionCommit`: a submit is committing `model` and `agent` to `session`; once the session
    /// reports both, the draft that chose them gives way to the session's own selection.
    pub fn track_commit(&self, session: &SessionID, model: &ModelRef, agent: &str) {
        let selection =
            Selection { model: Model::new(&model.provider_id.0, &model.id), variant: model.variant.clone() };
        self.state.borrow_mut().commits.insert(session.0.clone(), (agent.to_owned(), selection.key()));
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
        if agent.as_ref() != Some(&expected_agent) || durable.is_none_or(|durable| durable.key() != expected_selection)
        {
            return;
        }
        self.state.borrow_mut().commits.remove(&id.0);
        // Inactive agents keep their remembered choices after another agent commits.
        let here = self.route().is_some_and(|routed| routed.id == *id);
        if !here || self.agent().is_none_or(|agent| agent.id.0 != expected_agent) {
            return;
        }
        let mut state = self.state.borrow_mut();
        if let Some(drafts) = state.selections.get_mut(&id.0)
            && drafts.get(&expected_agent).is_some_and(|draft| draft.key() == expected_selection)
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
        let (Some(routed), Some(agent), Some(selection)) = (self.route(), self.agent(), self.selection()) else {
            return;
        };
        self.state.borrow_mut().selections.entry(routed.id.0).or_default().insert(agent.id.0, selection);
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
            state.preference.favorite = model_pref::favorite_models(model, &state.preference.favorite, enabled);
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
        let recent: Vec<Model> = self.recent().into_iter().filter(|item| self.is_valid(item)).collect();
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
        let favorites: Vec<Model> = self.favorite().into_iter().filter(|item| self.is_valid(item)).collect();
        if favorites.is_empty() {
            self.toasts.show(
                ToastOptions::new(Variant::Info, "Add a favorite model to use this shortcut")
                    .duration(Duration::from_millis(3000)),
            );
            return;
        }
        let len = favorites.len() as i64;
        let index = self.selection().and_then(|current| favorites.iter().position(|item| *item == current.model));
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
            .map(|info| info.variants.into_iter().map(|variant| variant.id).collect())
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
        if let Some(routed) = self.route() {
            self.set_session_draft(
                &routed,
                Selection { variant: model_pref::normalize_variant(value).map(str::to_owned), ..current.clone() },
            );
        }
        self.state.borrow_mut().preference.variant.insert(current.model.key(), value.unwrap_or("default").to_owned());
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

pub(crate) fn is(info: &ModelInfo, model: &Model) -> bool {
    info.provider_id.0 == model.provider_id && info.id == model.model_id
}
