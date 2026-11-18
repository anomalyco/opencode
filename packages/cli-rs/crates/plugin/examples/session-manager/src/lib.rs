//! A port of `@0xuwui/opencode-session-manager` 0.1.2 (`src/tui.tsx`, `src/panel.tsx`): `/session-manager` opens a page
//! of every session, grouped by directory, project, or when they were created, updated or viewed, with their
//! subsessions as a tree; the keys move a selection through it, fold groups, search in a field, rename a session and
//! delete one or a whole group, each after asking. The grouping, the subsessions and the language are kept.
//!
//! It draws as TS's: the rename prompt is filled with the session's title under its directory, `/` focuses the search
//! field the same call shows (the host's focus waits for the view that shows it), dates are local time by the host's
//! UTC offset of each, and `/sm` is the command's alias.

mod grouping;
mod i18n;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::time::{Duration, SystemTime};

use grouping::{Group, Mode, Row, Session};
use i18n::{LOCALES, Locale, Messages};
use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin_abi::task::{Cx, Tasks};
use opencode_plugin_abi::types::{
    ProjectListInput, SessionID, SessionListInput, SessionListInputOrder, SessionRemoveInput, SessionUpdateInput,
    SessionsCursor,
};
use opencode_plugin_abi::v2::{self, Scroll, ScrollAlign, Target};
use opencode_plugin_abi::{
    Call, Click, Command, Confirm, Edges, Host, Layout, Prompt, Read, Route, Setup, Span, TabEdit, Toast, Variant,
    Wrap, client, plugin,
};
use serde_json::{Value, json};

const ROUTE: &str = "manager";
const SETTINGS: &str = "settings";
const ROWS: &str = "session-manager-rows";
const SEARCH: &str = "session-manager-search";
const PAGE_SIZE: usize = 200;

/// What each key of the page's two layers does: the list's while no search is typed, the search's while one is.
const LIST_KEYS: [(&str, &str); 25] = [
    ("up", "up"),
    ("k", "up"),
    ("down", "down"),
    ("j", "down"),
    ("pageup", "page-up"),
    ("pagedown", "page-down"),
    ("home", "first"),
    ("g", "first"),
    ("end", "last"),
    ("shift+g", "last"),
    ("return", "open"),
    ("space", "fold"),
    ("tab", "next-mode"),
    ("shift+tab", "previous-mode"),
    ("c", "children"),
    ("r", "rename"),
    ("d", "delete"),
    ("shift+d", "delete-group"),
    ("f5", "refresh"),
    ("shift+r", "refresh"),
    ("/", "search"),
    ("ctrl+f", "search"),
    ("l", "language"),
    ("escape", "back"),
    ("q", "back"),
];
const SEARCH_KEYS: [(&str, &str); 7] = [
    ("up", "up"),
    ("down", "down"),
    ("pageup", "page-up"),
    ("pagedown", "page-down"),
    ("return", "finish"),
    ("tab", "finish"),
    ("escape", "clear"),
];

fn setup(setup: &mut Setup) -> Result<(), String> {
    let state = Rc::new(RefCell::new(State::default()));
    let page = Page { state: state.clone(), tasks: setup.tasks() };
    // The session `/session-manager` was opened from (TS's route data `from`).
    let open = Command::new("session-manager.open")
        .title("Session Manager")
        .description("Browse, rename and delete sessions grouped by directory, project or time")
        .group("Session")
        .palette()
        .slash("session-manager")
        .aliases(["sm".to_owned()]);
    let opened = state.clone();
    setup.command(open, move |host, _| {
        if let Route::Plugin { name, .. } = host.route()
            && name == ROUTE
        {
            return;
        }
        opened.borrow_mut().origin = match host.route() {
            Route::Session { id } => Some(id),
            _ => None,
        };
        host.open_route(ROUTE);
    });
    setup.storage_key(SETTINGS);
    // The page's clicks come back as commands.
    for (name, run) in [
        ("session-manager.row", State::clicked as fn(&mut State, &dyn Host, &str)),
        ("session-manager.mode", State::clicked_mode),
        ("session-manager.locale", State::clicked_locale),
        ("session-manager.children", |state, host, _| state.toggle_children(host)),
        ("session-manager.search", |state, host, _| state.start_search(host)),
    ] {
        let state = state.clone();
        setup.command(Command::new(name), move |host, input| {
            run(&mut state.borrow_mut(), host, input.unwrap_or_default());
        });
    }
    let layer = |keys: &[(&str, &str)], prefix: &str| {
        let binds = keys.iter().map(|(key, name)| Bind::new(*key, format!("{prefix}{name}")));
        Layer::default().scope(LayerScope::Surface).priority(100).keys(binds)
    };
    let (viewed, heard) = (state.clone(), page.clone());
    let surface =
        v2::Surface::new(ROUTE, v2::Place::Route(ROUTE.to_owned()), move |view| viewed.borrow().view(view.read))
            .mounts()
            .layers(vec![layer(&LIST_KEYS, "list:"), layer(&SEARCH_KEYS, "search:")])
            .on(move |host, event| {
                let handled = heard.state.borrow_mut().event(host, event);
                heard.start(host);
                handled
            });
    setup.surface(surface);
    let events = ["session.created", "session.deleted", "session.renamed", "session.archived"];
    // TS refreshes 300 ms after the last change it heard.
    let changed = page.clone();
    setup.on_event(&events, move |host, _| {
        if changed.state.borrow_mut().schedule_refresh() {
            let state = changed.state.clone();
            changed.tasks.spawn(host, move |cx| refresh_later(cx, state));
        }
    });
    Ok(())
}

/// The page's state and what starts its flows.
#[derive(Clone)]
struct Page {
    state: Rc<RefCell<State>>,
    tasks: Tasks,
}

impl Page {
    /// Starts the flow a handler asked for, once it no longer holds the state.
    fn start(&self, host: &dyn Host) {
        let Some(flow) = self.state.borrow_mut().start.take() else { return };
        let state = self.state.clone();
        match flow {
            Flow::Refresh => self.tasks.spawn(host, move |cx| refresh(cx, state)),
            Flow::Rename { id, prompt } => self.tasks.spawn(host, move |cx| rename(cx, state, id, prompt)),
            Flow::Remove(removal) => self.tasks.spawn(host, move |cx| remove(cx, state, removal)),
        }
    }
}

/// A flow of the page, which awaits its dialogs and requests.
enum Flow {
    Refresh,
    Rename { id: String, prompt: Prompt },
    Remove(Removal),
}

/// What a confirm asks to delete: top-level sessions, one after another.
struct Removal {
    confirm: Confirm,
    ids: Vec<String>,
    /// The sessions it deletes, their descendants included.
    total: usize,
    /// The group's label, for a whole group.
    group: Option<String>,
}

/// TS `refresh`: every page of the session list, and the projects. A later refresh replaces it.
async fn refresh(cx: Cx, state: Rc<RefCell<State>>) {
    let generation = {
        let mut state = state.borrow_mut();
        state.refreshes += 1;
        state.refreshes
    };
    let current = || state.borrow().refreshes == generation;
    // The replies are read as TS reads them, whatever fields they lack.
    let mut next = cx.call(page(None));
    let projects = cx.call(client::project_list(&ProjectListInput::default()).cast::<Value>());
    let mut sessions = Vec::new();
    let listed = loop {
        let body = match next.await {
            Ok(body) => body,
            Err(error) => break Err(error),
        };
        if !current() {
            return;
        }
        let data = body.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        sessions.extend(data.iter().filter_map(Session::from_json));
        let cursor = body.pointer("/cursor/next").and_then(Value::as_str).filter(|next| !next.is_empty());
        match cursor.filter(|_| !data.is_empty()) {
            Some(cursor) => next = cx.call(page(Some(cursor))),
            None => break projects.await,
        }
    };
    let mut state = state.borrow_mut();
    if state.refreshes != generation {
        return;
    }
    let list = match listed {
        Ok(body) => body.get("data").unwrap_or(&body).as_array().cloned().unwrap_or_default(),
        Err(error) => {
            state.error = Some(error);
            state.loading = false;
            return;
        }
    };
    state.projects = list
        .iter()
        .filter_map(|project| {
            let id = project.get("id")?.as_str()?.to_owned();
            let name = project.get("name").and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty());
            let canonical = project.get("canonical").and_then(Value::as_str).unwrap_or_default();
            Some((id, name.map_or_else(|| format_path(canonical), str::to_owned)))
        })
        .collect();
    // TS's `setSessions`, with the selection on the session it came from.
    state.sessions = sessions;
    if state.selected.is_none()
        && let Some(from) = &state.from
    {
        state.selected = Some(format!("s:{from}"));
    }
    state.now = now();
    state.error = None;
    state.loading = false;
}

/// TS `rename`: a prompt for session `id`'s new title, then the title saved.
async fn rename(cx: Cx, state: Rc<RefCell<State>>, id: String, prompt: Prompt) {
    let title = cx.prompt(prompt).await.map(|text| text.trim().to_owned()).filter(|title| !title.is_empty());
    let current =
        state.borrow().sessions.iter().find(|session| session.id == id).and_then(|session| session.title.clone());
    if let Some(title) = title.filter(|title| Some(title) != current.as_ref()) {
        let input =
            SessionUpdateInput { session_id: SessionID(id.clone()), title: Some(title.clone()), ..Default::default() };
        let saved = cx.send(client::session_update(&input)).await;
        let mut state = state.borrow_mut();
        match saved {
            Ok(_) => {
                if let Some(session) = state.sessions.iter_mut().find(|session| session.id == id) {
                    session.title = Some(title.clone());
                }
                cx.with(|host| host.toast(Toast::new(Variant::Success, (state.t().renamed)(&title))));
            }
            Err(error) => cx.with(|host| host.toast(Toast::new(Variant::Error, error))),
        }
    }
    state.borrow_mut().busy = false;
}

/// TS `removeOne` and `removeGroup`: asks, then deletes, one after another; the deleted ones go, and a toast says
/// so. A session already gone is deleted.
async fn remove(cx: Cx, state: Rc<RefCell<State>>, removal: Removal) {
    if cx.confirm(removal.confirm).await == Some(true) {
        let (mut done, mut failed) = (Vec::new(), 0);
        for id in removal.ids {
            match cx.send(client::session_remove(&SessionRemoveInput { session_id: SessionID(id.clone()) })).await {
                Err(error) if !not_found(&error) && removal.group.is_none() => {
                    state.borrow_mut().busy = false;
                    return cx.with(|host| host.toast(Toast::new(Variant::Error, error)));
                }
                Err(error) if !not_found(&error) => failed += 1,
                _ => done.push(id),
            }
        }
        let mut shown = state.borrow_mut();
        cx.with(|host| shown.forget(host, &done));
        let t = shown.t();
        match (&removal.group, failed) {
            (None, _) => cx.with(|host| host.toast(Toast::new(Variant::Success, (t.removed)(removal.total)))),
            (Some(_), failed) if failed > 0 => {
                cx.with(|host| host.toast(Toast::new(Variant::Error, (t.group_failed)(failed))))
            }
            (Some(label), _) => {
                cx.with(|host| host.toast(Toast::new(Variant::Success, (t.group_removed)(label, removal.total))))
            }
        }
        if removal.group.is_some() && shown.schedule_refresh() {
            let state = state.clone();
            cx.spawn(move |cx| refresh_later(cx, state));
        }
    }
    state.borrow_mut().busy = false;
}

/// TS `scheduleRefresh`'s timer: a refresh once 300 ms passed with no change heard. A change during the wait waits
/// 300 ms more, so the refresh runs 300 to 600 ms after the last change.
async fn refresh_later(cx: Cx, state: Rc<RefCell<State>>) {
    loop {
        let armed = state.borrow().armed;
        let slept = cx.sleep(Duration::from_millis(300)).await;
        if slept.is_ok() && state.borrow().armed != armed {
            continue;
        }
        state.borrow_mut().debouncing = false;
        if slept.is_ok() {
            refresh(cx, state).await;
        }
        return;
    }
}

/// TS `SessionManagerPage`'s signals.
struct State {
    origin: Option<String>,
    from: Option<String>,
    sessions: Vec<Session>,
    projects: HashMap<String, String>,
    loading: bool,
    error: Option<String>,
    busy: bool,
    collapsed: HashSet<String>,
    selected: Option<String>,
    last: usize,
    now: f64,
    query: String,
    searching: bool,
    mode: Mode,
    children: bool,
    locale: Locale,
    /// The refreshes started; the last one's list is the page's.
    refreshes: u64,
    /// The flow a handler asked for, which starts once it returns.
    start: Option<Flow>,
    /// The changes heard ([`State::schedule_refresh`]), and whether a refresh waits for them to stop.
    armed: u64,
    debouncing: bool,
}

impl Default for State {
    fn default() -> Self {
        Self {
            origin: None,
            from: None,
            sessions: Vec::new(),
            projects: HashMap::new(),
            loading: true,
            error: None,
            busy: false,
            collapsed: HashSet::new(),
            selected: None,
            last: 0,
            now: now(),
            query: String::new(),
            searching: false,
            mode: Mode::Directory,
            children: false,
            locale: Locale::En,
            refreshes: 0,
            start: None,
            armed: 0,
            debouncing: false,
        }
    }
}

/// What the page lists now: its groups and their rows.
struct Listed {
    groups: Vec<Group>,
    rows: Vec<Row>,
}

impl State {
    fn t(&self) -> &'static Messages {
        self.locale.messages()
    }

    /// TS's mount: a new page, with the stored settings, which reads the sessions.
    fn mount(&mut self, host: &dyn Host) {
        let stored = host.storage_get(SETTINGS).unwrap_or(Value::Null);
        *self = State {
            from: self.origin.clone(),
            origin: self.origin.take(),
            refreshes: self.refreshes,
            armed: self.armed,
            debouncing: self.debouncing,
            mode: stored.get("mode").and_then(Value::as_str).and_then(Mode::parse).unwrap_or(Mode::Directory),
            children: stored.get("showChildren") == Some(&Value::Bool(true)),
            locale: stored.get("locale").and_then(Value::as_str).and_then(Locale::parse).unwrap_or(Locale::En),
            ..State::default()
        };
        self.refresh();
    }

    /// TS `refresh`, once the handler returns.
    fn refresh(&mut self) {
        self.start = Some(Flow::Refresh);
    }

    /// A change was heard: whether a refresh must start waiting for the changes to stop ([`refresh_later`]).
    fn schedule_refresh(&mut self) -> bool {
        self.armed += 1;
        !std::mem::replace(&mut self.debouncing, true)
    }

    fn listed_now(&self, read: &dyn Read) -> Listed {
        let text = |session: &Session| {
            format!(
                "{} {} {}",
                session.title.as_deref().unwrap_or_default(),
                format_path(&session.directory),
                session.directory
            )
        };
        let shown = grouping::filter(&self.sessions, &self.query, text, self.children);
        let t = self.t();
        let label = |key: &str| match self.mode {
            Mode::Directory => format_path(key),
            Mode::Project if key == "global" => t.no_project.to_owned(),
            Mode::Project => self.projects.get(key).cloned().unwrap_or_else(|| key.to_owned()),
            _ => t.buckets[key.parse::<usize>().unwrap_or(4)].to_owned(),
        };
        let wall = |time: f64| time + f64::from(read.utc_offset(time as i64)) * 1000.0;
        let groups = grouping::groups(&self.sessions, &shown, self.mode, self.children, self.now, &wall, label);
        let rows = grouping::rows(&groups, &self.collapsed);
        Listed { groups, rows }
    }

    fn key(&self, listed: &Listed, row: &Row) -> String {
        match row {
            Row::Group { group, .. } => format!("g:{}", listed.groups[*group].key),
            Row::Session { session, .. } => format!("s:{}", self.sessions[*session].id),
        }
    }

    /// TS `index`: the selected row, else the one at the last index.
    fn index(&self, listed: &Listed) -> Option<usize> {
        if listed.rows.is_empty() {
            return None;
        }
        let found = listed.rows.iter().position(|row| Some(self.key(listed, row)) == self.selected);
        Some(found.unwrap_or_else(|| self.last.min(listed.rows.len() - 1)))
    }

    /// TS `select`, and the scroll that keeps it in view.
    fn select(&mut self, host: &dyn Host, listed: &Listed, target: isize) {
        if listed.rows.is_empty() {
            return;
        }
        let clamped = target.clamp(0, listed.rows.len() as isize - 1) as usize;
        self.last = clamped;
        self.selected = Some(self.key(listed, &listed.rows[clamped]));
        scroll_to(host, clamped);
    }

    fn event(&mut self, host: &dyn Host, event: &Event) -> Handled {
        match event {
            Event::Mount { mounted: true, .. } => {
                self.mount(host);
                Handled::Pass
            }
            Event::Change { node, text, .. } if node == SEARCH => {
                self.query = text.clone();
                self.searching = true;
                Handled::Pass
            }
            Event::Key(key) => match key.bind.as_deref() {
                // A layer holds while nothing else is asked; the other's key goes on.
                Some(name) if !self.busy => match (name.strip_prefix("list:"), name.strip_prefix("search:")) {
                    (Some(name), _) if !self.searching => self.list_key(host, name),
                    (_, Some(name)) if self.searching => self.search_key(host, name),
                    _ => Handled::Pass,
                },
                _ => Handled::Pass,
            },
            _ => Handled::Pass,
        }
    }

    fn list_key(&mut self, host: &dyn Host, name: &str) -> Handled {
        let listed = self.listed_now(host);
        let index = self.index(&listed).map_or(-1, |index| index as isize);
        let page = (host.info().size.1 as isize - 8).max(1);
        match name {
            "up" => self.select(host, &listed, index - 1),
            "down" => self.select(host, &listed, index + 1),
            "page-up" => self.select(host, &listed, index - page),
            "page-down" => self.select(host, &listed, index + page),
            "first" => self.select(host, &listed, 0),
            "last" => self.select(host, &listed, listed.rows.len() as isize - 1),
            "open" => self.activate(host, &listed),
            "fold" => {
                if let Some(row) = self.index(&listed).map(|index| &listed.rows[index]) {
                    self.fold(&listed.groups[group_of(row)].key.clone());
                }
            }
            "next-mode" => self.set_mode(host, self.mode.step(1)),
            "previous-mode" => self.set_mode(host, self.mode.step(-1)),
            "children" => self.toggle_children(host),
            "rename" => self.rename(&listed),
            "delete" => self.remove_one(&listed),
            "delete-group" => self.remove_group(&listed),
            "refresh" => self.refresh(),
            "search" => self.start_search(host),
            "language" => self.set_locale(host, self.locale.next()),
            "back" => match self.query.trim().is_empty() {
                true => self.back(host),
                false => self.clear_search(host),
            },
            _ => return Handled::Pass,
        }
        Handled::Consume
    }

    fn search_key(&mut self, host: &dyn Host, name: &str) -> Handled {
        let listed = self.listed_now(host);
        let index = self.index(&listed).map_or(-1, |index| index as isize);
        let page = (host.info().size.1 as isize - 8).max(1);
        match name {
            "up" => self.select(host, &listed, index - 1),
            "down" => self.select(host, &listed, index + 1),
            "page-up" => self.select(host, &listed, index - page),
            "page-down" => self.select(host, &listed, index + page),
            "finish" => self.finish_search(host),
            "clear" => self.clear_search(host),
            _ => return Handled::Pass,
        }
        Handled::Consume
    }

    fn fold(&mut self, key: &str) {
        if !self.collapsed.remove(key) {
            self.collapsed.insert(key.to_owned());
        }
    }

    /// TS `activate`: a group folds, a session opens.
    fn activate(&mut self, host: &dyn Host, listed: &Listed) {
        match self.index(listed).map(|index| &listed.rows[index]) {
            Some(Row::Group { group, .. }) => self.fold(&listed.groups[*group].key.clone()),
            Some(Row::Session { session, .. }) => {
                host.navigate(Route::Session { id: self.sessions[*session].id.clone() })
            }
            None => {}
        }
    }

    /// TS `back`: the session it was opened from, while it exists, else home.
    fn back(&self, host: &dyn Host) {
        match self.from.as_ref().filter(|from| self.sessions.iter().any(|session| session.id == **from)) {
            Some(from) => host.navigate(Route::Session { id: from.clone() }),
            None => host.navigate(Route::Home),
        }
    }

    fn set_mode(&mut self, host: &dyn Host, mode: Mode) {
        self.collapsed.clear();
        self.mode = mode;
        self.persist(host);
    }

    fn toggle_children(&mut self, host: &dyn Host) {
        self.children = !self.children;
        self.persist(host);
    }

    fn set_locale(&mut self, host: &dyn Host, locale: Locale) {
        self.locale = locale;
        self.persist(host);
    }

    /// TS `persist`, as its store writes it: the fields that differ from what is stored, or from the defaults.
    fn persist(&self, host: &dyn Host) {
        let stored = host.storage_get(SETTINGS).filter(Value::is_object);
        let base = stored.unwrap_or_else(|| json!({ "mode": "directory", "showChildren": false, "locale": "en" }));
        let draft = json!({ "mode": self.mode.name(), "showChildren": self.children, "locale": self.locale.code() });
        let fields: serde_json::Map<String, Value> = draft
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(key, value)| base.get(key.as_str()) != Some(value))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        if !fields.is_empty() {
            host.storage_merge(SETTINGS, fields);
        }
    }

    /// TS `startSearch`: the field shows, and takes the focus as the view that shows it is adopted (`focus-input`).
    fn start_search(&mut self, host: &dyn Host) {
        self.searching = true;
        host.focus(SEARCH);
    }

    fn finish_search(&mut self, host: &dyn Host) {
        self.searching = false;
        host.blur();
    }

    fn clear_search(&mut self, host: &dyn Host) {
        self.query.clear();
        self.finish_search(host);
    }

    /// A click on row `index`: the selected one opens or folds, another is selected.
    fn clicked(&mut self, host: &dyn Host, index: &str) {
        let listed = self.listed_now(host);
        let Ok(index) = index.parse::<usize>() else { return };
        match self.index(&listed) == Some(index) {
            true => self.activate(host, &listed),
            false => self.select(host, &listed, index as isize),
        }
    }

    fn clicked_mode(&mut self, host: &dyn Host, name: &str) {
        if let Some(mode) = Mode::parse(name) {
            self.set_mode(host, mode);
        }
    }

    fn clicked_locale(&mut self, host: &dyn Host, code: &str) {
        if let Some(locale) = Locale::parse(code) {
            self.set_locale(host, locale);
        }
    }

    /// TS `rename`: a prompt for the selected session's new title.
    fn rename(&mut self, listed: &Listed) {
        let Some(Row::Session { session, .. }) = self.index(listed).map(|index| &listed.rows[index]) else { return };
        let session = &self.sessions[*session];
        self.busy = true;
        let prompt = Prompt::ask(self.t().rename_title)
            .description(format_path(&session.directory))
            .value(session.title.clone().unwrap_or_default());
        self.start = Some(Flow::Rename { id: session.id.clone(), prompt });
    }

    /// TS `removeOne`: asks, then deletes the selected session.
    fn remove_one(&mut self, listed: &Listed) {
        let Some(Row::Session { session, .. }) = self.index(listed).map(|index| &listed.rows[index]) else { return };
        let session = &self.sessions[*session];
        let t = self.t();
        let total = grouping::with_descendants(std::slice::from_ref(&session.id), &self.sessions);
        let mut lines = vec![(t.remove_message)(session.title())];
        if total > 1 {
            lines.push((t.remove_children)(total - 1));
        }
        if self.from.as_deref() == Some(&session.id) {
            lines.push(t.remove_current.to_owned());
        }
        lines.push(t.irreversible.to_owned());
        self.busy = true;
        let confirm = confirm(t.remove_title, lines, t.confirm, t.cancel);
        self.start = Some(Flow::Remove(Removal { confirm, ids: vec![session.id.clone()], total, group: None }));
    }

    /// TS `removeGroup`: asks, then deletes the selected group's top-level sessions, one after another.
    fn remove_group(&mut self, listed: &Listed) {
        let Some(row) = self.index(listed).map(|index| &listed.rows[index]) else { return };
        let group = &listed.groups[group_of(row)];
        let ids: Vec<String> = group.roots.iter().map(|tree| self.sessions[tree.session].id.clone()).collect();
        if ids.is_empty() {
            return;
        }
        let total = grouping::with_descendants(&ids, &self.sessions);
        let current = self.from.as_ref().is_some_and(|from| self.contains(&ids, from));
        let t = self.t();
        let mut lines = vec![(t.group_message)(t.modes[self.mode.index()], &group.label, total)];
        if current {
            lines.push(t.group_current.to_owned());
        }
        if !self.query.trim().is_empty() {
            lines.push(t.group_filtered.to_owned());
        }
        lines.push(t.irreversible.to_owned());
        self.busy = true;
        let confirm = confirm(&(t.group_title)(&group.label), lines, &(t.group_confirm)(total), t.cancel);
        self.start = Some(Flow::Remove(Removal { confirm, ids, total, group: Some(group.label.clone()) }));
    }

    /// TS `containsSession`: whether `target` is one of `roots` or under one.
    fn contains(&self, roots: &[String], target: &str) -> bool {
        let by_id: HashMap<&str, &Session> =
            self.sessions.iter().map(|session| (session.id.as_str(), session)).collect();
        let mut cursor = by_id.get(target);
        while let Some(session) = cursor {
            if roots.contains(&session.id) {
                return true;
            }
            cursor = session.parent.as_deref().and_then(|parent| by_id.get(parent));
        }
        false
    }

    /// TS `forgetDeleted`: the deleted sessions and their descendants go, and their tabs close.
    fn forget(&mut self, host: &dyn Host, ids: &[String]) {
        let mut removed: HashSet<String> = HashSet::new();
        let mut todo: Vec<String> = ids.to_vec();
        while let Some(id) = todo.pop() {
            if removed.insert(id.clone()) {
                todo.extend(
                    self.sessions
                        .iter()
                        .filter(|session| session.parent.as_deref() == Some(&id))
                        .map(|session| session.id.clone()),
                );
            }
        }
        if self.from.as_ref().is_some_and(|from| removed.contains(from)) {
            self.from = None;
        }
        if host.tabs_enabled() {
            for id in &removed {
                host.edit_tab(TabEdit::Close { session: Some(id.clone()) });
            }
        }
        self.sessions.retain(|session| !removed.contains(&session.id));
    }

    /// The page, as TS's JSX draws it.
    fn view(&self, read: &dyn Read) -> v2::Node {
        let t = self.t();
        let listed = self.listed_now(read);
        let count: usize = listed.groups.iter().map(|group| group.count).sum();
        let filtered = !self.query.trim().is_empty();
        let mut rows = vec![self.header(t, count)];
        if self.searching || filtered {
            rows.push(self.search_row(t, count, filtered));
        }
        rows.push(self.body(read, t, &listed, filtered));
        rows.push(hints(t));
        v2::Node::column(rows).gap(1).padding_sides(Edges::new(1, 2, 1, 2)).layout(Layout::default().grow())
    }

    fn header(&self, t: &Messages, count: usize) -> v2::Node {
        let modes = grouping::MODES
            .iter()
            .map(|mode| {
                let (text, color) = match *mode == self.mode {
                    true => (format!("[{}]", t.modes[mode.index()]), "text.action.primary.base"),
                    false => (format!(" {} ", t.modes[mode.index()]), "text.muted"),
                };
                v2::Node::text([Span::new(text)])
                    .fg(color)
                    .wrap(Wrap::None)
                    .layout(Layout::default().shrink(false))
                    .on_click(Click::command("session-manager.mode").input(mode.name()))
            })
            .collect();
        let locales = LOCALES
            .iter()
            .enumerate()
            .map(|(position, locale)| {
                let mut spans = Vec::new();
                if position > 0 {
                    spans.push(Span::new(" | ").fg("text.faint"));
                }
                spans.push(match *locale == self.locale {
                    true => Span::new(locale.label()).bold(),
                    false => Span::new(locale.label()),
                });
                let color = if *locale == self.locale { "text.action.primary.base" } else { "text.muted" };
                v2::Node::text(spans)
                    .fg(color)
                    .wrap(Wrap::None)
                    .layout(Layout::default().shrink(false))
                    .on_click(Click::command("session-manager.locale").input(locale.code()))
            })
            .collect();
        v2::Node::row(vec![
            v2::Node::text([Span::new(t.title).bold()])
                .fg("text.base")
                .wrap(Wrap::None)
                .layout(Layout::default().shrink(false)),
            v2::Node::row(modes).gap(1).layout(Layout::default().shrink(true).min_width(0)),
            v2::Node::column(Vec::new()).layout(Layout::default().grow()),
            v2::Node::text([Span::new(format!("{} · {}", (t.children)(self.children), (t.total)(count)))])
                .fg("text.muted")
                .wrap(Wrap::None)
                .layout(Layout::default().shrink(false))
                .on_click(Click::command("session-manager.children")),
            v2::Node::row(locales).layout(Layout::default().shrink(false)),
        ])
        .gap(2)
        .layout(Layout::default().shrink(false))
    }

    fn search_row(&self, t: &Messages, count: usize, filtered: bool) -> v2::Node {
        let input = v2::Node::input(self.query.clone())
            .with_id(SEARCH)
            .placeholder(t.placeholder)
            .layout(Layout::default().grow());
        let mut row = vec![
            v2::Node::text([Span::new("/")])
                .fg(if self.searching { "text.action.primary.base" } else { "text.muted" })
                .wrap(Wrap::None)
                .layout(Layout::default().shrink(false)),
            input,
        ];
        if filtered {
            row.push(
                v2::Node::text([Span::new((t.matches)(count))])
                    .fg("text.muted")
                    .wrap(Wrap::None)
                    .layout(Layout::default().shrink(false)),
            );
        }
        v2::Node::row(row).gap(1).layout(Layout::default().shrink(false))
    }

    fn body(&self, read: &dyn Read, t: &Messages, listed: &Listed, filtered: bool) -> v2::Node {
        if self.loading {
            return v2::Node::text([Span::new(t.loading)]).fg("text.muted");
        }
        if let Some(error) = &self.error {
            return v2::Node::text([Span::new((t.load_failed)(error))]).fg("text.feedback.error.base");
        }
        if listed.rows.is_empty() {
            let empty = if filtered { (t.no_match)(self.query.trim()) } else { t.empty.to_owned() };
            return v2::Node::text([Span::new(empty)]).fg("text.muted");
        }
        let selected = self.index(listed);
        let rows = listed
            .rows
            .iter()
            .enumerate()
            .map(|(index, row)| self.row(read, t, listed, index, row, selected == Some(index)))
            .collect();
        v2::Node::scroll(rows).with_id(ROWS).layout(Layout::default().grow())
    }

    fn row(&self, read: &dyn Read, t: &Messages, listed: &Listed, index: usize, row: &Row, selected: bool) -> v2::Node {
        let wall = |time: f64| time + f64::from(read.utc_offset(time as i64)) * 1000.0;
        let click = Click::command("session-manager.row").input(index.to_string());
        let bg = |node: v2::Node| if selected { node.bg("background.raised.high") } else { node };
        match row {
            Row::Group { group, collapsed } => {
                let group = &listed.groups[*group];
                let line = v2::Node::row(vec![
                    v2::Node::text([Span::new(if *collapsed { "▶" } else { "▼" })])
                        .fg("text.action.primary.base")
                        .wrap(Wrap::None)
                        .layout(Layout::default().shrink(false)),
                    v2::Node::text([
                        Span::new(group.label.clone()).bold(),
                        Span::new(format!(" ({})", group.count)).fg("text.muted"),
                    ])
                    .fg("text.base")
                    .wrap(Wrap::None)
                    .truncate()
                    .layout(Layout::default().grow().shrink(true).min_width(0)),
                ])
                .gap(1)
                .on_click(click);
                let top = if index == 0 { 0 } else { 1 };
                v2::Node::column(vec![bg(line)]).with_id(row_id(index)).padding_sides(Edges::new(top, 0, 0, 0))
            }
            Row::Session { session, depth, prefix, .. } => {
                let session = &self.sessions[*session];
                let running = self.status(session);
                let from = self.from.as_deref() == Some(&session.id);
                let (marker, color) = match (running, from) {
                    (true, _) => ("◆ ", "text.feedback.info.base"),
                    (false, true) => ("● ", "text.feedback.success.base"),
                    _ => ("· ", "text.faint"),
                };
                let mut line = vec![
                    v2::Node::text([
                        Span::new(prefix.clone()).fg("text.faint"),
                        Span::new(marker).fg(color),
                        Span::new(session.title().to_owned()),
                    ])
                    .fg(if *depth > 0 { "text.muted" } else { "text.base" })
                    .wrap(Wrap::None)
                    .truncate()
                    .layout(Layout::default().grow().shrink(true).min_width(0)),
                ];
                if self.mode != Mode::Directory && *depth == 0 {
                    // TS's `maxWidth={40}`, which the layout cannot say.
                    line.push(
                        v2::Node::text([Span::new(format_path(&session.directory))])
                            .fg("text.faint")
                            .wrap(Wrap::None)
                            .truncate(),
                    );
                }
                let time = session.time(if matches!(self.mode, Mode::Directory | Mode::Project) {
                    Mode::Updated
                } else {
                    self.mode
                });
                line.push(
                    v2::Node::text([Span::new(grouping::age(time, self.now, &wall, t))])
                        .fg("text.muted")
                        .wrap(Wrap::None)
                        .layout(Layout::default().shrink(false)),
                );
                bg(v2::Node::row(line)
                    .with_id(row_id(index))
                    .gap(1)
                    .padding_sides(Edges::new(0, 0, 0, 2))
                    .on_click(click))
            }
        }
    }

    /// Whether `session` runs: the host's status of it, which the page reads as it draws.
    fn status(&self, _session: &Session) -> bool {
        false
    }
}

/// The hints row.
fn hints(t: &Messages) -> v2::Node {
    let keys = ["↑↓", "Enter", "Tab", "c", "r", "d", "D", "/", "F5", "l", "Esc"];
    let order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let hints = order
        .iter()
        .map(|&index| {
            v2::Node::text([
                Span::new(keys[index]).fg("text.base"),
                Span::new(format!(" {}", t.hints[index])).fg("text.muted"),
            ])
            .wrap(Wrap::None)
            .layout(Layout::default().shrink(false))
        })
        .collect();
    v2::Node::row(hints).gap(2).flex_wrap().layout(Layout::default().shrink(false))
}

/// A confirm of `lines` with its own labels.
fn confirm(title: &str, lines: Vec<String>, yes: &str, no: &str) -> Confirm {
    Confirm::ask(title, lines.join("\n")).labels(yes, no)
}

fn group_of(row: &Row) -> usize {
    match row {
        Row::Group { group, .. } | Row::Session { group, .. } => *group,
    }
}

fn row_id(index: usize) -> String {
    format!("session-manager-row-{index}")
}

/// TS `scrollChildIntoView` of row `index`.
fn scroll_to(host: &dyn Host, index: usize) {
    let target = Target::Node { surface: ROUTE.to_owned(), id: ROWS.to_owned() };
    host.scroll(target, Scroll::To { node: row_id(index), align: ScrollAlign::Nearest { inset: 0 } });
}

/// A page of the session list, newest first.
fn page(cursor: Option<&str>) -> Call<Value> {
    let order = Some(SessionListInputOrder::Desc);
    let cursor = cursor.map(|cursor| SessionsCursor(cursor.to_owned()));
    client::session_list(&SessionListInput { limit: Some(PAGE_SIZE as i64), order, cursor, ..Default::default() })
        .cast()
}

/// TS `isNotFound`.
fn not_found(error: &str) -> bool {
    let error = error.to_lowercase();
    error.contains("notfound") || error.contains("not found") || error.contains("404")
}

/// TS `ui.format.path`: the home directory as `~`.
fn format_path(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    match path.strip_prefix(&home) {
        Some(rest) if !home.is_empty() && (rest.is_empty() || rest.starts_with('/')) => format!("~{rest}"),
        _ => path.to_owned(),
    }
}

/// `Date.now()`.
fn now() -> f64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0.0, |since| since.as_millis() as f64)
}

plugin!(id = "session-manager", setup);
