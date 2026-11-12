//! Footer views for requests and panels (`footer.view.tsx`, `footer.permission.tsx`, `footer.form.tsx`,
//! `footer.menu.tsx`, `footer.command.tsx`; row M05).
//!
//! A pending permission or form replaces the composer (`pickBlockerView`): the first permission, else the first
//! form. With the composer showing, `command.palette.show` opens the command menu, which leads to the agent and
//! model panels, and `session.queued_prompts` opens the pending prompts, where Enter toggles steer and queue,
//! `queued_prompt.delete` cancels a prompt, and `queued_prompt.undo` takes it back into the draft.
//!
//! Child sessions (`crate::subagents`) add their permissions and forms after the session's own, and global forms
//! come last. `session.child.first` opens the subagent panel, which leads to the inspector of one child, and
//! `composer.subagent.interrupt` interrupts the inspected one.

pub mod form;
pub mod menu;
pub mod panel;
pub mod permission;
mod scroll;
pub mod subagent;

use opencode_api::generated::{
    FormID, FormInfo, FormListInput, PermissionAskedData, PermissionListInput, PermissionReplyInput, PermissionRequest,
    SessionFormCancelInput, SessionFormListInput, SessionFormReplyInput, SessionGetInput, SessionID,
    SessionInboxListInput, SessionInfo, SessionInterruptInput, SessionListInput, SessionListInputOrder,
    SessionMessageGetInput,
};
use opencode_local::cli_config::Visibility;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::input::KeyEvent;
use opentui::keymap::{Condition, Disposer};

use self::menu::{Item, Tone};
use self::panel::{Entry, Outcome, Panel, Spec};
use crate::prelude::*;
use crate::prompt::status::mono_shortcut;
use crate::prompt::{Delivery, Prompt};
use crate::replay::GLOBAL;
use crate::settings::{Change, Key, MiniSettings};
use crate::subagents::{Discovery, FAMILY_LIMIT, Fetch, Status, Tab, Tracker};
use crate::variants::{ModelSelection, Provider};

/// `PERMISSION_ROWS`.
const PERMISSION_ROWS: u16 = 12;
/// `FORM_ROWS`.
const FORM_ROWS: u16 = 14;
/// `base`: the footer's rows above the composer's one-row textarea at startup (`FOOTER_HEIGHT - 1`).
const BASE: u16 = 3;

type Action = Option<Box<dyn Fn()>>;
type TextAction = Option<Box<dyn Fn(&str)>>;
/// Called once a change was saved or failed.
pub type Done = Box<dyn FnOnce()>;

/// What the footer views ask of mini around them. Each returns at once.
#[derive(Default)]
pub struct Hooks {
    /// The footer's height or contents changed.
    pub layout: Action,
    /// `onStatus`: a notice in the status row.
    pub status: TextAction,
    /// `blockerStatus`: the footer's status while a request waits, empty once none does.
    pub blocker: TextAction,
    /// `footerStatus`: the text "Show status" puts in the status row.
    pub summary: Option<Box<dyn Fn() -> String>>,
    /// `onAgentSelect`: the agent the next prompt uses.
    pub agent: TextAction,
    /// `app.clear` from the command menu.
    pub clear_screen: Action,
    /// `onExit`.
    pub exit: Action,
    /// What the model and variant panels list.
    pub models: Option<Box<dyn Fn() -> Models>>,
    /// `onModelSelect`.
    pub model: Option<Box<dyn Fn(ModelSelection)>>,
    /// `onVariantSelect`.
    pub variant: Option<Box<dyn Fn(Option<String>)>>,
    /// `onCycleVariant`.
    pub cycle_variant: Action,
    /// The current settings, for the settings panel.
    pub settings: Option<Box<dyn Fn() -> MiniSettings>>,
    /// `onMiniSettingChange`: saves a change, then calls the callback.
    pub setting: Option<Box<dyn Fn(Change, Done)>>,
}

/// What the model and variant panels list (`providers`, `currentModel`, `variants`, `currentVariant`).
#[derive(Clone, Debug, Default)]
pub struct Models {
    /// `None` while the catalog loads.
    pub providers: Option<Vec<Provider>>,
    pub current: Option<ModelSelection>,
    pub variants: Vec<String>,
    pub variant: Option<String>,
}

/// The view that replaces the composer (`FooterView`).
#[derive(Clone, Debug, PartialEq)]
enum Shown {
    Prompt,
    Permission(String),
    Form(String),
}

/// The panel open over the composer (`FooterPromptRoute`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Route {
    Command,
    Agent,
    Model,
    Variant,
    Settings,
    Queued,
    /// The subagent panel (`subagent-menu`).
    Subagents,
    /// The inspector of the selected child (`subagent`).
    Inspector,
}

impl Route {
    /// The view name the prompt's keys follow (`promptView`).
    fn view(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::Agent => "agent",
            Self::Model => "model",
            Self::Variant => "variant",
            Self::Settings => "settings",
            Self::Queued => "queued-menu",
            Self::Subagents => "subagent-menu",
            Self::Inspector => "subagent",
        }
    }
}

/// What a panel row does.
#[derive(Clone, Debug, Default, PartialEq)]
enum Pick {
    #[default]
    Nothing,
    Editor,
    Status,
    Slash(&'static str),
    Agents,
    Models,
    Queued,
    VariantCycle,
    Clear,
    Settings,
    Exit,
    Agent(String),
    Pending(String, Delivery),
    Variants,
    Model(ModelSelection),
    Variant(Option<String>),
    Setting(Key),
    Subagents,
    Subagent(String),
}

/// The session the requests belong to.
#[derive(Clone)]
struct Target {
    client: Client,
    session: String,
    directory: String,
}

#[derive(Default)]
struct State {
    route: Option<Route>,
    shown: Option<Shown>,
    permissions: Vec<permission::Request>,
    forms: Vec<FormInfo>,
    /// The children's requests, from the tracker, and the forms of no session at the session's location.
    child_permissions: Vec<permission::Request>,
    child_forms: Vec<FormInfo>,
    global_forms: Vec<FormInfo>,
    tabs: Vec<Tab>,
    /// The inspected child.
    selected: Option<String>,
    /// The subagent panel lists the running children, else the others (`active`).
    running_only: bool,
    inspector: Option<subagent::Inspector>,
    permission: Option<permission::State>,
    /// Answers in progress per form while a permission covers it (`formStates`).
    form_states: HashMap<String, form::State>,
    settled: HashSet<String>,
    panel: Option<Panel<Pick>>,
    terminal: (u16, u16),
    running: bool,
    /// The setting being saved (`saving`).
    saving: Option<Key>,
}

/// The widgets of the request shown, which keys reach into.
#[derive(Default)]
struct Widgets {
    scroll: Option<scroll::Scroller>,
    field: Option<Textarea>,
}

struct Inner {
    app: App,
    prompt: Prompt,
    root: View,
    body: View,
    theme: RefCell<RunTheme>,
    mono: bool,
    home: Option<std::path::PathBuf>,
    target: RefCell<Option<Target>>,
    tracker: RefCell<Option<Tracker>>,
    hooks: RefCell<Rc<Hooks>>,
    state: RefCell<State>,
    widgets: RefCell<Widgets>,
    layers: RefCell<Vec<Disposer>>,
    /// Counts the sessions opened, so a read that ends after another session opened is dropped.
    generation: Cell<u64>,
    /// Permission requests whose tool call is being read, until a reply drops them.
    asking: RefCell<HashSet<String>>,
}

/// A session's pending requests, read by a hydration.
#[derive(Debug, Default)]
pub struct Requests {
    pub permissions: Vec<permission::Request>,
    pub forms: Vec<FormInfo>,
    /// The forms of no session at the session's location.
    pub global_forms: Vec<FormInfo>,
}

/// Lists the session's permissions with their tool calls, its forms, and the forms of no session at `directory`.
pub async fn requests(client: &Client, session: &str, directory: &str) -> Requests {
    let input = FormListInput { location: Some(LocationQueryInput { directory: Some(directory.to_owned()) }) };
    let (permissions, forms, globals) = futures_util::future::join3(
        client.permission_list(&PermissionListInput { session_id: SessionID(session.to_owned()) }),
        client.session_form_list(&SessionFormListInput { session_id: session.to_owned() }),
        client.form_list(&input),
    )
    .await;
    let mut requests = Vec::new();
    for request in permissions.unwrap_or_default() {
        requests.push(source(client, session, request).await);
    }
    Requests {
        permissions: requests,
        forms: forms.unwrap_or_default(),
        global_forms: globals
            .map(|list| list.data)
            .unwrap_or_default()
            .into_iter()
            .filter(|form| form.session_id == GLOBAL)
            .collect(),
    }
}

/// The footer views. Cloning is cheap.
#[derive(Clone)]
pub struct Footers(Rc<Inner>);

impl Footers {
    pub fn new(app: &App, prompt: &Prompt, theme: &RunTheme, mono: bool) -> Self {
        let body = View::new(app).column().width(Length::percent(100.0)).grow(1.0).basis(Length::Auto).min_height(0);
        let root = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .visible(false)
            // The blank row above a panel or a request.
            .child(&View::new(app).height(1).shrink(0.0))
            .child(&body);
        let inner = Rc::new(Inner {
            app: app.clone(),
            prompt: prompt.clone(),
            root,
            body,
            theme: RefCell::new(theme.clone()),
            mono,
            home: std::env::home_dir(),
            target: RefCell::default(),
            tracker: RefCell::default(),
            hooks: RefCell::default(),
            state: RefCell::new(State {
                terminal: opentui::term::size().unwrap_or((app.size().0, 24)),
                ..State::default()
            }),
            widgets: RefCell::default(),
            layers: RefCell::default(),
            generation: Cell::new(0),
            asking: RefCell::default(),
        });
        install_layers(&inner);
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn set_hooks(&self, hooks: Hooks) {
        *self.0.hooks.borrow_mut() = Rc::new(hooks);
    }

    pub fn set_theme(&self, theme: &RunTheme) {
        *self.0.theme.borrow_mut() = theme.clone();
        self.0.paint();
    }

    /// `state.phase === "running"`, for "Show status".
    pub fn set_running(&self, running: bool) {
        self.0.state.borrow_mut().running = running;
    }

    /// Whether a view replaces the composer and the status row.
    pub fn active(&self) -> bool {
        self.0.active()
    }

    /// The footer's height at this terminal size while a view shows (`applyHeight`), else `None`.
    pub fn height(&self, terminal: (u16, u16)) -> Option<u16> {
        let resized = {
            let mut state = self.0.state.borrow_mut();
            std::mem::replace(&mut state.terminal, terminal) != terminal
        };
        if resized && self.0.active() {
            self.0.paint();
        }
        let rows = terminal.1;
        let state = self.0.state.borrow();
        let desired = match (&state.shown, state.route) {
            (Some(Shown::Permission(_)), _) => BASE + PERMISSION_ROWS,
            (Some(Shown::Form(_)), _) => BASE + FORM_ROWS,
            (_, Some(Route::Queued | Route::Subagents)) => {
                1 + state.panel.as_ref().map_or(0, |panel| panel.rows(rows)) as u16
            }
            (_, Some(Route::Inspector)) => BASE + subagent::INSPECTOR_ROWS,
            (_, Some(Route::Command | Route::Agent | Route::Model | Route::Variant | Route::Settings)) => {
                let layout = panel::layout(rows, panel::LIST_ROWS);
                1 + (layout.frame + layout.limit) as u16
            }
            _ => return None,
        };
        Some(desired.min(rows).max(1))
    }

    /// Opens a session: forgets the last one's requests and children. Its requests arrive with the stream's
    /// hydration ([`Self::hydrated`]). `thinking` shows the children's reasoning. Reads still in flight for the
    /// last session are dropped when they end.
    pub fn open(&self, client: &Client, session: &str, directory: &str, thinking: bool) {
        self.0.generation.set(self.0.generation.get() + 1);
        *self.0.target.borrow_mut() =
            Some(Target { client: client.clone(), session: session.to_owned(), directory: directory.to_owned() });
        *self.0.tracker.borrow_mut() = Some(Tracker::new(session, thinking, Some(directory.to_owned())));
        self.0.asking.borrow_mut().clear();
        {
            let mut state = self.0.state.borrow_mut();
            state.permissions.clear();
            state.forms.clear();
            state.child_permissions.clear();
            state.child_forms.clear();
            state.global_forms.clear();
            state.tabs.clear();
            state.form_states.clear();
            state.settled.clear();
        }
        if matches!(self.0.state.borrow().route, Some(Route::Subagents | Route::Inspector)) {
            self.0.close_route();
        }
        self.0.sync();
    }

    /// Shows or hides the reasoning the children send from now on (`/settings`).
    pub fn set_thinking(&self, thinking: bool) {
        if let Some(tracker) = self.0.tracker.borrow_mut().as_mut() {
            tracker.set_thinking(thinking);
        }
    }

    /// The session's pending requests and the forms of no session at its location, as a hydration listed them
    /// after the stream subscribed (connect, reconnect, and resize). They replace what was known; the events that
    /// followed the subscription apply after them (`hydrate`).
    pub fn hydrated(&self, requests: Requests) {
        {
            let mut state = self.0.state.borrow_mut();
            state.permissions = requests.permissions;
            state.forms = requests.forms;
            state.global_forms = requests.global_forms;
        }
        self.0.sync();
    }

    /// `blockerStatus`: the status of the request shown, if any.
    pub fn blocker_status(&self) -> &'static str {
        match self.0.state.borrow().shown {
            Some(Shown::Permission(_)) => "awaiting permission",
            Some(Shown::Form(_)) => "awaiting form",
            _ => "",
        }
    }

    /// A permission or form event of the session, or a form event of no session.
    pub fn event(&self, event: &V2Event) {
        let inner = &self.0;
        if self.global_event(event) {
            return;
        }
        match event {
            V2Event::PermissionAsked(event) => {
                let request = asked(&event.data);
                if inner.state.borrow().permissions.iter().any(|item| item.info.id == request.id) {
                    return;
                }
                let Some(target) = inner.target.borrow().clone() else { return };
                // A reply or another session that comes while the tool call is read drops the request.
                inner.asking.borrow_mut().insert(request.id.as_str().to_owned());
                let generation = inner.generation.get();
                inner.app.spawn(
                    async move { source(&target.client, &target.session, request).await },
                    bind!(inner, |inner, _, request| {
                        if inner.generation.get() != generation
                            || !inner.asking.borrow_mut().remove(request.info.id.as_str())
                        {
                            return;
                        }
                        {
                            let mut state = inner.state.borrow_mut();
                            if state.permissions.iter().any(|item| item.info.id == request.info.id) {
                                return;
                            }
                            state.permissions.push(request);
                        }
                        inner.sync();
                    }),
                );
            }
            V2Event::PermissionReplied(replied) => {
                let id = &replied.data.request_id;
                inner.asking.borrow_mut().remove(id.as_str());
                inner.state.borrow_mut().permissions.retain(|item| &item.info.id != id);
                inner.sync();
            }
            V2Event::FormCreated(created) => {
                let form = created.data.form.clone();
                {
                    let mut state = inner.state.borrow_mut();
                    if state.forms.iter().any(|item| item.id == form.id) {
                        return;
                    }
                    state.forms.push(form);
                }
                inner.sync();
            }
            V2Event::FormReplied(replied) => self.form_done(&replied.data.id),
            V2Event::FormCancelled(cancelled) => self.form_done(&cancelled.data.id),
            _ => {}
        }
    }
}

impl Footers {
    fn form_done(&self, id: &FormID) {
        self.0.state.borrow_mut().forms.retain(|item| &item.id != id);
        self.0.sync();
    }

    /// A form of no session at the session's location (`sameLocation`).
    fn global_event(&self, event: &V2Event) -> bool {
        let directory = self.0.target.borrow().as_ref().map(|target| target.directory.clone());
        let here = |location: &Option<opencode_api::generated::LocationRef>| {
            location.as_ref().is_some_and(|location| Some(&location.directory.0) == directory.as_ref())
        };
        let mut state = self.0.state.borrow_mut();
        match event {
            V2Event::FormCreated(created) if created.data.form.session_id == GLOBAL => {
                let form = &created.data.form;
                if !here(&created.location) || state.global_forms.iter().any(|item| item.id == form.id) {
                    return true;
                }
                state.global_forms.push(form.clone());
            }
            V2Event::FormReplied(replied) if replied.data.session_id == GLOBAL => {
                if !here(&replied.location) {
                    return true;
                }
                state.global_forms.retain(|item| item.id != replied.data.id);
            }
            V2Event::FormCancelled(cancelled) if cancelled.data.session_id == GLOBAL => {
                if !here(&cancelled.location) {
                    return true;
                }
                state.global_forms.retain(|item| item.id != cancelled.data.id);
            }
            _ => return false,
        }
        drop(state);
        self.0.sync();
        true
    }

    /// An event for the subagent tracker: another session's event, or a tool event of this one.
    pub fn subagent_event(&self, event: &V2Event) {
        let fetches = {
            let mut tracker = self.0.tracker.borrow_mut();
            let Some(tracker) = tracker.as_mut() else { return };
            if crate::replay::session_of(event) == Some(tracker.parent()) {
                tracker.main(event)
            } else {
                tracker.foreign(event)
            }
        };
        self.0.run(fetches);
        self.0.subagents_changed();
    }

    /// The session's messages were listed (again, with `reconnect`): the children follow.
    pub fn subagent_hydrate(&self, messages: &[SessionMessageInfo], active: &[String], reconnect: bool) {
        let fetches = {
            let mut tracker = self.0.tracker.borrow_mut();
            let Some(tracker) = tracker.as_mut() else { return };
            tracker.hydrate(messages, active, reconnect)
        };
        self.0.run(fetches);
        self.0.subagents_changed();
    }

    /// The running children.
    pub fn running_subagents(&self) -> usize {
        self.0.running()
    }
}

/// A `permission.asked` event's request.
pub(crate) fn asked(data: &PermissionAskedData) -> PermissionRequest {
    let data = data.clone();
    PermissionRequest {
        id: data.id,
        session_id: data.session_id,
        action: data.action,
        resources: data.resources,
        save: data.save,
        metadata: data.metadata,
        source: data.source,
        message: data.message,
    }
}

/// `resolvePermissionSources`: the request with its tool call's input and metadata, read from its message.
async fn source(client: &Client, session: &str, info: PermissionRequest) -> permission::Request {
    let mut request = permission::Request { info, input: Value::Null, metadata: Value::Null };
    let Some(source) = request.info.source.clone().filter(|source| source.r#type == "tool") else { return request };
    let input = SessionMessageGetInput {
        session_id: SessionID(session.to_owned()),
        message_id: source.message_id.as_str().into(),
    };
    let Ok(call) = Client::session_message_get_call(&input) else { return request };
    let Ok(message) = client.json::<Value>(call).await else { return request };
    let message = message.get("data").unwrap_or(&message);
    if message["type"] != "assistant" {
        return request;
    }
    let tool = message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|item| item["type"] == "tool" && item["id"] == source.id.as_str());
    if let Some(state) = tool.map(|tool| &tool["state"]).filter(|state| state["status"] != "streaming") {
        request.input = state["input"].clone();
        request.metadata = state["metadata"].clone();
    }
    request
}

impl Inner {
    /// Runs the tracker's reads; each result goes back to it.
    fn run(self: &Rc<Self>, fetches: Vec<Fetch>) {
        let Some(target) = self.target.borrow().clone() else { return };
        let generation = self.generation.get();
        for fetch in fetches {
            let client = target.client.clone();
            match fetch {
                Fetch::Family => {
                    let parent = target.session.clone();
                    self.app.spawn(
                        async move { family(&client, &parent).await },
                        bind!(self, |inner, _, sessions| {
                            inner.tracked(generation, |tracker: &mut Tracker| tracker.family(sessions));
                        }),
                    );
                }
                Fetch::Discover { session, family } => {
                    let id = session.clone();
                    self.app.spawn(
                        async move { lineage(&client, &id, &family).await },
                        bind!(self, |inner, _, discovery| {
                            inner.tracked(generation, |tracker: &mut Tracker| tracker.discovered(&session, discovery));
                        }),
                    );
                }
                Fetch::Child(session) => {
                    let id = session.clone();
                    self.app.spawn(
                        async move {
                            let input = SessionInboxListInput { session_id: SessionID(id.clone()) };
                            let (messages, inbox) = futures_util::future::join(
                                crate::replay::messages(&client, &id, crate::subagents::CHILD_MESSAGE_LIMIT),
                                client.session_inbox_list(&input),
                            )
                            .await;
                            Ok::<_, String>((messages?, inbox.map_err(|error| error.to_string())?))
                        },
                        bind!(self, |inner, _, result| {
                            inner.tracked(generation, |tracker: &mut Tracker| tracker.child_loaded(&session, result));
                        }),
                    );
                }
                Fetch::Blockers { session, epoch, delay } => {
                    if !delay.is_zero() {
                        self.app.set_timeout(
                            delay,
                            bind!(self, |inner, _| {
                                if inner.generation.get() != generation {
                                    return;
                                }
                                let due =
                                    inner.tracker.borrow_mut().as_mut().is_some_and(|t| t.retry_due(&session, epoch));
                                if due {
                                    inner.run(vec![Fetch::Blockers {
                                        session: session.clone(),
                                        epoch,
                                        delay: Duration::ZERO,
                                    }]);
                                }
                            }),
                        );
                        continue;
                    }
                    let id = session.clone();
                    self.app.spawn(
                        async move {
                            let (permissions, forms) = futures_util::future::join(
                                client.permission_list(&PermissionListInput { session_id: SessionID(id.clone()) }),
                                client.session_form_list(&SessionFormListInput { session_id: id.clone() }),
                            )
                            .await;
                            let permissions = match permissions {
                                Ok(list) => {
                                    let mut requests = Vec::new();
                                    for request in list {
                                        requests.push(source(&client, &id, request).await);
                                    }
                                    Ok(requests)
                                }
                                Err(error) => Err(error.to_string()),
                            };
                            (permissions, forms.map_err(|error| error.to_string()))
                        },
                        bind!(self, |inner, _, (permissions, forms)| {
                            inner.tracked(generation, |tracker: &mut Tracker| {
                                tracker.blockers_loaded(&session, epoch, permissions, forms)
                            });
                        }),
                    );
                }
            }
        }
    }

    /// Hands a read's result to the tracker, then runs what it reads next. A read started for another session is
    /// dropped.
    fn tracked(self: &Rc<Self>, generation: u64, apply: impl FnOnce(&mut Tracker) -> Vec<Fetch>) {
        if self.generation.get() != generation {
            return;
        }
        let fetches = {
            let mut tracker = self.tracker.borrow_mut();
            let Some(tracker) = tracker.as_mut() else { return };
            apply(tracker)
        };
        self.run(fetches);
        self.subagents_changed();
    }

    /// The tracker may have changed: the requests, the tabs, and the open subagent views follow.
    fn subagents_changed(self: &Rc<Self>) {
        let (changed, detail) = {
            let mut tracker = self.tracker.borrow_mut();
            let Some(tracker) = tracker.as_mut() else { return };
            let changed = tracker.take_changed();
            let detail = tracker.take_detail();
            if changed {
                let mut state = self.state.borrow_mut();
                state.child_permissions = tracker.permissions();
                state.child_forms = tracker.forms();
                state.tabs = tracker.tabs();
            }
            (changed, detail)
        };
        if !changed && !detail {
            return;
        }
        if changed {
            self.sync();
        }
        let (route, selected, empty) = {
            let state = self.state.borrow();
            let selected = state.selected.as_ref().is_some_and(|id| state.tabs.iter().any(|tab| tab.session_id == *id));
            (state.route, selected, state.tabs.is_empty())
        };
        match route {
            Some(Route::Inspector) if !selected => return self.close_route(),
            Some(Route::Subagents) if empty => return self.close_route(),
            Some(Route::Inspector | Route::Subagents | Route::Command) if self.shows_route() => self.paint(),
            _ => {}
        }
        if changed {
            self.layout();
        }
    }

    /// Whether the open route shows, rather than a request over it.
    fn shows_route(&self) -> bool {
        matches!(self.state.borrow().shown, None | Some(Shown::Prompt))
    }

    /// `openSubagentMenu`.
    fn open_subagents(self: &Rc<Self>) {
        if self.state.borrow().tabs.is_empty() {
            return;
        }
        self.state.borrow_mut().running_only = true;
        self.open_route(Route::Subagents);
    }

    /// `openTab`: the inspector of `session`.
    fn open_tab(self: &Rc<Self>, session: &str) {
        let inspector = subagent::Inspector::new(&self.app);
        {
            let mut state = self.state.borrow_mut();
            state.route = Some(Route::Inspector);
            state.panel = None;
            state.selected = Some(session.to_owned());
            state.inspector = Some(inspector);
        }
        let fetches = self.tracker.borrow_mut().as_mut().map(|tracker| tracker.select(Some(session)));
        self.run(fetches.unwrap_or_default());
        self.show();
        self.subagents_changed();
    }

    /// `cycleTab`: the next tab's inspector.
    fn cycle_tab(self: &Rc<Self>) {
        let next = {
            let state = self.state.borrow();
            let current = state.tabs.iter().position(|tab| Some(&tab.session_id) == state.selected.as_ref());
            let index = current.map_or(0, |index| (index + 1) % state.tabs.len().max(1));
            state.tabs.get(index).map(|tab| tab.session_id.clone())
        };
        if let Some(next) = next {
            self.open_tab(&next);
        }
    }

    /// Forgets the inspected child (`onSubagentSelect(undefined)`).
    fn unselect(self: &Rc<Self>) {
        let selected = {
            let mut state = self.state.borrow_mut();
            state.inspector = None;
            state.selected.take()
        };
        if selected.is_some() {
            let fetches = self.tracker.borrow_mut().as_mut().map(|tracker| tracker.select(None));
            self.run(fetches.unwrap_or_default());
        }
    }

    fn selected_tab(&self) -> Option<Tab> {
        let state = self.state.borrow();
        state.tabs.iter().find(|tab| Some(&tab.session_id) == state.selected.as_ref()).cloned()
    }

    /// The inspector's keys (`useKeyboard` in `RunFooterSubagentBody`).
    fn inspector_key(self: &Rc<Self>, name: &str) -> bool {
        if !self.shows_route() {
            return false;
        }
        match name {
            "escape" => self.close_route(),
            "tab" => self.cycle_tab(),
            "up" | "k" | "down" | "j" | "pageup" | "pagedown" => {
                if let Some(inspector) = self.state.borrow().inspector.as_ref() {
                    inspector.scroll(matches!(name, "down" | "j" | "pagedown"), name.starts_with("page"));
                }
                self.app.request_redraw();
            }
            _ => return false,
        }
        true
    }

    /// Tab in the subagent panel shows the inactive children, or the running ones again.
    fn subagents_key(self: &Rc<Self>, _: &str) -> bool {
        {
            let mut state = self.state.borrow_mut();
            state.running_only = !state.running_only;
        }
        self.paint();
        self.layout();
        true
    }

    /// `onSubagentInterrupt`.
    fn interrupt_subagent(self: &Rc<Self>) {
        let (Some(tab), Some(target)) = (self.selected_tab(), self.target.borrow().clone()) else { return };
        if tab.status != Status::Running {
            return;
        }
        let input = SessionInterruptInput { session_id: SessionID(tab.session_id), resume: None };
        self.app.spawn(async move { target.client.session_interrupt(&input).await }, |_, result| {
            if let Err(error) = result {
                log::warn!("mini subagent interrupt failed: {error}");
            }
        });
    }

    fn paint_inspector(&self, width: u16, rows: u16) {
        let run = self.theme.borrow().clone();
        let keymap = self.prompt.keymap().clone();
        let interrupt = keymap
            .shortcut("composer.subagent.interrupt")
            .filter(|key| !key.is_empty())
            .map(|key| mono_shortcut(&key, self.mono));
        let shell_output = self
            .hooks()
            .settings
            .as_ref()
            .is_none_or(|settings| settings().shell_output == opencode_local::cli_config::Visibility::Show);
        let tracker = self.tracker.borrow();
        let mut state = self.state.borrow_mut();
        let state = &mut *state;
        let Some(inspector) = state.inspector.as_mut() else { return };
        let selected = state.selected.clone().unwrap_or_default();
        let commits = tracker.as_ref().and_then(|tracker| tracker.detail(&selected));
        let index = state.tabs.iter().position(|tab| tab.session_id == selected).map_or(0, |index| index + 1);
        self.body.clear();
        self.body.add(inspector.root());
        inspector.paint(
            &self.app,
            &subagent::Body {
                tab: state.tabs.iter().find(|tab| tab.session_id == selected),
                index,
                total: state.tabs.len(),
                commits: commits.as_deref(),
                interrupt,
                shell_output,
                theme: &run,
                mono: self.mono,
                width: width.saturating_sub(1),
                height: rows.saturating_sub(1),
            },
        );
    }

    fn hooks(&self) -> Rc<Hooks> {
        self.hooks.borrow().clone()
    }

    fn notice(&self, text: &str) {
        if let Some(status) = &self.hooks().status {
            status(text);
        }
    }

    fn layout(&self) {
        if let Some(layout) = &self.hooks().layout {
            layout();
        }
    }

    fn active(&self) -> bool {
        let state = self.state.borrow();
        !matches!(state.shown, None | Some(Shown::Prompt)) || state.route.is_some()
    }

    fn terminal(&self) -> (u16, u16) {
        self.state.borrow().terminal
    }

    /// The footer's rows; the views lay out against them.
    fn rows(&self) -> u16 {
        let terminal = self.terminal();
        match &self.state.borrow().shown {
            Some(Shown::Permission(_)) => (BASE + PERMISSION_ROWS).min(terminal.1),
            Some(Shown::Form(_)) => (BASE + FORM_ROWS).min(terminal.1),
            _ if self.state.borrow().route == Some(Route::Inspector) => {
                (BASE + subagent::INSPECTOR_ROWS).min(terminal.1)
            }
            _ => terminal.1,
        }
    }

    /// `syncBlockers`: the first permission, else the first form, else the composer.
    fn sync(self: &Rc<Self>) {
        let (next, changed) = {
            let mut state = self.state.borrow_mut();
            let next = state
                .permissions
                .first()
                .or_else(|| state.child_permissions.first())
                .map(|request| Shown::Permission(request.info.id.0.clone()))
                .or_else(|| {
                    let form = state.forms.first().or_else(|| state.child_forms.first());
                    form.or_else(|| state.global_forms.first()).map(|form| Shown::Form(form.id.0.clone()))
                })
                .unwrap_or(Shown::Prompt);
            let changed = state.shown.as_ref() != Some(&next);
            if changed {
                if let Shown::Permission(id) = &next {
                    state.permission = Some(permission::State::new(id));
                }
                if next == Shown::Prompt {
                    state.form_states.clear();
                    state.settled.clear();
                }
                // A request closes a panel; the inspector comes back once the requests are answered.
                if next != Shown::Prompt && state.route != Some(Route::Inspector) {
                    state.route = None;
                    state.panel = None;
                }
                state.shown = Some(next.clone());
            }
            (next, changed)
        };
        if !changed {
            return;
        }
        if let Some(blocker) = &self.hooks().blocker {
            blocker(match next {
                Shown::Permission(_) => "awaiting permission",
                Shown::Form(_) => "awaiting form",
                Shown::Prompt => "",
            });
        }
        self.show();
    }

    /// Switches between the composer and a view, then draws it.
    fn show(self: &Rc<Self>) {
        let active = self.active();
        let view = {
            let state = self.state.borrow();
            match (&state.shown, state.route) {
                (Some(Shown::Permission(_)), _) => "permission",
                (Some(Shown::Form(_)), _) => "form",
                (_, Some(route)) => route.view(),
                _ => "prompt",
            }
        };
        self.root.visible(active);
        self.prompt.root().visible(!active);
        if active {
            self.prompt.menu_root().visible(false);
            self.app.blur();
        }
        self.prompt.set_view(view);
        self.paint();
        self.layout();
    }

    fn paint(self: &Rc<Self>) {
        let (width, _) = self.terminal();
        let rows = self.rows();
        let run = self.theme.borrow().clone();
        let theme = run.footer.clone();
        let mut widgets = Widgets::default();
        // The form body pads the shared view; the other views do not.
        for edge in [Edge::Left, Edge::Right, Edge::Top, Edge::Bottom] {
            self.body.padding_edge(edge, 0);
        }
        let shown = self.state.borrow().shown.clone();
        match shown {
            Some(Shown::Permission(id)) => {
                let state = self.state.borrow();
                let (Some(request), Some(current)) = (find_permission(&state, &id), state.permission.as_ref()) else {
                    return;
                };
                let directory = self.target.borrow().as_ref().map(|target| target.directory.clone());
                let cwd = std::env::current_dir().unwrap_or_default();
                let home = self.home.clone();
                let format =
                    move |path: &str| opencode_ui::path::format(path, directory.as_deref(), &cwd, home.as_deref());
                let info = permission::info(request, &format, self.mono);
                let painted = permission::paint(
                    &self.app,
                    &self.body,
                    &permission::Body {
                        request,
                        state: current,
                        info: &info,
                        theme: &theme,
                        run: &run,
                        mono: self.mono,
                        width,
                        height: rows.saturating_sub(1),
                    },
                );
                widgets.scroll = painted.scroll;
                widgets.field = painted.field;
            }
            Some(Shown::Form(id)) => {
                let mut state = self.state.borrow_mut();
                let Some(info) = find_form(&state, &id).cloned() else { return };
                let current = state.form_states.entry(id.clone()).or_insert_with(|| form::State::new(&info)).clone();
                drop(state);
                let painted = form::paint(
                    &self.app,
                    &self.body,
                    &form::Body {
                        form: &info,
                        state: &current,
                        theme: &theme,
                        mono: self.mono,
                        width,
                        height: rows.saturating_sub(1),
                    },
                );
                widgets.scroll = Some(painted.scroll);
                widgets.field = painted.field;
            }
            _ => {
                let route = self.state.borrow().route;
                match route {
                    Some(Route::Inspector) => self.paint_inspector(width, rows),
                    Some(_) => self.paint_panel(width, rows, &theme),
                    None => {}
                }
            }
        }
        if let Some(field) = &widgets.field {
            field.on_change(bind!(self, |inner, _, text| inner.field_changed(text)));
        }
        let focus = widgets.field.clone();
        *self.widgets.borrow_mut() = widgets;
        if let Some(field) = focus {
            field.focus();
        }
        self.app.request_redraw();
    }

    /// Typing in the reject field or a form's answer field keeps the draft (`onContentChange`).
    fn field_changed(&self, text: &str) {
        let mut state = self.state.borrow_mut();
        match state.shown.clone() {
            Some(Shown::Permission(_)) => {
                if let Some(current) = state.permission.as_mut() {
                    current.message = text.to_owned();
                }
            }
            Some(Shown::Form(id)) => {
                let field =
                    find_form(&state, &id).and_then(|form| form.fields.get(state.form_states.get(&id)?.field).cloned());
                if let Some(current) = state.form_states.get_mut(&id) {
                    current.set_draft(field.as_ref(), text);
                }
            }
            _ => {}
        }
    }

    // -----------------------------------------------------------------------------------------------------------
    // Panels
    // -----------------------------------------------------------------------------------------------------------

    /// `openRoute`: a panel over the composer.
    fn open_route(self: &Rc<Self>, route: Route) {
        let spec = match route {
            Route::Command => Spec {
                title: "Commands",
                count: false,
                empty: "No results found",
                rows: panel::LIST_ROWS,
                fixed: true,
                grouped: true,
                background: true,
                close_on_first_up: false,
            },
            Route::Agent => Spec {
                title: "Select agent",
                count: true,
                empty: "No agents found",
                rows: panel::LIST_ROWS,
                fixed: true,
                grouped: false,
                background: true,
                close_on_first_up: false,
            },
            Route::Variant => Spec {
                title: "Select variant",
                count: true,
                empty: "No results found",
                rows: panel::LIST_ROWS,
                fixed: true,
                grouped: false,
                background: true,
                close_on_first_up: false,
            },
            Route::Settings => Spec {
                title: "Settings",
                count: false,
                empty: "No settings found",
                rows: panel::LIST_ROWS,
                fixed: true,
                grouped: true,
                background: true,
                close_on_first_up: false,
            },
            Route::Model => Spec {
                title: "Select model",
                count: true,
                empty: "Models loading",
                rows: panel::LIST_ROWS,
                fixed: true,
                grouped: true,
                background: false,
                close_on_first_up: false,
            },
            Route::Inspector => return,
            Route::Subagents => Spec {
                title: "Select subagent",
                count: true,
                empty: "No subagents found",
                rows: panel::SUBAGENT_LIST_ROWS,
                fixed: false,
                grouped: false,
                background: true,
                close_on_first_up: true,
            },
            Route::Queued => Spec {
                title: "Pending prompts",
                count: true,
                empty: "No pending prompts",
                rows: panel::SUBAGENT_LIST_ROWS,
                fixed: false,
                grouped: false,
                background: true,
                close_on_first_up: false,
            },
        };
        let panel = Panel::new(&self.app, spec);
        panel.input().on_change(bind!(self, |inner, _, text| {
            let rows = inner.terminal().1;
            if let Some(panel) = inner.state.borrow_mut().panel.as_mut() {
                panel.set_query(text.to_owned(), rows);
            }
            inner.paint();
            inner.layout();
        }));
        self.unselect();
        self.body.clear();
        self.body.add(panel.root());
        {
            let mut state = self.state.borrow_mut();
            state.route = Some(route);
            state.panel = Some(panel);
        }
        self.refresh_panel(true);
        self.show();
        if let Some(panel) = self.state.borrow().panel.as_ref() {
            panel.input().focus();
        }
    }

    /// `closePanel`.
    fn close_route(self: &Rc<Self>) {
        {
            let mut state = self.state.borrow_mut();
            if state.route.is_none() {
                return;
            }
            state.route = None;
            state.panel = None;
        }
        self.unselect();
        self.body.clear();
        self.show();
    }

    /// Rebuilds the open panel's entries from the current state (the panels' `entries` memos).
    fn refresh_panel(&self, opening: bool) {
        let route = self.state.borrow().route;
        let Some(route) = route else { return };
        let keymap = self.prompt.keymap().clone();
        let shortcut =
            |id: &str| keymap.shortcut(id).filter(|key| !key.is_empty()).map(|key| mono_shortcut(&key, self.mono));
        let queued = self.prompt.queued();
        let tabs = self.state.borrow().tabs.clone();
        let entries: Vec<Entry<Pick>> = match route {
            Route::Inspector => return,
            Route::Subagents => {
                let (running_only, selected) = {
                    let state = self.state.borrow();
                    (state.running_only, state.selected.clone())
                };
                subagent_entries(&tabs, running_only, selected.as_deref())
            }
            Route::Command => command_entries(
                &tabs,
                queued.iter().map(|item| item.prompt.text.as_str()).collect(),
                keymap.shortcut_all("variant.cycle").map(|key| mono_shortcut(&key, self.mono)),
                shortcut("app.clear"),
                &self.models().variants,
            ),
            Route::Variant => {
                let models = self.models();
                let current = models.variant.clone();
                std::iter::once(None)
                    .chain(models.variants.iter().cloned().map(Some))
                    .map(|variant| {
                        let selected = current == variant;
                        let display = variant.clone().unwrap_or_else(|| "Default".to_owned());
                        Entry {
                            keywords: variant.clone().unwrap_or_else(|| "default".to_owned()),
                            item: Item {
                                display,
                                footer: selected.then(|| "current".to_owned()),
                                tone: Some(Tone::Selection),
                                current: selected,
                                ..Item::default()
                            },
                            action: Pick::Variant(variant),
                        }
                    })
                    .collect()
            }
            Route::Model => model_entries(&self.models(), self.query()),
            Route::Settings => {
                let settings = self.hooks().settings.as_ref().map(|settings| settings());
                let saving = self.state.borrow().saving;
                settings.map(|settings| setting_entries(&settings, saving)).unwrap_or_default()
            }
            Route::Agent => {
                let label = self.prompt.agent_id();
                let current = (!label.is_empty()).then_some(label);
                self.prompt
                    .agents()
                    .into_iter()
                    .filter(|agent| agent.mode != "subagent" && !agent.hidden)
                    .map(|agent| {
                        let current = current.as_deref() == Some(agent.id.as_str());
                        Entry {
                            keywords: format!(
                                "{} {} {}",
                                agent.id,
                                agent.name,
                                agent.description.clone().unwrap_or_default()
                            ),
                            item: Item {
                                display: agent.id.clone(),
                                description: agent.description.clone(),
                                footer: current.then(|| "current".to_owned()),
                                tone: Some(Tone::Selection),
                                current,
                                ..Item::default()
                            },
                            action: Pick::Agent(agent.id),
                        }
                    })
                    .collect()
            }
            Route::Queued => queued
                .iter()
                .map(|item| Entry {
                    keywords: item.prompt.text.clone(),
                    item: Item {
                        display: item.prompt.text.replace('\n', " "),
                        footer: Some(if item.delivery == Delivery::Queue { "queued" } else { "steering" }.to_owned()),
                        ..Item::default()
                    },
                    action: Pick::Pending(item.id.clone(), item.delivery),
                })
                .collect(),
        };
        // The keymap's conditions read the state, so the shortcuts come first.
        let delete = shortcut("queued_prompt.delete");
        let undo = shortcut("queued_prompt.undo");
        let rows = self.terminal().1;
        let running_only = self.state.borrow().running_only;
        let mut state = self.state.borrow_mut();
        let Some(panel) = state.panel.as_mut() else { return };
        if route == Route::Model {
            panel.spec.empty = if self.models().providers.is_none() { "Models loading" } else { "No results found" };
        }
        if route == Route::Settings {
            panel.hint = Some("left/right change".to_owned());
        }
        if route == Route::Subagents {
            let shown = if running_only { "inactive" } else { "active" };
            panel.hint = Some(format!("tab show {shown}"));
        }
        panel.set_entries(entries, rows);
        if opening {
            panel.reveal_current(rows);
        }
        if route == Route::Queued {
            let separator = if self.mono { " - " } else { " · " };
            let enter = match panel.selected().map(|entry| &entry.action) {
                Some(Pick::Pending(_, Delivery::Steer)) => "enter queue",
                _ => "enter steer",
            };
            let hint = [
                Some(enter.to_owned()),
                delete.map(|key| format!("{key} delete")),
                undo.map(|key| format!("{key} undo")),
            ];
            panel.hint = Some(hint.into_iter().flatten().collect::<Vec<_>>().join(separator));
        }
    }

    fn paint_panel(&self, width: u16, rows: u16, theme: &crate::theme::FooterTheme) {
        self.refresh_panel(false);
        let mut state = self.state.borrow_mut();
        if let Some(panel) = state.panel.as_mut() {
            panel.paint(&self.app, width, rows, theme, self.mono);
        }
    }

    /// A key while a panel is open.
    fn panel_key(self: &Rc<Self>, name: &str) -> bool {
        let rows = self.terminal().1;
        let outcome = {
            let mut state = self.state.borrow_mut();
            let Some(panel) = state.panel.as_mut() else { return false };
            let Some(outcome) = panel.key(name, rows) else { return false };
            match outcome {
                Outcome::Select(index) => Some(panel.entries()[index].action.clone()),
                Outcome::Close => None,
                Outcome::Handled => Some(Pick::Nothing),
            }
        };
        match outcome {
            None => self.close_route(),
            Some(Pick::Nothing) => {
                self.paint();
                self.layout();
            }
            Some(pick) => self.pick(pick),
        }
        true
    }

    /// Enter on a panel row (`pick` and the panels' `onSelect`).
    fn pick(self: &Rc<Self>, pick: Pick) {
        let hooks = self.hooks();
        match pick {
            Pick::Nothing => {}
            Pick::Editor => {
                self.close_route();
                self.prompt.open_editor();
            }
            Pick::Status => {
                if let Some(summary) = &hooks.summary {
                    self.notice(&summary());
                }
                self.close_route();
            }
            Pick::Slash(name) => {
                self.close_route();
                self.prompt.submit_text(&format!("/{name}"));
            }
            Pick::Agents => self.open_route(Route::Agent),
            Pick::Models => self.open_route(Route::Model),
            Pick::Variants => self.open_route(Route::Variant),
            Pick::Model(model) => {
                if let Some(select) = &hooks.model {
                    select(model);
                }
                self.close_route();
            }
            Pick::Variant(variant) => {
                if let Some(select) = &hooks.variant {
                    select(variant);
                }
                self.close_route();
            }
            Pick::Setting(key) => self.change_setting(key, true),
            Pick::Queued => self.open_queued(),
            Pick::VariantCycle => {
                self.cycle_variant();
                self.close_route();
            }
            Pick::Clear => {
                self.close_route();
                if let Some(clear) = &hooks.clear_screen {
                    clear();
                }
            }
            Pick::Settings => self.open_route(Route::Settings),
            Pick::Subagents => self.open_subagents(),
            Pick::Subagent(id) => self.open_tab(&id),
            Pick::Exit => {
                if let Some(exit) = &hooks.exit {
                    exit();
                }
            }
            Pick::Agent(id) => {
                if let Some(agent) = &hooks.agent {
                    agent(&id);
                }
                self.close_route();
            }
            Pick::Pending(id, delivery) => {
                let next = if delivery == Delivery::Queue { Delivery::Steer } else { Delivery::Queue };
                self.prompt.queued_action(
                    &id,
                    Some(next),
                    bind!(self, |inner, ok| if ok {
                        inner.close_route()
                    }),
                );
            }
        }
    }

    /// `handleCycle`.
    fn cycle_variant(&self) {
        if let Some(cycle) = &self.hooks().cycle_variant {
            cycle();
        }
    }

    fn models(&self) -> Models {
        self.hooks().models.as_ref().map(|models| models()).unwrap_or_default()
    }

    fn query(&self) -> String {
        self.state.borrow().panel.as_ref().map(|panel| panel.query().to_owned()).unwrap_or_default()
    }

    /// `change` in the settings panel: Enter and right step forward, left back. One change saves at a time.
    fn change_setting(self: &Rc<Self>, key: Key, forward: bool) {
        let hooks = self.hooks();
        let (Some(settings), Some(save)) = (&hooks.settings, &hooks.setting) else { return };
        if self.state.borrow().saving.is_some() {
            return;
        }
        let Some(change) = settings().change(key, forward) else { return };
        self.state.borrow_mut().saving = Some(key);
        self.paint();
        save(
            change,
            Box::new(bind!(self, |inner| {
                inner.state.borrow_mut().saving = None;
                inner.paint();
            })),
        );
    }

    /// Left and right in the settings panel.
    fn setting_key(self: &Rc<Self>, name: &str) -> bool {
        let selected =
            self.state.borrow().panel.as_ref().and_then(|panel| panel.selected()).map(|entry| entry.action.clone());
        if let Some(Pick::Setting(key)) = selected {
            self.change_setting(key, name == "right");
        }
        true
    }

    /// `openQueuedMenu`.
    fn open_queued(self: &Rc<Self>) {
        if self.prompt.queued().is_empty() {
            return;
        }
        self.open_route(Route::Queued);
    }

    /// `queued_prompt.undo` and `queued_prompt.delete` on the highlighted pending prompt.
    fn pending(self: &Rc<Self>, undo: bool) -> bool {
        let selected =
            self.state.borrow().panel.as_ref().and_then(|panel| panel.selected()).map(|entry| entry.action.clone());
        let Some(Pick::Pending(id, _)) = selected else { return false };
        if !undo {
            self.prompt.queued_action(&id, None, |_| {});
            return true;
        }
        self.prompt.undo(
            &id,
            bind!(self, |inner, ok| if ok {
                inner.close_route()
            }),
        );
        true
    }

    /// The pending prompts changed: the open panel follows, and closes once none is left.
    fn queue_changed(self: &Rc<Self>) {
        let route = self.state.borrow().route;
        if route != Some(Route::Queued) {
            if route == Some(Route::Command) {
                self.paint();
            }
            return;
        }
        if self.prompt.queued().is_empty() {
            return self.close_route();
        }
        self.paint();
        self.layout();
    }

    // -----------------------------------------------------------------------------------------------------------
    // Permission
    // -----------------------------------------------------------------------------------------------------------

    fn permission_request(&self) -> Option<permission::Request> {
        let state = self.state.borrow();
        let Some(Shown::Permission(id)) = &state.shown else { return None };
        find_permission(&state, id).cloned()
    }

    /// The permission body's keys (`useKeyboard`).
    fn permission_key(self: &Rc<Self>, name: &str) -> bool {
        let Some(request) = self.permission_request() else { return false };
        let Some(mut current) = self.state.borrow().permission.clone() else { return false };
        if current.stage == permission::Stage::Reject {
            return match name {
                "return" => {
                    if let Some(reply) = current.reject() {
                        self.send_permission(&request, reply);
                    }
                    true
                }
                "escape" => {
                    current.cancel();
                    self.set_permission(current);
                    true
                }
                _ => false,
            };
        }
        if matches!(name, "pageup" | "pagedown") {
            if let Some(scroll) = &self.widgets.borrow().scroll {
                scroll.page(name == "pageup");
                self.app.request_redraw();
            }
            return true;
        }
        if current.submitting {
            return matches!(name, "left" | "right" | "h" | "l" | "tab" | "shift+tab" | "return" | "escape");
        }
        let saves = request.info.save.as_ref().is_some_and(|save| !save.is_empty());
        let choices = current.choices(saves);
        match name {
            "tab" | "right" | "l" => current.shift(true, &choices),
            "shift+tab" | "left" | "h" => current.shift(false, &choices),
            "return" => {
                let selected = current.selected;
                if let Some(reply) = current.run(selected) {
                    self.set_permission(current);
                    self.send_permission(&request, reply);
                    return true;
                }
            }
            "escape" => current.escape(),
            _ => return false,
        }
        self.set_permission(current);
        true
    }

    fn set_permission(self: &Rc<Self>, next: permission::State) {
        let stage = {
            let mut state = self.state.borrow_mut();
            let stage = state.permission.as_ref().map(|current| current.stage);
            state.permission = Some(next);
            stage
        };
        self.paint();
        if stage != self.state.borrow().permission.as_ref().map(|current| current.stage)
            && let Some(scroll) = &self.widgets.borrow().scroll
        {
            scroll.top();
        }
    }

    /// `onPermissionReply`; the request leaves once its `permission.replied` arrives.
    fn send_permission(self: &Rc<Self>, request: &permission::Request, reply: permission::Reply) {
        let Some(target) = self.target.borrow().clone() else { return };
        if let Some(current) = self.state.borrow_mut().permission.as_mut() {
            current.submitting = true;
        }
        self.paint();
        let input = PermissionReplyInput {
            session_id: request.info.session_id.clone(),
            request_id: request.info.id.clone(),
            decision: reply.decision,
            message: reply.message,
        };
        let id = request.info.id.0.clone();
        self.app.spawn(
            async move { target.client.permission_reply(&input).await },
            bind!(self, |inner, _, result| {
                if let Err(error) = result {
                    log::warn!("mini permission reply failed: {error}");
                    let mut state = inner.state.borrow_mut();
                    match state.permission.as_mut() {
                        Some(current) if current.request == id => current.submitting = false,
                        _ => return,
                    }
                    drop(state);
                    inner.paint();
                }
            }),
        );
    }

    // -----------------------------------------------------------------------------------------------------------
    // Form
    // -----------------------------------------------------------------------------------------------------------

    fn form(&self) -> Option<(FormInfo, form::State)> {
        let state = self.state.borrow();
        let Some(Shown::Form(id)) = &state.shown else { return None };
        let info = find_form(&state, id)?.clone();
        let current = state.form_states.get(id).cloned().unwrap_or_else(|| form::State::new(&info));
        Some((info, current))
    }

    fn set_form(self: &Rc<Self>, next: form::State) {
        let mut state = self.state.borrow_mut();
        if state.settled.contains(&next.form) {
            return;
        }
        state.form_states.insert(next.form.clone(), next);
        drop(state);
        self.paint();
    }

    /// The form body's keys (`useKeyboard`, and the answer field's Enter and Escape).
    fn form_key(self: &Rc<Self>, name: &str) -> bool {
        let Some((info, mut current)) = self.form() else { return false };
        if current.submitting {
            return true;
        }
        if name == "escape" {
            self.cancel_form(&info);
            return true;
        }
        if matches!(name, "pageup" | "pagedown") {
            if let Some(scroll) = &self.widgets.borrow().scroll {
                scroll.page(name == "pageup");
                self.app.request_redraw();
            }
            return true;
        }
        let unsupported = form::unsupported(&info).is_some();
        let confirm = form::confirm(&info, &current);
        let editing =
            !unsupported && !confirm && (opencode_ui::form::textual(form::current(&info, &current)) || current.editing);
        if editing {
            if name != "return" {
                return false;
            }
            let text = self
                .widgets
                .borrow()
                .field
                .as_ref()
                .map_or_else(|| current.input(form::current(&info, &current)), Textarea::text);
            current.commit(&info, &text);
            if !current.error.is_empty() {
                self.set_form(current);
                return true;
            }
            if form::single(&info) {
                self.submit_form(&info, current);
                return true;
            }
            let next = current.field + 1;
            current.set_field(&info, next);
            self.set_form(current);
            return true;
        }
        if unsupported {
            return false;
        }
        let field = form::current(&info, &current).cloned();
        match name {
            "tab" | "right" | "l" | "shift+tab" | "left" | "h" => {
                let back = matches!(name, "shift+tab" | "left" | "h");
                let total = info.fields.len() + 1;
                let next = (current.field + if back { total - 1 } else { 1 }) % total;
                if !back && !confirm {
                    let problem = match &field {
                        Some(field @ opencode_api::generated::FormField::External(_)) => (current.answer(field)
                            != Some(&opencode_api::generated::FormValue::Bool(true)))
                        .then(|| format!("Acknowledge {}", opencode_ui::form::label(field))),
                        Some(field) => opencode_ui::form::validate(field, current.answer(field)),
                        None => None,
                    };
                    if let Some(problem) = problem {
                        current.fail(problem);
                        self.set_form(current);
                        return true;
                    }
                }
                current.set_field(&info, next);
                self.set_form(current);
            }
            "return" if confirm => self.submit_form(&info, current),
            "return" if matches!(field, Some(opencode_api::generated::FormField::External(_))) => {
                self.external(&info, current);
            }
            "up" | "k" => {
                current.step(&info, false);
                self.set_form(current);
            }
            "down" | "j" => {
                current.step(&info, true);
                self.set_form(current);
            }
            "return" => {
                let selected = current.selected;
                self.choose(&info, current, selected);
            }
            digit => {
                let total = opencode_ui::form::rows(field.as_ref()).len()
                    + usize::from(opencode_ui::form::custom(field.as_ref()));
                let Some(number) = digit.parse::<usize>().ok().filter(|number| (1..=total.min(9)).contains(number))
                else {
                    return false;
                };
                self.choose(&info, current, number - 1);
            }
        }
        true
    }

    /// `choose`: picks a row; a single field submits at once.
    fn choose(self: &Rc<Self>, info: &FormInfo, mut current: form::State, selected: usize) {
        current.select(selected);
        current.pick(info);
        let multiple =
            matches!(form::current(info, &current), Some(opencode_api::generated::FormField::Multiselect(_)));
        if current.editing || multiple || !form::single(info) {
            self.set_form(current);
            return;
        }
        self.submit_form(info, current);
    }

    /// `external`: opens the URL, then acknowledges it on the next Enter.
    fn external(self: &Rc<Self>, info: &FormInfo, mut current: form::State) {
        let Some(opencode_api::generated::FormField::External(field)) = form::current(info, &current).cloned() else {
            return;
        };
        if current.answer(&opencode_api::generated::FormField::External(field.clone()))
            == Some(&opencode_api::generated::FormValue::Bool(true))
        {
            if form::single(info) {
                return self.submit_form(info, current);
            }
            let next = current.field + 1;
            current.set_field(info, next);
            return self.set_form(current);
        }
        if current.external_ready.contains(&field.key) {
            current.acknowledge(info);
            if form::single(info) {
                return self.submit_form(info, current);
            }
            return self.set_form(current);
        }
        let opened = open_url(&field.url);
        current.external_ready.insert(field.key.clone());
        current.error.clear();
        if !opened {
            current.fail("Could not open the URL. Open it manually, then press enter.");
        }
        self.set_form(current);
    }

    /// `submit`: validates, then sends the answers (`onFormReply`).
    fn submit_form(self: &Rc<Self>, info: &FormInfo, mut current: form::State) {
        if let Some(invalid) = form::invalid(info, &current) {
            current.fail(invalid);
            return self.set_form(current);
        }
        let Some(answer) = form::answer(info, &current) else { return };
        let Some(target) = self.target.borrow().clone() else { return };
        current.submitting = true;
        current.error.clear();
        self.set_form(current);
        let input = SessionFormReplyInput { session_id: info.session_id.clone(), form_id: info.id.clone(), answer };
        let id = info.id.0.clone();
        let client = form_client(&target, info);
        self.app.spawn(
            async move { client.session_form_reply(&input).await },
            bind!(self, |inner, _, result| inner.form_settled(&id, result)),
        );
    }

    /// `cancel` (`onFormCancel`).
    fn cancel_form(self: &Rc<Self>, info: &FormInfo) {
        let Some((_, mut current)) = self.form() else { return };
        let Some(target) = self.target.borrow().clone() else { return };
        current.submitting = true;
        current.error.clear();
        self.set_form(current);
        let input =
            SessionFormCancelInput { session_id: info.session_id.clone(), form_id: info.id.clone(), message: None };
        let id = info.id.0.clone();
        let client = form_client(&target, info);
        self.app.spawn(
            async move { client.session_form_cancel(&input).await },
            bind!(self, |inner, _, result| inner.form_settled(&id, result)),
        );
    }

    /// A reply or cancel answered: the form leaves (`settleForm`), unless it failed for another reason than being
    /// settled already (`formAlreadySettled`).
    fn form_settled(self: &Rc<Self>, id: &str, result: Result<(), opencode_api::error::Error>) {
        if let Err(error) = result {
            let settled = error.declared().is_some_and(|declared| {
                matches!(declared.tag.as_deref(), Some("FormNotFoundError" | "FormAlreadySettledError"))
            });
            if !settled {
                let message = error
                    .declared()
                    .and_then(|declared| declared.body.get("message").and_then(Value::as_str).map(str::to_owned))
                    .filter(|message| !message.trim().is_empty())
                    .unwrap_or_else(|| "Form request failed".to_owned());
                let mut state = self.state.borrow_mut();
                if let Some(current) = state.form_states.get_mut(id) {
                    current.fail(message);
                }
                drop(state);
                return self.paint();
            }
        }
        let owner = {
            let mut state = self.state.borrow_mut();
            let owner = find_form(&state, id).map(|form| form.session_id.clone());
            state.settled.insert(id.to_owned());
            state.form_states.remove(id);
            state.forms.retain(|form| form.id.0 != id);
            state.child_forms.retain(|form| form.id.0 != id);
            state.global_forms.retain(|form| form.id.0 != id);
            owner
        };
        if let (Some(owner), Some(tracker)) = (owner, self.tracker.borrow_mut().as_mut()) {
            tracker.settle_form(&owner, id);
            tracker.take_changed();
        }
        self.sync();
    }
}

/// A permission of the session, else of a child (`pickBlockerView`'s order).
fn find_permission<'a>(state: &'a State, id: &str) -> Option<&'a permission::Request> {
    state.permissions.iter().chain(&state.child_permissions).find(|request| request.info.id.0 == id)
}

/// A form of the session, else of a child, else of no session.
fn find_form<'a>(state: &'a State, id: &str) -> Option<&'a FormInfo> {
    state.forms.iter().chain(&state.child_forms).chain(&state.global_forms).find(|form| form.id.0 == id)
}

/// A form of no session names its location in a header (`formRequestOptions`).
fn form_client(target: &Target, form: &FormInfo) -> Client {
    if form.session_id != GLOBAL {
        return target.client.clone();
    }
    // `encodeURIComponent`.
    let directory: String = target
        .directory
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect();
    target.client.with_header("x-opencode-directory", directory)
}

/// `openUrl`: a form's URL is not trusted to name a web link, so anything else fails before a process starts.
fn open_url(url: &str) -> bool {
    let Ok(url) = opencode_ui::open::web_url(url) else { return false };
    opencode_ui::open::command(&url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}

/// `RunCommandMenuBody`'s entries.
fn command_entries(
    tabs: &[Tab],
    queued: Vec<&str>,
    variant_cycle: Option<String>,
    clear: Option<String>,
    variants: &[String],
) -> Vec<Entry<Pick>> {
    let entry = |category: &str, display: &str, footer: Option<String>, keywords: &str, action: Pick| Entry {
        item: Item { display: display.to_owned(), category: Some(category.to_owned()), footer, ..Item::default() },
        keywords: keywords.to_owned(),
        action,
    };
    let mut entries = vec![
        entry("Session", "Open editor", Some("/editor".into()), "editor compose draft external editor", Pick::Editor),
        entry("Session", "Show status", None, "status activity model context usage footer", Pick::Status),
    ];
    if !tabs.is_empty() {
        let running = tabs.iter().filter(|tab| tab.status == Status::Running).count();
        let footer = if running > 0 { format!("{running} active") } else { format!("{} recent", tabs.len()) };
        let keywords: Vec<String> = tabs
            .iter()
            .map(|tab| format!("{} {} {}", tab.label, tab.description, tab.title.as_deref().unwrap_or_default()))
            .collect();
        entries.push(entry("Session", "View subagents", Some(footer), &keywords.join(" "), Pick::Subagents));
    }
    entries.extend([
        entry("Session", "Compact session", Some("/compact".into()), "compact session context", Pick::Slash("compact")),
        entry("Session", "New session", Some("/new".into()), "new session clear", Pick::Slash("new")),
        entry("Agent", "Switch agent", None, "", Pick::Agents),
        entry("Agent", "Switch model", None, "", Pick::Models),
    ]);
    if !queued.is_empty() {
        entries.push(entry(
            "Agent",
            "View pending prompts",
            Some(format!("{} pending", queued.len())),
            &queued.join(" "),
            Pick::Queued,
        ));
    }
    entries.push(entry("Agent", "Variant cycle", variant_cycle, "variant cycle", Pick::VariantCycle));
    if !variants.is_empty() {
        let keywords = format!("variant variants {}", variants.join(" "));
        entries.push(entry("Agent", "Switch model variant", None, &keywords, Pick::Variants));
    }
    entries.extend([
        entry("System", "Clear screen", clear, "clear screen cls redraw", Pick::Clear),
        entry(
            "System",
            "Settings",
            Some("/settings".into()),
            "/settings settings preferences configuration",
            Pick::Settings,
        ),
        entry("System", "Exit", Some("/exit".into()), "/exit exit", Pick::Exit),
    ]);
    entries
}

/// `RunSubagentSelectBody`'s entries: the running children, or with `running_only` false the others.
fn subagent_entries(tabs: &[Tab], running_only: bool, selected: Option<&str>) -> Vec<Entry<Pick>> {
    tabs.iter()
        .filter(|tab| (tab.status == Status::Running) == running_only)
        .map(|tab| {
            let title = [tab.description.as_str(), tab.title.as_deref().unwrap_or_default(), tab.label.as_str()]
                .into_iter()
                .find(|text| !text.is_empty())
                .unwrap_or_default()
                .to_owned();
            let (footer, tone) = match tab.status {
                Status::Running => ("running", Some(Tone::Running)),
                Status::Error => ("error", Some(Tone::Error)),
                Status::Completed => ("done", Some(Tone::Success)),
                Status::Cancelled => ("cancelled", None),
            };
            let status = footer;
            Entry {
                keywords: format!(
                    "{} {} {} {status}",
                    tab.label,
                    tab.description,
                    tab.title.as_deref().unwrap_or_default()
                ),
                item: Item {
                    description: (title != tab.label).then(|| tab.label.clone()),
                    display: title,
                    category: Some(String::new()),
                    footer: Some(footer.to_owned()),
                    tone,
                    current: selected == Some(tab.session_id.as_str()),
                },
                action: Pick::Subagent(tab.session_id.clone()),
            }
        })
        .collect()
}

/// The family index (`session.list` by parent, breadth first): the sessions under `parent`, up to
/// [`FAMILY_LIMIT`]. A list that fails counts as empty.
async fn family(client: &Client, parent: &str) -> Vec<SessionInfo> {
    let mut found: Vec<SessionInfo> = Vec::new();
    let mut queue = std::collections::VecDeque::from([parent.to_owned()]);
    let mut visited = HashSet::from([parent.to_owned()]);
    while let Some(owner) = queue.pop_front() {
        if found.len() >= FAMILY_LIMIT {
            break;
        }
        let input = SessionListInput {
            parent_id: Some(Some(SessionID(owner))),
            limit: Some((FAMILY_LIMIT - found.len()) as i64),
            order: Some(SessionListInputOrder::Desc),
            ..SessionListInput::default()
        };
        let sessions = client.session_list(&input).await.map(|list| list.data).unwrap_or_default();
        for session in sessions {
            if found.len() >= FAMILY_LIMIT || !visited.insert(session.id.0.clone()) {
                continue;
            }
            queue.push_back(session.id.0.clone());
            found.push(session);
        }
    }
    found
}

/// `runDiscovery`: walks up from `session` until a session whose parent is in `family`.
async fn lineage(client: &Client, session: &str, family: &HashSet<String>) -> Discovery {
    let get = |id: String| async move { client.session_get(&SessionGetInput { session_id: SessionID(id) }).await };
    let Ok(mut current) = get(session.to_owned()).await else { return Discovery::Failed };
    let mut lineage: Vec<SessionInfo> = Vec::new();
    let mut visited = HashSet::new();
    while lineage.len() < FAMILY_LIMIT && visited.insert(current.id.0.clone()) {
        let parent = current.parent_id.clone();
        lineage.push(current);
        let Some(parent) = parent else { break };
        if family.contains(&parent.0) {
            return Discovery::Family(lineage);
        }
        if visited.contains(&parent.0) {
            break;
        }
        current = match get(parent.0).await {
            Ok(next) => next,
            Err(_) => return Discovery::Failed,
        };
    }
    Discovery::Unrelated
}

/// `RunModelSelectBody`'s entries: every model but the deprecated, opencode first, then by provider and model name.
/// A query shows each model's provider in the footer.
fn model_entries(models: &Models, query: String) -> Vec<Entry<Pick>> {
    let current = models.current.as_ref();
    let searching = !query.trim().is_empty();
    let mut entries: Vec<(String, Entry<Pick>)> = models
        .providers
        .iter()
        .flatten()
        .flat_map(|provider| {
            provider.models.iter().filter(|(_, model)| !model.deprecated).map(move |(id, model)| {
                let title = if model.name.is_empty() { id.clone() } else { model.name.clone() };
                let selected =
                    current.is_some_and(|current| current.provider_id == provider.id && current.model_id == *id);
                let footer = if selected {
                    Some("current".to_owned())
                } else if model.cost == Some(0.0) && provider.id == "opencode" {
                    Some("Free".to_owned())
                } else {
                    (title != *id).then(|| id.clone())
                };
                let keywords =
                    format!("{} {} {id} {title} {}", provider.id, provider.name, footer.clone().unwrap_or_default());
                let (footer, tone) = if searching {
                    (Some(provider.name.clone()), None)
                } else {
                    (footer, selected.then_some(Tone::Selection))
                };
                let entry = Entry {
                    keywords,
                    item: Item {
                        display: title,
                        category: Some(provider.name.clone()),
                        footer,
                        tone,
                        current: selected,
                        ..Item::default()
                    },
                    action: Pick::Model(ModelSelection { provider_id: provider.id.clone(), model_id: id.clone() }),
                };
                (provider.id.clone(), entry)
            })
        })
        .collect();
    entries.sort_by(|(a_id, a), (b_id, b)| {
        (a_id != "opencode")
            .cmp(&(b_id != "opencode"))
            .then_with(|| {
                opencode_api::js::locale_compare(
                    a.item.category.as_deref().unwrap_or_default(),
                    b.item.category.as_deref().unwrap_or_default(),
                )
            })
            .then_with(|| opencode_api::js::locale_compare(&a.item.display, &b.item.display))
    });
    entries.into_iter().map(|(_, entry)| entry).collect()
}

/// `RunSettingsBody`'s entries.
fn setting_entries(settings: &MiniSettings, saving: Option<Key>) -> Vec<Entry<Pick>> {
    let visibility = |value: Visibility| if value == Visibility::Show { "show" } else { "hide" };
    let rows = [
        (
            "Transcript",
            "Verbosity",
            Key::Verbosity,
            settings.verbosity_label().to_owned(),
            "verbosity quiet default everything custom noise",
        ),
        ("Transcript", "Thinking", Key::Thinking, visibility(settings.thinking).to_owned(), "thinking reasoning"),
        (
            "Transcript",
            "Tools",
            Key::Tools,
            visibility(settings.tools).to_owned(),
            "tools files skills activity work steps intermediate",
        ),
        (
            "Transcript",
            "Shell",
            Key::ShellOutput,
            visibility(settings.shell_output).to_owned(),
            "shell tool command output",
        ),
        (
            "Transcript",
            "Turn summary",
            Key::TurnSummary,
            visibility(settings.turn_summary).to_owned(),
            "turn summary agent model duration",
        ),
        (
            "Terminal",
            "Footer details",
            Key::Footer,
            visibility(settings.footer).to_owned(),
            "footer status activity model context usage",
        ),
        ("Terminal", "Splash", Key::Splash, visibility(settings.splash).to_owned(), "splash entry exit banner"),
        (
            "Terminal",
            "Monochrome UI",
            Key::Mono,
            if settings.mono { "on" } else { "off" }.to_owned(),
            "mono monochrome ascii legacy compat terminal",
        ),
        (
            "Terminal",
            "Work spinner",
            Key::WorkSpinner,
            settings.work_spinner.as_str().replace("block-", "").replace('-', " "),
            "work spinner animation",
        ),
    ];
    rows.into_iter()
        .map(|(category, display, key, value, words)| {
            let saved = saving == Some(key);
            let word = if key == Key::WorkSpinner { settings.work_spinner.as_str().to_owned() } else { value.clone() };
            Entry {
                keywords: format!("{words} {word}"),
                item: Item {
                    display: display.to_owned(),
                    category: Some(category.to_owned()),
                    footer: Some(if saved { "saving".to_owned() } else { value }),
                    tone: Some(if saved { Tone::Running } else { Tone::Selection }),
                    ..Item::default()
                },
                action: Pick::Setting(key),
            }
        })
        .collect()
}

/// The footer's layers (`footer.view.tsx:560-613`, the panels' and the request bodies' keys).
fn install_layers(inner: &Rc<Inner>) {
    let when = |check: fn(&Inner) -> bool| Condition::when(bind!(inner, |inner| check(&inner)));
    fn composer(inner: &Inner) -> bool {
        let state = inner.state.borrow();
        matches!(state.shown, None | Some(Shown::Prompt)) && state.route.is_none()
    }
    fn route(inner: &Inner) -> Option<Route> {
        inner.state.borrow().route
    }
    fn shown(inner: &Inner) -> Option<Shown> {
        inner.state.borrow().shown.clone()
    }
    let run = |action: fn(&Rc<Inner>)| bind!(inner, |inner, _: Option<&str>, _: Option<&KeyEvent>| action(&inner));
    // Inline keys, each handled by `handle`; a `false` lets the key through to the focused field.
    let keys = |binds: &[&'static str], handle: fn(&Rc<Inner>, &str) -> bool| -> Vec<TuiCommand> {
        binds
            .iter()
            .map(|bind| {
                let name = *bind;
                TuiCommand::inline(
                    name,
                    bind!(inner, |inner, _: Option<&str>, _: Option<&KeyEvent>| handle(&inner, name)),
                )
            })
            .collect()
    };
    let layers = vec![
        KeymapLayer::new(vec![
            TuiCommand::new("command.palette.show", run(|inner| inner.open_route(Route::Command)))
                .title("Open command palette")
                .group("Prompt"),
            TuiCommand::new("variant.cycle", run(|inner| inner.cycle_variant()))
                .title("Cycle model variant")
                .group("Model"),
        ])
        .enabled(when(|inner| composer(inner) && !inner.prompt.menu_visible())),
        KeymapLayer::new(vec![
            TuiCommand::new("session.queued_prompts", run(Inner::open_queued))
                .title("View pending prompts")
                .group("Prompt"),
        ])
        .enabled(when(|inner| composer(inner) && !inner.prompt.queued().is_empty())),
        KeymapLayer::new(vec![
            TuiCommand::new("session.child.first", run(Inner::open_subagents)).title("View subagents").group("Session"),
        ])
        .enabled(when(|inner| composer(inner) && !inner.state.borrow().tabs.is_empty())),
        KeymapLayer::new(vec![
            TuiCommand::new("composer.subagent.interrupt", run(Inner::interrupt_subagent))
                .title("Interrupt subagent")
                .group("Session"),
        ])
        .enabled(when(|inner| {
            route(inner) == Some(Route::Inspector)
                && inner.shows_route()
                && inner.selected_tab().is_some_and(|tab| tab.status == Status::Running)
        }))
        .priority(1),
        KeymapLayer::new(keys(&["escape", "tab", "up", "k", "down", "j", "pageup", "pagedown"], Inner::inspector_key))
            .enabled(when(|inner| route(inner) == Some(Route::Inspector) && inner.shows_route()))
            .priority(2),
        KeymapLayer::new(keys(&["tab"], Inner::subagents_key))
            .enabled(when(|inner| route(inner) == Some(Route::Subagents)))
            .priority(3),
        KeymapLayer::new(keys(
            &[
                "escape", "ctrl+c", "up", "down", "ctrl+p", "ctrl+n", "pageup", "pagedown", "home", "end", "return",
                "ctrl+u",
            ],
            Inner::panel_key,
        ))
        .enabled(when(|inner| route(inner).is_some_and(|route| route != Route::Inspector)))
        .priority(2),
        KeymapLayer::new(keys(&["left", "right"], Inner::setting_key))
            .enabled(when(|inner| route(inner) == Some(Route::Settings)))
            .priority(3),
        KeymapLayer::new(vec![
            TuiCommand::new(
                "queued_prompt.undo",
                bind!(inner, |inner, _: Option<&str>, _: Option<&KeyEvent>| inner.pending(true)),
            )
            .title("Undo")
            .group("Prompt"),
            TuiCommand::new(
                "queued_prompt.delete",
                bind!(inner, |inner, _: Option<&str>, _: Option<&KeyEvent>| inner.pending(false)),
            )
            .title("Delete pending prompt")
            .group("Prompt"),
        ])
        .enabled(when(|inner| route(inner) == Some(Route::Queued)))
        .priority(3),
        KeymapLayer::new(keys(
            &["pageup", "pagedown", "tab", "shift+tab", "left", "h", "right", "l", "return", "escape"],
            Inner::permission_key,
        ))
        .enabled(when(|inner| matches!(shown(inner), Some(Shown::Permission(_)))))
        .priority(2),
        KeymapLayer::new(keys(
            &[
                "escape",
                "pageup",
                "pagedown",
                "tab",
                "shift+tab",
                "left",
                "h",
                "right",
                "l",
                "return",
                "up",
                "k",
                "down",
                "j",
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
            ],
            Inner::form_key,
        ))
        .enabled(when(|inner| matches!(shown(inner), Some(Shown::Form(_)))))
        .priority(2),
    ];
    for layer in layers {
        match inner.prompt.keymap().layer(layer) {
            Ok(disposer) => inner.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("mini footer keymap layer: {error}"),
        }
    }
}

impl Inner {
    /// The running children.
    fn running(&self) -> usize {
        self.state.borrow().tabs.iter().filter(|tab| tab.status == Status::Running).count()
    }
}

impl Footers {
    /// `/settings`: the settings panel over the composer.
    pub fn open_settings(&self) {
        self.0.open_route(Route::Settings);
    }

    /// The catalog, the model, or its variants changed: an open model, variant, command, or agent panel follows.
    pub fn models_changed(&self) {
        let route = self.0.state.borrow().route;
        if matches!(route, Some(Route::Model | Route::Variant | Route::Command | Route::Agent)) {
            self.0.paint();
            self.0.layout();
        }
    }

    /// The session's pending prompts changed (an inbox event or an admission).
    pub fn queue_changed(&self) {
        self.0.queue_changed();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use opencode_api::memory::{Memory, Route};
    use opentui::testing::TestApp;
    use serde::Deserialize;
    use serde_json::json;

    use super::*;

    #[test]
    fn a_form_url_that_is_not_a_web_link_never_starts_the_opener() {
        // The Windows opener's `Start` would run a program; the failure tells the user to open it themselves.
        for url in [r"C:\Windows\System32\calc.exe", "calc", "file:///etc/passwd", r"\\host\share\payload.exe", "-a x"]
        {
            assert!(!open_url(url), "{url}");
        }
    }

    fn event(kind: &str, data: Value) -> V2Event {
        let event = json!({ "id": "evt_1", "created": 1, "type": kind,
            "durable": { "aggregateID": "ses_1", "seq": 1, "version": 1 }, "data": data });
        V2Event::deserialize(&event).unwrap()
    }

    fn asked(session: &str) -> V2Event {
        event(
            "permission.asked",
            json!({ "id": "per_1", "sessionID": session, "action": "bash", "resources": ["ls"],
                "source": { "type": "tool", "messageID": "msg_a", "id": "call_1" } }),
        )
    }

    /// The footers of `ses_1`, whose tool-call reads answer at once.
    fn footers(app: &TestApp) -> (Footers, Client) {
        let theme = crate::theme::resolve(&crate::theme::ThemeInput::default());
        let prompt = Prompt::new(app, &theme, false, &Default::default());
        let footers = Footers::new(app, &prompt, &theme, false);
        let message = json!({ "id": "msg_a", "type": "assistant", "content": [] });
        let memory = Memory::new(vec![Route::json("GET", "/api/session/ses_1/message/msg_a", 200, &message)]);
        let client = Client::with_transport("http://test", Arc::new(memory)).unwrap();
        footers.open(&client, "ses_1", "/", false);
        (footers, client)
    }

    /// A request answered while its tool call is read stays answered.
    #[test]
    fn a_reply_during_the_tool_call_read_drops_the_request() {
        let app = TestApp::new(40, 12);
        let (footers, _) = footers(&app);
        footers.event(&asked("ses_1"));
        footers.event(&event(
            "permission.replied",
            json!({ "sessionID": "ses_1", "requestID": "per_1",
            "reply": "once" }),
        ));
        app.wait_until(Duration::from_millis(300), || false);
        assert_eq!(footers.blocker_status(), "");
    }

    /// A read for the last session does not reach the session opened after it.
    #[test]
    fn a_read_of_the_last_session_is_dropped() {
        let app = TestApp::new(40, 12);
        let (footers, client) = footers(&app);
        footers.event(&asked("ses_1"));
        footers.open(&client, "ses_2", "/", false);
        app.wait_until(Duration::from_millis(300), || false);
        assert_eq!(footers.blocker_status(), "");
    }

    /// The requests a hydration listed show; the stream applies its events after them.
    #[test]
    fn the_listed_requests_show() {
        let app = TestApp::new(40, 12);
        let (footers, _) = footers(&app);
        let V2Event::PermissionAsked(event) = asked("ses_1") else { unreachable!() };
        let request =
            permission::Request { info: super::asked(&event.data), input: Value::Null, metadata: Value::Null };
        footers.hydrated(Requests { permissions: vec![request], ..Requests::default() });
        assert_eq!(footers.blocker_status(), "awaiting permission");
    }
}
