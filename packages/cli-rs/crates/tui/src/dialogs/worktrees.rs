//! Worktrees dialog (E.11b, row DLG26): `component/dialog-workspaces.tsx`.
//!
//! "Worktrees" lists a project's checkouts: the current one first under "Current", then the others, with
//! the session subdirectories under each. Enter picks one for the caller (`/worktrees` in the prompt, the
//! location-missing view). `ctrl+a` names a new worktree, `ctrl+d` twice deletes one (asking again when it
//! has file changes), `ctrl+r` asks the server to look for worktrees, and in a session `ctrl+m` moves the
//! session there.
//!
//! Like the open dialog, each change of the loading or deleting state builds the dialog again, restoring the
//! filter and the selection, so the list's lock and current marker follow it (TS props are reactive).

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    AbsolutePath, LocationGetInput, LocationQueryInput, ProjectID, SessionMoveInput, V2Event,
    VcsStatusInput, WorktreeDirectory, WorktreeListInput, WorktreeRefreshInput,
    WorktreeRemoveInput,
};
use opencode_store::Location;
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize};
use opencode_ui::motion::Spinner;
use opencode_ui::path::abbreviate_home;
use opencode_ui::select::{
    self, ActionRun, Select, SelectAction, SelectOption, SelectProps, Truncate,
};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use super::file_changes::{self, Choice};
use super::session_list::dialog_theme;
use crate::app::Tui;
use crate::routes::Route;

/// The dialog's key, so a rebuild only replaces this dialog.
pub const KEY: &str = "worktrees";

/// `WorkspaceSelection`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Selection {
    Directory {
        directory: String,
        subdirectory: bool,
    },
    New {
        name: String,
    },
}

/// What a pick runs.
pub type OnSelect = Rc<dyn Fn(&Tui, Selection)>;
/// What runs after a list read.
type Then = Box<dyn FnOnce(&Rc<Workspaces>)>;

/// `DialogWorkspacesProps`.
pub struct Props {
    pub project_id: ProjectID,
    /// The location whose project and checkout the dialog starts from; the default one for `None`.
    pub location: Option<Location>,
    pub current: Option<Selection>,
    pub on_select: OnSelect,
    /// After deleting the current checkout on home: the checkout that replaces it.
    pub on_current_change: Option<Rc<dyn Fn(Selection)>>,
}

thread_local! {
    /// The open dialog, for `worktree.updated`.
    static OPEN: RefCell<Weak<Workspaces>> = const { RefCell::new(Weak::new()) };
}

/// Opens the dialog for `props.project_id`.
pub fn show(tui: &Tui, props: Props) {
    let workspaces = Rc::new(Workspaces {
        tui: tui.weak(),
        props,
        state: RefCell::new(State::default()),
        select: RefCell::new(None),
        shown: Cell::new(false),
        pending: Cell::new(false),
    });
    OPEN.with(|open| *open.borrow_mut() = Rc::downgrade(&workspaces));
    workspaces.reopen(None);
}

/// `worktree.updated` of the open dialog's project reads the list again.
pub(crate) fn event(event: &V2Event) {
    let V2Event::WorktreeUpdated(event) = event else {
        return;
    };
    let Some(workspaces) = OPEN.with(|open| open.borrow().upgrade()) else {
        return;
    };
    if event.data.project_id == workspaces.props.project_id && workspaces.shown.get() {
        workspaces.load(None);
    }
}

struct Workspaces {
    tui: Weak<Tui>,
    props: Props,
    state: RefCell<State>,
    select: RefCell<Option<Select<Selection>>>,
    /// The dialog on screen is this one's latest build.
    shown: Cell<bool>,
    /// A build is queued; it reads the state when it runs.
    pending: Cell<bool>,
}

#[derive(Default)]
struct State {
    /// `directoryData()`: the last list read.
    directories: Option<Vec<WorktreeDirectory>>,
    /// `directories.loading`.
    loading: bool,
    load_error: Option<String>,
    /// `loadedProject.loading`.
    project_loading: bool,
    /// The project directory the location read found, when the store's location is another project.
    loaded_project: Option<String>,
    /// The worktree the first delete press marked.
    to_delete: Option<String>,
    removing: Option<String>,
    working: bool,
    /// The checkout that replaces a deleted current one.
    replacement: Option<String>,
    /// Asked the server to look for worktrees once.
    refreshed: bool,
}

impl Workspaces {
    fn tui(&self) -> Option<Rc<Tui>> {
        self.tui.upgrade()
    }

    /// `reopen`: starts over with the list kept, as TS mounts a new `DialogWorkspaces` with
    /// `initialDirectories`. With `removing`, it shows that worktree being deleted and reads nothing.
    fn reopen(self: &Rc<Self>, removing: Option<String>) {
        {
            let mut state = self.state.borrow_mut();
            state.working = removing.is_some();
            state.to_delete = None;
            state.removing = removing.clone();
            state.replacement = None;
            state.load_error = None;
            state.loaded_project = None;
            state.refreshed = false;
            state.loading = removing.is_none();
        }
        self.load_project();
        self.build();
        if removing.is_none() {
            self.load(None);
        }
    }

    /// The store's info for `props.location`.
    fn location_info(&self, tui: &Tui) -> Option<opencode_api::generated::LocationPublicInfo> {
        tui.data.read(|state| {
            state
                .location(self.props.location.as_ref())
                .and_then(|data| data.info.clone())
        })
    }

    /// `loadedProject`: when the store's location belongs to another project, reads where this project's
    /// checkout is. A failure only loses the current marker.
    fn load_project(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        let info = self.location_info(&tui);
        if info.as_ref().map(|info| &info.project.id) == Some(&self.props.project_id) {
            return;
        }
        self.state.borrow_mut().project_loading = true;
        let directory = info.map_or_else(|| tui.directory.clone(), |info| info.directory.0);
        let client = tui.data.client().clone();
        let project = self.props.project_id.clone();
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                let input = LocationGetInput {
                    location: Some(LocationQueryInput {
                        directory: Some(directory),
                    }),
                };
                client
                    .location_get(&input, &RequestOptions::default())
                    .await
                    .ok()
                    .filter(|result| result.project.id == project)
                    .map(|result| result.project.directory.0)
            },
            move |_, directory| {
                let Some(workspaces) = weak.upgrade() else {
                    return;
                };
                {
                    let mut state = workspaces.state.borrow_mut();
                    state.project_loading = false;
                    state.loaded_project = directory;
                }
                workspaces.rebuild();
            },
        );
    }

    /// Reads the list; the first success also asks the server to look for new worktrees. A failed read
    /// with a list on screen keeps it. `then` runs after the read.
    fn load(self: &Rc<Self>, then: Option<Then>) {
        let Some(tui) = self.tui() else { return };
        self.state.borrow_mut().loading = true;
        let client = tui.data.client().clone();
        let input = WorktreeListInput {
            project_id: self.props.project_id.clone(),
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                client
                    .worktree_list(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(workspaces) = weak.upgrade() else {
                    return;
                };
                let refresh = {
                    let mut state = workspaces.state.borrow_mut();
                    state.loading = false;
                    match result {
                        Ok(directories) => {
                            state.directories = Some(directories);
                            state.load_error = None;
                        }
                        Err(error) => state.load_error = Some(error_message(&error)),
                    }
                    let refresh = state.directories.is_some() && !state.refreshed;
                    state.refreshed |= refresh;
                    refresh
                };
                if refresh {
                    workspaces.refresh_worktrees(false);
                }
                match then {
                    Some(then) => then(&workspaces),
                    None => workspaces.rebuild(),
                }
            },
        );
    }

    /// `worktree.refresh`; a failure toasts only when the user asked for it.
    fn refresh_worktrees(&self, toast: bool) {
        let Some(tui) = self.tui() else { return };
        let client = tui.data.client().clone();
        let input = WorktreeRefreshInput {
            project_id: self.props.project_id.clone(),
        };
        let weak = tui.weak();
        tui.app.spawn(
            async move {
                client
                    .worktree_refresh(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                if let (Err(error), Some(tui), true) = (result, weak.upgrade(), toast) {
                    tui.toasts.error(error_message(&error));
                }
            },
        );
    }

    fn show_error(&self) -> bool {
        let state = self.state.borrow();
        state.load_error.is_some() && state.directories.is_none()
    }

    fn locked(&self) -> bool {
        let state = self.state.borrow();
        self.show_error() || state.loading || state.project_loading || state.removing.is_some()
    }

    /// `currentDirectory`: the replacement, else the given current directory, else the project's checkout.
    fn current_directory(&self, tui: &Tui) -> Option<String> {
        if let Some(replacement) = self.state.borrow().replacement.clone() {
            return Some(replacement);
        }
        if let Some(Selection::Directory { directory, .. }) = &self.props.current {
            return Some(directory.clone());
        }
        match self.location_info(tui) {
            Some(info) if info.project.id == self.props.project_id => {
                Some(info.project.directory.0)
            }
            _ => self.state.borrow().loaded_project.clone(),
        }
    }

    /// `currentRoot`: the deepest listed root that holds the current directory.
    fn current_root(&self, tui: &Tui) -> Option<String> {
        if self.show_error() {
            return None;
        }
        let directory = self.current_directory(tui)?;
        let state = self.state.borrow();
        state
            .directories
            .iter()
            .flatten()
            .map(|root| root.directory.0.clone())
            .filter(|root| contains(root, &directory))
            .max_by_key(String::len)
    }

    /// `current()`: no marker while loading.
    fn current_value(&self) -> Option<Selection> {
        let state = self.state.borrow();
        if state.loading || state.project_loading {
            return None;
        }
        if let Some(replacement) = &state.replacement {
            return Some(Selection::Directory {
                directory: replacement.clone(),
                subdirectory: false,
            });
        }
        self.props.current.clone()
    }

    /// `options()`.
    fn options(&self) -> Vec<SelectOption<Selection>> {
        let Some(tui) = self.tui() else {
            return Vec::new();
        };
        if self.show_error() {
            return Vec::new();
        }
        let current_root = self.current_root(&tui);
        let current_directory = self.current_directory(&tui);
        let theme = dialog_theme(&tui);
        let state = self.state.borrow();
        let mut roots: Vec<&WorktreeDirectory> = state.directories.iter().flatten().collect();
        let current = current_root.as_deref();
        roots.sort_by(|a, b| {
            let (a_current, b_current) = (
                Some(a.directory.as_str()) == current,
                Some(b.directory.as_str()) == current,
            );
            if a_current || b_current {
                return b_current.cmp(&a_current);
            }
            let (a_strategy, b_strategy) = (a.strategy.is_some(), b.strategy.is_some());
            if a_strategy != b_strategy {
                return a_strategy.cmp(&b_strategy);
            }
            if !a_strategy {
                return a.directory.0.len().cmp(&b.directory.0.len());
            }
            std::cmp::Ordering::Equal
        });
        if roots.is_empty() {
            return Vec::new();
        }
        let deepest = |location: &str| {
            roots
                .iter()
                .enumerate()
                .filter(|(_, root)| contains(&root.directory.0, location))
                .max_by_key(|(_, root)| root.directory.0.len())
                .map(|(index, _)| index)
        };
        let project = &self.props.project_id;
        let mut subdirectories: Vec<String> = Vec::new();
        tui.data.read(|store| {
            for session in store.sessions() {
                let sub = session.subpath.as_ref().map(|sub| sub.0.as_str());
                if session.project_id != *project || matches!(sub, None | Some("" | "." | "/")) {
                    continue;
                }
                let location = session.location.directory.0.clone();
                if current_root.is_none() && Some(&location) == current_directory.as_ref() {
                    continue;
                }
                if roots.iter().any(|root| root.directory.0 == location)
                    || subdirectories.contains(&location)
                {
                    continue;
                }
                subdirectories.push(location);
            }
        });
        let mut list: Vec<(String, usize)> = roots
            .iter()
            .enumerate()
            .map(|(index, root)| (root.directory.0.clone(), index))
            .chain(
                subdirectories
                    .into_iter()
                    .filter_map(|location| deepest(&location).map(|root| (location, root))),
            )
            .collect();
        list.sort_by(|a, b| {
            a.1.cmp(&b.1)
                .then_with(|| {
                    let (a_root, b_root) =
                        (a.0 == roots[a.1].directory.0, b.0 == roots[b.1].directory.0);
                    b_root.cmp(&a_root)
                })
                .then_with(|| a.0.cmp(&b.0))
        });
        let width = u32::from(tui.app.size().0)
            .saturating_sub(2)
            .min(DialogSize::XLarge.width());
        let title_width = (select::content_width(width) as usize).max(1);
        let home = std::env::var("HOME").unwrap_or_default();
        let delete_key = tui
            .keymap
            .shortcut("dialog.move_session.delete")
            .unwrap_or_default();
        list.into_iter()
            .map(|(location, index)| {
                let root = &roots[index].directory.0;
                let title = abbreviate_home(&location, &home);
                let subdirectory = &location != root;
                let mut option = SelectOption::new(
                    title.clone(),
                    Selection::Directory {
                        directory: location.clone(),
                        subdirectory,
                    },
                )
                .category(if Some(root.as_str()) == current {
                    "Current"
                } else {
                    "Other"
                });
                option.title_width = Some(title_width);
                option.truncate = Truncate::Left;
                let deleting = state.to_delete.as_ref() == Some(&location);
                if state.removing.as_ref() == Some(&location) {
                    option.title_spans = Some(vec![(
                        format!("Deleting {location}"),
                        Some(theme.text.feedback.error.base),
                    )]);
                } else if deleting {
                    option.title_spans = Some(vec![(
                        format!("Press {delete_key} again to confirm"),
                        Some(theme.text.action.destructive.base),
                    )]);
                    option.bg = Some(theme.background.action.destructive.base);
                } else if subdirectory {
                    let suffix = format!("/{}", location[root.len()..].trim_start_matches('/'));
                    let visible: Vec<char> =
                        select::truncate_left(&title, title_width).chars().collect();
                    let split = visible.len().saturating_sub(suffix.chars().count());
                    option.title_spans = Some(vec![
                        (visible[..split].iter().collect(), None),
                        (visible[split..].iter().collect(), Some(theme.text.muted)),
                    ]);
                }
                option
            })
            .collect()
    }

    /// Builds the dialog again if it is still on screen.
    fn rebuild(self: &Rc<Self>) {
        if self.shown.get() || self.pending.get() {
            self.build();
        }
    }

    /// Builds the dialog after the current key or select handler returns, from the state at that time.
    fn build(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        if self.pending.replace(true) {
            return;
        }
        let workspaces = self.clone();
        let weak = tui.weak();
        tui.app.defer(move |_| {
            workspaces.pending.set(false);
            if let Some(tui) = weak.upgrade() {
                workspaces.replace(&tui);
            }
        });
    }

    fn replace(self: &Rc<Self>, tui: &Tui) {
        let (filter, selected) = self
            .select
            .borrow()
            .as_ref()
            .map(|select| {
                (
                    select.filter(),
                    select.selected().map(|option| option.value),
                )
            })
            .unwrap_or_default();
        let (show_error, locked, spinning) = {
            let state = self.state.borrow();
            (
                self.show_error(),
                self.locked(),
                state.working || state.loading || state.project_loading,
            )
        };
        let session = matches!(tui.route(), Route::Session { .. });
        let current = self.current_value();
        let animations = opencode_ui::motion::enabled(tui.config.info.animations);
        let height = i64::from(tui.app.size().1);
        let full_height = (height - height / 4 - 2).clamp(8, 16) as u32;
        let built = self.clone();
        {
            tui.dialogs.replace(
                move |cx| {
                    let app = &cx.app;
                    let theme = &cx.theme;
                    let weak = Rc::downgrade(&built);
                    let mut props = SelectProps::dynamic(
                        "Worktrees",
                        Rc::new({
                            let weak = weak.clone();
                            move |_: &str| weak.upgrade().map(|w| w.options()).unwrap_or_default()
                        }),
                    );
                    let title = View::new(app)
                        .row()
                        .gap(1)
                        .child(&Text::new(app, "Worktrees").fg(theme.text.base).bold());
                    if spinning {
                        title.add(
                            &Spinner::new(app)
                                .color(theme.text.muted)
                                .animations(animations),
                        );
                    }
                    props.title_view = Some(title.as_any());
                    props.render_filter = !show_error;
                    props.flat = true;
                    props.locked = locked;
                    props.current = current;
                    let error = built.state.borrow().load_error.clone();
                    let loading = {
                        let state = built.state.borrow();
                        state.loading || state.project_loading
                    };
                    props.empty_view = Some(Rc::new({
                        let (app, theme) = (app.clone(), theme.clone());
                        move || {
                            let view = View::new(&app).padding_x(DIALOG_LIST_INSET);
                            if show_error {
                                view.add(
                                    &Text::new(&app, "Could not load worktrees")
                                        .fg(theme.text.feedback.error.base)
                                        .bold(),
                                );
                                view.add(
                                    &Text::new(&app, error.clone().unwrap_or_default())
                                        .fg(theme.text.muted),
                                );
                                view.add(
                                    &Text::new(&app, "Close and reopen Worktrees to try again.")
                                        .fg(theme.text.muted),
                                );
                            } else {
                                view.add(
                                    &Text::new(
                                        &app,
                                        if loading {
                                            "Loading worktrees…"
                                        } else {
                                            "No worktrees available"
                                        },
                                    )
                                    .fg(theme.text.muted),
                                );
                            }
                            view.as_any()
                        }
                    }));
                    props.no_match_view = Some(Rc::new({
                        let (app, theme) = (app.clone(), theme.clone());
                        move || {
                            View::new(&app)
                                .padding_x(DIALOG_LIST_INSET)
                                .child(&Text::new(&app, "No worktrees found").fg(theme.text.muted))
                                .as_any()
                        }
                    }));
                    props.on_select = Some(Rc::new({
                        let weak = weak.clone();
                        move |option: &SelectOption<Selection>| {
                            let Some(workspaces) = weak.upgrade() else {
                                return;
                            };
                            let Some(tui) = workspaces.tui() else { return };
                            let value = option.value.clone();
                            let run = workspaces.props.on_select.clone();
                            let weak = tui.weak();
                            tui.app.defer(move |_| {
                                if let Some(tui) = weak.upgrade() {
                                    run(&tui, value);
                                }
                            });
                        }
                    }));
                    props.on_move = Some(Rc::new({
                        let weak = weak.clone();
                        move |_: &SelectOption<Selection>| {
                            let Some(workspaces) = weak.upgrade() else {
                                return;
                            };
                            if workspaces.state.borrow_mut().to_delete.take().is_some() {
                                workspaces.refresh_later();
                            }
                        }
                    }));
                    if !show_error {
                        props.actions = actions(&weak, session);
                    }
                    let (view, select) = select::select(cx, props);
                    if !filter.is_empty() {
                        select.set_filter(&filter);
                    }
                    if let Some(selected) = &selected {
                        select.move_to(selected);
                    }
                    *built.select.borrow_mut() = Some(select);
                    built.shown.set(true);
                    let owner = built.clone();
                    cx.on_close(opentui::keymap::Disposer::new(move || {
                        owner.shown.set(false);
                        owner.select.borrow_mut().take();
                    }));
                    View::new(app)
                        .min_height(if show_error { 5 } else { full_height })
                        .child(&view)
                },
                None,
                DialogOptions {
                    size: DialogSize::XLarge,
                    key: Some(KEY.into()),
                },
            );
        }
    }

    fn refresh_later(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        let weak = Rc::downgrade(self);
        tui.app.defer(move |_| {
            let Some(workspaces) = weak.upgrade() else {
                return;
            };
            let select = workspaces.select.borrow().clone();
            if let Some(select) = select {
                select.set_options(workspaces.options());
            }
        });
    }

    /// `remove`: the first press marks the worktree, the second deletes it.
    fn remove(self: &Rc<Self>, option: &SelectOption<Selection>) {
        let Some(tui) = self.tui() else { return };
        let Selection::Directory {
            directory,
            subdirectory: false,
        } = &option.value
        else {
            return;
        };
        if self.state.borrow().removing.is_some() || !self.has_strategy(directory) {
            return;
        }
        let deleting_current = self.current_root(&tui).as_ref() == Some(directory);
        if self.state.borrow().to_delete.as_ref() != Some(directory) {
            self.state.borrow_mut().to_delete = Some(directory.clone());
            self.refresh_later();
            return;
        }
        {
            let mut state = self.state.borrow_mut();
            state.to_delete = None;
            state.removing = Some(directory.clone());
            state.working = true;
        }
        self.build();
        let directory = directory.clone();
        self.delete(directory.clone(), false, move |workspaces, result| {
            let Err(error) = result else {
                workspaces.load(Some(Box::new(move |workspaces| {
                    {
                        let mut state = workspaces.state.borrow_mut();
                        state.removing = None;
                        state.working = false;
                    }
                    if !workspaces.removed_current(deleting_current) {
                        workspaces.rebuild();
                    }
                })));
                return;
            };
            {
                let mut state = workspaces.state.borrow_mut();
                state.removing = None;
                state.working = false;
            }
            if !force_required(&error) {
                workspaces.failed(&error);
                workspaces.rebuild();
                return;
            }
            workspaces.confirm_force(directory, deleting_current);
        });
    }

    /// The worktree has file changes: lists them and deletes with `force` once confirmed.
    fn confirm_force(self: &Rc<Self>, directory: String, deleting_current: bool) {
        let Some(tui) = self.tui() else { return };
        let client = tui.data.client().clone();
        let input = VcsStatusInput {
            location: Some(LocationQueryInput {
                directory: Some(directory.clone()),
            }),
        };
        let workspaces = self.clone();
        tui.app.spawn(
            async move {
                client
                    .vcs_status(&input, &RequestOptions::default())
                    .await
                    .map(|status| status.data)
                    .unwrap_or_default()
            },
            move |_, files| {
                let Some(tui) = workspaces.tui() else { return };
                let owner = workspaces.clone();
                file_changes::show(
                    &tui,
                    files,
                    file_changes::Texts {
                        title: Some("Delete worktree?".into()),
                        message: Some(
                            "This worktree has file changes. Do you want to delete it anyway?"
                                .into(),
                        ),
                        confirm: Some(("delete".into(), "d".into())),
                    },
                    Rc::new(move |choice| {
                        let workspaces = owner.clone();
                        if choice != Some(Choice::Yes) {
                            workspaces.reopen(None);
                            return;
                        }
                        workspaces.reopen(Some(directory.clone()));
                        workspaces.delete(directory.clone(), true, move |workspaces, result| {
                            if let Err(error) = result {
                                workspaces.failed(&error);
                                workspaces.reopen(None);
                                return;
                            }
                            {
                                let mut state = workspaces.state.borrow_mut();
                                state.removing = None;
                                state.working = false;
                            }
                            // TS leaves a home dialog that stays open showing the deletion; this reads
                            // the list again instead.
                            if !workspaces.removed_current(deleting_current) {
                                workspaces.reopen(None);
                            } else if workspaces.shown.get() {
                                workspaces.load(None);
                            }
                        });
                    }),
                );
            },
        );
    }

    fn delete(
        self: &Rc<Self>,
        directory: String,
        force: bool,
        then: impl FnOnce(&Rc<Self>, Result<(), opencode_api::error::Error>) + 'static,
    ) {
        let Some(tui) = self.tui() else { return };
        let client = tui.data.client().clone();
        let input = WorktreeRemoveInput {
            project_id: self.props.project_id.clone(),
            directory: AbsolutePath(directory),
            force,
        };
        let workspaces = self.clone();
        tui.app.spawn(
            async move {
                client
                    .worktree_remove(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| then(&workspaces, result),
        );
    }

    fn failed(&self, error: &opencode_api::error::Error) {
        if let Some(tui) = self.tui() {
            tui.toasts.show(
                ToastOptions::new(Variant::Error, error_message(error))
                    .title("Failed to delete worktree"),
            );
        }
    }

    /// `removedCurrent`: after deleting the current checkout, a session goes home; on home the last
    /// checkout without a strategy (the main one) becomes current, or the dialog closes.
    fn removed_current(self: &Rc<Self>, current: bool) -> bool {
        let Some(tui) = self.tui() else { return true };
        if !current {
            return false;
        }
        let fallback = self.state.borrow().directories.as_ref().and_then(|list| {
            list.iter()
                .rev()
                .find(|item| item.strategy.is_none())
                .map(|item| item.directory.0.clone())
        });
        if let Some(fallback) = &fallback {
            self.state.borrow_mut().replacement = Some(fallback.clone());
        }
        if matches!(tui.route(), Route::Session { .. }) {
            tui.dialogs.clear();
            tui.navigate(Route::Home);
            return true;
        }
        if let Some(fallback) = fallback {
            if let Some(change) = &self.props.on_current_change {
                change(Selection::Directory {
                    directory: fallback,
                    subdirectory: false,
                });
            }
            self.rebuild();
            return true;
        }
        tui.dialogs.clear();
        true
    }

    fn has_strategy(&self, directory: &str) -> bool {
        self.state
            .borrow()
            .directories
            .iter()
            .flatten()
            .any(|item| item.directory.0 == directory && item.strategy.is_some())
    }

    /// `create`: names a new worktree for the caller.
    fn create(self: &Rc<Self>) {
        let Some(tui) = self.tui() else { return };
        let workspaces = self.clone();
        let weak = tui.weak();
        tui.app.defer(move |_| {
            let Some(tui) = weak.upgrade() else { return };
            let run = workspaces.props.on_select.clone();
            let weak = tui.weak();
            super::worktree_name::show(
                &tui,
                Rc::new(move |name| {
                    if let (Some(name), Some(tui)) = (name, weak.upgrade()) {
                        run(&tui, Selection::New { name });
                    }
                }),
            );
        });
    }

    /// `move`: moves the open session to the selected directory.
    fn move_session(&self, option: &SelectOption<Selection>) {
        let Some(tui) = self.tui() else { return };
        let (Route::Session { id }, Selection::Directory { directory, .. }) =
            (tui.route(), &option.value)
        else {
            return;
        };
        tui.dialogs.clear();
        let client = tui.data.client().clone();
        let input = SessionMoveInput {
            session_id: id,
            directory: AbsolutePath(directory.clone()),
            delivery: None,
        };
        let weak = tui.weak();
        tui.app.spawn(
            async move {
                client
                    .session_move(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                    tui.toasts.error(error_message(&error));
                }
            },
        );
    }
}

/// The footer actions: move (in a session), new, delete, and refresh.
fn actions(weak: &Weak<Workspaces>, session: bool) -> Vec<SelectAction<Selection>> {
    let selected =
        |command: &str, title: &str, run: fn(&Rc<Workspaces>, &SelectOption<Selection>)| {
            let weak = weak.clone();
            SelectAction::new(command, title, move |option: &SelectOption<Selection>| {
                if let Some(workspaces) = weak.upgrade() {
                    run(&workspaces, option);
                }
            })
        };
    let dialog = |command: &str, title: &str, run: fn(&Rc<Workspaces>)| {
        let weak = weak.clone();
        SelectAction {
            run: ActionRun::Dialog(Rc::new(move || {
                if let Some(workspaces) = weak.upgrade() {
                    run(&workspaces);
                }
            })),
            ..SelectAction::new(command, title, |_: &SelectOption<Selection>| {})
        }
    };
    let mut actions = Vec::new();
    if session {
        actions.push(selected(
            "dialog.move_session.move",
            "move",
            |workspaces, option| workspaces.move_session(option),
        ));
    }
    actions.push(dialog("dialog.move_session.new", "new", Workspaces::create));
    actions.push(SelectAction {
        disabled: Some(Rc::new({
            let weak = weak.clone();
            move |option: Option<&SelectOption<Selection>>| {
                let Some(workspaces) = weak.upgrade() else {
                    return true;
                };
                match option.map(|option| &option.value) {
                    Some(Selection::Directory {
                        directory,
                        subdirectory: false,
                    }) => !workspaces.has_strategy(directory),
                    _ => true,
                }
            }
        })),
        ..selected("dialog.move_session.delete", "delete", Workspaces::remove)
    });
    actions.push(dialog(
        "dialog.move_session.refresh",
        "refresh",
        |workspaces| workspaces.refresh_worktrees(true),
    ));
    actions
}

/// `errorMessage`: a declared error's message, else the error.
pub(crate) fn error_message(error: &opencode_api::error::Error) -> String {
    match error.declared() {
        Some(declared) => declared
            .message
            .clone()
            .or_else(|| declared.tag.clone())
            .unwrap_or_else(|| error.to_string()),
        None => error.to_string(),
    }
}

/// The server marks a delete that would lose file changes (`WorktreeError` with `data.forceRequired`).
fn force_required(error: &opencode_api::error::Error) -> bool {
    error
        .declared()
        .and_then(|declared| declared.body.get("data")?.get("forceRequired")?.as_bool())
        == Some(true)
}

/// `contains`: `directory` is `root` or below it.
pub(crate) fn contains(root: &str, directory: &str) -> bool {
    root == directory
        || directory
            .strip_prefix(root.trim_end_matches('/'))
            .is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::contains;

    #[test]
    fn contains_follows_path_relative() {
        assert!(contains("/a/b", "/a/b"));
        assert!(contains("/a/b", "/a/b/c/d"));
        assert!(!contains("/a/b", "/a/bc"));
        assert!(!contains("/a/b", "/a"));
        assert!(contains("/", "/a"));
    }
}
