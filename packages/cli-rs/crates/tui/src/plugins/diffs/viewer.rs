//! One viewer: the state of a mount of the panel or the route, and what its keys, presses and replies do to it.
//! Positions are the host's: the hunk cursor is [`Scroll::Step`], the reading position [`ScrollAlign::Keep`], and the
//! current file the top anchor of the last settled frame ([`Read::top_anchor`]).

use std::collections::{BTreeSet, HashMap};

use opencode_api::generated::{FileDiffInfo, FileDiffInfoStatus};
use opencode_plugin::abi::interact::{Handled, OpenPanel, PanelInput};
use opencode_plugin::abi::v2::{ContentRef, DiffView, Scroll, ScrollAlign, Target};
use opencode_plugin::abi::{self, Host, Read};

use super::keys::Action;
use super::tree::{self, Expanded, Tree};
use super::{Diffs, FILES, MENU, PAGE, PANEL, TREE};
use crate::frame::layout::SESSION_PANEL_SPLIT_MIN_WIDTH;

/// The rows the sticky file header covers above a hunk a step lands on.
pub const FILE_HEADER_HEIGHT: u16 = 2;
pub const MIN_SPLIT_WIDTH: i64 = 100;
const FILE_TREE_MIN_WIDTH: i64 = 30;
const FILE_TREE_MAX_WIDTH: i64 = 40;
pub const FULL_INSET: u16 = 2;
/// The full layout keeps its tree and inset cards only while its patches stay as wide as the narrowest docked panel.
pub const FULL_LAYOUT_MIN_WIDTH: i64 = FILE_TREE_MIN_WIDTH + FULL_INSET as i64 * 2 + SESSION_PANEL_SPLIT_MIN_WIDTH / 2;

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

    /// The setting's and the select's word for it.
    pub fn key(self) -> &'static str {
        match self {
            Mode::Branch => "branch",
            Mode::Committed => "committed",
            Mode::Working => "working",
            Mode::Turn => "turn",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        [Mode::Branch, Mode::Committed, Mode::Working, Mode::Turn].into_iter().find(|mode| mode.key() == key)
    }

    pub fn vcs(self) -> opencode_api::generated::VcsMode {
        use opencode_api::generated::VcsMode;
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
    /// The patch's lines, counted once a load: a card's estimate, which every view gives.
    pub lines: u16,
}

impl From<FileDiffInfo> for File {
    fn from(info: FileDiffInfo) -> Self {
        Self {
            file: info.file,
            lines: info.patch.lines().count().min(usize::from(u16::MAX)) as u16,
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
pub enum Load {
    Loading,
    Failed,
    Ready { base: Option<Base>, files: Vec<File> },
}

/// The plugin's memory, kept while it is active (`storage.memory("review")`): the last source and the chosen base per
/// location and branch.
#[derive(Default)]
pub struct Memory {
    pub source: Option<Mode>,
    pub bases: HashMap<String, String>,
}

/// Where a viewer shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Showing {
    /// In the session's panel.
    Panel { session: String },
    /// The full-screen route; closing goes back to `back`.
    Route { session: Option<String>, back: abi::Route },
}

/// The working-tree bytes of an image card (`DiffViewerImage`'s resource).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Preview {
    Loading,
    Failed,
    /// Bytes that the host's image decoder refuses (TS `onError`): no size and no preview to click.
    Undecodable,
    /// The bytes, and the width and height the host decodes them to.
    Ready(std::rc::Rc<[u8]>, (u32, u32)),
}

/// The content handles a viewer gave its mount: a patch by its file, an image by its path. They name nothing in
/// another mount, and the host drops them with a refused tree.
#[derive(Default)]
pub struct Contents {
    pub mount: u64,
    pub load: u64,
    pub patches: HashMap<usize, ContentRef>,
    pub images: HashMap<String, ContentRef>,
}

pub struct Viewer {
    /// Its number among the plugin's viewers: a reply to an earlier one changes nothing of this one.
    pub id: u64,
    pub place: Showing,
    pub mode: Mode,
    pub location: abi::LocationRef,
    pub base_key: String,
    pub load: Load,
    /// The loads so far: a reply to an earlier one changes nothing.
    pub loads: u64,
    /// The base each location and branch reported (`reportedBases`), looked up once per viewer.
    pub reported: HashMap<String, Option<Base>>,
    /// The room the last view had, and how the panel showed.
    pub width: i64,
    pub panel: Option<PanelInput>,
    pub tree_enabled: bool,
    pub single: bool,
    pub view_override: Option<DiffView>,
    pub tree: Tree,
    pub expanded: Expanded,
    pub selected: Option<usize>,
    pub reviewed: BTreeSet<String>,
    pub exhausted: Option<usize>,
    /// Image previews by file, read once per file list.
    pub previews: HashMap<String, Preview>,
    /// The file whose menu is open (`fileMenu`); new files close it.
    pub menu: Option<usize>,
    /// The tree's selected row and its rows when they last scrolled it: the selection scrolls into view only when
    /// they change, as TS's effect does.
    pub tree_mark: (Option<usize>, usize),
    pub contents: Contents,
    /// The last view shows this state: a wake that changed nothing of it keeps the tree.
    pub drawn: bool,
    /// A turn of its session started, in `turn` mode, whose end it has not heard.
    pub running: bool,
}

/// A turn event, as the viewer hears it.
pub enum Turn<'a> {
    Started(&'a str),
    Ended(&'a str),
    /// The connection came back, or the UI skipped signals: an end may have gone unheard.
    Reconnected,
}

/// What of a viewer's own state its view shows, beside its input: an event that leaves it as it was keeps the view.
#[derive(PartialEq)]
pub struct Shown {
    selected: Option<usize>,
    expanded: usize,
    reviewed: usize,
    tree: bool,
    single: bool,
    view: Option<DiffView>,
    loads: u64,
}

impl Viewer {
    /// What its view shows of it now (each event changes a set by one, so the sizes tell).
    pub fn shown(&self) -> Shown {
        Shown {
            selected: self.selected,
            expanded: self.expanded.len(),
            reviewed: self.reviewed.len(),
            tree: self.tree_enabled,
            single: self.single,
            view: self.view_override,
            loads: self.loads,
        }
    }

    pub fn new(read: &dyn Read, memory: &Memory, id: u64, place: Showing) -> Self {
        let session = match &place {
            Showing::Panel { session } => Some(session.clone()),
            Showing::Route { session, .. } => session.clone(),
        };
        let preference = |name: &str| read.setting(name);
        let configured = preference("diffs.source").and_then(|value| Mode::from_key(value.as_str()?));
        let initial = memory.source.or(configured).unwrap_or(Mode::Branch);
        let mode = if sources(session.is_some()).contains(&initial) { initial } else { Mode::Branch };
        let location = session
            .as_ref()
            .and_then(|id| read.session(id))
            .map(|session| abi::LocationRef { directory: session.info.location.directory.0, workspace: None })
            .unwrap_or_else(|| read.info().location);
        let branch = read.vcs(Some(&location)).and_then(|vcs| vcs.branch.current);
        let base_key = serde_json::json!([location.directory, location.workspace, branch]).to_string();
        let flag = |name: &str, default: bool| preference(name).and_then(|value| value.as_bool()).unwrap_or(default);
        Self {
            id,
            mode,
            location,
            base_key,
            load: Load::Loading,
            loads: 0,
            reported: HashMap::new(),
            width: i64::from(read.info().size.0),
            panel: None,
            tree_enabled: flag("diffs.tree", true),
            single: flag("diffs.single", false),
            view_override: stored_view(read),
            tree: Tree::default(),
            expanded: Expanded::new(),
            selected: None,
            reviewed: BTreeSet::new(),
            exhausted: None,
            previews: HashMap::new(),
            menu: None,
            tree_mark: (None, 0),
            contents: Contents::default(),
            drawn: false,
            running: false,
            place,
        }
    }

    /// The surface it shows in, which its verbs and reads name.
    pub fn surface(&self) -> &'static str {
        match self.place {
            Showing::Panel { .. } => PANEL,
            Showing::Route { .. } => PAGE,
        }
    }

    pub fn files_target(&self) -> Target {
        Target::node(self.surface(), FILES)
    }

    pub fn session(&self) -> Option<&str> {
        match &self.place {
            Showing::Panel { session } => Some(session),
            Showing::Route { session, .. } => session.as_deref(),
        }
    }

    /// The sources this viewer offers: the VCS ones, and the last turn in a session.
    pub fn sources(&self) -> Vec<Mode> {
        sources(self.session().is_some())
    }

    pub fn in_panel(&self) -> bool {
        matches!(self.place, Showing::Panel { .. })
    }

    /// Whether the panel is docked beside the session.
    pub fn docked(&self) -> bool {
        self.in_panel() && !self.panel.is_some_and(|panel| panel.fullscreen)
    }

    /// Docked panels and narrow full screens share the compact layout: no tree, flush cards, and a footer.
    pub fn compact(&self) -> bool {
        self.docked() || self.width < FULL_LAYOUT_MIN_WIDTH
    }

    /// Whether the viewer has the input: always full screen, else while its panel has the focus. A dialog takes the
    /// focus without changing the panel's (TS `panel.focused`).
    pub fn focused(&self) -> bool {
        !self.docked() || self.panel.is_some_and(|panel| panel.focused)
    }

    pub fn files(&self) -> &[File] {
        match &self.load {
            Load::Ready { files, .. } => files,
            _ => &[],
        }
    }

    /// The file whose card or row a node of `id` (`f:`, `c:`, `h:`, `d:` and a path) belongs to. The path is whole: a
    /// `#` in it is part of the name (a hunk's `#index` is on its anchor's id, never its owner).
    pub fn file_of(&self, id: &str) -> Option<usize> {
        let path = id.split_once(':')?.1;
        self.files().iter().position(|file| file.file == path)
    }

    pub fn patch_files(&self) -> Vec<usize> {
        tree::ordered_files(&tree::flatten(&self.tree, None))
    }

    pub fn tree_width(&self) -> i64 {
        (self.width / 4).clamp(FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH)
    }

    pub fn show_tree(&self) -> bool {
        !self.compact() && self.tree_enabled && !self.files().is_empty()
    }

    pub fn inset(&self) -> u16 {
        if self.compact() { 0 } else { FULL_INSET }
    }

    pub fn pane_width(&self) -> i64 {
        let tree = if self.show_tree() { self.tree_width() } else { 0 };
        self.width - tree - i64::from(self.inset()) * 2
    }

    pub fn split_available(&self) -> bool {
        self.pane_width() >= MIN_SPLIT_WIDTH
    }

    pub fn view(&self, read: &dyn Read) -> DiffView {
        if !self.split_available() {
            return DiffView::Unified;
        }
        self.view_override.or(stored_view(read)).unwrap_or(DiffView::Split)
    }

    /// The files the cards show: every file in tree order, or the one file of the single view.
    pub fn visible(&self, read: &dyn Read) -> Vec<usize> {
        let files = self.patch_files();
        if !self.single {
            return files;
        }
        self.selected.or_else(|| self.current_file(read)).or(files.first().copied()).into_iter().collect()
    }

    /// `currentPatchFileIndex`: the last card that starts at or above the first row under the view's top, in the last
    /// settled frame.
    pub fn current_file(&self, read: &dyn Read) -> Option<usize> {
        read.top_anchor(&self.files_target(), "file", 1).and_then(|anchor| self.file_of(&anchor.id))
    }

    pub fn is_reviewed(&self, file: usize) -> bool {
        self.files().get(file).is_some_and(|file| self.reviewed.contains(&file.file))
    }

    /// `sourceDetail`: what the header says after the source's name.
    pub fn source_detail(&self) -> Option<String> {
        match (&self.load, self.mode) {
            (Load::Failed, Mode::Turn) => Some("Diff unavailable".to_owned()),
            (_, Mode::Turn) => None,
            (_, Mode::Working) => Some("vs HEAD".to_owned()),
            (Load::Failed, _) => Some("Base or diff unavailable".to_owned()),
            (Load::Loading, _) => Some("Resolving diff…".to_owned()),
            (Load::Ready { base: None, .. }, _) => Some("Base not reported".to_owned()),
            (Load::Ready { base: Some(base), .. }, _) => Some(format!("vs {}", base.name)),
        }
    }

    /// The chosen base, else the one the location reported (`sourceBase`).
    pub fn source_base(&self, memory: &Memory) -> Option<Base> {
        let chosen = memory.bases.get(&self.base_key).cloned();
        chosen
            .map(|reference| Base { name: reference.clone(), reference })
            .or_else(|| self.reported.get(&self.base_key).cloned().flatten())
    }

    pub fn location_query(&self) -> Option<opencode_api::generated::LocationQueryInput> {
        Some(opencode_api::generated::LocationQueryInput { directory: Some(self.location.directory.clone()) })
    }

    // Keys.

    /// What a key of the viewer's layer does; a key whose command TS disables passes on.
    pub fn run(&mut self, host: &dyn Host, diffs: &Diffs, action: Action) -> Handled {
        match action {
            Action::Close => match &self.place {
                Showing::Panel { .. } => host.close_panel(PANEL),
                Showing::Route { back, .. } => host.navigate(back.clone()),
            },
            Action::Down | Action::Up => {
                self.clear_patch_selection(host);
                self.scroll(host, Scroll::By { rows: if action == Action::Down { 1 } else { -1 } });
            }
            Action::PageDown => self.scroll_page(host, 1, 1),
            Action::PageUp => self.scroll_page(host, -1, 1),
            Action::HalfPageDown => self.scroll_page(host, 1, 2),
            Action::HalfPageUp => self.scroll_page(host, -1, 2),
            Action::First => {
                self.clear_patch_selection(host);
                self.scroll(host, Scroll::Offset { offset: 0 });
            }
            Action::Last => {
                self.clear_patch_selection(host);
                self.scroll(host, Scroll::Edge { edge: abi::v2::Edge::Bottom });
            }
            Action::NextHunk => self.jump_hunk(host, 1),
            Action::PreviousHunk => self.jump_hunk(host, -1),
            Action::NextFile => self.jump_file(host, 1),
            Action::PreviousFile => self.jump_file(host, -1),
            Action::MarkReviewed => {
                let file = self.selected.or_else(|| self.current_file(host));
                if file.is_none() || file != self.exhausted {
                    self.toggle_reviewed(host, file);
                }
            }
            Action::ToggleFileTree => {
                if self.compact() {
                    return Handled::Pass;
                }
                self.tree_enabled = !self.tree_enabled;
                host.set_setting("diffs.tree", self.tree_enabled.into());
            }
            Action::SinglePatch => self.toggle_single(host),
            Action::SwitchSource => super::sources::open(host, self, &diffs.memory.borrow()),
            Action::ToggleView => {
                if self.split_available() {
                    let next = match self.view(host) {
                        DiffView::Split => DiffView::Unified,
                        DiffView::Unified => DiffView::Split,
                    };
                    self.forget(host);
                    self.view_override = Some(next);
                    let name = if next == DiffView::Split { "split" } else { "unified" };
                    host.set_setting("diffs.view", name.into());
                }
            }
            Action::ToggleFullscreen => {
                let Some(panel) = self.panel.filter(|_| self.in_panel()) else { return Handled::Pass };
                // A narrow terminal forces full screen and ignores the toggle; only a real toggle is remembered.
                if !panel.forced {
                    let fullscreen = !panel.fullscreen;
                    let session = self.session().map(str::to_owned);
                    host.open_panel(OpenPanel { surface: PANEL.to_owned(), session, fullscreen });
                    host.set_setting("diffs.fullscreen", fullscreen.into());
                }
            }
            Action::Help => super::help::open(host, self),
        }
        Handled::Consume
    }

    fn scroll(&self, host: &dyn Host, verb: Scroll) {
        host.scroll(self.files_target(), verb);
    }

    fn scroll_page(&mut self, host: &dyn Host, direction: i32, divisor: i32) {
        self.clear_patch_selection(host);
        let viewport = host.scroll_state(&self.files_target()).map_or(0, |state| state.viewport);
        self.scroll(host, Scroll::By { rows: direction * (viewport / divisor).max(1) });
    }

    /// The scroll's pending move and the hunk cursor go, as a scroll of the user's does.
    fn forget(&self, host: &dyn Host) {
        self.scroll(host, Scroll::Forget);
    }

    /// The wheel or a scroll key: the hunk cursor goes, and so does the selection of the list of all files.
    pub fn clear_patch_selection(&mut self, host: &dyn Host) {
        self.forget(host);
        if !self.single {
            self.selected = None;
        }
    }

    /// `jumpRelativeHunk`: the host steps from the hunk it last landed on, below the sticky header, and tells where
    /// it landed ([`Self::landed`]).
    fn jump_hunk(&self, host: &dyn Host, by: i32) {
        self.scroll(host, Scroll::Step { group: "hunk".to_owned(), by, inset: FILE_HEADER_HEIGHT });
    }

    /// Where a hunk step landed: its file is selected.
    pub fn landed(&mut self, anchor: &abi::v2::AnchorAt) {
        if let Some(file) = self.file_of(&anchor.owner) {
            self.select_file(file);
        }
    }

    fn jump_file(&mut self, host: &dyn Host, offset: i64) {
        self.forget(host);
        let current = self.selected.or_else(|| self.current_file(host));
        let next = tree::move_file(&self.patch_files(), current, offset);
        if self.single {
            let Some(next) = next else { return };
            self.select_file(next);
            self.scroll(host, Scroll::Offset { offset: 0 });
            return;
        }
        self.scroll_to_file(host, next);
    }

    fn scroll_to_file(&mut self, host: &dyn Host, file: Option<usize>) {
        let Some(file) = file else { return };
        self.select_file(file);
        self.scroll_to_card(host, file, ScrollAlign::Start);
    }

    /// `scrollPatchNodeToTop`: the card past its gap goes to the top, or `Keep` holds where its item is on screen.
    fn scroll_to_card(&self, host: &dyn Host, file: usize, align: ScrollAlign) {
        let Some(path) = self.files().get(file).map(|file| file.file.clone()) else { return };
        let node = match align {
            ScrollAlign::Keep => format!("f:{path}"),
            _ => format!("c:{path}"),
        };
        self.scroll(host, Scroll::To { node, align });
    }

    fn toggle_single(&mut self, host: &dyn Host) {
        self.forget(host);
        if !self.single {
            let file = self.current_file(host).or(self.selected).or(self.patch_files().first().copied());
            if let Some(file) = file {
                self.select_file(file);
            }
            self.single = true;
            host.set_setting("diffs.single", true.into());
            self.scroll(host, Scroll::Offset { offset: 0 });
            return;
        }
        let file = self.visible(host).first().copied();
        if let Some(file) = file {
            self.select_file(file);
        }
        self.single = false;
        host.set_setting("diffs.single", false.into());
        if let Some(file) = file {
            self.scroll_to_card(host, file, ScrollAlign::Start);
        }
    }

    /// `selectPatchFile`: selects `file` and opens the directories above it.
    pub fn select_file(&mut self, file: usize) {
        self.exhausted = None;
        if let Some(parents) = tree::parents_of(&self.tree, file) {
            self.expanded.extend(parents);
        }
        self.selected = Some(file);
    }

    /// `toggleFileReviewed`: a file reviewed from the current card moves on (the next file in the single view);
    /// another file's mark keeps the reading position.
    pub fn toggle_reviewed(&mut self, host: &dyn Host, file: Option<usize>) {
        let Some(file) = file else { return };
        let Some(name) = self.files().get(file).map(|file| file.file.clone()) else { return };
        let current = self.selected.or_else(|| self.current_file(host));
        let was = !self.reviewed.insert(name.clone());
        if was {
            self.reviewed.remove(&name);
        }
        if Some(file) != current {
            if let (Some(current), false) = (current, self.single) {
                self.scroll_to_card(host, current, ScrollAlign::Keep);
            }
            return;
        }
        let single = self.single;
        let next =
            if single && !was { tree::move_file(&self.patch_files(), Some(file), 1).unwrap_or(file) } else { file };
        self.select_file(next);
        if single && !was && next == file {
            self.exhausted = Some(file);
        }
        self.forget(host);
        self.scroll_to_card(host, next, ScrollAlign::Start);
    }

    /// A press on a tree row: a file is selected and scrolled to; a directory opens or closes.
    pub fn pick_row(&mut self, host: &dyn Host, row: &tree::Row) {
        match row.file {
            Some(file) => {
                self.forget(host);
                self.scroll_to_file(host, Some(file));
                if self.single {
                    self.scroll(host, Scroll::Offset { offset: 0 });
                }
            }
            None => self.expanded = tree::toggle(&self.tree, &self.expanded, row.id),
        }
    }

    /// `scrollFileTreeRowIntoView`: a new selection or new rows bring the selected row into the tree's view.
    pub fn follow_tree(&mut self, host: &dyn Host) {
        let rows = tree::flatten(&self.tree, Some(&self.expanded));
        let selected = self.tree_selected(host);
        let row = rows.iter().position(|row| row.file.is_some() && row.file == selected);
        let mark = (row, rows.len());
        if std::mem::replace(&mut self.tree_mark, mark) == mark {
            return;
        }
        if let Some(row) = row {
            let node = tree::row_id(&rows[row]);
            let target = Target::node(self.surface(), TREE);
            host.scroll(target, Scroll::To { node, align: ScrollAlign::Nearest { inset: 0 } });
        }
    }

    /// The tree's selected file: the selection, or the one file of the single view.
    pub fn tree_selected(&self, read: &dyn Read) -> Option<usize> {
        self.selected.or_else(|| self.single.then(|| self.visible(read).first().copied()).flatten())
    }

    /// Opens the file menu of `file` at the cell `x`, `y` (`openFileMenu`).
    pub fn open_menu(&mut self, host: &dyn Host, file: usize, x: u16, y: u16) {
        self.menu = Some(file);
        super::file_menu::open(host, x, y);
    }

    /// New files: the tree opens fully, and the selection and reviewed marks start over.
    pub fn reset(&mut self, host: &dyn Host) {
        if self.menu.take().is_some() {
            host.close_overlay(MENU);
        }
        self.previews.clear();
        self.tree = tree::build(self.files().iter().map(|file| file.file.as_str()));
        self.expanded = tree::all_expanded(&self.tree);
        self.selected = None;
        self.reviewed.clear();
        self.exhausted = None;
        self.forget(host);
    }

    /// What a turn event says to the viewer: in `turn` mode the viewer of that session loads again when one of its
    /// turns ends (TS's `createEffect` on `session.status`, running to idle), and says whether it did. It hears the
    /// end itself: the status read when the UI hears of an event may already be idle again, for a turn that started
    /// and ended before then (`steps/flakes-8.md`). A turn it saw start whose end the connection may have lost (a
    /// reconnect, or signals the UI skipped) loads it again too (carbon's review of P6c, 6).
    pub fn turn(&mut self, host: &dyn Host, diffs: &Diffs, turn: Turn<'_>) -> bool {
        let mine = |session: &str| self.mode == Mode::Turn && self.session() == Some(session);
        let ended = match turn {
            Turn::Started(session) => {
                self.running |= mine(session);
                false
            }
            Turn::Ended(session) => mine(session),
            Turn::Reconnected => self.running,
        };
        if ended {
            self.running = false;
            self.load(host, diffs);
        }
        ended
    }

    /// `onSwitchSource`: remembers the source and loads it, unless it is the one shown.
    pub fn switch_source(&mut self, host: &dyn Host, diffs: &Diffs, mode: Mode) {
        diffs.memory.borrow_mut().source = Some(mode);
        if self.mode != mode {
            self.mode = mode;
            self.load(host, diffs);
        }
    }
}

pub fn sources(session: bool) -> Vec<Mode> {
    let mut sources = vec![Mode::Branch, Mode::Committed, Mode::Working];
    if session {
        sources.push(Mode::Turn);
    }
    sources
}

/// The `diffs.view` setting, unless it is `auto`.
fn stored_view(read: &dyn Read) -> Option<DiffView> {
    match read.setting("diffs.view")?.as_str()? {
        "split" => Some(DiffView::Split),
        "unified" => Some(DiffView::Unified),
        _ => None,
    }
}

/// `isDiffImageFile`.
pub fn is_image(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|extension| lower.ends_with(extension))
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
