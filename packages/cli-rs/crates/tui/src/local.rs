//! Local model and agent selections. The composer commits drafts on submit; selection events settle them. Serialize
//! preference writes off the UI thread because the file lock blocks.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};

use opencode_api::client::Client;
use opencode_api::generated::{
    AgentInfo, AgentInfoMode, IntegrationInfo, LocationQueryInput, ModelInfo, ModelRef, ModelSpeed, ProviderInfo,
    SessionInfo, UsageLimitsInfo,
};
use opencode_local::model_pref::{self, Model, ModelPreferences, Preference};
use opencode_local::storage::Storage;
use opencode_local::watch::Watch;
use opencode_store::location::{Catalog, Location, LocationData};
use opencode_store::{Data, Parts, Selected};
use opencode_ui::dialog::Dialogs;
use opencode_ui::toast::Toasts;

use crate::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub model: Model,
    pub variant: Option<String>,
}

impl Selection {
    fn key(&self) -> String {
        format!("{}:{}", self.model.key(), model_pref::normalize_variant(self.variant.as_deref()).unwrap_or("default"))
    }
}

/// One of the current model's other speeds (`local.model.speed.list()`).
#[derive(Clone, Debug, PartialEq)]
pub struct Speed {
    pub id: String,
    pub faster: bool,
    /// Its input price against the standard speed's, when the model has prices.
    pub price: Option<f64>,
}

/// The session route on screen. Its session's agent and model are read from the store where they are needed.
pub struct Routed(Rc<Route>);

impl Routed {
    pub fn id(&self) -> &SessionID {
        match &*self.0 {
            Route::Session { id } => id,
            _ => unreachable!("a routed session holds a session route"),
        }
    }
}

const CATALOGS: [Catalog; 5] =
    [Catalog::Model, Catalog::Provider, Catalog::Agent, Catalog::Integration, Catalog::Config];

/// What the selections and their readers read of the location: the catalogs above, and the usage limits.
pub(crate) const READS: Parts = Parts::catalogs(&[
    Catalog::Model,
    Catalog::Provider,
    Catalog::Agent,
    Catalog::Integration,
    Catalog::Config,
    Catalog::UsageLimits,
]);

pub struct Files {
    /// The state directory that holds `model.json`.
    pub state: PathBuf,
    pub storage: Option<Storage>,
}

type Job = Box<dyn FnOnce() + Send>;
type Listeners = Rc<RefCell<Vec<(u64, Rc<dyn Fn()>)>>>;
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
    /// Usage warnings already shown by model and severity.
    pub(crate) warned: RefCell<HashSet<String>>,
    /// Startup agent selection when a session has no agent draft.
    pub(crate) startup_agent: RefCell<Option<String>>,
    /// First model to try when falling back.
    pub(crate) startup_model: RefCell<Option<Model>>,
    watch: RefCell<Option<Watch>>,
    pub(crate) layers: RefCell<Vec<Disposer>>,
    pub(crate) go_memory: RefCell<crate::dialogs::go_upsell::Seen>,
    pub open_url: RefCell<OpenUrl>,
    pub(crate) this: Weak<Local>,
}

#[derive(Default)]
struct State {
    location: Option<Location>,
    preference: Preference,
    ready: bool,
    agent: Option<String>,
    agent_drafts: HashMap<String, Option<String>>,
    new_session: HashMap<String, Model>,
    selections: HashMap<String, HashMap<String, Selection>>,
    /// Per session: the agent and selection key a submit committed, until the session reports them
    /// (`pendingSelectionCommits`).
    commits: HashMap<String, (String, String)>,
}

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
            warned: RefCell::default(),
            startup_agent: RefCell::default(),
            startup_model: RefCell::default(),
            watch: RefCell::new(None),
            layers: RefCell::new(Vec::new()),
            go_memory: RefCell::default(),
            open_url: RefCell::new(Rc::new(crate::features::links::open_url)),
            this: this.clone(),
        })
    }

    pub fn load(&self) {
        self.relocate(self.tui_location());
        self.load_preferences();
        let Some(preferences) = &self.preferences else {
            self.state.borrow_mut().ready = true;
            return;
        };
        self.app.on_message(bind!(self.this, |local, _, _: &PreferencesChanged| local.load_preferences()));
        let proxy = self.app.proxy();
        *self.watch.borrow_mut() = preferences.watch(move || {
            let _ = proxy.send(PreferencesChanged);
        });
    }

    /// Reads the integrations again, for example after a connect.
    pub fn load_integrations(&self) {
        let Some(location) = self.state.borrow().location.clone() else { return };
        self.data.catalog_invalidate(Catalog::Integration, Some(&location));
        self.read(Catalog::Integration, &location);
    }

    pub fn sync(&self, changes: &Changes) {
        let moved = self.at_tui_location(|at| (self.state.borrow().location.as_ref() != Some(at)).then(|| at.clone()));
        let relocated = moved.is_some();
        if let Some(location) = moved {
            self.relocate(location);
        } else if changes.all() || self.at_tui_location(|at| changes.location_parts(at, READS)) {
            self.notify();
        }
        // A connection can open after these reads: the server does not replay what it sent before the
        // subscription, and the model list it answers before its providers settle is empty with no later event
        // delivered (the model route says so). Every connection marks every change, so read them again, as a
        // reconnect needs too. `relocate` has just read them.
        if changes.all() && !relocated {
            let location = self.tui_location();
            for catalog in CATALOGS {
                self.data.catalog_invalidate(catalog, Some(&location));
                self.read(catalog, &location);
            }
        }
        let sessions: Vec<SessionID> = if changes.all() {
            self.state
                .borrow()
                .commits
                .keys()
                .cloned()
                .chain(self.state.borrow().agent_drafts.keys().cloned())
                .map(SessionID)
                .collect()
        } else {
            self.data.read(|state| changes.sessions_with(state, Touched::INFO).cloned().collect())
        };
        for id in sessions {
            let selected: Vec<Selected> = self.data.read(|state| changes.selected(state, &id).cloned().collect());
            self.reconcile(&id, &selected);
        }
    }

    fn relocate(&self, location: Location) {
        self.state.borrow_mut().location = Some(location.clone());
        self.notify();
        for catalog in CATALOGS {
            self.read(catalog, &location);
        }
    }

    fn read(&self, catalog: Catalog, location: &Location) {
        let task = self.data.catalog_sync(catalog, Some(location));
        self.app.spawn(
            task,
            bind!(self.this, |local, _, result| {
                match result {
                    Ok(()) => local.notify(),
                    Err(error) => log::warn!("model catalog: {error}"),
                }
            }),
        );
    }

    pub(crate) fn reload(
        &self,
        catalog: Catalog,
    ) -> impl Future<Output = Result<(), opencode_store::Error>> + Send + use<> {
        let remote = self.data.remote();
        let location = self.catalog_location();
        async move {
            let sync = remote.call(move |data| {
                data.catalog_invalidate(catalog, Some(&location));
                data.catalog_sync(catalog, Some(&location))
            });
            sync.await?.await
        }
    }

    /// Runs `f` on the store's data of the catalog's location, `None` until the store holds some.
    fn catalog<R>(&self, f: impl FnOnce(Option<&LocationData>) -> R) -> R {
        let location = self.catalog_location();
        self.data.read(|state| f(state.location(Some(&location))))
    }

    fn tui_location(&self) -> Location {
        self.at_tui_location(Location::clone)
    }

    /// Runs `f` on the location the TUI works in: the one set, else the store's default.
    fn at_tui_location<R>(&self, f: impl FnOnce(&Location) -> R) -> R {
        let tui = self.tui.upgrade();
        match tui.as_ref().map(|tui| tui.location.reference.borrow()).as_deref() {
            Some(Some(location)) => f(location),
            _ => self.data.read(|state| f(state.default_location())),
        }
    }

    pub(crate) fn route(&self) -> Option<Routed> {
        let route = self.tui.upgrade()?.route();
        matches!(*route, Route::Session { .. }).then(|| Routed(route))
    }

    /// `useUsageLimits().load`: loads the current location's limits into the store once, or again with `refresh`,
    /// keeping the loaded ones meanwhile.
    pub fn load_usage(&self, refresh: bool) {
        let location = self.catalog_location();
        if refresh {
            self.data.catalog_invalidate(Catalog::UsageLimits, Some(&location));
        }
        self.read(Catalog::UsageLimits, &location);
    }

    pub(crate) fn catalog_location(&self) -> Location {
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

    pub(crate) fn location(&self) -> Option<LocationQueryInput> {
        let location = self.state.borrow().location.clone();
        let location = location.unwrap_or_else(|| self.tui_location());
        Some(LocationQueryInput { directory: Some(location.directory) })
    }

    fn load_preferences(&self) {
        let Some(preferences) = self.preferences.clone() else { return };
        let started = self.writes.get();
        let written = self.written.clone();
        self.app.spawn(
            async move {
                // Settled when every write sent before the read had landed before it.
                let settled = written.load(Ordering::SeqCst) == started;
                tokio::task::spawn_blocking(move || preferences.load()).await.map(|preference| (preference, settled))
            },
            bind!(self.this, |local, _, result| {
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
        let (Some(writer), Some(_)) = (&self.writer, &self.preferences) else { return };
        let proxy = self.app.proxy();
        let _ = writer.send(Box::new(move || {
            let _ = proxy.send(PreferencesChanged);
        }));
    }

    // `model.json` writes, in order, off the UI thread.
    fn write(&self, job: impl FnOnce(&ModelPreferences) -> Result<(), opencode_local::lock::Error> + Send + 'static) {
        let (Some(writer), Some(preferences)) = (&self.writer, self.preferences.clone()) else { return };
        self.writes.set(self.writes.get() + 1);
        let written = self.written.clone();
        let _ = writer.send(Box::new(move || {
            if let Err(error) = job(&preferences) {
                log::warn!("model.json: {error}");
            }
            written.fetch_add(1, Ordering::SeqCst);
        }));
    }

    pub fn ready(&self) -> bool {
        self.state.borrow().ready
    }

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

    pub fn integrations(&self) -> Option<Arc<[IntegrationInfo]>> {
        self.catalog(|data| data?.integration.clone())
    }

    /// The integration `id`, once the integrations have loaded.
    pub fn integration(&self, id: &str) -> Option<IntegrationInfo> {
        self.catalog(|data| data?.integration.as_ref()?.iter().find(|item| item.id.0 == id).cloned())
    }

    /// `useUsageLimits().info`, from the store: `None` until loaded, `Some(None)` when the location is not signed in
    /// to OpenCode Console.
    pub fn usage(&self) -> Option<Option<UsageLimitsInfo>> {
        self.catalog(|data| data?.usage_limits.clone())
    }

    /// The selected model and what the usage limits leave it, when some limit applies (`limits.usage(model)`).
    pub(crate) fn current_usage(&self) -> Option<(ModelInfo, crate::dialogs::usage::ModelUsage)> {
        // The limits first: without them there is no selection to work out.
        let info = self.usage().flatten()?;
        let model = self.model_info(&self.current()?)?;
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

    /// Load limits when OpenCode Console serves the selected model.
    pub(crate) fn load_served_usage(&self) {
        let served = self
            .current()
            .is_some_and(|model| crate::dialogs::usage::served_by_console(self.provider(&model.provider_id).as_ref()));
        if served && self.usage().is_none() {
            self.load_usage(false);
        }
    }

    pub fn connected(&self) -> bool {
        self.catalog(|data| {
            data.and_then(|data| data.integration.as_ref())
                .is_some_and(|list| list.iter().any(|item| !item.connections.is_empty()))
        })
    }

    /// The recent models, each once: an entry saved at another speed stands for the model.
    pub fn recent(&self) -> Vec<Model> {
        let recent = self.state.borrow().preference.recent.clone();
        self.unique(recent)
    }

    /// The favorite models, each once, as [`Self::recent`].
    pub fn favorite(&self) -> Vec<Model> {
        let favorite = self.state.borrow().preference.favorite.clone();
        self.unique(favorite)
    }

    fn unique(&self, list: Vec<Model>) -> Vec<Model> {
        let mut seen = HashSet::new();
        self.models(|models| {
            list.iter().map(|item| standard_of(models, item)).filter(|item| seen.insert(item.key())).collect()
        })
    }

    /// `standardModel`: the model whose entry stands for `model` in a list of models.
    pub fn standard_model(&self, model: &Model) -> Model {
        self.models(|models| standard_of(models, model))
    }

    /// The current model at its standard speed.
    pub fn standard(&self) -> Option<Model> {
        self.current().map(|model| self.standard_model(&model))
    }

    /// The listed models that are `standard` served faster or slower.
    fn speeds_of(&self, standard: &Model) -> Vec<ModelInfo> {
        self.models(|models| {
            models
                .iter()
                .filter(|item| {
                    item.provider_id.0 == standard.provider_id
                        && speed_info(item).is_some_and(|speed| speed.base == standard.model_id)
                })
                .cloned()
                .collect()
        })
    }

    fn is_valid(&self, model: &Model) -> bool {
        self.models(|models| models.iter().any(|item| is(item, model)))
    }

    pub fn agents(&self) -> Vec<AgentInfo> {
        self.catalog(|data| listed(data).cloned().collect())
    }

    pub fn agent(&self) -> Option<AgentInfo> {
        let selected = {
            let state = self.state.borrow();
            match self.route() {
                Some(routed) => state
                    .agent_drafts
                    .get(&routed.id().0)
                    .cloned()
                    .flatten()
                    .or_else(|| {
                        let draft = state.agent_drafts.contains_key(&routed.id().0);
                        let startup = self.startup_agent.borrow().clone();
                        startup.filter(|_| !draft)
                    })
                    .or_else(|| self.data.read(|state| Some(state.session(routed.id())?.agent.as_ref()?.0.clone())))
                    .or_else(|| state.agent.clone()),
                None => state.agent.clone(),
            }
        };
        self.catalog(|data| {
            listed(data).find(|agent| Some(&agent.id.0) == selected.as_ref()).or_else(|| listed(data).next()).cloned()
        })
    }

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
                state.agent_drafts.insert(routed.id().0.clone(), Some(id.to_owned()));
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

    fn configured(&self) -> Option<Selection> {
        let choice = self.catalog(|data| data?.config.as_deref().and_then(crate::prompt::metadata::configured))?;
        Some(Selection { model: Model::new(&choice.provider_id, &choice.model_id), variant: choice.variant })
    }

    fn fallback(&self) -> Option<Model> {
        if let Some(startup) = self.startup_model.borrow().clone().filter(|model| self.is_valid(model)) {
            return Some(startup);
        }
        if let Some(configured) = self.configured().filter(|c| self.is_valid(&c.model)) {
            return Some(configured.model);
        }
        let recent = self.state.borrow().preference.recent.clone();
        if let Some(model) = recent.into_iter().find(|item| self.is_valid(item)) {
            return Some(model);
        }
        self.models(|models| models.first().map(|first| Model::new(&first.provider_id.0, &first.id)))
    }

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

    fn preferred(&self, model: &Model) -> Selection {
        let configured = self.agent().and_then(|agent| agent.model);
        let fallback = self.configured();
        // A model's speeds share its variant. Preferences saved before then may name one of its speeds instead.
        let standard = self.standard_model(model);
        let candidates: Vec<Model> = [standard.clone(), model.clone()]
            .into_iter()
            .chain(self.speeds_of(&standard).into_iter().map(|item| Model::new(&item.provider_id.0, item.id)))
            .collect();
        let preferred = {
            let state = self.state.borrow();
            candidates.iter().find_map(|item| state.preference.variant.get(&item.key()).cloned())
        };
        let variant = preferred
            .or_else(|| {
                configured
                    .filter(|c| c.provider_id.0 == model.provider_id && c.id == model.model_id)
                    .and_then(|c| c.variant)
            })
            .or_else(|| fallback.filter(|f| f.model == *model).and_then(|f| f.variant));
        let variant = model_pref::normalize_variant(variant.as_deref()).map(str::to_owned);
        let info = self.model_info(model);
        // A model runs at the speed last used with it.
        let speed = self.state.borrow().preference.speed.get(&model.key()).cloned();
        let remembered = speed.and_then(|speed| {
            self.speeds_of(model).into_iter().find(|item| speed_info(item).is_some_and(|item| item.id == speed))
        });
        Selection {
            model: remembered.map_or_else(|| model.clone(), |remembered| Model::new(&model.provider_id, remembered.id)),
            variant: variant
                .filter(|variant| info.is_some_and(|info| info.variants.iter().any(|item| item.id == *variant))),
        }
    }

    fn durable(session: Option<&SessionInfo>) -> Option<Selection> {
        let model = session?.model.as_ref()?;
        Some(Selection {
            model: Model::new(&model.provider_id.0, &model.id),
            variant: model_pref::normalize_variant(model.variant.as_deref()).map(str::to_owned),
        })
    }

    fn session_selection(&self, routed: &Routed) -> Option<Selection> {
        let agent = self.agent()?;
        let drafted =
            self.state.borrow().selections.get(&routed.id().0).and_then(|drafts| drafts.get(&agent.id.0)).cloned();
        let selected = drafted.or_else(|| {
            self.data.read(|state| {
                let session = state.session(routed.id());
                let own = session.and_then(|session| session.agent.as_ref()).is_none_or(|other| *other == agent.id);
                own.then(|| Self::durable(session)).flatten()
            })
        });
        if let Some(selected) = selected {
            let info = self.model_info(&selected.model);
            let keep =
                info.is_none_or(|info| info.variants.iter().any(|item| Some(&item.id) == selected.variant.as_ref()));
            return Some(Selection { variant: selected.variant.filter(|_| keep), ..selected });
        }
        self.new_session_model().map(|model| self.preferred(&model))
    }

    pub fn selection(&self) -> Option<Selection> {
        match self.route() {
            Some(routed) => self.session_selection(&routed),
            None => self.new_session_model().map(|model| self.preferred(&model)),
        }
    }

    pub fn current(&self) -> Option<Model> {
        self.selection().map(|selection| selection.model)
    }

    pub fn parsed(&self) -> (String, String, bool) {
        let Some(selection) = self.selection() else {
            return ("Connect a provider".into(), "No provider selected".into(), false);
        };
        let provider = self
            .provider(&selection.model.provider_id)
            .map_or(selection.model.provider_id.clone(), |provider| provider.name);
        let reasoning = self.model_info(&selection.model).is_some_and(|info| !info.variants.is_empty());
        // The speed shows beside the name, so the name is the model's own.
        let model = self
            .model_info(&self.standard_model(&selection.model))
            .map_or_else(|| format!("{} (unavailable)", selection.model.model_id), |info| info.name);
        (provider, model, reasoning)
    }

    fn set_session_draft(&self, routed: &Routed, selection: Selection) {
        let Some(agent) = self.agent() else { return };
        let (own, same) = self.data.read(|state| {
            let session = state.session(routed.id());
            let own = session.and_then(|session| session.agent.as_ref()).is_none_or(|other| *other == agent.id);
            (own, Self::durable(session).is_some_and(|durable| durable.key() == selection.key()))
        });
        let mut state = self.state.borrow_mut();
        let drafts = state.selections.entry(routed.id().0.clone()).or_default();
        if own && same {
            drafts.remove(&agent.id.0);
        } else {
            drafts.insert(agent.id.0.clone(), selection);
        }
    }

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
        let Some(agent) = self.agent() else { return false };
        let key = self.location_agent_key(&agent.id.0);
        self.state.borrow_mut().new_session.insert(key, model.clone());
        true
    }

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
        self.reconcile(session, &[]);
    }

    // Reconcile each selection event before reconciling the final stored session.
    fn reconcile(&self, id: &SessionID, selected: &[Selected]) {
        let session = self.data.read(|state| state.session(id).cloned());
        let Some(session) = session else { return };
        for (agent, model) in selected {
            self.settle(id, &SessionInfo { agent: agent.clone(), model: model.clone(), ..session.clone() });
        }
        self.settle(id, &session);
    }

    fn settle(&self, id: &SessionID, session: &SessionInfo) {
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
        let Some((expected_agent, expected_selection)) = expected else { return };
        let durable = Self::durable(Some(session));
        if agent.as_ref() != Some(&expected_agent) || durable.is_none_or(|durable| durable.key() != expected_selection)
        {
            return;
        }
        self.state.borrow_mut().commits.remove(&id.0);
        // Inactive agents keep their remembered choices after another agent commits.
        let here = self.route().is_some_and(|routed| routed.id() == id);
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

    fn remember(&self) {
        let (Some(routed), Some(agent), Some(selection)) = (self.route(), self.agent(), self.selection()) else {
            return;
        };
        self.state.borrow_mut().selections.entry(routed.id().0.clone()).or_default().insert(agent.id.0, selection);
    }

    pub fn set(&self, model: &Model, recent: bool) {
        if !self.is_valid(model) || !self.select_model(model) {
            return;
        }
        if recent {
            self.add_recent(model);
        }
        self.notify();
    }

    /// Adds `model` to the recent models when it is listed, without selecting it.
    pub(crate) fn add_recent_valid(&self, model: &Model) {
        if self.is_valid(model) {
            self.add_recent(model);
            self.notify();
        }
    }

    fn add_recent(&self, model: &Model) {
        {
            let mut state = self.state.borrow_mut();
            state.preference.recent = model_pref::recent_models(model, &state.preference.recent);
        }
        let model = model.clone();
        self.write(move |file| file.add_recent(&model));
    }

    pub fn toggle_favorite(&self, model: &Model) {
        if !self.is_valid(model) {
            return;
        }
        // An entry saved for the model at another speed is the same favorite.
        let standard = self.standard_model(model);
        let same: HashSet<String> =
            self.speeds_of(&standard).iter().map(|item| format!("{}/{}", item.provider_id.0, item.id)).collect();
        let same = move |item: &Model| item.key() == standard.key() || same.contains(&item.key());
        let enabled = {
            let mut state = self.state.borrow_mut();
            let enabled = !state.preference.favorite.iter().any(&same);
            state.preference.favorite = model_pref::favorite_models(model, &state.preference.favorite, enabled, &same);
            enabled
        };
        let model = model.clone();
        self.write(move |file| file.set_favorite(&model, enabled, same));
        self.notify();
    }

    pub fn cycle(&self, direction: i64) {
        let Some(current) = self.selection() else { return };
        let recent: Vec<Model> = self.recent().into_iter().filter(|item| self.is_valid(item)).collect();
        let len = recent.len() as i64;
        let standard = self.standard_model(&current.model);
        let next = match recent.iter().position(|item| *item == standard) {
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
        let Some(model) = usize::try_from(next).ok().and_then(|next| recent.get(next)) else { return };
        self.select_model(model);
        self.notify();
    }

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
        let index = self.selection().and_then(|current| {
            let standard = self.standard_model(&current.model);
            favorites.iter().position(|item| *item == standard)
        });
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

    pub fn variants(&self) -> Vec<String> {
        self.selection()
            .and_then(|selection| self.model_info(&selection.model))
            .map(|info| info.variants.into_iter().map(|variant| variant.id).collect())
            .unwrap_or_default()
    }

    pub fn variant(&self) -> Option<String> {
        self.selection().and_then(|selection| selection.variant)
    }

    pub fn set_variant(&self, value: Option<&str>) {
        let Some(current) = self.selection() else { return };
        if let Some(routed) = self.route() {
            self.set_session_draft(
                &routed,
                Selection { variant: model_pref::normalize_variant(value).map(str::to_owned), ..current.clone() },
            );
        }
        // A model's speeds share its variant.
        let model = self.standard_model(&current.model);
        self.state.borrow_mut().preference.variant.insert(model.key(), value.unwrap_or("default").to_owned());
        let value = value.map(str::to_owned);
        self.write(move |file| file.save_variant(&model, value.as_deref()));
        self.notify();
    }

    pub fn cycle_variant(&self) {
        let variants = self.variants();
        if variants.is_empty() {
            return;
        }
        let names: Vec<&str> = variants.iter().map(String::as_str).collect();
        let next = model_pref::cycle_variant(self.variant().as_deref(), &names);
        self.set_variant(next.as_deref());
    }

    /// The current model's speed, `None` at its standard speed.
    pub fn speed(&self) -> Option<String> {
        let current = self.current()?;
        self.models(|models| speed_of(models, &current))
    }

    /// The current model's other speeds.
    pub fn speeds(&self) -> Vec<Speed> {
        let Some(current) = self.current() else { return Vec::new() };
        let standard = self.standard_model(&current);
        // Catalogs from older servers may list a model without prices.
        let price = self.model_info(&standard).and_then(|info| info.cost.first().map(|cost| cost.input));
        let price = price.filter(|price| *price != 0.0);
        self.speeds_of(&standard)
            .into_iter()
            .filter_map(|item| {
                let speed = speed_info(&item)?;
                let input = item.cost.first().map(|cost| cost.input);
                Some(Speed {
                    id: speed.id,
                    faster: speed.faster,
                    price: price.zip(input).map(|(price, input)| input / price),
                })
            })
            .collect()
    }

    /// Switches the current model to its speed `value`, or to its standard speed, and remembers it for the model.
    pub fn set_speed(&self, value: Option<&str>) {
        let Some(current) = self.selection() else { return };
        let standard = self.standard_model(&current.model);
        let target = match value {
            Some(value) => self
                .speeds_of(&standard)
                .into_iter()
                .find(|item| speed_info(item).is_some_and(|speed| speed.id == value))
                .map(|item| item.id),
            None => Some(standard.model_id.clone()),
        };
        let Some(target) = target else { return };
        match value {
            Some(value) => self.state.borrow_mut().preference.speed.insert(standard.key(), value.to_owned()),
            None => self.state.borrow_mut().preference.speed.shift_remove(&standard.key()),
        };
        let (saved, value) = (standard.clone(), value.map(str::to_owned));
        self.write(move |file| file.save_speed(&saved, value.as_deref()));
        if let Some(routed) = self.route() {
            let model = Model::new(&standard.provider_id, target);
            self.set_session_draft(&routed, Selection { model, ..current });
        } else if let Some(agent) = self.agent() {
            // A new session starts on the model, which runs at the speed just saved for it.
            let key = self.location_agent_key(&agent.id.0);
            self.state.borrow_mut().new_session.insert(key, standard);
        }
        self.notify();
    }

    pub fn cycle_speed(&self) {
        let speeds = self.speeds();
        if speeds.is_empty() {
            return;
        }
        let order: Vec<(&str, bool)> = speeds.iter().map(|speed| (speed.id.as_str(), speed.faster)).collect();
        self.set_speed(model_pref::cycle_speed(self.speed().as_deref(), &order).as_deref());
    }
}

fn speed_info(info: &ModelInfo) -> Option<ModelSpeed> {
    info.experimental.as_ref()?.speed.clone()
}

/// `standardModel`: a model that is another listed model served faster or slower ("gpt-5.5-fast") is offered as a
/// speed of that model instead of as an entry of its own. This is the model whose entry stands for it.
pub(crate) fn standard_of(models: &[ModelInfo], model: &Model) -> Model {
    let base = models.iter().find(|item| is(item, model)).and_then(speed_info).map(|speed| speed.base);
    match base.map(|base| Model::new(&model.provider_id, base)) {
        Some(standard) if models.iter().any(|item| is(item, &standard)) => standard,
        _ => model.clone(),
    }
}

/// The speed `model` runs at among `models`, `None` at its standard speed.
pub(crate) fn speed_of(models: &[ModelInfo], model: &Model) -> Option<String> {
    if standard_of(models, model) == *model {
        return None;
    }
    models.iter().find(|item| is(item, model)).and_then(speed_info).map(|speed| speed.id)
}

/// Whether `info` is a speed of another listed model, which lists choose with the speed selector instead.
pub(crate) fn is_speed_in(models: &[ModelInfo], info: &ModelInfo) -> bool {
    speed_info(info)
        .is_some_and(|speed| models.iter().any(|item| item.provider_id == info.provider_id && item.id == speed.base))
}

/// The agents a user picks from: neither subagents nor hidden.
fn listed(data: Option<&LocationData>) -> impl Iterator<Item = &AgentInfo> + Clone {
    let agents = data.and_then(|data| data.agent.as_deref()).unwrap_or_default();
    agents.iter().filter(|agent| !matches!(agent.mode, AgentInfoMode::Subagent) && !agent.hidden)
}

pub(crate) fn is(info: &ModelInfo, model: &Model) -> bool {
    info.provider_id.0 == model.provider_id && info.id == model.model_id
}
