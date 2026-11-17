//! A port of `@0xuwui/opencode-session-manager` 0.1.2 (`src/tui.tsx`, `src/panel.tsx`): `/session-manager` opens a page
//! of every session, grouped by directory, project, or when they were created, updated or viewed, with their
//! subsessions as a tree; the keys move a selection through it, fold groups, search in a field, rename a session and
//! delete one or a whole group, each after asking. The grouping, the subsessions and the language are kept.
//!
//! Where it differs from TS: the rename prompt cannot be filled with the session's title or show its directory (a
//! prompt has a title and a placeholder only), so it shows the title as the placeholder; the search field takes the
//! focus at the next wake, once the host's tree holds it, so keys typed in the same burst as `/` are lost; dates are
//! read in UTC; and a command has one slash name, so TS's `/sm` alias is not there.

mod grouping;
mod i18n;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use grouping::{Group, Mode, Row, Session};
use i18n::{LOCALES, Locale, Messages};
use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin_abi::v2::{self, Scroll, ScrollAlign, Target};
use opencode_plugin_abi::{
    Action, Click, Command, Confirm, Dialog, Edges, Fetch, Host, Layout, Prompt, Read, RequestId, Route, Setup, Span,
    TabEdit, Toast, Variant, Waker, Wrap, plugin,
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
    // The session `/session-manager` was opened from (TS's route data `from`).
    let open = Command::new("session-manager.open")
        .title("Session Manager")
        .description("Browse, rename and delete sessions grouped by directory, project or time")
        .group("Session")
        .palette()
        .slash("session-manager");
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
    // The page's clicks and the dialogs' answers come back as commands.
    for (name, run) in [
        ("session-manager.row", State::clicked as fn(&mut State, &dyn Host, &str)),
        ("session-manager.mode", State::clicked_mode),
        ("session-manager.locale", State::clicked_locale),
        ("session-manager.children", |state, host, _| state.toggle_children(host)),
        ("session-manager.search", |state, host, _| state.start_search(host)),
        ("session-manager.renamed", State::renamed),
        // The prompt closed: without an answer (escape), the page takes keys again.
        ("session-manager.rename-closed", |state, _, _| {
            if state.renaming.take().is_some() {
                state.busy = false;
            }
        }),
        ("session-manager.removed", State::confirmed_remove),
        ("session-manager.group-removed", State::confirmed_group),
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
    let (viewed, heard) = (state.clone(), state.clone());
    let page = v2::Surface::new(ROUTE, v2::Place::Route(ROUTE.to_owned()), move |view| viewed.borrow().view(view.read))
        .mounts()
        .layers(vec![layer(&LIST_KEYS, "list:"), layer(&SEARCH_KEYS, "search:")])
        .on(move |host, event| heard.borrow_mut().event(host, event));
    setup.surface(page);
    let events = ["session.created", "session.deleted", "session.renamed", "session.archived"];
    let changed = state.clone();
    setup.on_event(&events, move |_, _| changed.borrow_mut().schedule_refresh());
    let replied = state.clone();
    setup.on_reply(move |host, id, reply| replied.borrow_mut().reply(host, id, reply));
    // TS refreshes 300 ms after the last change it heard; a thread keeps that time and wakes the host.
    if let Some(waker) = setup.waker() {
        let timer = Timer::start(waker.clone());
        state.borrow_mut().timer = Some(timer.clone());
        state.borrow_mut().waker = Some(waker);
        let woken = state.clone();
        setup.on_wake(move |host| {
            let mut state = woken.borrow_mut();
            if std::mem::take(&mut state.focus) && state.searching {
                host.focus(SEARCH);
            }
            if state.timer.as_ref().is_some_and(Timer::take) {
                state.refresh(host);
            }
        });
        setup.on_dispose(move |_| timer.stop());
    }
    Ok(())
}

/// What a request in flight is for.
enum Want {
    /// A page of the session list.
    Page,
    Projects,
    Rename {
        id: String,
        title: String,
    },
    /// One deletion of a run of them: the sessions still to delete, and what is known so far.
    Remove(Removal),
}

struct Removal {
    left: Vec<String>,
    current: String,
    done: Vec<String>,
    failed: usize,
    total: usize,
    /// The group's label, for a whole group.
    group: Option<String>,
}

/// TS `SessionManagerPage`'s signals.
struct State {
    origin: Option<String>,
    from: Option<String>,
    sessions: Vec<Session>,
    /// The sessions read so far by a refresh.
    pages: Vec<Session>,
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
    waiting: HashMap<RequestId, Want>,
    timer: Option<Timer>,
    /// Wakes the host for a focus that must wait for the next view: the field shows only once searching.
    waker: Option<Waker>,
    /// The search field takes the focus at the next wake.
    focus: bool,
    /// The session the rename prompt asks about, until it answers or closes.
    renaming: Option<String>,
    /// What the confirm asks about, until it answers.
    removing: Option<Removal>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            origin: None,
            from: None,
            sessions: Vec::new(),
            pages: Vec::new(),
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
            waiting: HashMap::new(),
            timer: None,
            waker: None,
            focus: false,
            renaming: None,
            removing: None,
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
            timer: self.timer.take(),
            waker: self.waker.take(),
            mode: stored.get("mode").and_then(Value::as_str).and_then(Mode::parse).unwrap_or(Mode::Directory),
            children: stored.get("showChildren") == Some(&Value::Bool(true)),
            locale: stored.get("locale").and_then(Value::as_str).and_then(Locale::parse).unwrap_or(Locale::En),
            ..State::default()
        };
        self.refresh(host);
    }

    /// TS `refresh`: every page of the session list, and the projects.
    fn refresh(&mut self, host: &dyn Host) {
        self.waiting.retain(|_, want| !matches!(want, Want::Page | Want::Projects));
        self.pages.clear();
        self.ask(host, page(None), Want::Page);
        self.ask(host, Fetch::new("GET", "/api/project"), Want::Projects);
    }

    fn schedule_refresh(&mut self) {
        if let Some(timer) = &self.timer {
            timer.arm(Duration::from_millis(300));
        }
    }

    fn ask(&mut self, host: &dyn Host, fetch: Fetch, want: Want) {
        match host.try_fetch(fetch) {
            Ok(id) => drop(self.waiting.insert(id, want)),
            Err(error) => self.failed(host, want, error),
        }
    }

    fn reply(&mut self, host: &dyn Host, id: RequestId, reply: Result<Value, String>) {
        let Some(want) = self.waiting.remove(&id) else { return };
        let body = match reply {
            Ok(body) => body,
            Err(error) => return self.failed(host, want, error),
        };
        match want {
            Want::Page => {
                let data = body.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
                self.pages.extend(data.iter().filter_map(Session::from_json));
                let next = body.pointer("/cursor/next").and_then(Value::as_str).filter(|next| !next.is_empty());
                match next.filter(|_| !data.is_empty()) {
                    Some(next) => {
                        let next = next.to_owned();
                        self.ask(host, page(Some(&next)), Want::Page);
                    }
                    None => self.listed(),
                }
            }
            Want::Projects => {
                let list = body.get("data").unwrap_or(&body).as_array().cloned().unwrap_or_default();
                self.projects = list
                    .iter()
                    .filter_map(|project| {
                        let id = project.get("id")?.as_str()?.to_owned();
                        let name =
                            project.get("name").and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty());
                        let canonical = project.get("canonical").and_then(Value::as_str).unwrap_or_default();
                        Some((id, name.map_or_else(|| format_path(canonical), str::to_owned)))
                    })
                    .collect();
                if !self.waiting.values().any(|want| matches!(want, Want::Page)) {
                    self.listed();
                }
            }
            Want::Rename { id, title } => {
                if let Some(session) = self.sessions.iter_mut().find(|session| session.id == id) {
                    session.title = Some(title.clone());
                }
                self.busy = false;
                host.toast(Toast::new(Variant::Success, (self.t().renamed)(&title)));
            }
            Want::Remove(mut removal) => {
                removal.done.push(removal.current.clone());
                self.next_removal(host, removal);
            }
        }
    }

    /// A request failed: TS's `catch` of what asked for it.
    fn failed(&mut self, host: &dyn Host, want: Want, error: String) {
        match want {
            Want::Page | Want::Projects => {
                self.waiting.retain(|_, want| !matches!(want, Want::Page | Want::Projects));
                self.error = Some(error);
                self.loading = false;
            }
            Want::Rename { .. } => {
                self.busy = false;
                host.toast(Toast::new(Variant::Error, error));
            }
            Want::Remove(mut removal) => {
                // A session already gone is deleted.
                match not_found(&error) {
                    true => removal.done.push(removal.current.clone()),
                    false if removal.group.is_none() => {
                        self.busy = false;
                        return host.toast(Toast::new(Variant::Error, error));
                    }
                    false => removal.failed += 1,
                }
                self.next_removal(host, removal);
            }
        }
    }

    /// The list is read: TS's `setSessions` with the selection on the session it came from.
    fn listed(&mut self) {
        if self.waiting.values().any(|want| matches!(want, Want::Page | Want::Projects)) {
            return;
        }
        self.sessions = std::mem::take(&mut self.pages);
        if self.selected.is_none()
            && let Some(from) = &self.from
        {
            self.selected = Some(format!("s:{from}"));
        }
        self.now = now();
        self.error = None;
        self.loading = false;
    }

    fn listed_now(&self) -> Listed {
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
        let groups = grouping::groups(&self.sessions, &shown, self.mode, self.children, self.now, label);
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
        let listed = self.listed_now();
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
            "rename" => self.rename(host, &listed),
            "delete" => self.remove_one(host, &listed),
            "delete-group" => self.remove_group(host, &listed),
            "refresh" => self.refresh(host),
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
        let listed = self.listed_now();
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

    /// TS `startSearch`: the field shows, and takes the focus once it does (`focus-input`): a focus asked in this call
    /// would name a field the host's tree does not hold yet.
    fn start_search(&mut self, host: &dyn Host) {
        self.searching = true;
        match &self.waker {
            Some(waker) => {
                self.focus = true;
                waker.wake();
            }
            None => host.focus(SEARCH),
        }
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
        let listed = self.listed_now();
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
    fn rename(&mut self, host: &dyn Host, listed: &Listed) {
        let Some(Row::Session { session, .. }) = self.index(listed).map(|index| &listed.rows[index]) else { return };
        let session = &self.sessions[*session];
        self.busy = true;
        let prompt = Prompt::new(self.t().rename_title, Action::command("session-manager.renamed"))
            .placeholder(session.title.clone().unwrap_or_default());
        let dismissed = Action::command("session-manager.rename-closed").input(session.id.clone());
        self.renaming = Some(session.id.clone());
        host.dialog(Dialog::Dismissable { dialog: Box::new(Dialog::Prompt(prompt)), dismissed });
    }

    fn renamed(&mut self, host: &dyn Host, text: &str) {
        let Some(id) = self.renaming.take() else { return };
        let title = text.trim();
        let current = self.sessions.iter().find(|session| session.id == id).and_then(|session| session.title.clone());
        if title.is_empty() || Some(title) == current.as_deref() {
            self.busy = false;
            return;
        }
        let fetch = Fetch::new("PATCH", format!("/api/session/{id}")).body(json!({ "title": title }));
        self.ask(host, fetch, Want::Rename { id, title: title.to_owned() });
    }

    /// TS `removeOne`: asks, then deletes the selected session.
    fn remove_one(&mut self, host: &dyn Host, listed: &Listed) {
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
        self.removing = Some(Removal {
            left: vec![session.id.clone()],
            current: String::new(),
            done: Vec::new(),
            failed: 0,
            total,
            group: None,
        });
        host.dialog(confirm(t.remove_title, lines, t.confirm, t.cancel, "session-manager.removed"));
    }

    /// TS `removeGroup`: asks, then deletes the selected group's top-level sessions, one after another.
    fn remove_group(&mut self, host: &dyn Host, listed: &Listed) {
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
        self.removing = Some(Removal {
            left: ids,
            current: String::new(),
            done: Vec::new(),
            failed: 0,
            total,
            group: Some(group.label.clone()),
        });
        host.dialog(confirm(
            &(t.group_title)(&group.label),
            lines,
            &(t.group_confirm)(total),
            t.cancel,
            "session-manager.group-removed",
        ));
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

    fn confirmed_remove(&mut self, host: &dyn Host, answer: &str) {
        self.confirmed(host, answer);
    }

    fn confirmed_group(&mut self, host: &dyn Host, answer: &str) {
        self.confirmed(host, answer);
    }

    /// The confirm's answer: `true` deletes what it asked about.
    fn confirmed(&mut self, host: &dyn Host, answer: &str) {
        let Some(removal) = self.removing.take() else { return };
        if answer != "true" {
            self.busy = false;
            return;
        }
        self.next_removal(host, removal);
    }

    /// Deletes the next session of `removal`, or ends it: the deleted ones go, and a toast says so.
    fn next_removal(&mut self, host: &dyn Host, mut removal: Removal) {
        if let Some(next) = removal.left.first().cloned() {
            removal.left.remove(0);
            removal.current = next.clone();
            let fetch = Fetch::new("DELETE", format!("/api/session/{next}"));
            return self.ask(host, fetch, Want::Remove(removal));
        }
        self.forget(host, &removal.done);
        self.busy = false;
        let t = self.t();
        match (&removal.group, removal.failed) {
            (None, _) => host.toast(Toast::new(Variant::Success, (t.removed)(removal.total))),
            (Some(_), failed) if failed > 0 => host.toast(Toast::new(Variant::Error, (t.group_failed)(failed))),
            (Some(label), _) => host.toast(Toast::new(Variant::Success, (t.group_removed)(label, removal.total))),
        }
        if removal.group.is_some() {
            self.schedule_refresh();
        }
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
    fn view(&self, _read: &dyn Read) -> v2::Node {
        let t = self.t();
        let listed = self.listed_now();
        let count: usize = listed.groups.iter().map(|group| group.count).sum();
        let filtered = !self.query.trim().is_empty();
        let mut rows = vec![self.header(t, count)];
        if self.searching || filtered {
            rows.push(self.search_row(t, count, filtered));
        }
        rows.push(self.body(t, &listed, filtered));
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
            v2::Node::row(modes).gap(1).layout(Layout::default().shrink(true).min_width_zero()),
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

    fn body(&self, t: &Messages, listed: &Listed, filtered: bool) -> v2::Node {
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
            .map(|(index, row)| self.row(t, listed, index, row, selected == Some(index)))
            .collect();
        v2::Node::scroll(rows).with_id(ROWS).layout(Layout::default().grow())
    }

    fn row(&self, t: &Messages, listed: &Listed, index: usize, row: &Row, selected: bool) -> v2::Node {
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
                    .layout(Layout::default().grow().shrink(true).min_width_zero()),
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
                    .layout(Layout::default().grow().shrink(true).min_width_zero()),
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
                    v2::Node::text([Span::new(grouping::age(time, self.now, t))])
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

/// A confirm with its own labels, whose answer runs command `answer`.
fn confirm(title: &str, lines: Vec<String>, yes: &str, no: &str, answer: &str) -> Dialog {
    Dialog::Confirm(Confirm::new(title, lines.join("\n"), Action::command(answer)).labels(yes, no))
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
fn page(cursor: Option<&str>) -> Fetch {
    let query = [("limit", PAGE_SIZE.to_string()), ("order", "desc".to_owned())];
    Fetch::new("GET", "/api/session").query(query.into_iter().chain(cursor.map(|cursor| ("cursor", cursor.to_owned()))))
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

/// TS's `setTimeout` of the refresh: a thread that wakes the host when the time armed last comes.
#[derive(Clone)]
struct Timer {
    due: Arc<Mutex<Option<Instant>>>,
    fired: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}

impl Timer {
    fn start(waker: Waker) -> Self {
        let timer = Timer { due: Arc::default(), fired: Arc::default(), stopped: Arc::default() };
        let thread = timer.clone();
        std::thread::spawn(move || {
            while !thread.stopped.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(25));
                let mut due = thread.due.lock().unwrap_or_else(PoisonError::into_inner);
                if due.is_some_and(|due| Instant::now() >= due) {
                    *due = None;
                    thread.fired.store(true, Ordering::Release);
                    waker.wake();
                }
            }
        });
        timer
    }

    /// Fires `after` from now, replacing the time armed before (TS `clearTimeout` and `setTimeout`).
    fn arm(&self, after: Duration) {
        *self.due.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now() + after);
    }

    /// Whether it fired since the last call.
    fn take(&self) -> bool {
        self.fired.swap(false, Ordering::AcqRel)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
}

plugin!(id = "session-manager", setup);
