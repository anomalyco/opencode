//! Footer views for requests and panels (`footer.view.tsx`, `footer.permission.tsx`, `footer.form.tsx`,
//! `footer.menu.tsx`, `footer.command.tsx`; row M05).
//!
//! A pending permission or form replaces the composer (`pickBlockerView`): the first permission, else the first
//! form. With the composer showing, `command.palette.show` opens the command menu, which leads to the agent and
//! model panels, and `session.queued_prompts` opens the pending prompts, where Enter toggles steer and queue,
//! `queued_prompt.delete` cancels a prompt, and `queued_prompt.undo` takes it back into the draft.
//!
//! Subagent tabs, their panel, and their inspector wait for the subagent stream (`stream-v2.subagent.ts`).

pub mod form;
pub mod menu;
pub mod panel;
pub mod permission;
mod scroll;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use opencode_api::client::{Call, Client};
use opencode_api::generated::{
    FormInfo, PermissionListInput, PermissionReplyInput, PermissionRequest, SessionFormCancelInput,
    SessionFormListInput, SessionFormReplyInput, SessionID,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::input::KeyEvent;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde_json::Value;

use self::menu::{Item, Tone};
use self::panel::{Entry, Outcome, Panel, Spec};
use crate::prompt::status::mono_shortcut;
use crate::prompt::{Delivery, Prompt};
use crate::replay::encode;
use crate::theme::RunTheme;

/// `PERMISSION_ROWS`.
const PERMISSION_ROWS: u16 = 12;
/// `FORM_ROWS`.
const FORM_ROWS: u16 = 14;
/// `base`: the footer's rows above the composer's one-row textarea at startup (`FOOTER_HEIGHT - 1`).
const BASE: u16 = 3;

type Action = Option<Box<dyn Fn()>>;
type TextAction = Option<Box<dyn Fn(&str)>>;

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
    Queued,
}

impl Route {
    /// The view name the prompt's keys follow (`promptView`).
    fn view(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::Agent => "agent",
            Self::Model => "model",
            Self::Queued => "queued-menu",
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
    permission: Option<permission::State>,
    /// Answers in progress per form while a permission covers it (`formStates`).
    form_states: HashMap<String, form::State>,
    settled: HashSet<String>,
    panel: Option<Panel<Pick>>,
    terminal: (u16, u16),
    running: bool,
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
    hooks: RefCell<Rc<Hooks>>,
    state: RefCell<State>,
    widgets: RefCell<Widgets>,
    layers: RefCell<Vec<Disposer>>,
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
            hooks: RefCell::default(),
            state: RefCell::new(State {
                terminal: opentui::term::size().unwrap_or((app.size().0, 24)),
                ..State::default()
            }),
            widgets: RefCell::default(),
            layers: RefCell::default(),
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
            (_, Some(Route::Queued)) => 1 + state.panel.as_ref().map_or(0, |panel| panel.rows(rows)) as u16,
            (_, Some(Route::Command | Route::Agent | Route::Model)) => {
                let layout = panel::layout(rows, panel::LIST_ROWS);
                1 + (layout.frame + layout.limit) as u16
            }
            _ => return None,
        };
        Some(desired.min(rows).max(1))
    }

    /// Opens a session: forgets the last one's requests and lists its pending ones (`hydrate`).
    pub fn open(&self, client: &Client, session: &str, directory: &str) {
        *self.0.target.borrow_mut() =
            Some(Target { client: client.clone(), session: session.to_owned(), directory: directory.to_owned() });
        {
            let mut state = self.0.state.borrow_mut();
            state.permissions.clear();
            state.forms.clear();
            state.form_states.clear();
            state.settled.clear();
        }
        self.0.sync();
        let weak = Rc::downgrade(&self.0);
        let (client, id) = (client.clone(), session.to_owned());
        self.0.app.spawn(
            async move {
                let (permissions, forms) = futures_util::future::join(
                    client.permission_list(&PermissionListInput { session_id: SessionID(id.clone()) }),
                    client.session_form_list(&SessionFormListInput { session_id: id.clone() }),
                )
                .await;
                let mut requests = Vec::new();
                for request in permissions.unwrap_or_default() {
                    requests.push(source(&client, &id, request).await);
                }
                (requests, forms.unwrap_or_default())
            },
            move |_, (permissions, forms)| {
                let Some(inner) = weak.upgrade() else { return };
                {
                    let mut state = inner.state.borrow_mut();
                    state.permissions = permissions;
                    state.forms = forms;
                }
                inner.sync();
            },
        );
    }

    /// A permission or form event of the session.
    pub fn event(&self, event: &Value) {
        let data = &event["data"];
        let inner = &self.0;
        match event["type"].as_str().unwrap_or_default() {
            "permission.asked" => {
                let Ok(request) = serde_json::from_value::<PermissionRequest>(data.clone()) else {
                    return;
                };
                if inner.state.borrow().permissions.iter().any(|item| item.info.id == request.id) {
                    return;
                }
                let Some(target) = inner.target.borrow().clone() else {
                    return;
                };
                let weak = Rc::downgrade(inner);
                inner.app.spawn(
                    async move { source(&target.client, &target.session, request).await },
                    move |_, request| {
                        let Some(inner) = weak.upgrade() else { return };
                        {
                            let mut state = inner.state.borrow_mut();
                            if state.permissions.iter().any(|item| item.info.id == request.info.id) {
                                return;
                            }
                            state.permissions.push(request);
                        }
                        inner.sync();
                    },
                );
            }
            "permission.replied" => {
                let id = data["requestID"].as_str().unwrap_or_default();
                inner.state.borrow_mut().permissions.retain(|item| item.info.id.0 != id);
                inner.sync();
            }
            "form.created" => {
                let Ok(form) = serde_json::from_value::<FormInfo>(data["form"].clone()) else {
                    return;
                };
                {
                    let mut state = inner.state.borrow_mut();
                    if state.forms.iter().any(|item| item.id == form.id) {
                        return;
                    }
                    state.forms.push(form);
                }
                inner.sync();
            }
            "form.replied" | "form.cancelled" => {
                let id = data["id"].as_str().unwrap_or_default();
                inner.state.borrow_mut().forms.retain(|item| item.id.0 != id);
                inner.sync();
            }
            _ => {}
        }
    }
}

/// `resolvePermissionSources`: the request with its tool call's input and metadata, read from its message.
async fn source(client: &Client, session: &str, info: PermissionRequest) -> permission::Request {
    let mut request = permission::Request { info, input: Value::Null, metadata: Value::Null };
    let Some(source) = request.info.source.clone().filter(|source| source.r#type == "tool") else {
        return request;
    };
    let call = Call::new(
        "GET",
        format!("/api/session/{}/message/{}", encode(session), encode(&source.message_id)),
        200,
        &[400, 401, 404],
    );
    let Ok(message) = client.json::<Value>(call).await else {
        return request;
    };
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
                .map(|request| Shown::Permission(request.info.id.0.clone()))
                .or_else(|| state.forms.first().map(|form| Shown::Form(form.id.0.clone())))
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
                if next != Shown::Prompt {
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
        let theme = self.theme.borrow().footer.clone();
        let mut widgets = Widgets::default();
        let shown = self.state.borrow().shown.clone();
        match shown {
            Some(Shown::Permission(id)) => {
                let state = self.state.borrow();
                let (Some(request), Some(current)) =
                    (state.permissions.iter().find(|request| request.info.id.0 == id), state.permission.as_ref())
                else {
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
                let Some(info) = state.forms.iter().find(|form| form.id.0 == id).cloned() else {
                    return;
                };
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
                if self.state.borrow().route.is_some() {
                    self.paint_panel(width, rows, &theme);
                }
            }
        }
        if let Some(field) = &widgets.field {
            let weak = Rc::downgrade(self);
            field.on_change(move |_, text| {
                if let Some(inner) = weak.upgrade() {
                    inner.field_changed(text);
                }
            });
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
                let field = state
                    .forms
                    .iter()
                    .find(|form| form.id.0 == id)
                    .and_then(|form| form.fields.get(state.form_states.get(&id)?.field).cloned());
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
        let weak = Rc::downgrade(self);
        panel.input().on_change(move |_, text| {
            let Some(inner) = weak.upgrade() else { return };
            let rows = inner.terminal().1;
            if let Some(panel) = inner.state.borrow_mut().panel.as_mut() {
                panel.set_query(text.to_owned(), rows);
            }
            inner.paint();
            inner.layout();
        });
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
        let entries: Vec<Entry<Pick>> = match route {
            Route::Command => command_entries(
                queued.iter().map(|item| item.prompt.text.as_str()).collect(),
                keymap.shortcut_all("variant.cycle").map(|key| mono_shortcut(&key, self.mono)),
                shortcut("app.clear"),
            ),
            Route::Agent => {
                let current = self.current_agent();
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
            // M.4 loads the provider catalog the model panel lists.
            Route::Model => Vec::new(),
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
        let mut state = self.state.borrow_mut();
        let Some(panel) = state.panel.as_mut() else {
            return;
        };
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

    fn current_agent(&self) -> Option<String> {
        let label = self.prompt.agent_id();
        (!label.is_empty()).then_some(label)
    }

    /// A key while a panel is open.
    fn panel_key(self: &Rc<Self>, name: &str) -> bool {
        let rows = self.terminal().1;
        let outcome = {
            let mut state = self.state.borrow_mut();
            let Some(panel) = state.panel.as_mut() else {
                return false;
            };
            let Some(outcome) = panel.key(name, rows) else {
                return false;
            };
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
            Pick::Settings => {
                self.close_route();
                self.prompt.submit_text("/settings");
            }
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
                let weak = Rc::downgrade(self);
                self.prompt.queued_action(&id, Some(next), move |ok| {
                    if let Some(inner) = weak.upgrade().filter(|_| ok) {
                        inner.close_route();
                    }
                });
            }
        }
    }

    /// `handleCycle` without variants: M.4 cycles them.
    fn cycle_variant(&self) {
        self.notice("no variants available");
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
        let Some(Pick::Pending(id, _)) = selected else {
            return false;
        };
        if !undo {
            self.prompt.queued_action(&id, None, |_| {});
            return true;
        }
        let weak = Rc::downgrade(self);
        self.prompt.undo(&id, move |ok| {
            if let Some(inner) = weak.upgrade().filter(|_| ok) {
                inner.close_route();
            }
        });
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
        let Some(Shown::Permission(id)) = &state.shown else {
            return None;
        };
        state.permissions.iter().find(|request| request.info.id.0 == *id).cloned()
    }

    /// The permission body's keys (`useKeyboard`).
    fn permission_key(self: &Rc<Self>, name: &str) -> bool {
        let Some(request) = self.permission_request() else {
            return false;
        };
        let Some(mut current) = self.state.borrow().permission.clone() else {
            return false;
        };
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
        let Some(target) = self.target.borrow().clone() else {
            return;
        };
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
        let weak = Rc::downgrade(self);
        let id = request.info.id.0.clone();
        self.app.spawn(async move { target.client.permission_reply(&input).await }, move |_, result| {
            let Some(inner) = weak.upgrade() else { return };
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
        });
    }

    // -----------------------------------------------------------------------------------------------------------
    // Form
    // -----------------------------------------------------------------------------------------------------------

    fn form(&self) -> Option<(FormInfo, form::State)> {
        let state = self.state.borrow();
        let Some(Shown::Form(id)) = &state.shown else {
            return None;
        };
        let info = state.forms.iter().find(|form| form.id.0 == *id)?.clone();
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
        let Some((info, mut current)) = self.form() else {
            return false;
        };
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
        let Some(answer) = form::answer(info, &current) else {
            return;
        };
        let Some(target) = self.target.borrow().clone() else {
            return;
        };
        current.submitting = true;
        current.error.clear();
        self.set_form(current);
        let input = SessionFormReplyInput { session_id: info.session_id.clone(), form_id: info.id.clone(), answer };
        let id = info.id.0.clone();
        let weak = Rc::downgrade(self);
        self.app.spawn(async move { target.client.session_form_reply(&input).await }, move |_, result| {
            if let Some(inner) = weak.upgrade() {
                inner.form_settled(&id, result);
            }
        });
    }

    /// `cancel` (`onFormCancel`).
    fn cancel_form(self: &Rc<Self>, info: &FormInfo) {
        let Some((_, mut current)) = self.form() else {
            return;
        };
        let Some(target) = self.target.borrow().clone() else {
            return;
        };
        current.submitting = true;
        current.error.clear();
        self.set_form(current);
        let input =
            SessionFormCancelInput { session_id: info.session_id.clone(), form_id: info.id.clone(), message: None };
        let id = info.id.0.clone();
        let weak = Rc::downgrade(self);
        self.app.spawn(async move { target.client.session_form_cancel(&input).await }, move |_, result| {
            if let Some(inner) = weak.upgrade() {
                inner.form_settled(&id, result);
            }
        });
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
        {
            let mut state = self.state.borrow_mut();
            state.settled.insert(id.to_owned());
            state.form_states.remove(id);
            state.forms.retain(|form| form.id.0 != id);
        }
        self.sync();
    }
}

/// `openUrl`.
fn open_url(url: &str) -> bool {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}

/// `RunCommandMenuBody`'s entries, without the subagent and variant-list rows, which need the subagent stream and
/// M.4's variants.
fn command_entries(queued: Vec<&str>, variant_cycle: Option<String>, clear: Option<String>) -> Vec<Entry<Pick>> {
    let entry = |category: &str, display: &str, footer: Option<String>, keywords: &str, action: Pick| Entry {
        item: Item { display: display.to_owned(), category: Some(category.to_owned()), footer, ..Item::default() },
        keywords: keywords.to_owned(),
        action,
    };
    let mut entries = vec![
        entry("Session", "Open editor", Some("/editor".into()), "editor compose draft external editor", Pick::Editor),
        entry("Session", "Show status", None, "status activity model context usage footer", Pick::Status),
        entry("Session", "Compact session", Some("/compact".into()), "compact session context", Pick::Slash("compact")),
        entry("Session", "New session", Some("/new".into()), "new session clear", Pick::Slash("new")),
        entry("Agent", "Switch agent", None, "", Pick::Agents),
        entry("Agent", "Switch model", None, "", Pick::Models),
    ];
    if !queued.is_empty() {
        entries.push(entry(
            "Agent",
            "View pending prompts",
            Some(format!("{} pending", queued.len())),
            &queued.join(" "),
            Pick::Queued,
        ));
    }
    entries.extend([
        entry("Agent", "Variant cycle", variant_cycle, "variant cycle", Pick::VariantCycle),
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

/// The footer's layers (`footer.view.tsx:560-613`, the panels' and the request bodies' keys).
fn install_layers(inner: &Rc<Inner>) {
    let when = |check: fn(&Inner) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || weak.upgrade().is_some_and(|inner| check(&inner)))
    };
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
    let run = |action: fn(&Rc<Inner>)| {
        let weak = Rc::downgrade(inner);
        move |_: Option<&str>, _: Option<&KeyEvent>| {
            if let Some(inner) = weak.upgrade() {
                action(&inner);
            }
        }
    };
    // Inline keys, each handled by `handle`; a `false` lets the key through to the focused field.
    let keys = |binds: &[&'static str], handle: fn(&Rc<Inner>, &str) -> bool| -> Vec<TuiCommand> {
        binds
            .iter()
            .map(|bind| {
                let weak = Rc::downgrade(inner);
                let name = *bind;
                TuiCommand::inline(name, move |_: Option<&str>, _: Option<&KeyEvent>| {
                    weak.upgrade().is_some_and(|inner| handle(&inner, name))
                })
            })
            .collect()
    };
    let layers = vec![
        KeymapLayer::new(vec![
            TuiCommand::new("command.palette.show", run(|inner| inner.open_route(Route::Command)))
                .title("Open command palette")
                .group("Prompt"),
            TuiCommand::new("variant.cycle", run(Inner::cycle_variant_rc)).title("Cycle model variant").group("Model"),
        ])
        .enabled(when(|inner| composer(inner) && !inner.prompt.menu_visible())),
        KeymapLayer::new(vec![
            TuiCommand::new("session.queued_prompts", run(Inner::open_queued))
                .title("View pending prompts")
                .group("Prompt"),
        ])
        .enabled(when(|inner| composer(inner) && !inner.prompt.queued().is_empty())),
        KeymapLayer::new(keys(
            &[
                "escape", "ctrl+c", "up", "down", "ctrl+p", "ctrl+n", "pageup", "pagedown", "home", "end", "return",
                "ctrl+u",
            ],
            Inner::panel_key,
        ))
        .enabled(when(|inner| route(inner).is_some()))
        .priority(2),
        KeymapLayer::new(vec![
            TuiCommand::new("queued_prompt.undo", {
                let weak = Rc::downgrade(inner);
                move |_: Option<&str>, _: Option<&KeyEvent>| weak.upgrade().is_some_and(|inner| inner.pending(true))
            })
            .title("Undo")
            .group("Prompt"),
            TuiCommand::new("queued_prompt.delete", {
                let weak = Rc::downgrade(inner);
                move |_: Option<&str>, _: Option<&KeyEvent>| weak.upgrade().is_some_and(|inner| inner.pending(false))
            })
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
    fn cycle_variant_rc(self: &Rc<Self>) {
        self.cycle_variant();
    }
}

impl Footers {
    /// The session's pending prompts changed (an inbox event or an admission).
    pub fn queue_changed(&self) {
        self.0.queue_changed();
    }
}
