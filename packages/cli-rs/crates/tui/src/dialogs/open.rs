//! Open dialog (E.11a, row DLG14): `packages/tui/src/component/dialog-open.tsx`.
//!
//! "Open": recent root sessions (those awaiting input first) and the projects, in two sections
//! with `alt+up`/`alt+down` between them. An exact session ID finds a session outside the recent
//! list. `right` on a Git project lists its worktrees, where `ctrl+n` creates one.

use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    LocationGetInput, LocationPublicInfo, LocationQueryInput, Project, ProjectID, ProjectListInput,
    SessionGetInput, SessionID, SessionInfo, SessionListInput, SessionListInputOrder,
    WorktreeCreateInput, WorktreeListInput, WorktreeRefreshInput,
};
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize};
use opencode_ui::keymap::TuiCommand;
use opencode_ui::motion::Spinner;
use opencode_ui::path::abbreviate_home;
use opencode_ui::prompt::{Prompt, PromptProps, prompt};
use opencode_ui::select::{self, FooterHint, Gutter, Select, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::session_list::{
    attention, basename, dialog_theme, now_ms, project_name, running, status_gutter, title,
};
use crate::app::Tui;
use crate::routes::Route;

/// `DialogOpenKey`.
pub const KEY: &str = "open";
/// `RECENT_LIMIT`.
const RECENT_LIMIT: usize = 8;

thread_local! {
    /// `openSessions` in `app.tsx:555`: the last recent read, shown at once when the dialog reopens.
    static RECENT: RefCell<Vec<SessionInfo>> = const { RefCell::new(Vec::new()) };
}

/// What a row opens.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Session(SessionID),
    Project {
        directory: String,
        /// Set for Git projects, which list worktrees.
        project_id: Option<ProjectID>,
    },
}

#[derive(Clone, Debug, PartialEq)]
enum OpenView {
    Projects,
    Worktrees(ProjectID),
}

/// `OpenSelection`.
#[derive(Clone)]
struct Selection {
    view: OpenView,
    filter: String,
    selected: Option<Target>,
}

/// Opens the dialog (`open.menu`), unless it is open already.
pub fn show(tui: &Tui) {
    if tui.dialogs.key().as_deref() == Some(KEY) {
        return;
    }
    let open = Rc::new(Open {
        tui: tui.weak(),
        state: RefCell::new(State {
            view: OpenView::Projects,
            filter: String::new(),
            moved: false,
            sessions: RECENT.with(|recent| recent.borrow().clone()),
            recent: None,
            projects: Vec::new(),
            projects_loaded: None,
            location: None,
            matched: None,
            worktrees: None,
            refreshed: HashSet::new(),
            back: None,
        }),
        select: RefCell::new(None),
        prompt: RefCell::new(None),
        footer: View::new(&tui.app),
    });
    open.build(Selection {
        view: OpenView::Projects,
        filter: String::new(),
        selected: None,
    });
    open.load();
}

struct Open {
    tui: Weak<Tui>,
    state: RefCell<State>,
    select: RefCell<Option<Select<Target>>>,
    prompt: RefCell<Option<Prompt>>,
    /// The loading and error line under the list.
    footer: View,
}

struct State {
    view: OpenView,
    filter: String,
    /// `selectionMoved`.
    moved: bool,
    /// `props.sessions`: the recent read.
    sessions: Vec<SessionInfo>,
    /// The recent read: `None` while loading, then whether it succeeded.
    recent: Option<bool>,
    projects: Vec<Project>,
    projects_loaded: Option<bool>,
    /// The default location, for the current project marker.
    location: Option<LocationPublicInfo>,
    /// The session an exact ID in the filter names.
    matched: Option<SessionInfo>,
    /// The worktree directories of the open project; `None` while loading.
    worktrees: Option<Vec<String>>,
    refreshed: HashSet<ProjectID>,
    /// `projectsSelection`: where `left` returns to.
    back: Option<Selection>,
}

impl Open {
    fn tui(&self) -> Option<Rc<Tui>> {
        self.tui.upgrade()
    }

    /// Builds the select for `selection.view` and restores the filter and the selection.
    fn build(self: &Rc<Self>, selection: Selection) {
        let Some(tui) = self.tui() else { return };
        {
            let mut state = self.state.borrow_mut();
            state.view = selection.view.clone();
            state.moved = false;
            state.filter = selection.filter.clone();
        }
        let worktrees = match &selection.view {
            OpenView::Worktrees(id) => Some(id.clone()),
            OpenView::Projects => None,
        };
        let open = self.clone();
        let current = tui.data.read(|state| match tui.route() {
            Route::Session { id } => Some(Target::Session(state.root(&id))),
            _ => None,
        });
        tui.dialogs.replace(
            move |cx| {
                let weak = Rc::downgrade(&open);
                let mut props = SelectProps::dynamic(
                    match &worktrees {
                        Some(id) => format!("{} / Worktrees", open.project_title(id)),
                        None => "Open".into(),
                    },
                    Rc::new({
                        let weak = weak.clone();
                        move |filter: &str| {
                            let Some(open) = weak.upgrade() else {
                                return Vec::new();
                            };
                            open.state.borrow_mut().filter = filter.to_owned();
                            open.options()
                        }
                    }),
                );
                props.placeholder = Some(
                    if worktrees.is_some() {
                        "Search worktrees…"
                    } else {
                        "Search sessions and projects…"
                    }
                    .into(),
                );
                props.current = current;
                props.focus_current = selection.selected.is_some();
                props.section_navigation = true;
                props.on_move = Some(Rc::new({
                    let weak = weak.clone();
                    move |_: &SelectOption<Target>| {
                        if let Some(open) = weak.upgrade() {
                            open.state.borrow_mut().moved = true;
                        }
                    }
                }));
                props.on_filter = Some(Rc::new({
                    let weak = weak.clone();
                    move |filter: &str| {
                        if let Some(open) = weak.upgrade() {
                            open.find_exact(filter.trim());
                        }
                    }
                }));
                props.on_select = Some(Rc::new({
                    let weak = weak.clone();
                    move |option: &SelectOption<Target>| {
                        if let Some(open) = weak.upgrade() {
                            open.choose(option.value.clone());
                        }
                    }
                }));
                let back = {
                    let weak = weak.clone();
                    move || {
                        if let Some(open) = weak.upgrade() {
                            open.back();
                        }
                    }
                };
                if worktrees.is_some() {
                    props.on_cancel = Some(Rc::new(back.clone()));
                    props.bindings = vec![
                        TuiCommand::inline("left", move |_, _| back())
                            .title("Return to projects")
                            .group("Dialog"),
                        TuiCommand::inline("ctrl+n", {
                            let weak = weak.clone();
                            move |_, _| {
                                if let Some(open) = weak.upgrade() {
                                    open.new_worktree();
                                }
                            }
                        })
                        .title("New worktree")
                        .group("Dialog"),
                    ];
                    props.footer_hints = vec![FooterHint {
                        title: "new worktree".into(),
                        label: "ctrl+n".into(),
                        group: None,
                    }];
                } else {
                    props.bindings = vec![
                        TuiCommand::inline("right", {
                            let weak = weak.clone();
                            move |_, _| {
                                if let Some(open) = weak.upgrade() {
                                    open.show_worktrees();
                                }
                            }
                        })
                        .title("Show project worktrees")
                        .group("Dialog"),
                    ];
                }
                let app = cx.app.clone();
                let theme = cx.theme.clone();
                props.empty_view = Some(Rc::new({
                    let weak = weak.clone();
                    let app = app.clone();
                    let theme = theme.clone();
                    move || {
                        let loading = weak.upgrade().is_none_or(|open| {
                            let state = open.state.borrow();
                            state.recent.is_none() || state.projects_loaded.is_none()
                        });
                        let row = View::new(&app).padding_x(DIALOG_LIST_INSET);
                        if !loading {
                            row.add(
                                &Text::new(&app, "No recent sessions or projects")
                                    .fg(theme.text.muted),
                            );
                        }
                        row.as_any()
                    }
                }));
                props.no_match_view = Some(Rc::new({
                    let weak = weak.clone();
                    move || {
                        let message = weak
                            .upgrade()
                            .map(|open| open.no_match())
                            .unwrap_or_default();
                        View::new(&app)
                            .padding_x(DIALOG_LIST_INSET)
                            .child(&Text::new(&app, message).fg(theme.text.muted))
                            .as_any()
                    }
                }));
                props.footer = Some(open.footer.as_any());
                let (view, select) = select::select(cx, props);
                if !selection.filter.is_empty() {
                    select.set_filter(&selection.filter);
                }
                if let Some(target) = &selection.selected {
                    select.move_to(target);
                }
                *open.select.borrow_mut() = Some(select);
                open.render_footer();
                let owner = open.clone();
                cx.on_close(opentui::keymap::Disposer::new(move || {
                    owner.select.borrow_mut().take();
                }));
                view
            },
            None,
            DialogOptions {
                size: DialogSize::Large,
                key: Some(KEY.into()),
            },
        );
        if let Some(id) = &self.worktree_project() {
            self.load_worktrees(id.clone());
        }
    }

    fn worktree_project(&self) -> Option<ProjectID> {
        match &self.state.borrow().view {
            OpenView::Worktrees(id) => Some(id.clone()),
            OpenView::Projects => None,
        }
    }

    fn project_title(&self, id: &ProjectID) -> String {
        let state = self.state.borrow();
        project_name(state.projects.iter().find(|project| project.id == *id))
            .unwrap_or_else(|| "Project".into())
    }

    /// The recent read, the projects, and the default location.
    fn load(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        let client = tui.data.client().clone();
        let directory = tui.directory.clone();
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                let options = RequestOptions::default();
                let recent = SessionListInput {
                    limit: Some(50),
                    order: Some(SessionListInputOrder::Desc),
                    parent_id: Some(None),
                    archived: Some(false),
                    ..SessionListInput::default()
                };
                let location = LocationGetInput {
                    location: Some(LocationQueryInput {
                        directory: Some(directory),
                    }),
                };
                futures_util::future::join3(
                    client.session_list(&recent, &options),
                    client.project_list(&ProjectListInput::default(), &options),
                    client.location_get(&location, &options),
                )
                .await
            },
            move |_, (recent, projects, location)| {
                let Some(open) = weak.upgrade() else { return };
                let Some(tui) = open.tui() else { return };
                {
                    let mut state = open.state.borrow_mut();
                    state.recent = Some(recent.is_ok());
                    if let Ok(response) = recent {
                        // A session deleted while the read was in flight stays out.
                        let sessions: Vec<SessionInfo> = tui.data.read(|store| {
                            response
                                .data
                                .into_iter()
                                .filter(|session| !store.is_missing(&session.id))
                                .collect()
                        });
                        RECENT.with(|recent| *recent.borrow_mut() = sessions.clone());
                        state.sessions = sessions;
                    }
                    state.projects_loaded = Some(projects.is_ok());
                    if let Ok(projects) = projects {
                        state.projects = projects;
                    }
                    state.location = location.ok();
                }
                open.refresh();
            },
        );
    }

    /// `matched`: reads the session an exact `ses_` ID names.
    fn find_exact(self: &Rc<Self>, value: &str) {
        let Some(tui) = self.tui() else { return };
        let exact = value.len() == 30
            && value.starts_with("ses_")
            && value[4..].chars().all(|c| c.is_ascii_alphanumeric());
        if !exact {
            self.state.borrow_mut().matched = None;
            return;
        }
        let client = tui.data.client().clone();
        let id = SessionID(value.to_owned());
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                client
                    .session_get(
                        &SessionGetInput {
                            session_id: id.clone(),
                        },
                        &RequestOptions::default(),
                    )
                    .await
                    .ok()
                    .filter(|session| session.id == id)
            },
            move |_, session| {
                let Some(open) = weak.upgrade() else { return };
                open.state.borrow_mut().matched = session;
                open.refresh();
            },
        );
    }

    fn load_worktrees(self: &Rc<Self>, id: ProjectID) {
        let Some(tui) = self.tui() else { return };
        self.state.borrow_mut().worktrees = None;
        let client = tui.data.client().clone();
        let weak = Rc::downgrade(self);
        let input = WorktreeListInput {
            project_id: id.clone(),
        };
        tui.app.spawn(
            async move {
                client
                    .worktree_list(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(open) = weak.upgrade() else { return };
                let Some(tui) = open.tui() else { return };
                if open.worktree_project().as_ref() != Some(&id) {
                    return;
                }
                let directories = match result {
                    Ok(list) => list
                        .into_iter()
                        .map(|worktree| worktree.directory.0)
                        .collect(),
                    Err(error) => {
                        tui.toasts.show(
                            ToastOptions::new(Variant::Error, error.to_string())
                                .title("Loading worktrees failed"),
                        );
                        Vec::new()
                    }
                };
                let refresh = {
                    let mut state = open.state.borrow_mut();
                    state.worktrees = Some(directories);
                    state.refreshed.insert(id.clone())
                };
                // Once per project, ask the server to look for new worktrees.
                if refresh {
                    let client = tui.data.client().clone();
                    tui.app.runtime().spawn(async move {
                        let input = WorktreeRefreshInput { project_id: id };
                        let _ = client
                            .worktree_refresh(&input, &RequestOptions::default())
                            .await;
                    });
                }
                open.refresh();
            },
        );
    }

    fn refresh(&self) {
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            let previous = self.state.borrow().moved.then(|| select.selected());
            select.set_options(self.options());
            // `preserveSelection` once the user moved.
            if let Some(Some(previous)) = previous
                && select.selected().map(|option| option.value) != Some(previous.value.clone())
            {
                select.move_to(&previous.value);
            }
        }
        self.render_footer();
    }

    fn render_footer(&self) {
        let Some(tui) = self.tui() else { return };
        let theme = dialog_theme(&tui);
        let app = &tui.app;
        self.footer.clear();
        let state = self.state.borrow();
        let line: Option<AnyWidget> = match state.view {
            OpenView::Worktrees(_) => state.worktrees.is_none().then(|| {
                Spinner::new(app)
                    .color(theme.text.muted)
                    .label("Loading worktrees…")
                    .as_any()
            }),
            OpenView::Projects => {
                if state.recent.is_none() || state.projects_loaded.is_none() {
                    Some(
                        Spinner::new(app)
                            .color(theme.text.muted)
                            .label("Refreshing sessions and projects…")
                            .as_any(),
                    )
                } else {
                    let what = match (
                        state.recent == Some(false),
                        state.projects_loaded == Some(false),
                    ) {
                        (true, true) => Some("sessions and projects"),
                        (true, false) => Some("sessions"),
                        (false, true) => Some("projects"),
                        (false, false) => None,
                    };
                    what.map(|what| {
                        Text::new(app, format!("Could not refresh {what}."))
                            .fg(theme.text.feedback.error.base)
                            .as_any()
                    })
                }
            }
        };
        drop(state);
        // Hidden when empty, so it takes no place in the footer row and draws no band (TS renders nothing).
        self.footer.visible(line.is_some());
        if let Some(line) = line {
            self.footer.add(&line);
        }
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.refresh_footer();
        }
    }

    fn no_match(&self) -> String {
        let Some(tui) = self.tui() else {
            return String::new();
        };
        let state = self.state.borrow();
        if let OpenView::Worktrees(_) = state.view {
            return if state.worktrees.is_none() {
                "Loading worktrees…"
            } else {
                "No matching worktrees"
            }
            .into();
        }
        if state.recent.is_none() || state.projects_loaded.is_none() {
            return "Searching sessions and projects…".into();
        }
        match tui.keymap.shortcut("session.list") {
            Some(key) => format!("No matches · search all sessions with {key}"),
            None => "No matches".into(),
        }
    }

    fn options(&self) -> Vec<SelectOption<Target>> {
        match self.worktree_project() {
            Some(id) => self.worktree_options(&id),
            None => self.project_view_options(),
        }
    }

    /// `options()`: sessions, then projects.
    fn project_view_options(&self) -> Vec<SelectOption<Target>> {
        let Some(tui) = self.tui() else {
            return Vec::new();
        };
        let theme = dialog_theme(&tui);
        let state = self.state.borrow();
        let home = home();
        let width = u32::from(tui.app.size().0)
            .saturating_sub(2)
            .min(DialogSize::Large.width());
        let content = select::content_width(width) as i64;
        let now = now_ms();
        // Read before the store lock: the tabs read the store themselves.
        let tabs: HashSet<String> = tui.tabs.open_ids(&tui).into_iter().collect();
        let current = tui.tabs.current(&tui);
        let mut options: Vec<SelectOption<Target>> = tui.data.read(|store| {
            let mut seen = HashSet::new();
            let matched = state.matched.as_ref();
            let mut sessions: Vec<&SessionInfo> = store
                .sessions()
                .into_iter()
                .chain(state.sessions.iter())
                .chain(matched)
                .filter(|session| {
                    if session.parent_id.is_some() || seen.contains(&session.id) {
                        return false;
                    }
                    if session.time.archived.is_some()
                        && Some(&session.id) != matched.map(|matched| &matched.id)
                    {
                        return false;
                    }
                    seen.insert(session.id.clone());
                    true
                })
                .collect();
            sessions.sort_by(|a, b| {
                let (x, y) = (
                    attention(store, &a.id).is_some(),
                    attention(store, &b.id).is_some(),
                );
                y.cmp(&x).then(b.time.updated.total_cmp(&a.time.updated))
            });
            // With an empty query the recents leave out open tabs, which the strip shows, unless a
            // background tab awaits input; typing searches every session.
            let candidates: Vec<&SessionInfo> = sessions
                .iter()
                .copied()
                .filter(|session| {
                    !tabs.contains(&session.id.0)
                        || (attention(store, &session.id).is_some()
                            && current.as_deref() != Some(session.id.0.as_str()))
                })
                .collect();
            let attention_count = candidates
                .iter()
                .filter(|session| attention(store, &session.id).is_some())
                .count();
            let recent: Vec<&SessionInfo> = if state.filter.trim().is_empty() {
                candidates
                    .into_iter()
                    .take(RECENT_LIMIT.max(attention_count))
                    .collect()
            } else {
                sessions
            };
            recent
                .into_iter()
                .map(|session| {
                    let project = state
                        .projects
                        .iter()
                        .find(|project| project.id == session.project_id);
                    let name = project_name(project).unwrap_or_default();
                    let base = basename(session.location.directory.as_str());
                    let label = if !name.is_empty()
                        && Some(session.location.directory.as_str())
                            != project.map(|project| project.canonical.as_str())
                        && name.to_lowercase() != base.to_lowercase()
                    {
                        format!("{name} · {base}")
                    } else if name.is_empty() {
                        base.to_owned()
                    } else {
                        name
                    };
                    let mark = attention(store, &session.id);
                    let mut option =
                        SelectOption::new(title(session), Target::Session(session.id.clone()))
                            .search_text(format!(
                                "{} {}",
                                session.id.0, session.location.directory.0
                            ))
                            .category("Sessions")
                            .footer(format!(
                                "{}{}",
                                if label.is_empty() {
                                    String::new()
                                } else {
                                    format!("{} · ", select::truncate(&label, 30))
                                },
                                time_ago(now, session.time.updated)
                            ));
                    let accent = theme.accent().step(200);
                    let tab: Option<Gutter> = tabs.contains(&session.id.0).then(|| {
                        Rc::new(move |app: &App, _: Color| Text::new(app, "▪").fg(accent).as_any())
                            as Gutter
                    });
                    option.gutter = status_gutter(
                        &theme,
                        mark,
                        mark.is_none() && running(store, &session.id),
                        tab,
                    );
                    option
                })
                .collect()
        });

        let current = tui.directory.as_str();
        let current_project = state
            .location
            .as_ref()
            .map(|location| location.project.canonical.as_str());
        let mut projects: Vec<&Project> = state
            .projects
            .iter()
            .filter(|project| project.time.archived.is_none())
            .collect();
        projects.sort_by_key(|project| std::cmp::Reverse(project.time.active));
        let mut canonicals = HashSet::new();
        for project in projects
            .into_iter()
            .filter(|project| project.canonical.as_str() != "/")
            // Historical project identities can share a checkout; the newest-active one stays.
            .filter(|project| canonicals.insert(project.canonical.0.clone()))
        {
            let directory = project.canonical.as_str();
            let title = project_name(Some(project)).unwrap_or_else(|| basename(directory).into());
            let footer = abbreviate_home(directory, &home);
            let git = project
                .vcs
                .as_ref()
                .is_some_and(|vcs| vcs.as_str() == "git");
            let width = content - title.width() as i64 - if git { 2 } else { 0 };
            let mut option = SelectOption::new(
                title,
                Target::Project {
                    directory: directory.to_owned(),
                    project_id: git.then(|| project.id.clone()),
                },
            )
            .footer(format!(
                "{}{}",
                truncate_file_path(&footer, width),
                if git { " →" } else { "" }
            ))
            .search_text(format!(
                "{footer} {}",
                project_name(Some(project)).unwrap_or_default()
            ))
            .category("Projects");
            if directory == current || Some(directory) == current_project {
                option.gutter = Some(selected_mark(theme.text.formfield.selected));
            }
            options.push(option);
        }
        options
    }

    /// `worktreeOptions()`.
    fn worktree_options(&self, id: &ProjectID) -> Vec<SelectOption<Target>> {
        let Some(tui) = self.tui() else {
            return Vec::new();
        };
        let theme = dialog_theme(&tui);
        let state = self.state.borrow();
        let Some(project) = state.projects.iter().find(|project| project.id == *id) else {
            return Vec::new();
        };
        let canonical = project.canonical.as_str();
        let current = tui.directory.as_str();
        let home = home();
        let mut directories: Vec<&str> = vec![canonical];
        directories.extend(state.worktrees.iter().flatten().map(String::as_str));
        let title = |directory: &str| {
            if directory == canonical {
                project_name(Some(project)).unwrap_or_else(|| basename(directory).into())
            } else {
                basename(directory).to_owned()
            }
        };
        let dialog = u32::from(tui.app.size().0)
            .saturating_sub(2)
            .min(DialogSize::Large.width());
        let widest = directories
            .iter()
            .map(|directory| title(directory).width())
            .max()
            .unwrap_or(0);
        let width = (select::content_width(dialog) as i64 - widest as i64).max(0);
        let mut seen = HashSet::new();
        directories.retain(|directory| seen.insert(*directory));
        // Stable: the project root first, then the current directory.
        directories.sort_by_key(|directory| {
            if *directory == canonical {
                0
            } else if *directory == current {
                1
            } else {
                2
            }
        });
        directories
            .into_iter()
            .map(|directory| {
                let footer = truncate_file_path(&abbreviate_home(directory, &home), width);
                let pad = (width as usize).saturating_sub(footer.width());
                let mut option = SelectOption::new(
                    title(directory),
                    Target::Project {
                        directory: directory.to_owned(),
                        project_id: None,
                    },
                )
                .footer(format!("{footer}{}", " ".repeat(pad)));
                if directory == current {
                    option.gutter = Some(selected_mark(theme.text.formfield.selected));
                }
                option
            })
            .collect()
    }

    fn snapshot(&self) -> Selection {
        let select = self.select.borrow().clone();
        Selection {
            view: self.state.borrow().view.clone(),
            filter: select.as_ref().map(Select::filter).unwrap_or_default(),
            selected: select
                .and_then(|select| select.selected())
                .map(|option| option.value),
        }
    }

    /// `right`: the worktrees of the selected Git project.
    fn show_worktrees(self: &Rc<Self>) {
        let selected = self
            .select
            .borrow()
            .as_ref()
            .and_then(Select::selected)
            .map(|option| option.value);
        let Some(Target::Project {
            directory,
            project_id: Some(id),
        }) = selected
        else {
            return;
        };
        let back = self.snapshot();
        self.state.borrow_mut().back = Some(back);
        let open = self.clone();
        self.defer(move || {
            open.build(Selection {
                view: OpenView::Worktrees(id),
                filter: String::new(),
                selected: Some(Target::Project {
                    directory,
                    project_id: None,
                }),
            })
        });
    }

    /// `left` and Escape in the worktrees: back to the projects as they were.
    fn back(self: &Rc<Self>) {
        let Some(selection) = self.state.borrow_mut().back.clone() else {
            return;
        };
        let open = self.clone();
        self.defer(move || open.build(selection));
    }

    /// `ctrl+n`: the new worktree prompt.
    fn new_worktree(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        let Some(id) = self.worktree_project() else {
            return;
        };
        let previous = self.snapshot();
        let title = format!("{} / New worktree", self.project_title(&id));
        let theme = dialog_theme(&tui);
        let open = self.clone();
        self.defer(move || {
            let Some(tui) = open.tui() else { return };
            let weak = Rc::downgrade(&open);
            let cancel = {
                let weak = weak.clone();
                let previous = previous.clone();
                move || {
                    if let Some(open) = weak.upgrade() {
                        let previous = previous.clone();
                        let reopen = open.clone();
                        open.defer(move || reopen.build(previous));
                    }
                }
            };
            let built = open.clone();
            tui.dialogs.replace(
                move |cx| {
                    let (view, handle) = prompt(
                        cx,
                        PromptProps {
                            title,
                            size: DialogSize::Large,
                            placeholder: Some("Worktree name (optional)".into()),
                            description: Some(Rc::new(move |cx| {
                                Text::new(&cx.app, "Leave blank for a random name.")
                                    .fg(theme.text.muted)
                                    .as_any()
                            })),
                            busy_text: Some("Creating worktree…".into()),
                            on_cancel: Some(Rc::new(cancel)),
                            on_confirm: Some(Rc::new(move |value: &str| {
                                if let Some(open) = weak.upgrade() {
                                    open.create_worktree(id.clone(), value.trim().to_owned());
                                }
                            })),
                            ..PromptProps::default()
                        },
                    );
                    *built.prompt.borrow_mut() = Some(handle);
                    let owner = built.clone();
                    cx.on_close(opentui::keymap::Disposer::new(move || {
                        owner.prompt.borrow_mut().take();
                    }));
                    view
                },
                None,
                DialogOptions {
                    size: DialogSize::Large,
                    key: Some(KEY.into()),
                },
            );
        });
    }

    fn create_worktree(self: &Rc<Self>, id: ProjectID, name: String) {
        let Some(tui) = self.tui() else { return };
        let Some(prompt) = self.prompt.borrow().clone() else {
            return;
        };
        prompt.set_busy(true);
        let client = tui.data.client().clone();
        let input = WorktreeCreateInput {
            project_id: id,
            name: (!name.is_empty()).then_some(name),
            ..WorktreeCreateInput::default()
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                client
                    .worktree_create(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(open) = weak.upgrade() else { return };
                let Some(tui) = open.tui() else { return };
                // The prompt closed or was replaced while the request ran.
                let Some(current) = open.prompt.borrow().clone() else {
                    return;
                };
                match result {
                    Ok(_) => {
                        tui.dialogs.clear();
                        tui.navigate(Route::Home);
                    }
                    Err(error) => {
                        current.set_busy(false);
                        tui.toasts.show(
                            ToastOptions::new(Variant::Error, error.to_string())
                                .title("Creating worktree failed"),
                        );
                    }
                }
            },
        );
    }

    fn choose(self: &Rc<Self>, target: Target) {
        let Some(tui) = self.tui() else { return };
        let weak = tui.weak();
        tui.app.defer(move |_| {
            let Some(tui) = weak.upgrade() else { return };
            tui.dialogs.clear();
            match target {
                Target::Session(id) => tui.navigate(Route::Session { id }),
                // The Rust TUI has one location until the location context lands (E.1).
                Target::Project { .. } => tui.navigate(Route::Home),
            }
        });
    }

    /// Runs `run` after the current key or select handler returns.
    fn defer(&self, run: impl FnOnce() + 'static) {
        if let Some(tui) = self.tui() {
            tui.app.defer(move |_| run());
        }
    }
}

fn selected_mark(color: Color) -> Gutter {
    Rc::new(move |app: &App, _: Color| Text::new(app, "●").fg(color).as_any())
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

/// `timeAgo`.
fn time_ago(now: f64, timestamp: f64) -> String {
    let minutes = ((now - timestamp) / 60_000.0).floor() as i64;
    if minutes < 1 {
        return "now".into();
    }
    if minutes < 60 {
        return format!("{minutes}m");
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours}h");
    }
    let days = hours / 24;
    if days < 30 {
        return format!("{days}d");
    }
    let months = days / 30;
    if months < 12 {
        return format!("{months}mo");
    }
    format!("{}y", days / 365)
}

/// `truncateFilePath` for POSIX paths: keeps the root and the basename, then as many parents as
/// fit, with `…` for the rest.
pub(crate) fn truncate_file_path(value: &str, max: i64) -> String {
    if max <= 0 {
        return String::new();
    }
    let max = max as usize;
    if value.width() <= max {
        return value.to_owned();
    }
    let root = if value.starts_with('/') { "/" } else { "" };
    let segments: Vec<&str> = value[root.len()..]
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    let base = segments.last().copied().unwrap_or(value);
    if segments.len() < 2 {
        if root.width() >= max {
            return take_start(root, max);
        }
        return format!("{root}{}", truncate_basename(base, max - root.width()));
    }
    let prefix = format!("{root}…/");
    let Some(base_width) = max.checked_sub(prefix.width()).filter(|width| *width > 0) else {
        return take_start(&prefix, max);
    };
    let compact = truncate_basename(base, base_width);
    if compact != base {
        return prefix + &compact;
    }
    let mut selected = vec![base.to_owned()];
    let mut width = prefix.width() + base.width();
    for segment in segments[..segments.len() - 1].iter().rev() {
        let next = segment.width() + 1;
        if width + next > max {
            let available = max as i64 - width as i64 - 1;
            if available > 1 {
                selected.insert(0, take_start(segment, available as usize - 1) + "…");
            }
            break;
        }
        selected.insert(0, (*segment).to_owned());
        width += next;
    }
    prefix + &selected.join("/")
}

fn truncate_basename(value: &str, max: usize) -> String {
    if value.width() <= max {
        return value.to_owned();
    }
    if max <= 1 {
        return take_start("…", max);
    }
    let dot = value.rfind('.').filter(|dot| *dot > 0);
    let extension = dot.map_or("", |dot| &value[dot..]);
    if extension.width() >= max {
        return format!("…{}", take_end(extension, max - 1));
    }
    let stem = dot.map_or(value, |dot| &value[..dot]);
    format!(
        "{}…{extension}",
        take_start(stem, max - extension.width() - 1)
    )
}

fn take_start(value: &str, max: usize) -> String {
    let mut width = 0;
    value
        .chars()
        .take_while(|c| {
            width += unicode_width::UnicodeWidthChar::width(*c).unwrap_or(0);
            width <= max
        })
        .collect()
}

fn take_end(value: &str, max: usize) -> String {
    let reversed: String = value.chars().rev().collect();
    take_start(&reversed, max).chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_paths_truncate_as_typescript_does() {
        assert_eq!(truncate_file_path("/tmp/a", 10), "/tmp/a");
        assert_eq!(
            truncate_file_path("/home/user/projects/opencode", 20),
            "/…/projects/opencode"
        );
        assert_eq!(
            truncate_file_path("/a/very-long-name.txt", 10),
            "/…/ve….txt"
        );
        assert_eq!(truncate_file_path("/x", 0), "");
    }

    #[test]
    fn time_ago_steps() {
        let minute = 60_000.0;
        assert_eq!(time_ago(10.0 * minute, 10.0 * minute), "now");
        assert_eq!(time_ago(10.0 * minute, 5.0 * minute), "5m");
        assert_eq!(time_ago(200.0 * minute, 0.0), "3h");
        assert_eq!(time_ago(3.0 * 1440.0 * minute, 0.0), "3d");
        assert_eq!(time_ago(400.0 * 1440.0 * minute, 0.0), "1y");
    }
}
