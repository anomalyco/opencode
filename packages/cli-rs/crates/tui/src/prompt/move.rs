//! Worktrees from the prompt (E.11b, rows P16 and P17): `session.move` (`/worktrees`) and
//! `component/prompt/move.tsx`.
//!
//! `/worktrees` opens the worktrees dialog for the prompt's project. Picking a checkout goes home there. A
//! new worktree is created at once from a session; on home it is staged, the footer says "(new worktree)",
//! and the first submit creates it ("Creating worktree…", then "Creating session…") before the session.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{LocationGetInput, LocationQueryInput, ProjectID, SessionInfo, WorktreeCreateInput};
use opencode_store::Location;
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, TuiCommand};
use opencode_ui::motion::Spinner;
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use super::editor::Inner;
use crate::app::Tui;
use crate::dialogs::worktrees::{self, Selection};

pub const COMMAND: &str = "session.move";

/// The staged destination and the creation progress of one prompt, and the footer row that shows them.
pub struct Move {
    destination: RefCell<Option<Selection>>,
    progress: RefCell<Option<String>>,
    creating: Cell<bool>,
    dots: Cell<usize>,
    timer: Cell<Option<TimerId>>,
    app: App,
    root: View,
    /// The progress spinner, only while there is progress, so no timer runs while idle.
    spinner: RefCell<Option<Spinner>>,
    animations: Cell<bool>,
    dots_text: Text,
    label: Text,
}

impl Move {
    /// The footer row, hidden until something is staged; it goes where the location shows.
    pub fn new(app: &App, animations: bool) -> Self {
        let dots_text = Text::new(app, "").wrap(WrapMode::None);
        let label = Text::new(app, "(new worktree)").wrap(WrapMode::None).truncate(true);
        let root = View::new(app)
            .row()
            .height(1)
            .min_height(0)
            .shrink(1.0)
            .padding_edge(Edge::Left, 3)
            .child(&dots_text)
            .child(&label)
            .visible(false);
        Self {
            destination: RefCell::new(None),
            progress: RefCell::new(None),
            creating: Cell::new(false),
            dots: Cell::new(3),
            timer: Cell::new(None),
            app: app.clone(),
            root,
            spinner: RefCell::new(None),
            animations: Cell::new(animations),
            dots_text,
            label,
        }
    }

    pub fn set_animations(&self, enabled: bool) {
        self.animations.set(enabled);
        if let Some(spinner) = &*self.spinner.borrow() {
            spinner.set_animations(enabled);
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// `creating()`: a submit waits while the worktree is being created. Once it exists its directory is
    /// staged, and the submit that waited for it runs.
    pub fn creating(&self) -> bool {
        self.creating.get() && self.directory().is_none()
    }

    /// The staged directory, if a directory is staged.
    pub fn directory(&self) -> Option<String> {
        match &*self.destination.borrow() {
            Some(Selection::Directory { directory, .. }) => Some(directory.clone()),
            _ => None,
        }
    }

    /// The staged new worktree's name.
    pub fn pending_new(&self) -> Option<String> {
        match &*self.destination.borrow() {
            Some(Selection::New { name }) => Some(name.clone()),
            _ => None,
        }
    }

    /// Shows the progress or the staged worktree in `theme`; returns whether the row shows.
    pub fn render(&self, theme: &Theme) -> bool {
        let accent = theme.accent().step(500);
        let progress = self.progress.borrow().clone();
        let pending = self.pending_new().is_some();
        let shown = progress.is_some() || pending;
        self.root.visible(shown);
        let mut spinner = self.spinner.borrow_mut();
        if progress.is_none()
            && let Some(spinner) = spinner.take()
        {
            spinner.detach();
        }
        if let Some(progress) = &progress {
            let spinner = spinner.get_or_insert_with(|| {
                let spinner = Spinner::new(&self.app).animations(self.animations.get());
                self.root.insert(0, &spinner);
                spinner
            });
            spinner.set_color(accent);
            spinner.set_label(Some(progress.clone()));
        }
        self.dots_text.set_text(vec![".".repeat(self.dots.get()).fg(theme.text.muted)]);
        self.dots_text.visible(progress.is_some());
        self.label.set_text(vec!["(new worktree)".fg(accent)]);
        self.label.visible(progress.is_none() && pending);
        shown
    }

    fn stage(&self, selection: Option<Selection>) {
        *self.destination.borrow_mut() = selection;
    }

    fn set_progress(&self, prompt: &Inner, progress: Option<&str>) {
        *self.progress.borrow_mut() = progress.map(str::to_owned);
        if let Some(tui) = prompt.tui.upgrade() {
            prompt.refresh(&tui);
        }
    }

    /// `creating` starts and stops the dots, one more each second.
    fn set_creating(&self, prompt: &Rc<Inner>, creating: bool) {
        self.creating.set(creating);
        if let Some(timer) = self.timer.take() {
            self.app.cancel_timer(timer);
        }
        self.dots.set(3);
        if creating {
            self.tick(Rc::downgrade(prompt));
        }
    }

    fn tick(&self, prompt: Weak<Inner>) {
        self.timer.set(Some(self.app.set_timeout(
            Duration::from_secs(1),
            bind!(prompt, |prompt, _| {
                let staging = &prompt.staging;
                staging.timer.set(None);
                staging.dots.set(staging.dots.get() % 3 + 1);
                if let Some(tui) = prompt.tui.upgrade() {
                    prompt.refresh(&tui);
                }
                staging.tick(Rc::downgrade(&prompt));
            }),
        )));
    }

    /// `finishSubmit`.
    pub fn finish(&self, prompt: &Rc<Inner>) {
        self.stage(None);
        self.set_creating(prompt, false);
        self.set_progress(prompt, None);
    }
}

impl Drop for Move {
    fn drop(&mut self) {
        if let Some(timer) = self.timer.take() {
            self.app.cancel_timer(timer);
        }
    }
}

/// The `session.move` command of a prompt (`/worktrees`).
pub fn command(prompt: Weak<Inner>) -> TuiCommand {
    TuiCommand::new(COMMAND, move |_: Option<&str>, _: Option<&KeyEvent>| {
        if let Some(prompt) = prompt.upgrade()
            && let Some(tui) = prompt.tui.upgrade()
        {
            open(&tui, &prompt);
        }
        true
    })
    .bind(Bind::Off)
    .title("Manage workspaces")
    .group("Session")
    .palette()
    .slash("worktrees")
}

/// Submits a staged new worktree: creates it, then `then` gets its directory (`None` after a failure,
/// which toasts). Returns whether the creation started.
pub fn create_staged(
    tui: &Tui,
    prompt: &Rc<Inner>,
    then: impl FnOnce(&Tui, &Rc<Inner>, Option<String>) + 'static,
) -> bool {
    let Some(name) = prompt.staging.pending_new() else {
        return false;
    };
    create(tui, prompt, name, then);
    true
}

/// `open`: the worktrees dialog for the prompt's project.
fn open(tui: &Tui, prompt: &Rc<Inner>) {
    let Some(id) = prompt.session.clone() else {
        resolve_home(tui, prompt);
        return;
    };
    if let Some(session) = prompt.session_info(tui) {
        show(tui, prompt, Some(session.project_id.clone()), Some(session));
        return;
    }
    // `resolveSession`: the session is read once if the store does not have it yet.
    let task = tui.data.session_sync(&id, false);
    let weak = prompt.this.clone();
    tui.app.spawn(
        task,
        bind!(weak, |prompt, _, _| {
            let Some(tui) = prompt.tui.upgrade() else {
                return;
            };
            let session = prompt.session_info(&tui);
            show(&tui, &prompt, session.as_ref().map(|s| s.project_id.clone()), session);
        }),
    );
}

/// `resolveProjectID` on home: the stored location's project, else a location read.
fn resolve_home(tui: &Tui, prompt: &Rc<Inner>) {
    let home = home_location(tui, prompt);
    if let Some(project) = stored_project(tui, &home) {
        show(tui, prompt, Some(project), None);
        return;
    }
    let client = tui.data.client().clone();
    let input = LocationGetInput { location: Some(LocationQueryInput { directory: Some(home.directory) }) };
    let weak = prompt.this.clone();
    tui.app.spawn(
        async move { client.location_get(&input, &RequestOptions::default()).await.ok().map(|info| info.project.id) },
        bind!(weak, |prompt, _, project| {
            let Some(tui) = prompt.tui.upgrade() else {
                return;
            };
            show(&tui, &prompt, project, None);
        }),
    );
}

fn show(tui: &Tui, prompt: &Rc<Inner>, project: Option<ProjectID>, session: Option<SessionInfo>) {
    let Some(project) = project else {
        tui.toasts.show(ToastOptions::new(Variant::Error, "Unable to determine current project"));
        return;
    };
    let home = home_location(tui, prompt);
    let current = prompt.staging.destination.borrow().clone().or_else(|| {
        Some(match &session {
            Some(session) => Selection::Directory {
                directory: session.location.directory.0.clone(),
                subdirectory: session.subpath.as_ref().is_some_and(|sub| !sub.0.is_empty()),
            },
            None => {
                let root = tui.data.read(|state| {
                    state
                        .location(Some(&home))
                        .and_then(|data| data.info.as_ref())
                        .map(|info| info.project.directory.0.clone())
                });
                Selection::Directory {
                    subdirectory: Some(&home.directory) != root.as_ref(),
                    directory: home.directory.clone(),
                }
            }
        })
    });
    let (select, change) = (prompt.this.clone(), prompt.this.clone());
    worktrees::show(
        tui,
        worktrees::Props {
            project_id: project,
            location: Some(session.map_or(home, |session| Location::from(&session.location))),
            current,
            on_select: Rc::new(move |tui, selection| {
                let Some(prompt) = select.upgrade() else {
                    tui.dialogs.clear();
                    return;
                };
                if prompt.session.is_none() && matches!(selection, Selection::New { .. }) {
                    prompt.staging.stage(Some(selection));
                    tui.dialogs.clear();
                    prompt.refresh(tui);
                    return;
                }
                select_workspace(tui, &prompt, selection);
            }),
            on_current_change: Some(Rc::new(bind!(change, |prompt, selection| prompt.staging.stage(Some(selection))))),
        },
    );
}

/// `selectWorkspace`: goes home in the picked directory, creating a new worktree first.
fn select_workspace(tui: &Tui, prompt: &Rc<Inner>, selection: Selection) {
    tui.dialogs.clear();
    let go = |tui: &Tui, prompt: &Rc<Inner>, directory: Option<String>| {
        prompt.staging.finish(prompt);
        if let Some(directory) = directory {
            crate::features::location::navigate_home(tui, Some(Location::new(directory)));
        }
    };
    match selection {
        Selection::Directory { directory, .. } => go(tui, prompt, Some(directory)),
        Selection::New { name } => create(tui, prompt, name, go),
    }
}

/// `create`: the worktree, then its location info, so the new session finds its project.
fn create(tui: &Tui, prompt: &Rc<Inner>, name: String, then: impl FnOnce(&Tui, &Rc<Inner>, Option<String>) + 'static) {
    let staging = &prompt.staging;
    staging.set_creating(prompt, true);
    staging.set_progress(prompt, Some("Creating worktree"));
    let session = prompt.session_info(tui);
    let lost = prompt.session.is_some() && session.is_none();
    let location = session.map_or_else(|| home_location(tui, prompt), |session| Location::from(&session.location));
    let data = tui.data.clone();
    let weak = prompt.this.clone();
    tui.app.spawn(
        async move {
            if lost {
                return Err("Unable to determine current session location".to_owned());
            }
            if data.read(|state| state.location(Some(&location)).and_then(|d| d.info.clone())).is_none() {
                data.location_sync_info(Some(&location)).await.map_err(|error| worktrees::error_message(&error))?;
            }
            let project = data
                .read(|state| {
                    state.location(Some(&location)).and_then(|d| d.info.as_ref()).map(|info| info.project.id.clone())
                })
                .ok_or_else(|| "Unable to determine current project".to_owned())?;
            let input = WorktreeCreateInput { project_id: project, name: Some(name), ..WorktreeCreateInput::default() };
            let directory = data
                .client()
                .worktree_create(&input, &RequestOptions::default())
                .await
                .map_err(|error| worktrees::error_message(&error))?
                .directory
                .0;
            if directory.is_empty() {
                return Err("No worktree directory returned".to_owned());
            }
            data.location_sync_info(Some(&Location::new(directory.clone())))
                .await
                .map_err(|error| worktrees::error_message(&error))?;
            Ok(directory)
        },
        bind!(weak, |prompt, _, result| {
            let Some(tui) = prompt.tui.upgrade() else {
                return;
            };
            match result {
                Ok(directory) => {
                    prompt
                        .staging
                        .stage(Some(Selection::Directory { directory: directory.clone(), subdirectory: false }));
                    prompt.staging.set_progress(&prompt, Some("Creating session"));
                    then(&tui, &prompt, Some(directory));
                }
                Err(error) => {
                    prompt.staging.finish(&prompt);
                    tui.toasts.show(ToastOptions::new(Variant::Error, error).title("Creating workspace failed"));
                    then(&tui, &prompt, None);
                }
            }
        }),
    );
}

/// `homeLocation`: where the home prompt creates its session.
fn home_location(tui: &Tui, prompt: &Inner) -> Location {
    Location::new(prompt.location(tui).directory)
}

fn stored_project(tui: &Tui, location: &Location) -> Option<ProjectID> {
    tui.data.read(|state| {
        state.location(Some(location)).and_then(|data| data.info.as_ref()).map(|info| info.project.id.clone())
    })
}
