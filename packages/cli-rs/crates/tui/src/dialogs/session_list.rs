//! Session list dialog (E.11a, row DLG16): `packages/tui/src/component/dialog-session-list.tsx`.
//!
//! "Sessions": the root sessions of the picker's location (or of every project, `ctrl+a`), newest
//! first under date headings, with pinned sessions on top. The list is read from the server with
//! the typed search, debounced by 150 ms. Actions: open, pin, delete (press twice), and rename.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    LocationGetInput, LocationPublicInfo, LocationQueryInput, Project, ProjectListInput, SessionID,
    SessionInfo, SessionListInput, SessionListInputOrder, SessionRemoveInput,
};
use opencode_local::cli_config::TabsScope;
use opencode_store::SessionStatus;
use opencode_store::state::State as Store;
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize};
use opencode_ui::keymap::TuiCommand;
use opencode_ui::motion::Spinner;
use opencode_ui::select::{
    self, FooterHint, Gutter, Select, SelectAction, SelectOption, SelectProps,
};
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;
use serde_json::{Value, json};

use crate::app::Tui;
use crate::routes::Route;

/// `limit` of every list read.
const LIMIT: i64 = 50;
/// `createDebouncedSignal("", 150)`.
const SEARCH_DEBOUNCE: Duration = Duration::from_millis(150);

/// Opens the dialog (`session.list`).
pub fn show(tui: &Tui) {
    let all_projects = load_all_projects(tui);
    let list = Rc::new(List {
        tui: tui.weak(),
        title: View::new(&tui.app).row(),
        select: RefCell::new(None),
        state: RefCell::new(State {
            filter: String::new(),
            search: String::new(),
            to_delete: None,
            all_projects,
            location: None,
            projects: Vec::new(),
            loading: true,
            results: None,
            request: 0,
        }),
        timer: Cell::new(None),
    });
    let current = match tui.route() {
        Route::Session { id } => Some(id),
        _ => None,
    };
    let built = list.clone();
    tui.dialogs.replace(
        move |cx| {
            let list = built;
            let weak = Rc::downgrade(&list);
            let mut props = SelectProps::dynamic(
                "Sessions",
                Rc::new({
                    let weak = weak.clone();
                    move |filter: &str| {
                        let Some(list) = weak.upgrade() else {
                            return Vec::new();
                        };
                        list.state.borrow_mut().filter = filter.to_owned();
                        list.options()
                    }
                }),
            );
            props.title_view = Some(list.title.as_any());
            props.search_in_title = true;
            props.title_placeholder = Some(list.placeholder());
            props.skip_filter = true;
            props.current = current;
            props.on_filter = Some(Rc::new({
                let weak = weak.clone();
                move |_: &str| {
                    if let Some(list) = weak.upgrade() {
                        list.debounce_search();
                    }
                }
            }));
            props.on_move = Some(Rc::new({
                let weak = weak.clone();
                move |_: &SelectOption<SessionID>| {
                    let Some(list) = weak.upgrade() else { return };
                    if list.state.borrow_mut().to_delete.take().is_some() {
                        list.refresh_later();
                    }
                }
            }));
            props.on_select = Some(Rc::new({
                let weak = weak.clone();
                move |option: &SelectOption<SessionID>| {
                    let Some(tui) = weak.upgrade().and_then(|list| list.tui.upgrade()) else {
                        return;
                    };
                    let id = option.value.clone();
                    let app = tui.app.clone();
                    let weak = tui.weak();
                    app.defer(move |_| {
                        let Some(tui) = weak.upgrade() else { return };
                        // Closed first, so the new view takes the focus.
                        tui.dialogs.clear();
                        tui.navigate(Route::Session { id });
                    });
                }
            }));
            let tabs = list
                .tui
                .upgrade()
                .is_some_and(|tui| tui.config().tabs.enabled);
            props.actions = vec![
                SelectAction {
                    hidden: tabs,
                    ..SelectAction::new("session.pin.toggle", "pin/unpin", {
                        let weak = weak.clone();
                        move |option: &SelectOption<SessionID>| {
                            if let Some(list) = weak.upgrade() {
                                list.toggle_pin(&option.value);
                            }
                        }
                    })
                },
                SelectAction::new("session.delete", "delete", {
                    let weak = weak.clone();
                    move |option: &SelectOption<SessionID>| {
                        if let Some(list) = weak.upgrade() {
                            list.delete(&option.value);
                        }
                    }
                }),
                SelectAction::new("session.rename", "rename", {
                    let weak = weak.clone();
                    move |option: &SelectOption<SessionID>| {
                        let Some(tui) = weak.upgrade().and_then(|list| list.tui.upgrade()) else {
                            return;
                        };
                        let (id, title) = (option.value.clone(), option.title.clone());
                        let app = tui.app.clone();
                        let weak = tui.weak();
                        app.defer(move |_| {
                            if let Some(tui) = weak.upgrade() {
                                crate::dialogs::rename::show(&tui, id, Some(title));
                            }
                        });
                    }
                }),
            ];
            props.bindings = vec![
                TuiCommand::inline("ctrl+a", {
                    let weak = weak.clone();
                    move |_, _| {
                        if let Some(list) = weak.upgrade() {
                            list.toggle_all_projects();
                        }
                    }
                })
                .title(if all_projects {
                    "Show current directory sessions"
                } else {
                    "Show all project sessions"
                })
                .group("Dialog"),
            ];
            props.dynamic_hints = Some(Rc::new({
                let weak = weak.clone();
                move || weak.upgrade().map(|list| list.hints()).unwrap_or_default()
            }));
            let empty: Rc<dyn Fn() -> AnyWidget> = Rc::new({
                let weak = weak.clone();
                let app = cx.app.clone();
                let theme = cx.theme.clone();
                move || {
                    let (message, error) = weak
                        .upgrade()
                        .map(|list| list.search_state())
                        .unwrap_or_default();
                    View::new(&app)
                        .padding_x(DIALOG_LIST_INSET)
                        .child(&Text::new(&app, message).fg(if error {
                            theme.text.feedback.error.base
                        } else {
                            theme.text.muted
                        }))
                        .as_any()
                }
            });
            props.empty_view = Some(empty.clone());
            props.no_match_view = Some(empty);
            let (view, select) = select::select(cx, props);
            *list.select.borrow_mut() = Some(select);
            list.render_title(&cx.theme);
            // The dialog owns the list; handlers hold weak references.
            cx.on_close(opentui::keymap::Disposer::new(move || {
                if let Some(timer) = list.timer.take() {
                    list.app().map(|app| app.cancel_timer(timer));
                }
                list.select.borrow_mut().take();
            }));
            view
        },
        None,
        DialogOptions {
            size: DialogSize::Large,
            key: None,
        },
    );
    list.load();
}

struct List {
    tui: Weak<Tui>,
    /// `titleView`: "Sessions", then " for <project>" while scoped to one project.
    title: View,
    select: RefCell<Option<Select<SessionID>>>,
    state: RefCell<State>,
    timer: Cell<Option<TimerId>>,
}

struct State {
    filter: String,
    /// The debounced filter the list read uses.
    search: String,
    /// The session the first delete press marked.
    to_delete: Option<SessionID>,
    all_projects: bool,
    location: Option<LocationPublicInfo>,
    projects: Vec<Project>,
    loading: bool,
    /// The newest finished read (`searchResults.latest`).
    results: Option<Results>,
    /// Numbers reads, so only the newest one lands.
    request: u64,
}

#[derive(Clone)]
struct Results {
    query: String,
    all_projects: bool,
    sessions: Vec<SessionInfo>,
    error: bool,
}

impl List {
    fn app(&self) -> Option<App> {
        self.tui.upgrade().map(|tui| tui.app.clone())
    }

    /// The picker location, then the project list and the first read.
    fn load(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let directory = picker_directory(&tui);
        let client = tui.data.client().clone();
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                let input = LocationGetInput {
                    location: Some(LocationQueryInput {
                        directory: Some(directory),
                    }),
                };
                let options = RequestOptions::default();
                let (location, projects) = futures_util::future::join(
                    client.location_get(&input, &options),
                    client.project_list(&ProjectListInput::default(), &options),
                )
                .await;
                (location.ok(), projects.unwrap_or_default())
            },
            move |_, (location, projects)| {
                let Some(list) = weak.upgrade() else { return };
                {
                    let mut state = list.state.borrow_mut();
                    state.location = location;
                    state.projects = projects;
                }
                list.fetch();
            },
        );
    }

    /// Reads the list for the current search and scope (the `searchResults` resource).
    fn fetch(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let (query, all_projects, location, request) = {
            let mut state = self.state.borrow_mut();
            state.request += 1;
            state.loading = true;
            (
                state.search.trim().to_owned(),
                state.all_projects,
                state.location.clone(),
                state.request,
            )
        };
        self.refresh();
        let client = tui.data.client().clone();
        let weak = Rc::downgrade(self);
        let input = location.map(|location| list_input(&location, &query, all_projects));
        tui.app.spawn(
            async move {
                // TS throws "Location unavailable" here, which degrades like a failed read.
                read(&client, &input?).await
            },
            move |_, sessions| {
                let Some(list) = weak.upgrade() else { return };
                {
                    let mut state = list.state.borrow_mut();
                    if state.request != request {
                        return;
                    }
                    state.loading = false;
                    state.results = Some(Results {
                        query,
                        all_projects,
                        error: sessions.is_none(),
                        sessions: sessions.unwrap_or_default(),
                    });
                }
                list.refresh();
            },
        );
    }

    fn debounce_search(self: &Rc<Self>) {
        let Some(app) = self.app() else { return };
        if let Some(timer) = self.timer.take() {
            app.cancel_timer(timer);
        }
        let weak = Rc::downgrade(self);
        self.timer
            .set(Some(app.set_timeout(SEARCH_DEBOUNCE, move |_| {
                let Some(list) = weak.upgrade() else { return };
                list.timer.set(None);
                let changed = {
                    let mut state = list.state.borrow_mut();
                    let next = state.filter.clone();
                    let changed = next.trim() != state.search.trim();
                    state.search = next;
                    changed
                };
                // A resource refetches only when its source changes; the trimmed query is the source.
                if changed {
                    list.fetch();
                    return;
                }
                list.refresh();
            })));
    }

    fn toggle_all_projects(self: &Rc<Self>) {
        let all_projects = {
            let mut state = self.state.borrow_mut();
            state.all_projects = !state.all_projects;
            state.all_projects
        };
        if let Some(tui) = self.tui.upgrade()
            && let Some(storage) = tui.storage()
        {
            let initial = json!({ "allProjects": tui.config().tabs.scope != TabsScope::Cwd });
            tui.app.runtime().spawn_blocking(move || {
                let result = storage.update("session-list", &initial, |draft| {
                    if let Value::Object(map) = draft {
                        map.insert("allProjects".into(), Value::Bool(all_projects));
                    }
                });
                if let Err(error) = result {
                    log::warn!("failed to save session-list: {error}");
                }
            });
        }
        self.fetch();
    }

    fn toggle_pin(self: &Rc<Self>, id: &SessionID) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        pins::toggle(&tui, id);
        self.refresh();
    }

    fn delete(self: &Rc<Self>, id: &SessionID) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if self.state.borrow().to_delete.as_ref() != Some(id) {
            self.state.borrow_mut().to_delete = Some(id.clone());
            self.refresh_later();
            return;
        }
        let client = tui.data.client().clone();
        let input = SessionRemoveInput {
            session_id: id.clone(),
        };
        let weak = Rc::downgrade(self);
        let toasts = tui.weak();
        let id = id.clone();
        tui.app.spawn(
            async move {
                client
                    .session_remove(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(list) = weak.upgrade() else { return };
                match result {
                    Ok(()) => {
                        if let Some(results) = &mut list.state.borrow_mut().results {
                            results.sessions.retain(|session| session.id != id);
                        }
                    }
                    Err(error) => {
                        list.state.borrow_mut().to_delete = None;
                        if let Some(tui) = toasts.upgrade() {
                            tui.toasts.show(
                                ToastOptions::new(
                                    Variant::Error,
                                    format!("Failed to delete session: {error}"),
                                )
                                .duration(Duration::from_millis(5000)),
                            );
                        }
                    }
                }
                list.refresh();
            },
        );
    }

    /// Refreshes after the current select handler returns.
    fn refresh_later(self: &Rc<Self>) {
        let Some(app) = self.app() else { return };
        let weak = Rc::downgrade(self);
        app.defer(move |_| {
            if let Some(list) = weak.upgrade() {
                list.refresh();
            }
        });
    }

    fn refresh(&self) {
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_options(self.options());
        }
        if let Some(tui) = self.tui.upgrade() {
            self.render_title(&dialog_theme(&tui));
        }
    }

    fn render_title(&self, theme: &Theme) {
        let Some(app) = self.app() else { return };
        self.title.clear();
        self.title
            .add(&Text::new(&app, "Sessions").fg(theme.text.base).bold());
        let name = self.project_name();
        if !self.state.borrow().all_projects && !name.is_empty() {
            self.title
                .add(&Text::new(&app, format!(" for {name}")).fg(theme.text.muted));
        }
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_placeholder(&self.placeholder());
        }
    }

    /// `titlePlaceholder`.
    fn placeholder(&self) -> String {
        let name = self.project_name();
        if !self.state.borrow().all_projects && !name.is_empty() {
            return format!("Search sessions in {name}");
        }
        "Search sessions".to_owned()
    }

    /// `currentProjectName`.
    fn project_name(&self) -> String {
        let state = self.state.borrow();
        let Some(current) = &state.location else {
            return String::new();
        };
        let project = state
            .projects
            .iter()
            .find(|project| project.id == current.project.id);
        project_name(project).unwrap_or_default()
    }

    /// `sessions()`: the read's results, or the loaded sessions while a read is pending or failed.
    fn sessions(&self, store: &Store) -> Vec<SessionInfo> {
        let state = self.state.borrow();
        let query = state.filter.trim();
        let local = || local_sessions(store, &state, query);
        if query != state.search.trim() {
            return state
                .results
                .as_ref()
                .map_or_else(local, |results| results.sessions.clone());
        }
        if state.loading {
            return state
                .results
                .as_ref()
                .map(|results| results.sessions.clone())
                .unwrap_or_default();
        }
        match &state.results {
            Some(results)
                if results.query == query
                    && results.all_projects == state.all_projects
                    && !results.error =>
            {
                results.sessions.clone()
            }
            _ => local(),
        }
    }

    /// `searchState`: the empty-list message and whether it is an error.
    fn search_state(&self) -> (String, bool) {
        let state = self.state.borrow();
        let query = state.filter.trim();
        if query != state.search.trim() || state.loading {
            let message = if query.is_empty() {
                "Loading sessions…"
            } else {
                "Searching sessions…"
            };
            return (message.into(), false);
        }
        if let Some(results) = &state.results
            && results.query == query
            && results.error
        {
            let message = if query.is_empty() {
                "Could not load sessions."
            } else {
                "Could not search sessions. Change the search to try again."
            };
            return (message.into(), true);
        }
        let message = if query.is_empty() {
            "No sessions available"
        } else {
            "No sessions found"
        };
        (message.into(), false)
    }

    fn hints(&self) -> Vec<FooterHint> {
        let all = self.state.borrow().all_projects;
        vec![FooterHint {
            title: if all {
                "current directory"
            } else {
                "all projects"
            }
            .into(),
            label: "ctrl+a".into(),
            group: None,
        }]
    }

    /// `options()`.
    fn options(&self) -> Vec<SelectOption<SessionID>> {
        let Some(tui) = self.tui.upgrade() else {
            return Vec::new();
        };
        let theme = dialog_theme(&tui);
        let tabs = tui.config().tabs.enabled;
        let pinned_ids = if tabs { Vec::new() } else { pins::list(&tui) };
        let slots: HashMap<SessionID, usize> = if tabs {
            HashMap::new()
        } else {
            pins::slots(&tui)
                .into_iter()
                .enumerate()
                .map(|(index, id)| (id, index + 1))
                .collect()
        };
        let delete_key = tui.keymap.shortcut("session.delete").unwrap_or_default();
        let state = self.state.borrow();
        let to_delete = state.to_delete.clone();
        let projects = state.projects.clone();
        drop(state);
        tui.data.read(|store| {
            let sessions: Vec<SessionInfo> = self
                .sessions(store)
                .into_iter()
                .filter(|session| session.parent_id.is_none())
                .collect();
            let by_id: HashMap<&SessionID, &SessionInfo> = sessions
                .iter()
                .map(|session| (&session.id, session))
                .collect();
            let pinned: Vec<&SessionID> = pinned_ids
                .iter()
                .filter(|id| by_id.contains_key(id))
                .collect();
            let pinned_set: HashSet<&SessionID> = pinned.iter().copied().collect();
            let today = date_string(now_ms());
            let option = |session: &SessionInfo, category: String| {
                let project = projects
                    .iter()
                    .find(|project| project.id == session.project_id);
                let deleting = to_delete.as_ref() == Some(&session.id);
                let mut option = SelectOption::new(
                    if deleting {
                        format!("Press {delete_key} again to confirm")
                    } else {
                        title(session)
                    },
                    session.id.clone(),
                )
                .category(category);
                option.footer = footer(session, project);
                if deleting {
                    option.bg = Some(theme.background.action.destructive.focused);
                    option.fg = Some(theme.text.action.destructive.focused);
                }
                let attention = attention(store, &session.id);
                let slot = slots.get(&session.id).copied();
                option.gutter = status_gutter(
                    &theme,
                    attention,
                    attention.is_none() && running(store, &session.id),
                    slot.map(|slot| {
                        let color = theme.accent().step(200);
                        Rc::new(move |app: &App, _: Color| {
                            Text::new(app, slot.to_string()).fg(color).as_any()
                        }) as Gutter
                    }),
                );
                option
            };
            let mut options: Vec<SelectOption<SessionID>> = pinned
                .iter()
                .map(|id| option(by_id[id], "Pinned".into()))
                .collect();
            options.extend(
                sessions
                    .iter()
                    .filter(|session| !pinned_set.contains(&session.id))
                    .map(|session| {
                        let date = date_string(session.time.updated);
                        option(session, if date == today { "Today".into() } else { date })
                    }),
            );
            options
        })
    }
}

/// `useTheme().surface("dialog")`.
pub fn dialog_theme(tui: &Tui) -> Theme {
    tui.page().surface(opencode_ui::theme::Surface::Dialog)
}

/// `localSessions()`: loaded sessions of the picker location (or all), matched by title.
fn local_sessions(store: &Store, state: &State, query: &str) -> Vec<SessionInfo> {
    let query = query.to_lowercase();
    store
        .sessions()
        .into_iter()
        .filter(|session| {
            session.time.archived.is_none()
                && (state.all_projects
                    || state.location.as_ref().is_some_and(|current| {
                        session.project_id == current.project.id
                            && session.location.directory == current.directory
                    }))
        })
        .filter(|session| {
            query.is_empty()
                || (session.parent_id.is_none() && title(session).to_lowercase().contains(&query))
        })
        .cloned()
        .collect()
}

/// The list read's scope (`dialog-session-list.tsx:63-77`).
fn list_input(location: &LocationPublicInfo, query: &str, all_projects: bool) -> SessionListInput {
    let mut input = SessionListInput {
        search: (!query.is_empty()).then(|| query.to_owned()),
        limit: Some(LIMIT),
        order: Some(SessionListInputOrder::Desc),
        parent_id: Some(None),
        archived: Some(false),
        ..SessionListInput::default()
    };
    if all_projects {
        return input;
    }
    if location.project.id.0 == "global" {
        input.directory = Some(location.directory.clone());
        return input;
    }
    input.project = Some(location.project.id.clone());
    input.subpath = Some(
        relative(
            location.project.directory.as_str(),
            location.directory.as_str(),
        )
        .replace('\\', "/")
        .into(),
    );
    input
}

async fn read(client: &Client, input: &SessionListInput) -> Option<Vec<SessionInfo>> {
    client
        .session_list(input, &RequestOptions::default())
        .await
        .map(|response| response.data)
        .ok()
}

/// `pickerLocation()`: the open session's location, else the default location.
fn picker_directory(tui: &Tui) -> String {
    let session = match tui.route() {
        Route::Session { id } => tui.data.read(|state| {
            state
                .session(&id)
                .map(|session| session.location.directory.0.clone())
        }),
        _ => None,
    };
    session.unwrap_or_else(|| tui.directory.clone())
}

/// `prefs.allProjects` from the `session-list` storage key.
fn load_all_projects(tui: &Tui) -> bool {
    let initial = tui.config().tabs.scope != TabsScope::Cwd;
    tui.storage()
        .and_then(|storage| storage.load("session-list", &json!({})).ok())
        .and_then(|value| value.get("allProjects").and_then(Value::as_bool))
        .unwrap_or(initial)
}

/// A row's footer: the checkout name when the session's root is outside its project.
fn footer(session: &SessionInfo, project: Option<&Project>) -> Option<String> {
    let directory = session.location.directory.as_str();
    let root = match &session.subpath {
        Some(subpath) => {
            let ups = subpath.as_str().split('/').count();
            resolve_up(directory, ups)
        }
        None => directory.to_owned(),
    };
    let from = project.map_or(root.as_str(), |project| project.canonical.as_str());
    let relative = relative(from, &root);
    (relative.starts_with("..") || relative.starts_with('/'))
        .then(|| select::truncate(basename(&relative), 25))
}

/// `withTimestampedFallback`: the title, else `New session - <ISO time>`.
pub fn title(session: &SessionInfo) -> String {
    if let Some(title) = &session.title {
        return title.clone();
    }
    let kind = if session.parent_id.is_some() {
        "Child"
    } else {
        "New"
    };
    let created = chrono::DateTime::from_timestamp_millis(session.time.created as i64)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ");
    format!("{kind} session - {created}")
}

/// `projectName`.
pub fn project_name(project: Option<&Project>) -> Option<String> {
    let canonical = project.map_or("", |project| project.canonical.as_str());
    if canonical == "/" {
        return None;
    }
    project
        .and_then(|project| project.name.clone())
        .filter(|name| !name.is_empty())
        .or_else(|| Some(basename(canonical).to_owned()))
}

/// `sessionTabs.status(id).attention`: `permission` while a family member waits on one. Forms
/// (`question`) join once the store holds them (F.8).
pub fn attention(store: &Store, id: &SessionID) -> Option<char> {
    let root = store.root(id);
    let mut members = std::iter::once(&root).chain(store.family(&root));
    members
        .any(|member| {
            store
                .permissions(member)
                .is_some_and(|list| !list.is_empty())
        })
        .then_some('!')
}

/// The session or a family member is running.
pub fn running(store: &Store, id: &SessionID) -> bool {
    store.status(id) == SessionStatus::Running
        || store
            .family(id)
            .iter()
            .any(|member| store.status(member) == SessionStatus::Running)
}

/// `sessionStatusGutter`.
pub fn status_gutter(
    theme: &Theme,
    attention: Option<char>,
    running: bool,
    fallback: Option<Gutter>,
) -> Option<Gutter> {
    if let Some(mark) = attention {
        let (focused, warning) = (
            theme.text.action.primary.focused,
            theme.text.feedback.warning.base,
        );
        return Some(Rc::new(move |app: &App, color: Color| {
            Text::new(app, mark.to_string())
                .fg(if color == focused { color } else { warning })
                .bold()
                .as_any()
        }));
    }
    if running {
        return Some(Rc::new(|app: &App, color: Color| {
            Spinner::new(app).color(color).as_any()
        }));
    }
    fallback
}

/// `new Date(ms).toDateString()` in local time.
pub fn date_string(ms: f64) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .with_timezone(&chrono::Local)
        .format("%a %b %d %Y")
        .to_string()
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

/// `path.basename` (POSIX).
pub fn basename(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    trimmed.rsplit('/').next().unwrap_or(trimmed)
}

/// `path.resolve(directory, "..", …)` with `ups` parent steps (POSIX).
fn resolve_up(directory: &str, ups: usize) -> String {
    let mut parts: Vec<&str> = directory
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    for _ in 0..ups {
        parts.pop();
    }
    format!("/{}", parts.join("/"))
}

/// `path.relative(from, to)` for absolute POSIX paths.
fn relative(from: &str, to: &str) -> String {
    let split = |path: &str| -> Vec<String> {
        path.split('/')
            .filter(|part| !part.is_empty() && *part != ".")
            .map(str::to_owned)
            .collect()
    };
    let (from, to) = (split(from), split(to));
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".to_owned(); from.len() - common];
    parts.extend(to[common..].iter().cloned());
    parts.join("/")
}

/// Pinned sessions in `<state>/session.json` (`context/local.tsx:508-603`), shared with the TS
/// TUI. Read once per state directory and kept in memory, as TS does. Each pin, unpin, and prune is
/// written in order on one worker thread, under the file's lock, from what the file holds then
/// (`opencode_local::pins`).
pub mod pins {
    use std::sync::OnceLock;

    use opencode_local::serial::Serial;

    use super::*;

    thread_local! {
        static PINS: RefCell<HashMap<Option<PathBuf>, Vec<SessionID>>> = RefCell::default();
    }

    /// The pinned session IDs, oldest pin first.
    pub fn list(tui: &Tui) -> Vec<SessionID> {
        let key = tui.state_dir();
        PINS.with(|pins| {
            pins.borrow_mut()
                .entry(key.clone())
                .or_insert_with(|| {
                    key.as_deref()
                        .map(opencode_local::pins::load)
                        .unwrap_or_default()
                        .into_iter()
                        .map(SessionID)
                        .collect()
                })
                .clone()
        })
    }

    /// `slots()`: pins of loaded root sessions, at most nine.
    pub fn slots(tui: &Tui) -> Vec<SessionID> {
        let pinned = list(tui);
        tui.data.read(|state| {
            pinned
                .into_iter()
                .filter(|id| {
                    state
                        .session(id)
                        .is_some_and(|session| session.parent_id.is_none())
                })
                .take(9)
                .collect()
        })
    }

    /// `togglePin`.
    pub fn toggle(tui: &Tui, id: &SessionID) {
        let pinned = !list(tui).contains(id);
        set(tui, id, pinned);
    }

    /// `prune` on `session.deleted`: the file loses the pin even when only another client had it.
    pub fn prune(tui: &Tui, id: &SessionID) {
        set(tui, id, false);
    }

    fn set(tui: &Tui, id: &SessionID, pinned: bool) {
        let mut list = list(tui);
        list.retain(|pin| pin != id);
        if pinned {
            list.push(id.clone());
        }
        let key = tui.state_dir();
        PINS.with(|pins| pins.borrow_mut().insert(key.clone(), list));
        let Some(state) = key else { return };
        let id = id.0.clone();
        static WRITER: OnceLock<Serial> = OnceLock::new();
        WRITER
            .get_or_init(|| Serial::new("session.json"))
            .run(move || {
                if let Err(error) = opencode_local::pins::set(&state, &id, pinned) {
                    log::warn!("failed to save session.json: {error}");
                }
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_follow_node() {
        assert_eq!(relative("/a/b", "/a/b"), "");
        assert_eq!(relative("/a/b", "/a/c/d"), "../c/d");
        assert_eq!(relative("/a/b", "/a/b/c"), "c");
        assert_eq!(resolve_up("/a/b/c", 2), "/a");
        assert_eq!(basename("../c/d"), "d");
        assert_eq!(basename(".."), "..");
    }
}
