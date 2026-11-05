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

use opencode_api::generated::{FileDiffInfo, FileDiffInfoStatus, LocationQueryInput, SessionID, VcsMode};
use opencode_local::cli_config::{DiffSource, DiffView as PreferredView};
use opencode_plugin::{Definition, Setup, Slotted};
use opencode_store::Location;
use opencode_ui::bind;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use opentui::widget::DiffView;
use serde_json::{Value, json};

use super::hunks::{self, Hunk, Selected};
use super::keys::{self, Action};
use super::tree::{self, Expanded, Tree};
use crate::app::Tui;
use crate::frame::layout::SESSION_PANEL_SPLIT_MIN_WIDTH;
use crate::panel::{Presentation, Target};
use crate::routes::Route;

mod load;
mod render;

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
                let place = Place::Panel { host: host.clone(), session: SessionID(input.target.session.clone()) };
                let viewer = Viewer::mount(tui, &panel, place, i64::from(input.width));
                host.add(&viewer.root);
                // The panel's host keeps the viewer, so its keys, menu, and watch go when the panel closes.
                Box::new(viewer)
            }),
        );
        let route = shared.clone();
        setup.route(ROUTE, move |tui| {
            let data = route.route.borrow().clone().unwrap_or(RouteData { session: None, back: Route::Home });
            let place = Place::Route { session: data.session, back: data.back };
            Box::new(RouteSlot(Viewer::mount(tui, &route, place, i64::from(tui.app.size().0))))
        });
        let open = shared.clone();
        setup.layer(keys::open_layer(&tui, Rc::new(move |tui| self::open(tui, &open))));
        setup.on_dispose(bind!(tui, |tui| tui.panels.release(&tui, ID)));
    })
}

/// `diff.open`: closes the session's open viewer, else docks one beside the session, else opens the route.
fn open(tui: &Tui, shared: &Rc<Shared>) {
    let route = tui.route();
    tui.dialogs.clear();
    if let Route::Session { id } = &route {
        let target = Target { plugin: ID.to_owned(), name: ROUTE.to_owned(), session: id.0.clone() };
        if tui.panels.current().as_ref() == Some(&target) {
            tui.panels.close(tui);
            return;
        }
        let fullscreen = tui.settings.info().diffs.and_then(|diffs| diffs.fullscreen) == Some(true);
        let presentation = if fullscreen { Presentation::Fullscreen } else { Presentation::Panel };
        tui.panels.open(tui, target, presentation);
        return;
    }
    *shared.route.borrow_mut() = Some(RouteData { session: None, back: route });
    tui.navigate(Route::Plugin { id: ID.to_owned(), name: ROUTE.to_owned() });
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
    /// The body of each image card on screen, by file, filled when its image loads.
    images: Vec<(String, View)>,
}

/// The working-tree bytes of an image card (`DiffViewerImage`'s resource).
#[derive(Clone)]
enum Preview {
    Loading,
    Failed,
    Ready(Rc<Vec<u8>>),
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
    /// Image previews by file, read once per file list.
    previews: RefCell<HashMap<String, Preview>>,
    layer: RefCell<Option<Disposer>>,
    /// The open file menu (`fileMenu`); new files close it.
    pub(super) menu: RefCell<Option<super::file_menu::Menu>>,
    /// The session's status last seen in `turn` mode, for the refetch when a turn ends.
    pub(super) turn_status: Cell<Option<opencode_store::SessionStatus>>,
    was_focused: Cell<bool>,
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
        let initial =
            shared.memory.borrow().source.or(preferences.source.map(Mode::from_config)).unwrap_or(Mode::Branch);
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
            previews: RefCell::default(),
            layer: RefCell::default(),
            menu: RefCell::default(),
            turn_status: Cell::new(None),
            was_focused: Cell::new(false),
            passes: Cell::new(0),
            this: this.clone(),
        });
        viewer.install(tui);
        viewer.load();
        super::sources::watch(&viewer);
        viewer
    }

    fn install(self: &Rc<Self>, tui: &Tui) {
        let (target, enabled) = match &self.place {
            Place::Panel { host, .. } => {
                let weak = self.this.clone();
                host.on_focus(bind!(weak, |viewer, _, _| viewer.refresh()));
                (Some(host.id()), Condition::Always)
            }
            Place::Route { .. } => {
                let tui = self.tui.clone();
                let enabled = Condition::when(move || {
                    tui.upgrade()
                        .is_some_and(|tui| tui.route() == Route::Plugin { id: ID.to_owned(), name: ROUTE.to_owned() })
                });
                (None, enabled)
            }
        };
        match tui.keymap.layer(keys::layer(self, target, enabled)) {
            Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
            Err(error) => log::error!("{ID} keymap layer: {error}"),
        }
        let weak = self.this.clone();
        self.root.on_resize(bind!(weak, |viewer, _, rect| {
            let width = rect.width as i64;
            if viewer.state.borrow().width != width {
                viewer.state.borrow_mut().width = width;
                viewer.refresh();
            }
        }));
    }

    pub(super) fn session(&self) -> Option<&SessionID> {
        match &self.place {
            Place::Panel { session, .. } => Some(session),
            Place::Route { session, .. } => session.as_ref(),
        }
    }

    pub(super) fn tui(&self) -> Option<Rc<Tui>> {
        self.tui.upgrade()
    }

    pub(super) fn weak(&self) -> Weak<Viewer> {
        self.this.clone()
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
            .map(|reference| Base { name: reference.clone(), reference })
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

    /// `onSwitchSource`: remembers the source and loads it, unless it is the one shown.
    pub fn switch_source(&self, mode: Mode) {
        self.shared.memory.borrow_mut().source = Some(mode);
        if self.mode() == mode {
            return;
        }
        self.state.borrow_mut().mode = mode;
        self.load();
    }

    /// Loads again, as after the base changed or a turn ended.
    pub fn reload(&self) {
        self.load();
    }

    /// The base chosen for `key`, kept until the TUI exits.
    pub fn chosen_base(&self, key: &str) -> Option<String> {
        self.shared.memory.borrow().bases.get(key).cloned()
    }

    /// `onSelect` of the base dialog: remembers `reference` for `key`, and loads again when this viewer compares
    /// with it.
    pub fn choose_base(&self, key: &str, reference: String) {
        let previous = self.shared.memory.borrow_mut().bases.insert(key.to_owned(), reference.clone());
        if previous.as_ref() != Some(&reference) && self.mode().needs_base() && self.base_key() == key {
            self.load();
        }
    }

    /// The base `key` reported, if it was looked up.
    pub fn reported_base(&self, key: &str) -> Option<Option<Base>> {
        self.state.borrow().reported.get(key).cloned()
    }

    /// Whether the panel is docked beside the session.
    fn docked(&self) -> bool {
        matches!(self.place, Place::Panel { .. })
            && self.tui.upgrade().is_some_and(|tui| tui.panels.presentation() == Presentation::Panel)
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
    /// A dialog takes the focus without changing the panel's focus state (TS `panel.focused`), so the state seen
    /// before it opened holds while it is open.
    fn focused(&self, tui: &Tui) -> bool {
        match &self.place {
            Place::Panel { host, .. } if self.docked() => {
                if tui.dialogs.is_open() {
                    return self.was_focused.get();
                }
                let focused = opencode_ui::dialog::focus_path(&tui.app).contains(&host.id());
                self.was_focused.set(focused);
                focused
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
        self.state.borrow().view_override.or(stored_view(preferred)).unwrap_or(DiffView::Split)
    }

    /// The files the cards show: every file in tree order, or the one file of the single view.
    fn visible(&self) -> Vec<usize> {
        let files = self.patch_files();
        if !self.single() {
            return files;
        }
        let selected = self.state.borrow().selected;
        selected.or_else(|| self.current_file()).or(files.first().copied()).into_iter().collect()
    }

    // Commands.

    pub(super) fn run(&self, action: Action) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
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
            let file = self.current_file().or(self.state.borrow().selected).or(self.patch_files().first().copied());
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
        self.scroll().map_or(0, |scroll| scroll.scroll_position().1.round() as i64)
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
        let node = self.parts.borrow().cards.iter().find(|card| card.file == file).map(|card| card.node.clone())?;
        self.content_y(&node)
    }

    /// `currentPatchFileIndex`.
    fn current_file(&self) -> Option<usize> {
        let nodes: Vec<(usize, View)> =
            self.parts.borrow().cards.iter().map(|card| (card.file, card.node.clone())).collect();
        let positions: Vec<(usize, i64)> =
            nodes.iter().filter_map(|(file, node)| Some((*file, self.content_y(node)?))).collect();
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
        let rows: Vec<(usize, Vec<AnyWidget>)> =
            self.parts.borrow().cards.iter().map(|card| (card.file, card.hunks.clone())).collect();
        let positions: Vec<Hunk> = rows
            .iter()
            .flat_map(|(file, rows)| {
                rows.iter()
                    .enumerate()
                    .filter_map(|(hunk, row)| Some(Hunk { file: *file, hunk, y: self.content_y(row)? }))
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
        self.state.borrow_mut().selected_hunk = Some(Selected { file: next.file, hunk: next.hunk, scroll_top: target });
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
        let next =
            if single && !was { tree::move_file(&self.patch_files(), Some(file), 1).unwrap_or(file) } else { file };
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

    /// `openFileMenu`: a right-click on a file's heading or tree row focuses the panel and opens the menu there.
    fn open_menu(&self, file: usize, x: u16, y: u16) {
        if let (Some(tui), Place::Panel { host, .. }) = (self.tui.upgrade(), &self.place) {
            tui.app.focus(host);
        }
        super::file_menu::open(self, file, x, y);
    }

    /// Whether `file` is marked reviewed.
    pub fn is_reviewed(&self, file: usize) -> bool {
        let files = self.files();
        files.get(file).is_some_and(|file| self.state.borrow().reviewed.contains(&file.file))
    }

    /// `scrollToPatchFileIndexAfterRender`.
    fn scroll_after_render(&self, file: usize, offset: Option<i64>) {
        self.state.borrow_mut().pending = Some((file, offset));
        self.passes();
    }

    /// Runs [`Self::pass`] before each of the next [`PASSES`] frames.
    fn passes(&self) {
        let running = self.passes.replace(PASSES) > 0;
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        tui.app.request_redraw();
        if running {
            return;
        }
        let weak = self.this.clone();
        tui.app.animate(bind!(weak, |viewer, _, _| {
            viewer.pass();
            let left = viewer.passes.get().saturating_sub(1);
            viewer.passes.set(left);
            if left == 0 {
                viewer.state.borrow_mut().pending = None;
            }
            left > 0
        }));
    }

    /// The work TS does in lifecycle passes: the pending scroll, the sticky headers, and the top edge's color.
    fn pass(&self) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
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
            edge.bg(if reviewed { theme.background.raised.high } else { theme.diff.background.context });
        }
    }
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
    Some(LocationQueryInput { directory: Some(location.directory.clone()) })
}

/// `isDiffImageFile`.
pub fn is_image(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|extension| lower.ends_with(extension))
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
