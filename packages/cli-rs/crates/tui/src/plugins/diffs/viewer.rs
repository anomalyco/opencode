//! Diff viewer (E.15a, row F15, `feature-plugins/system/diff-viewer.tsx`): the `opencode.diffs` plugin. `/diff`
//! docks the viewer beside the session as its panel, or opens it as a full-screen route outside a session. The
//! viewer loads the VCS or last-turn diff, and shows each file as a card under a sticky header, with the file tree
//! beside the cards when the screen is wide enough, split or unified hunks by width, and reviewed marks.
//!
//! The widgets are rebuilt from [`State`] when it changes; scroll moves are not. Positions come from the latest
//! frame, as TS reads them from the render tree: a few passes before the next frames ([`Viewer::passes`]) pin the
//! file headers, color the fixed top edge, and finish the scrolls that wait for a rebuilt layout.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap};
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    FileDiffInfo, FileDiffInfoStatus, LocationQueryInput, SessionDiffInput, SessionID, VcsBaseInput, VcsDiffInput,
    VcsMode,
};
use opencode_local::cli_config::{DiffSource, DiffView as PreferredView};
use opencode_plugin::{Definition, Setup, Slotted};
use opencode_store::Location;
use opencode_ui::theme::Theme;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use opentui::style::Attributes;
use opentui::widget::DiffView;
use serde_json::{Value, json};

use super::hunks::{self, Hunk, Selected};
use super::keys::{self, Action};
use super::tree::{self, Expanded, Tree};
use crate::app::Tui;
use crate::frame::layout::SESSION_PANEL_SPLIT_MIN_WIDTH;
use crate::panel::{Presentation, Target};
use crate::routes::Route;

pub const ID: &str = "opencode.diffs";
pub const ROUTE: &str = "diff";

const MIN_SPLIT_WIDTH: i64 = 100;
const FILE_TREE_MIN_WIDTH: i64 = 30;
const FILE_TREE_MAX_WIDTH: i64 = 40;
const FULL_INSET: u16 = 2;
/// The full layout keeps its tree and inset cards only while its patches stay as wide as the narrowest docked panel.
const FULL_LAYOUT_MIN_WIDTH: i64 = FILE_TREE_MIN_WIDTH + FULL_INSET as i64 * 2 + SESSION_PANEL_SPLIT_MIN_WIDTH / 2;
const VCS_DIFF_CONTEXT_LINES: i64 = 12;
/// Frames the passes run after a change: the rebuilt layout, the scroll it asks for, and the headers pinned to it.
const PASSES: u32 = 4;

/// A diff source (`DiffSource`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Mode {
    Branch,
    Committed,
    Working,
    Turn,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Mode::Branch => "All",
            Mode::Committed => "Committed",
            Mode::Working => "Uncommitted",
            Mode::Turn => "Last turn",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Mode::Branch => "Branch + local changes",
            Mode::Committed => "Branch commits only",
            Mode::Working => "Local changes only",
            Mode::Turn => "Latest session turn",
        }
    }

    pub fn needs_base(self) -> bool {
        matches!(self, Mode::Branch | Mode::Committed)
    }

    fn from_config(source: DiffSource) -> Self {
        match source {
            DiffSource::Branch => Mode::Branch,
            DiffSource::Committed => Mode::Committed,
            DiffSource::Working => Mode::Working,
            DiffSource::Turn => Mode::Turn,
        }
    }

    fn vcs(self) -> VcsMode {
        match self {
            Mode::Committed => VcsMode::Committed,
            Mode::Working => VcsMode::Working,
            Mode::Branch | Mode::Turn => VcsMode::Branch,
        }
    }
}

/// A base branch: what the header names and the ref the diff compares with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Base {
    pub name: String,
    pub reference: String,
}

/// One file of the diff (`DiffFile`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub file: String,
    pub patch: String,
    pub additions: i64,
    pub deletions: i64,
    pub status: tree::Status,
}

impl From<FileDiffInfo> for File {
    fn from(info: FileDiffInfo) -> Self {
        Self {
            file: info.file,
            patch: info.patch,
            additions: info.additions,
            deletions: info.deletions,
            status: match info.status {
                FileDiffInfoStatus::Added => tree::Status::Added,
                FileDiffInfoStatus::Deleted => tree::Status::Deleted,
                FileDiffInfoStatus::Modified => tree::Status::Modified,
                FileDiffInfoStatus::Unknown(_) => tree::Status::Unknown,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Load {
    Loading,
    Failed,
    Ready { base: Option<Base>, files: Vec<File> },
}

/// The plugin's memory, kept until the TUI exits (`storage.memory("review")`): the last source and the chosen base
/// per location and branch.
#[derive(Default)]
pub struct Memory {
    pub source: Option<Mode>,
    pub bases: HashMap<String, String>,
}

/// What the full-screen route shows, set by `diff.open` before it navigates.
#[derive(Clone)]
struct RouteData {
    session: Option<SessionID>,
    back: Route,
}

#[derive(Default)]
pub struct Shared {
    pub memory: RefCell<Memory>,
    route: RefCell<Option<RouteData>>,
    current: RefCell<Weak<Viewer>>,
}

pub fn plugin() -> Definition<Tui> {
    Definition::new(ID, |setup: &mut Setup<'_, Tui>| {
        let tui = setup.host().clone();
        let shared = Rc::new(Shared::default());
        let panel = shared.clone();
        tui.panels.register(
            ID,
            ROUTE,
            Rc::new(move |tui, host, input| {
                let place = Place::Panel {
                    host: host.clone(),
                    session: SessionID(input.target.session.clone()),
                };
                let viewer = Viewer::mount(tui, &panel, place, i64::from(input.width));
                host.add(&viewer.root);
            }),
        );
        let route = shared.clone();
        setup.route(ROUTE, move |tui| {
            let data = route.route.borrow().clone().unwrap_or(RouteData {
                session: None,
                back: Route::Home,
            });
            let place = Place::Route {
                session: data.session,
                back: data.back,
            };
            Box::new(RouteSlot(Viewer::mount(tui, &route, place, i64::from(tui.app.size().0))))
        });
        let open = shared.clone();
        setup.layer(keys::open_layer(&tui, Rc::new(move |tui| self::open(tui, &open))));
        let weak = tui.weak();
        setup.on_dispose(move || {
            if let Some(tui) = weak.upgrade() {
                tui.panels.release(&tui, ID);
            }
        });
    })
}

/// `diff.open`: closes the session's open viewer, else docks one beside the session, else opens the route.
fn open(tui: &Tui, shared: &Rc<Shared>) {
    let route = tui.route();
    tui.dialogs.clear();
    if let Route::Session { id } = &route {
        let target = Target {
            plugin: ID.to_owned(),
            name: ROUTE.to_owned(),
            session: id.0.clone(),
        };
        if tui.panels.current().as_ref() == Some(&target) {
            tui.panels.close(tui);
            return;
        }
        let fullscreen = tui.settings.info().diffs.and_then(|diffs| diffs.fullscreen) == Some(true);
        let presentation = if fullscreen {
            Presentation::Fullscreen
        } else {
            Presentation::Panel
        };
        tui.panels.open(tui, target, presentation);
        return;
    }
    *shared.route.borrow_mut() = Some(RouteData {
        session: None,
        back: route,
    });
    tui.navigate(Route::Plugin {
        id: ID.to_owned(),
        name: ROUTE.to_owned(),
    });
}

struct RouteSlot(Rc<Viewer>);

impl Slotted<Tui> for RouteSlot {
    fn root(&self) -> View {
        self.0.root.clone()
    }
}

/// Where the viewer shows.
enum Place {
    /// In the session's panel host, which takes the focus.
    Panel { host: View, session: SessionID },
    /// The full-screen route; closing goes back to `back`.
    Route { session: Option<SessionID>, back: Route },
}

struct State {
    mode: Mode,
    location: Location,
    base_key: String,
    load: Load,
    generation: u64,
    /// The base each location and branch reported (`reportedBases`), looked up once per viewer.
    reported: HashMap<String, Option<Base>>,
    width: i64,
    tree_enabled: bool,
    single: bool,
    view_override: Option<DiffView>,
    tree: Tree,
    expanded: Expanded,
    selected: Option<usize>,
    reviewed: BTreeSet<String>,
    exhausted: Option<usize>,
    selected_hunk: Option<Selected>,
    /// A card to scroll to once the layout has it, with an offset that keeps the reading position.
    pending: Option<(usize, Option<i64>)>,
}

/// The widgets the commands and passes read.
#[derive(Default)]
struct Parts {
    scroll: Option<ScrollBox>,
    top_edge: Option<View>,
    cards: Vec<Card>,
    tree: Option<View>,
    /// What the last full render showed; an equal key rebuilds only the tree.
    key: Option<String>,
}

struct Card {
    file: usize,
    reviewed: bool,
    node: View,
    card: View,
    header: Option<View>,
    /// The first row of each hunk: the first diff, then each later hunk's `@@` row.
    hunks: Vec<AnyWidget>,
}

pub struct Viewer {
    tui: Weak<Tui>,
    shared: Rc<Shared>,
    root: View,
    place: Place,
    state: RefCell<State>,
    parts: RefCell<Parts>,
    layer: RefCell<Option<Disposer>>,
    passes: Cell<u32>,
    this: Weak<Viewer>,
}

impl Viewer {
    fn mount(tui: &Tui, shared: &Rc<Shared>, place: Place, width: i64) -> Rc<Self> {
        let session = match &place {
            Place::Panel { session, .. } => Some(session.clone()),
            Place::Route { session, .. } => session.clone(),
        };
        let preferences = tui.settings.info().diffs.unwrap_or_default();
        let initial = shared
            .memory
            .borrow()
            .source
            .or(preferences.source.map(Mode::from_config))
            .unwrap_or(Mode::Branch);
        let sources = sources(session.is_some());
        let mode = if sources.contains(&initial) { initial } else { Mode::Branch };
        let (location, branch) = tui.data.read(|state| {
            let location = session
                .as_ref()
                .and_then(|id| state.session(id))
                .map(|session| Location::from(&session.location))
                .unwrap_or_else(|| state.default_location().clone());
            let branch = state
                .location(Some(&location))
                .and_then(|data| data.vcs.as_ref())
                .and_then(|vcs| vcs.branch.current.clone());
            (location, branch)
        });
        let base_key = json!([location.key(), branch]).to_string();
        let root = View::new(&tui.app)
            .column()
            .width(Length::percent(100.0))
            .height(Length::percent(100.0))
            .min_width(0)
            .min_height(0);
        let viewer = Rc::new_cyclic(|this| Self {
            tui: tui.weak(),
            shared: shared.clone(),
            root,
            place,
            state: RefCell::new(State {
                mode,
                location,
                base_key,
                load: Load::Loading,
                generation: 0,
                reported: HashMap::new(),
                width,
                tree_enabled: preferences.tree.unwrap_or(true),
                single: preferences.single.unwrap_or(false),
                view_override: stored_view(preferences.view),
                tree: Tree::default(),
                expanded: Expanded::new(),
                selected: None,
                reviewed: BTreeSet::new(),
                exhausted: None,
                selected_hunk: None,
                pending: None,
            }),
            parts: RefCell::default(),
            layer: RefCell::default(),
            passes: Cell::new(0),
            this: this.clone(),
        });
        // The previous viewer's keys go with it.
        if let Some(previous) = shared.current.replace(Rc::downgrade(&viewer)).upgrade()
            && let Some(layer) = previous.layer.borrow_mut().take()
        {
            layer.dispose();
        }
        viewer.install(tui);
        viewer.load();
        viewer
    }

    fn install(self: &Rc<Self>, tui: &Tui) {
        let (target, enabled) = match &self.place {
            Place::Panel { host, .. } => {
                let weak = self.this.clone();
                host.on_focus(move |_, _| {
                    if let Some(viewer) = weak.upgrade() {
                        viewer.refresh();
                    }
                });
                (Some(host.id()), Condition::Always)
            }
            Place::Route { .. } => {
                let weak = self.this.clone();
                let tui = self.tui.clone();
                let enabled = Condition::when(move || {
                    let shown = tui.upgrade().is_some_and(|tui| {
                        tui.route()
                            == Route::Plugin {
                                id: ID.to_owned(),
                                name: ROUTE.to_owned(),
                            }
                    });
                    shown && weak.upgrade().is_some_and(|viewer| viewer.is_current())
                });
                (None, enabled)
            }
        };
        match tui.keymap.layer(keys::layer(self, target, enabled)) {
            Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
            Err(error) => log::error!("{ID} keymap layer: {error}"),
        }
        let weak = self.this.clone();
        self.root.on_resize(move |_, rect| {
            let Some(viewer) = weak.upgrade() else { return };
            let width = rect.width as i64;
            if viewer.state.borrow().width != width {
                viewer.state.borrow_mut().width = width;
                viewer.refresh();
            }
        });
    }

    fn is_current(&self) -> bool {
        self.shared.current.borrow().ptr_eq(&self.this)
    }

    fn session(&self) -> Option<&SessionID> {
        match &self.place {
            Place::Panel { session, .. } => Some(session),
            Place::Route { session, .. } => session.as_ref(),
        }
    }

    /// The sources this viewer offers: the VCS ones, and the last turn in a session.
    pub fn sources(&self) -> Vec<Mode> {
        sources(self.session().is_some())
    }

    pub fn mode(&self) -> Mode {
        self.state.borrow().mode
    }

    /// The chosen base, else the one the location reported (`sourceBase`).
    pub fn source_base(&self) -> Option<Base> {
        let state = self.state.borrow();
        let chosen = self.shared.memory.borrow().bases.get(&state.base_key).cloned();
        chosen
            .map(|reference| Base {
                name: reference.clone(),
                reference,
            })
            .or_else(|| state.reported.get(&state.base_key).cloned().flatten())
    }

    /// The key [`Memory::bases`] keeps this location's base under.
    pub fn base_key(&self) -> String {
        self.state.borrow().base_key.clone()
    }

    /// The viewer's location as a request query.
    pub fn location(&self) -> Option<LocationQueryInput> {
        query(&self.state.borrow().location)
    }

    /// `onSwitchSource`: remembers the source and loads it.
    pub fn switch_source(&self, mode: Mode) {
        self.shared.memory.borrow_mut().source = Some(mode);
        self.state.borrow_mut().mode = mode;
        self.load();
    }

    /// Loads again, as after the base changed.
    pub fn reload(&self) {
        self.load();
    }

    /// Whether the panel is docked beside the session.
    fn docked(&self) -> bool {
        matches!(self.place, Place::Panel { .. })
            && self
                .tui
                .upgrade()
                .is_some_and(|tui| tui.panels.presentation() == Presentation::Panel)
    }

    pub fn in_panel(&self) -> bool {
        matches!(self.place, Place::Panel { .. })
    }

    /// Docked panels and narrow full screens share the compact layout: no tree, flush cards, and a footer.
    pub fn compact(&self) -> bool {
        self.docked() || self.state.borrow().width < FULL_LAYOUT_MIN_WIDTH
    }

    pub fn single(&self) -> bool {
        self.state.borrow().single
    }

    /// Whether the viewer has the input: always full screen, else while its panel has the focus.
    fn focused(&self, tui: &Tui) -> bool {
        match &self.place {
            Place::Panel { host, .. } if self.docked() => {
                opencode_ui::dialog::focus_path(&tui.app).contains(&host.id())
            }
            _ => true,
        }
    }

    fn files(&self) -> Vec<File> {
        match &self.state.borrow().load {
            Load::Ready { files, .. } => files.clone(),
            _ => Vec::new(),
        }
    }

    fn patch_files(&self) -> Vec<usize> {
        tree::ordered_files(&tree::flatten(&self.state.borrow().tree, None))
    }

    fn tree_width(&self) -> i64 {
        (self.state.borrow().width / 4).clamp(FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH)
    }

    fn show_tree(&self) -> bool {
        let state = self.state.borrow();
        let files = matches!(&state.load, Load::Ready { files, .. } if !files.is_empty());
        let enabled = state.tree_enabled;
        drop(state);
        !self.compact() && enabled && files
    }

    fn inset(&self) -> u16 {
        if self.compact() { 0 } else { FULL_INSET }
    }

    fn patch_pane_width(&self) -> i64 {
        let tree = if self.show_tree() { self.tree_width() } else { 0 };
        self.state.borrow().width - tree - i64::from(self.inset()) * 2
    }

    fn split_available(&self) -> bool {
        self.patch_pane_width() >= MIN_SPLIT_WIDTH
    }

    fn view(&self) -> DiffView {
        if !self.split_available() {
            return DiffView::Unified;
        }
        let preferred = self.tui.upgrade().and_then(|tui| tui.settings.info().diffs?.view);
        self.state
            .borrow()
            .view_override
            .or(stored_view(preferred))
            .unwrap_or(DiffView::Split)
    }

    /// The files the cards show: every file in tree order, or the one file of the single view.
    fn visible(&self) -> Vec<usize> {
        let files = self.patch_files();
        if !self.single() {
            return files;
        }
        let selected = self.state.borrow().selected;
        selected
            .or_else(|| self.current_file())
            .or(files.first().copied())
            .into_iter()
            .collect()
    }

    // Loading.

    fn load(&self) {
        let Some(tui) = self.tui.upgrade() else { return };
        let (generation, mode, location, key) = {
            let mut state = self.state.borrow_mut();
            state.generation += 1;
            state.load = Load::Loading;
            (state.generation, state.mode, state.location.clone(), state.base_key.clone())
        };
        self.reset();
        self.refresh();
        let client = tui.data.client().clone();
        let session = self.session().cloned().filter(|_| mode == Mode::Turn);
        let chosen = self.shared.memory.borrow().bases.get(&key).cloned();
        let known = self.state.borrow().reported.get(&key).cloned();
        let weak = self.this.clone();
        tui.app.spawn(
            async move {
                let options = RequestOptions::default();
                if let Some(session) = session {
                    let input = SessionDiffInput {
                        session_id: session,
                        context: Some(VCS_DIFF_CONTEXT_LINES),
                        ..SessionDiffInput::default()
                    };
                    let files = client.session_diff(&input, &options).await?;
                    return Ok((None, None, files));
                }
                let mut reported = None;
                let base = match (mode.needs_base(), chosen, known) {
                    (false, ..) => None,
                    (true, Some(reference), _) => Some(Base {
                        name: reference.clone(),
                        reference,
                    }),
                    (true, None, Some(known)) => known,
                    (true, None, None) => {
                        let input = VcsBaseInput {
                            location: query(&location),
                        };
                        let base = client.vcs_base(&input, &options).await?.data.map(|base| Base {
                            name: base.name,
                            reference: base.r#ref,
                        });
                        reported = Some(base.clone());
                        base
                    }
                };
                if mode == Mode::Committed && base.is_none() {
                    return Ok((reported, None, Vec::new()));
                }
                let input = VcsDiffInput {
                    location: query(&location),
                    mode: mode.vcs(),
                    base: base.as_ref().map(|base| base.reference.clone()),
                    context: Some(VCS_DIFF_CONTEXT_LINES),
                    untracked: None,
                };
                let files = client.vcs_diff(&input, &options).await?.data;
                Ok::<_, opencode_api::error::Error>((reported, base, files))
            },
            move |_, result| {
                let Some(viewer) = weak.upgrade() else { return };
                {
                    let mut state = viewer.state.borrow_mut();
                    if state.generation != generation {
                        return;
                    }
                    state.load = match result {
                        Ok((reported, base, files)) => {
                            if let Some(reported) = reported {
                                state.reported.insert(key, reported);
                            }
                            Load::Ready {
                                base,
                                files: files.into_iter().map(File::from).collect(),
                            }
                        }
                        Err(error) => {
                            log::warn!("{ID}: {error}");
                            Load::Failed
                        }
                    };
                }
                viewer.reset();
                viewer.refresh();
            },
        );
    }

    /// New files: the tree opens fully, and the selection and reviewed marks start over.
    fn reset(&self) {
        let files = self.files();
        let mut state = self.state.borrow_mut();
        state.tree = tree::build(files.iter().map(|file| file.file.as_str()));
        state.expanded = tree::all_expanded(&state.tree);
        state.selected = None;
        state.selected_hunk = None;
        state.reviewed.clear();
        state.exhausted = None;
        state.pending = None;
    }

    /// `sourceDetail`: what the header says after the source's name.
    fn source_detail(&self) -> Option<String> {
        let state = self.state.borrow();
        match (&state.load, state.mode) {
            (Load::Failed, Mode::Turn) => Some("Diff unavailable".to_owned()),
            (_, Mode::Turn) => None,
            (_, Mode::Working) => Some("vs HEAD".to_owned()),
            (Load::Failed, _) => Some("Base or diff unavailable".to_owned()),
            (Load::Loading, _) => Some("Resolving diff…".to_owned()),
            (Load::Ready { base: None, .. }, _) => Some("Base not reported".to_owned()),
            (Load::Ready { base: Some(base), .. }, _) => Some(format!("vs {}", base.name)),
        }
    }

    // Commands.

    pub(super) fn run(&self, action: Action) {
        let Some(tui) = self.tui.upgrade() else { return };
        match action {
            Action::Close => {
                tui.dialogs.clear();
                match &self.place {
                    Place::Panel { .. } => tui.panels.close(&tui),
                    Place::Route { back, .. } => tui.navigate(back.clone()),
                }
            }
            Action::Down | Action::Up => {
                self.clear_patch_selection();
                self.scroll_by(if action == Action::Down { 1 } else { -1 });
            }
            Action::PageDown => self.scroll_page(1, 1),
            Action::PageUp => self.scroll_page(-1, 1),
            Action::HalfPageDown => self.scroll_page(1, 2),
            Action::HalfPageUp => self.scroll_page(-1, 2),
            Action::First => {
                self.clear_patch_selection();
                self.scroll_to(0);
            }
            Action::Last => {
                self.clear_patch_selection();
                if let Some(scroll) = self.scroll() {
                    scroll.scroll_to_bottom();
                }
                self.passes();
            }
            Action::NextHunk => self.jump_hunk(1),
            Action::PreviousHunk => self.jump_hunk(-1),
            Action::NextFile => self.jump_file(1),
            Action::PreviousFile => self.jump_file(-1),
            Action::MarkReviewed => {
                let file = self.state.borrow().selected.or_else(|| self.current_file());
                if file.is_some() && file == self.state.borrow().exhausted {
                    return;
                }
                self.toggle_reviewed(file);
            }
            Action::ToggleFileTree => {
                if self.compact() {
                    return;
                }
                let next = !self.state.borrow().tree_enabled;
                self.state.borrow_mut().tree_enabled = next;
                preference(&tui, "tree", json!(next));
                self.refresh();
            }
            Action::SinglePatch => self.toggle_single(&tui),
            Action::SwitchSource => super::sources::open(self),
            Action::ToggleView => {
                if !self.split_available() {
                    return;
                }
                let next = match self.view() {
                    DiffView::Split => DiffView::Unified,
                    DiffView::Unified => DiffView::Split,
                };
                {
                    let mut state = self.state.borrow_mut();
                    state.selected_hunk = None;
                    state.view_override = Some(next);
                }
                let name = if next == DiffView::Split { "split" } else { "unified" };
                preference(&tui, "view", json!(name));
                self.refresh();
            }
            Action::ToggleFullscreen => {
                if !self.in_panel() {
                    return;
                }
                let before = tui.panels.presentation();
                tui.panels.toggle_fullscreen(&tui);
                let after = tui.panels.presentation();
                // A narrow terminal forces full screen and ignores the toggle; only a real toggle is remembered.
                if after != before {
                    preference(&tui, "fullscreen", json!(after == Presentation::Fullscreen));
                    self.refresh();
                }
            }
            Action::Help => super::help::open(self),
        }
    }

    fn toggle_single(&self, tui: &Tui) {
        self.state.borrow_mut().selected_hunk = None;
        if !self.single() {
            let file = self
                .current_file()
                .or(self.state.borrow().selected)
                .or(self.patch_files().first().copied());
            if let Some(file) = file {
                self.select_file(file);
            }
            self.state.borrow_mut().single = true;
            preference(tui, "single", json!(true));
            self.refresh();
            self.scroll_to(0);
            return;
        }
        let file = self.visible().first().copied();
        if let Some(file) = file {
            self.select_file(file);
        }
        self.state.borrow_mut().single = false;
        preference(tui, "single", json!(false));
        self.refresh();
        if let Some(file) = file {
            self.scroll_after_render(file, None);
        }
    }

    fn clear_patch_selection(&self) {
        let changed = {
            let mut state = self.state.borrow_mut();
            state.pending = None;
            state.selected_hunk = None;
            let single = state.single;
            !single && state.selected.take().is_some()
        };
        if changed {
            self.refresh();
        }
    }

    fn scroll(&self) -> Option<ScrollBox> {
        self.parts.borrow().scroll.clone()
    }

    fn scroll_top(&self) -> i64 {
        self.scroll()
            .map_or(0, |scroll| scroll.scroll_position().1.round() as i64)
    }

    fn viewport_height(&self) -> i64 {
        self.scroll().map_or(0, |scroll| scroll.rect().height as i64)
    }

    fn scroll_to(&self, top: i64) {
        if let Some(scroll) = self.scroll() {
            scroll.scroll_to(0.0, top as f64);
        }
        self.passes();
    }

    fn scroll_by(&self, rows: i64) {
        if let Some(scroll) = self.scroll() {
            scroll.scroll_by(0.0, rows as f64);
        }
        self.passes();
    }

    fn scroll_page(&self, direction: i64, divisor: i64) {
        self.clear_patch_selection();
        self.scroll_by(direction * (self.viewport_height() / divisor).max(1));
    }

    /// Rows from the top of the scrolled content to `widget`, in the latest frame.
    fn content_y(&self, widget: &impl Widget) -> Option<i64> {
        let parts = self.parts.borrow();
        let content = parts.scroll.as_ref()?.content_view().rect();
        let rect = widget.rect();
        (rect.height > 0.0).then(|| (rect.screen_y - content.screen_y).round() as i64)
    }

    fn card_y(&self, file: usize) -> Option<i64> {
        let node = self
            .parts
            .borrow()
            .cards
            .iter()
            .find(|card| card.file == file)
            .map(|card| card.node.clone())?;
        self.content_y(&node)
    }

    /// `currentPatchFileIndex`.
    fn current_file(&self) -> Option<usize> {
        let nodes: Vec<(usize, View)> = self
            .parts
            .borrow()
            .cards
            .iter()
            .map(|card| (card.file, card.node.clone()))
            .collect();
        let positions: Vec<(usize, i64)> = nodes
            .iter()
            .filter_map(|(file, node)| Some((*file, self.content_y(node)?)))
            .collect();
        hunks::current_file(&positions, self.scroll_top())
    }

    /// `selectPatchFile`: selects `file` and opens the directories above it.
    fn select_file(&self, file: usize) {
        let mut state = self.state.borrow_mut();
        state.pending = None;
        state.exhausted = None;
        if let Some(parents) = tree::parents_of(&state.tree, file) {
            state.expanded.extend(parents);
        }
        state.selected = Some(file);
    }

    fn scroll_to_file(&self, file: Option<usize>) {
        let Some(file) = file else { return };
        self.select_file(file);
        self.refresh();
        if let Some(y) = self.card_y(file) {
            self.scroll_to(hunks::card_top(y, None));
        }
    }

    fn jump_file(&self, offset: i64) {
        self.state.borrow_mut().selected_hunk = None;
        let current = self.state.borrow().selected.or_else(|| self.current_file());
        let next = tree::move_file(&self.patch_files(), current, offset);
        if self.single() {
            let Some(next) = next else { return };
            self.select_file(next);
            self.refresh();
            self.scroll_to(0);
            return;
        }
        self.scroll_to_file(next);
    }

    fn jump_hunk(&self, offset: i64) {
        let Some(scroll) = self.scroll() else { return };
        let rows: Vec<(usize, Vec<AnyWidget>)> = self
            .parts
            .borrow()
            .cards
            .iter()
            .map(|card| (card.file, card.hunks.clone()))
            .collect();
        let positions: Vec<Hunk> = rows
            .iter()
            .flat_map(|(file, rows)| {
                rows.iter().enumerate().filter_map(|(hunk, row)| {
                    Some(Hunk {
                        file: *file,
                        hunk,
                        y: self.content_y(row)?,
                    })
                })
            })
            .collect();
        let top = self.scroll_top();
        let Some(next) = hunks::jump(&positions, self.state.borrow().selected_hunk, top, offset) else {
            return;
        };
        self.select_file(next.file);
        self.refresh();
        let content = scroll.content_view().rect().height as i64;
        let target = hunks::clamp_scroll(hunks::hunk_top(&next), content, self.viewport_height());
        self.scroll_to(target);
        self.state.borrow_mut().selected_hunk = Some(Selected {
            file: next.file,
            hunk: next.hunk,
            scroll_top: target,
        });
    }

    /// `toggleFileReviewed`: a file reviewed from the current card moves on (the next file in the single view);
    /// another file's mark keeps the reading position.
    pub fn toggle_reviewed(&self, file: Option<usize>) {
        let Some(file) = file else { return };
        let Some(name) = self.files().get(file).map(|file| file.file.clone()) else {
            return;
        };
        let current = self.state.borrow().selected.or_else(|| self.current_file());
        let offset = current.and_then(|current| {
            let parts = self.parts.borrow();
            let node = parts.cards.iter().find(|card| card.file == current)?.node.clone();
            let viewport = parts.scroll.as_ref()?.rect();
            Some((viewport.screen_y - node.rect().screen_y).round() as i64)
        });
        let was = {
            let mut state = self.state.borrow_mut();
            let was = !state.reviewed.insert(name.clone());
            if was {
                state.reviewed.remove(&name);
            }
            was
        };
        let single = self.single();
        if Some(file) != current {
            if let (Some(current), Some(offset), false) = (current, offset, single) {
                self.scroll_after_render(current, Some(offset));
            }
            self.refresh();
            return;
        }
        let next = if single && !was {
            tree::move_file(&self.patch_files(), Some(file), 1).unwrap_or(file)
        } else {
            file
        };
        self.select_file(next);
        {
            let mut state = self.state.borrow_mut();
            if single && !was && next == file {
                state.exhausted = Some(file);
            }
            state.selected_hunk = None;
        }
        self.refresh();
        self.scroll_after_render(next, None);
    }

    /// Whether `file` is marked reviewed.
    pub fn is_reviewed(&self, file: usize) -> bool {
        let files = self.files();
        files
            .get(file)
            .is_some_and(|file| self.state.borrow().reviewed.contains(&file.file))
    }

    /// `scrollToPatchFileIndexAfterRender`.
    fn scroll_after_render(&self, file: usize, offset: Option<i64>) {
        self.state.borrow_mut().pending = Some((file, offset));
        self.passes();
    }

    /// Runs [`Self::pass`] before each of the next [`PASSES`] frames.
    fn passes(&self) {
        let running = self.passes.replace(PASSES) > 0;
        let Some(tui) = self.tui.upgrade() else { return };
        tui.app.request_redraw();
        if running {
            return;
        }
        let weak = self.this.clone();
        tui.app.animate(move |_, _| {
            let Some(viewer) = weak.upgrade() else { return false };
            viewer.pass();
            let left = viewer.passes.get().saturating_sub(1);
            viewer.passes.set(left);
            if left == 0 {
                viewer.state.borrow_mut().pending = None;
            }
            left > 0
        });
    }

    /// The work TS does in lifecycle passes: the pending scroll, the sticky headers, and the top edge's color.
    fn pass(&self) {
        let Some(tui) = self.tui.upgrade() else { return };
        let pending = self.state.borrow().pending;
        if let Some((file, offset)) = pending
            && let Some(y) = self.card_y(file)
            && let Some(scroll) = self.scroll()
        {
            scroll.scroll_to(0.0, hunks::card_top(y, offset) as f64);
        }
        let top = self.scroll_top();
        let parts = self.parts.borrow();
        let Some(scroll) = &parts.scroll else { return };
        let content = scroll.content_view().rect();
        let viewport = scroll.rect();
        for card in &parts.cards {
            let Some(header) = &card.header else { continue };
            let rect = card.card.rect();
            let y = (rect.screen_y - content.screen_y).round() as i64;
            let room = (rect.height as i64 - 2).max(0);
            header.translate(0.0, (top - y).clamp(0, room) as f64);
        }
        if let Some(edge) = &parts.top_edge {
            let theme = tui.page();
            let reviewed = parts
                .cards
                .iter()
                .rfind(|card| card.node.rect().screen_y <= viewport.screen_y)
                .is_some_and(|card| card.reviewed);
            edge.bg(if reviewed {
                theme.background.raised.high
            } else {
                theme.diff.background.context
            });
        }
    }

    // Rendering.

    /// Rebuilds what changed: everything when the cards change, else the tree.
    fn refresh(&self) {
        let Some(tui) = self.tui.upgrade() else { return };
        let key = self.render_key(&tui);
        let same = self.parts.borrow().key.as_ref() == Some(&key);
        if same {
            self.render_tree(&tui);
            self.passes();
            return;
        }
        self.render(&tui);
        self.parts.borrow_mut().key = Some(key);
        self.passes();
    }

    fn render_key(&self, tui: &Tui) -> String {
        let state = self.state.borrow();
        let load = match &state.load {
            Load::Loading => "loading".to_owned(),
            Load::Failed => "failed".to_owned(),
            Load::Ready { files, .. } => files.len().to_string(),
        };
        let (generation, width) = (state.generation, state.width);
        let reviewed: Vec<String> = state.reviewed.iter().cloned().collect();
        drop(state);
        format!(
            "{generation}|{load}|{width}|{:?}|{reviewed:?}|{:?}|{}|{}|{}",
            self.visible(),
            self.view(),
            self.compact(),
            self.show_tree(),
            self.focused(tui),
        )
    }

    fn render(&self, tui: &Tui) {
        let app = &tui.app;
        let theme = tui.page();
        let previous = self.scroll().map(|scroll| scroll.scroll_position().1);
        self.root.clear();
        *self.parts.borrow_mut() = Parts::default();
        let docked = self.docked();
        let compact = self.compact();
        let surface = if docked {
            theme.background.raised.base
        } else {
            theme.background.base
        };
        self.root.bg(surface);
        let show_tree = self.show_tree();
        let help = tui.keymap.shortcut("diff.help");
        if !show_tree {
            self.root.add(&self.header(app, &theme, docked, compact));
        }
        let body = View::new(app).column().grow(1.0).basis(Length::Auto).min_height(0);
        self.root.add(&body);
        let message = |text: &str, color: Color| {
            View::new(app)
                .grow(1.0)
                .basis(Length::Auto)
                .padding(2)
                .padding_edge(Edge::Top, if compact { 1 } else { 2 })
                .child(&Text::new(app, text).fg(color))
        };
        let (load, mode) = {
            let state = self.state.borrow();
            (state.load.clone(), state.mode)
        };
        match &load {
            Load::Loading => body.add(&message("Loading diff…", theme.text.muted)),
            Load::Failed => {
                let text = if self.source_base().is_none() && mode.needs_base() {
                    "Could not load diff. Choose a base branch from Diff source, or select Uncommitted."
                } else {
                    "Could not load diff. Reopen the diff viewer to try again."
                };
                body.add(&message(text, theme.text.feedback.error.base))
            }
            Load::Ready { base: None, .. } if mode == Mode::Committed => body.add(&message(
                "Committed comparison unavailable without base metadata. Choose a base branch from Diff source.",
                theme.text.muted,
            )),
            Load::Ready { files, .. } if files.is_empty() => {
                body.add(&message("No changes to show", theme.text.muted))
            }
            Load::Ready { files, .. } => {
                let row = View::new(app).row().grow(1.0).basis(Length::Auto).min_height(0);
                if show_tree {
                    let slot = View::new(app).shrink(0.0).min_height(0);
                    row.add(&slot);
                    self.parts.borrow_mut().tree = Some(slot);
                }
                row.add(&self.patches(tui, &theme, files, surface, previous));
                body.add(&row)
            }
        };
        if compact {
            self.root.add(&self.footer(tui, &theme, docked, help.clone()));
        }
        if !show_tree && !compact && help.is_some() {
            self.root.add(
                &View::new(app)
                    .absolute()
                    .position(Edge::Top, 0)
                    .position(Edge::Right, 0)
                    .width(1)
                    .height(1)
                    .child(&Text::new(app, "?").fg(theme.text.base).wrap(WrapMode::None)),
            );
        }
        self.render_tree(tui);
        app.request_redraw();
    }

    /// The source header above the cards when the tree is hidden.
    fn header(&self, app: &App, theme: &Theme, docked: bool, compact: bool) -> View {
        let mode = self.mode();
        let switch = View::new(app)
            .row()
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .child(
                &Text::new(app, mode.label())
                    .fg(theme.text.action.secondary.base)
                    .bold()
                    .wrap(WrapMode::None)
                    .shrink(0.0),
            );
        if let Some(detail) = self.source_detail() {
            switch.add(
                &Text::new(app, format!(" · {detail}"))
                    .fg(theme.text.muted)
                    .wrap(WrapMode::None)
                    .truncate(true)
                    .grow(1.0)
                    .basis(Length::Auto)
                    .min_width(0),
            );
        }
        let weak = self.this.clone();
        switch.on_click(move |cx, _| {
            cx.stop_propagation();
            if let Some(viewer) = weak.upgrade() {
                super::sources::open(&viewer);
            }
        });
        let files = self.files();
        let reviewed = (0..files.len()).filter(|&file| self.is_reviewed(file)).count();
        View::new(app)
            .row()
            .gap(1)
            .shrink(0.0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, if compact { 1 } else { 2 })
            .padding_edge(Edge::Top, u16::from(docked))
            .height(if docked { 2 } else { 1 })
            .child(&switch)
            .child(
                &Text::new(app, format!("{reviewed}/{}", files.len()))
                    .fg(theme.text.muted)
                    .wrap(WrapMode::None)
                    .shrink(0.0),
            )
    }

    /// The fixed top edge and the scrolled cards.
    fn patches(&self, tui: &Tui, theme: &Theme, files: &[File], surface: Color, previous: Option<f64>) -> View {
        let app = &tui.app;
        let inset = self.inset();
        let compact = self.compact();
        let top_edge = View::new(app)
            .height(1)
            .shrink(0.0)
            .margin_edge(Edge::Left, inset)
            .margin_edge(Edge::Right, inset)
            .bg(theme.diff.background.context);
        let scroll = ScrollBox::new(app)
            .scrollbars(false)
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .focusable(false);
        let weak = self.this.clone();
        scroll.on_mouse(move |_, event| {
            if matches!(event.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown)
                && let Some(viewer) = weak.upgrade()
            {
                viewer.clear_patch_selection();
                viewer.passes();
            }
        });
        let syntax = opencode_ui::code::syntax_theme(theme);
        let view = self.view();
        let mode = self.mode();
        let pane_width = self.patch_pane_width();
        let mut cards = Vec::new();
        for (index, file) in self.visible().into_iter().enumerate() {
            let Some(entry) = files.get(file) else { continue };
            let reviewed = self.state.borrow().reviewed.contains(&entry.file);
            let background = if reviewed {
                theme.background.raised.high
            } else {
                theme.diff.background.context
            };
            let image = is_image(&entry.file);
            let node = View::new(app).column().shrink(0.0);
            if index > 0 {
                node.add(&card_gap(app, theme, '▄', background, surface, inset));
            }
            let counts = if image {
                6
            } else {
                entry.additions.to_string().len() as i64 + entry.deletions.to_string().len() as i64 + 5
            } + if reviewed { 2 } else { 0 };
            let path = crate::dialogs::open::truncate_file_path(&entry.file, (pane_width - counts - 2).max(1));
            let split = path.rfind('/').map_or(0, |at| at + 1);
            let line = View::new(app)
                .row()
                .gap(1)
                .height(1)
                .shrink(0.0)
                .padding_edge(Edge::Left, if compact { 2 } else { 1 })
                .padding_edge(Edge::Right, 1)
                .child(
                    &View::new(app).grow(1.0).basis(Length::Auto).min_width(0).child(
                        &Text::new(
                            app,
                            vec![
                                path[..split].to_owned().fg(theme.text.muted),
                                path[split..].to_owned().fg(if reviewed {
                                    theme.text.muted
                                } else {
                                    theme.text.base
                                }),
                            ],
                        )
                        .fg(theme.text.muted)
                        .wrap(WrapMode::None)
                        .truncate(true),
                    ),
                );
            if reviewed {
                line.add(&Text::new(app, "✓").fg(theme.text.muted).shrink(0.0));
            }
            if image {
                line.add(&Text::new(app, "Image").fg(theme.text.muted));
            } else {
                let count = |text: String, color: Color| {
                    Text::new(app, text)
                        .fg(if reviewed { theme.text.muted } else { color })
                        .shrink(0.0)
                };
                line.add(&count(format!("+{}", entry.additions), theme.diff.text.added));
                line.add(&count(format!("-{}", entry.deletions), theme.diff.text.removed));
            }
            let weak = self.this.clone();
            line.on_mouse(move |cx, event| {
                if event.kind == MouseEventKind::Down(MouseButton::Right)
                    && let Some(viewer) = weak.upgrade()
                {
                    cx.prevent_default();
                    cx.stop_propagation();
                    super::file_menu::open(&viewer, file, event.x, event.y);
                }
            });
            let card = View::new(app)
                .column()
                .shrink(0.0)
                .margin_edge(Edge::Left, inset)
                .margin_edge(Edge::Right, inset)
                .bg(background);
            node.add(&card);
            let mut rows = Vec::new();
            let header = if reviewed {
                // The reviewed card is its title; a half-row of the page closes it.
                card.add(&line);
                node.add(&card_gap(app, theme, '▀', background, surface, inset));
                None
            } else {
                let header = View::new(app)
                    .column()
                    .height(hunks::FILE_HEADER_HEIGHT as u16)
                    .shrink(0.0)
                    .z_index(1)
                    .bg(background)
                    .child(&line);
                card.add(&header);
                card.add(&self.body(tui, theme, &syntax, entry, mode, view, compact, image, &mut rows));
                Some(header)
            };
            cards.push(Card {
                file,
                reviewed,
                node: node.clone(),
                card,
                header,
                hunks: rows,
            });
            scroll.add(&node);
        }
        if let Some(previous) = previous {
            scroll.scroll_to(0.0, previous);
        }
        {
            let mut parts = self.parts.borrow_mut();
            parts.scroll = Some(scroll.clone());
            parts.top_edge = Some(top_edge.clone());
            parts.cards = cards;
        }
        View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .min_height(0)
            .child(&top_edge)
            .child(&scroll)
    }

    /// A card's body: its patch, or a line that says why there is none.
    #[allow(clippy::too_many_arguments)]
    fn body(
        &self,
        tui: &Tui,
        theme: &Theme,
        syntax: &opentui::syntax::SyntaxTheme,
        entry: &File,
        mode: Mode,
        view: DiffView,
        compact: bool,
        image: bool,
        rows: &mut Vec<AnyWidget>,
    ) -> View {
        let app = &tui.app;
        if !(mode == Mode::Committed && image) && !image && !entry.patch.is_empty() {
            let view = if entry.status == tree::Status::Modified {
                view
            } else {
                DiffView::Unified
            };
            let diff = opencode_ui::diff::view(
                app,
                theme,
                syntax,
                &entry.patch,
                view,
                opentui::syntax::filetype_for_path(&entry.file),
                WrapMode::Char,
                u32::from(compact),
            );
            // The first diff, then each later hunk's `@@` row.
            rows.extend(
                diff.children()
                    .into_iter()
                    .enumerate()
                    .filter(|(index, _)| *index == 0 || index % 2 == 1)
                    .map(|(_, row)| row),
            );
            return diff;
        }
        let text = match () {
            _ if mode == Mode::Committed && image => {
                "Committed image preview unavailable. The working-tree image is not shown."
            }
            _ if entry.status == tree::Status::Deleted && image => {
                "Deleted image. The previous revision is not available for preview."
            }
            // TS previews the working-tree image here (`DiffViewerImage`); see F15-image-diffs.
            _ if image => "Image preview is not available in opencode-rs.",
            _ => "No patch available for this file.",
        };
        View::new(app)
            .width(Length::percent(100.0))
            .shrink(0.0)
            .padding_edge(Edge::Left, if compact { 2 } else { 1 })
            .padding_edge(Edge::Right, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&Text::new(app, text).fg(theme.text.muted))
    }

    /// The footer of the compact layout: how to leave, and the shortcuts.
    fn footer(&self, tui: &Tui, theme: &Theme, docked: bool, help: Option<String>) -> View {
        let app = &tui.app;
        let focused = self.focused(tui);
        let surface = theme.background.raised.base;
        let footer = View::new(app).column().shrink(0.0).bg(theme.background.base);
        if docked {
            footer.add(
                &View::new(app)
                    .height(1)
                    .shrink(0.0)
                    .border_sides(Sides::BOTTOM)
                    .border_chars(Some(border_chars('▀')))
                    .border_color(surface)
                    .bg(theme.background.base),
            );
        }
        let (command, label) = if docked {
            ("pane.focus.left", " focus prompt")
        } else {
            ("diff.close", " close")
        };
        let shortcut = tui.keymap.shortcut(command).unwrap_or_default();
        let leave = Text::new(
            app,
            vec![
                shortcut.into(),
                if focused {
                    label.fg(theme.text.muted)
                } else {
                    label.into()
                },
            ],
        )
        .fg(if focused {
            theme.background.action.primary.focused
        } else {
            theme.text.action.primary.disabled
        })
        .attributes(if focused { Attributes::default() } else { Attributes::DIM })
        .wrap(WrapMode::None)
        .truncate(true)
        .grow(1.0)
        .basis(Length::Auto)
        .min_width(0);
        let weak = self.this.clone();
        leave.on_click(move |_, _| {
            let Some(viewer) = weak.upgrade() else { return };
            if !viewer.docked() {
                viewer.run(Action::Close);
                return;
            }
            if let (Some(tui), Place::Panel { host, .. }) = (viewer.tui.upgrade(), &viewer.place) {
                tui.app.focus(host);
            }
        });
        let row = View::new(app)
            .row()
            .height(1)
            .shrink(0.0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 1)
            .child(&leave);
        if let Some(help) = help {
            let muted = !focused;
            let text = Text::new(
                app,
                vec![
                    help.into(),
                    if muted {
                        " see all".into()
                    } else {
                        " see all".fg(theme.text.muted)
                    },
                ],
            )
            .fg(if muted {
                theme.text.action.primary.disabled
            } else {
                theme.text.base
            })
            .attributes(if muted { Attributes::DIM } else { Attributes::default() })
            .wrap(WrapMode::None)
            .shrink(0.0);
            let weak = self.this.clone();
            text.on_click(move |cx, _| {
                cx.stop_propagation();
                if let Some(viewer) = weak.upgrade() {
                    super::help::open(&viewer);
                }
            });
            row.add(&View::new(app).shrink(0.0).child(&text));
        }
        footer.add(&row);
        if docked {
            footer.add(&View::new(app).height(1).shrink(0.0));
        }
        footer
    }

    /// Rebuilds the tree pane in its slot.
    fn render_tree(&self, tui: &Tui) {
        let Some(slot) = self.parts.borrow().tree.clone() else {
            return;
        };
        slot.clear();
        let theme = tui.page();
        let files = self.files();
        let items: Vec<tree::Item<'_>> = files
            .iter()
            .map(|file| tree::Item {
                file: &file.file,
                status: file.status,
            })
            .collect();
        let (tree, expanded, selected, reviewed) = {
            let state = self.state.borrow();
            (
                state.tree.clone(),
                state.expanded.clone(),
                state.selected,
                state.reviewed.clone(),
            )
        };
        let selected = selected.or_else(|| self.single().then(|| self.visible().first().copied()).flatten());
        let detail = self.source_detail();
        let is_reviewed = |file: usize| files.get(file).is_some_and(|file| reviewed.contains(&file.file));
        let weak = self.this.clone();
        let on_row: tree::OnRow = Rc::new(move |row| {
            let Some(viewer) = weak.upgrade() else { return };
            match row.file {
                Some(file) => {
                    viewer.state.borrow_mut().selected_hunk = None;
                    viewer.scroll_to_file(Some(file));
                    if viewer.single() {
                        viewer.scroll_to(0);
                    }
                }
                None => {
                    {
                        let mut state = viewer.state.borrow_mut();
                        state.expanded = tree::toggle(&state.tree, &state.expanded, row.id);
                    }
                    viewer.refresh();
                }
            }
        });
        let weak = self.this.clone();
        let on_source = Rc::new(move || {
            if let Some(viewer) = weak.upgrade() {
                super::sources::open(&viewer);
            }
        });
        let pane = tree::pane(
            &tui.app,
            &theme,
            &tree::Pane {
                width: self.tree_width() as u16,
                files: &items,
                selected,
                reviewed: &is_reviewed,
                expanded: &expanded,
                source: self.mode().label(),
                detail: detail.as_deref(),
                help: tui.keymap.shortcut("diff.help"),
            },
            &tree,
            on_row,
            on_source,
        );
        slot.add(&pane);
    }
}

/// A half-row of page between cards: the card's color over its width, the pane's surface over the insets
/// (`CardGap`).
fn card_gap(app: &App, theme: &Theme, glyph: char, card: Color, surface: Color, inset: u16) -> View {
    let side = if glyph == '▄' { Sides::TOP } else { Sides::BOTTOM };
    let half = |color: Color| {
        View::new(app)
            .height(1)
            .shrink(0.0)
            .border_sides(side)
            .border_chars(Some(border_chars(glyph)))
            .border_color(color)
            .bg(theme.background.base)
    };
    let row = View::new(app).row().height(1).shrink(0.0);
    // A zero-width inset still claims a cell, which would notch flush cards.
    if inset > 0 {
        row.add(&half(surface).width(inset));
    }
    row.add(&half(card).grow(1.0).basis(Length::Auto));
    if inset > 0 {
        row.add(&half(surface).width(inset));
    }
    row
}

/// Border characters that draw `horizontal` on the top and bottom sides only (`EmptyBorder`).
fn border_chars(horizontal: char) -> [char; 11] {
    let mut chars = [' '; 11];
    chars[4] = horizontal;
    chars
}

fn sources(session: bool) -> Vec<Mode> {
    let mut sources = vec![Mode::Branch, Mode::Committed, Mode::Working];
    if session {
        sources.push(Mode::Turn);
    }
    sources
}

fn stored_view(view: Option<PreferredView>) -> Option<DiffView> {
    match view? {
        PreferredView::Split => Some(DiffView::Split),
        PreferredView::Unified => Some(DiffView::Unified),
        PreferredView::Auto => None,
    }
}

fn query(location: &Location) -> Option<LocationQueryInput> {
    Some(LocationQueryInput {
        directory: Some(location.directory.clone()),
    })
}

/// `isDiffImageFile`.
pub fn is_image(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

/// `onPreferencesChange`: one `diffs` key in `cli.json`.
fn preference(tui: &Tui, key: &'static str, value: Value) {
    crate::dialogs::settings::update(tui, move |config| {
        crate::dialogs::settings::set_path(config, &["diffs", key], value);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_match_by_extension() {
        assert!(is_image("assets/logo.PNG"));
        assert!(is_image("a.jpeg") && is_image("a.jpg") && is_image("a.webp") && is_image("a.gif"));
        assert!(!is_image("a.svg") && !is_image("png"));
    }

    #[test]
    fn the_full_layout_needs_room_for_a_docked_panel_of_patches() {
        assert_eq!(FULL_LAYOUT_MIN_WIDTH, 88);
        assert_eq!(sources(false), [Mode::Branch, Mode::Committed, Mode::Working]);
        assert_eq!(sources(true).last(), Some(&Mode::Turn));
    }
}
