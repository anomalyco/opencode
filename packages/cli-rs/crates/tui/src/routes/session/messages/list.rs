//! Window the transcript from the tail. A store update refreshes the rows owned by changed messages; scrolling toward
//! the head loads older pages.
//!
//! The window is bounded on both sides: a move that mounts rows on one side of the view drops the rows more than
//! [`MARGIN`] past the other side, so memory follows the rows near the view, not every row the reader passed.
//! What the reader opened in a row stays in [`Toggles`], so a dropped row comes back as they left it.
//!
//! What the transcript remembers is one [`Model`]. A render plans over the model and the store, applies the plan to
//! the widgets with the model not borrowed, so a widget callback that re-enters finds no borrow, then commits it.

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::ops::Range;
use std::sync::Arc;

use opencode_api::generated::{
    AgentInfo, ModelInfo, ModelRef, SessionInboxInfo, SessionInfo, SessionMessageAssistant,
    SessionMessageAssistantContentItem, SessionMessageAssistantFinish, SessionMessageCompaction,
    SessionStructuredError,
};
use opencode_local::cli_config::{Markdown as MarkdownMode, Resolved, TurnTokens, Visibility};
use opencode_plugin::claim::ToolClaims;
use opencode_store::location::{Catalog, Location};
use opencode_store::{LoadMore, MessageKey, Parts, State};
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::ThemeMode;
use opencode_ui::tool_info::ToolKind;
use opentui::input::MouseEventKind;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{ScrollCause, ScrollEdge};

use super::super::find::{self, FindPart, FindPartId, FindPartKey};
use super::super::find_view::{FindHandle, FindSnapshot};
use super::super::tools;
use super::{assistant, background, compaction, errors, footer, reasoning, revert, shell, skill, user};
use crate::prelude::*;
use crate::routes::session::grouping;

pub const TAIL_ROWS: usize = 40;
pub const BACKFILL_CHUNK: usize = 60;
/// The rows, by weight, the window keeps past the edge of the view it moves away from.
pub const MARGIN: usize = BACKFILL_CHUNK;

#[derive(Clone)]
pub struct Transcript(Rc<Inner>);

/// The row a tab keeps while the reader is away from the bottom. Its message is kept by ID: the session may be read
/// again under new keys before the tab shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct ScrollAnchor {
    pub message: String,
    pub row: RowKey,
    pub screen_y: f64,
}

#[derive(Clone, Copy, Default, PartialEq)]
struct RowSettings {
    conceal: bool,
    tps: bool,
    turn_tokens: Option<TurnTokens>,
    image_preview: bool,
    hide_thinking: bool,
}

impl RowSettings {
    fn read(config: &Resolved) -> Self {
        let session = config.info.session.clone().unwrap_or_default();
        Self {
            conceal: session.markdown.unwrap_or(MarkdownMode::Rendered) == MarkdownMode::Rendered,
            tps: config.tps,
            turn_tokens: config
                .info
                .debug
                .as_ref()
                .and_then(|debug| debug.turn_tokens)
                .filter(|tokens| *tokens != TurnTokens::Enabled(false)),
            image_preview: session.image_preview.unwrap_or(false),
            hide_thinking: session.thinking.unwrap_or(Visibility::Hide) == Visibility::Hide,
        }
    }
}

struct Inner {
    root: View,
    scroll: ScrollBox,
    hint: Text,
    hint_row: View,
    background: background::Hint,
    revert: revert::Banner,
    limits: errors::LimitWatch,
    tui: Weak<Tui>,
    this: Weak<Inner>,
    renderers: CodeBlockRenderers,
    claims: ToolClaims,
    groups: Rc<grouping::Settings>,
    toggles: Toggles,
    model: RefCell<Model>,
    look: RefCell<Look>,
    /// The mounted rows by key: a render's plan builds and drops them.
    rows: RefCell<HashMap<RowKey, Row>>,
    /// Off-window rows pinned while Find has an active query matching a plugin-claimed fence,
    /// adopted into `rows` when the window moves over them and dropped when Find closes.
    find_pinned: RefCell<HashMap<RowKey, Row>>,
    find_pinned_keys: RefCell<HashSet<RowKey>>,
    hooks: RefCell<Hooks>,
    find: RefCell<FindHandle>,
}

/// What the transcript registered, released when it drops.
#[derive(Default)]
struct Hooks {
    layer: Option<Disposer>,
    settings: Option<Disposer>,
    /// The terminal resize handler, which pins the reader's row before the layout.
    resize: Option<HandlerId>,
    /// The plugin viewport.
    published: Option<opencode_plugin::behave::Publication>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        let hooks = self.hooks.get_mut();
        if let Some(tui) = self.tui.upgrade() {
            dispose(&tui, hooks.layer.take());
            if let Some(id) = hooks.resize.take() {
                tui.app.remove_handler(id);
            }
            let dropped = self.rows.get_mut().len() + self.find_pinned.get_mut().len();
            self.find_pinned.get_mut().clear();
            crate::features::release::dropped(&tui.app, dropped);
        }
    }
}

/// Unregisters the transcript's layer. A command may drop the view while the keymap runs it, so the layer goes
/// afterwards.
fn dispose(tui: &Tui, layer: Option<Disposer>) {
    if let Some(layer) = layer {
        tui.app.defer(move |_| drop(layer));
    }
}

/// What the transcript remembers between renders.
#[derive(Default)]
struct Model {
    session: Option<SessionID>,
    location: Option<Location>,
    settings: RowSettings,
    /// The rows, oldest first. Shared, so rows update from them while the model is not borrowed.
    specs: Rc<Vec<Spec>>,
    weights: Vec<usize>,
    /// Each visible message's key and [`shape`] at the last render, by position.
    shapes: Vec<(MessageKey, u64)>,
    /// The visible messages have no idle marker (`legacy`), at the last render.
    legacy: bool,
    /// The keys of the scroll box's children, in order.
    mounted: Vec<RowKey>,
    /// The rows of each message, by index in the specs.
    refs: HashMap<MessageKey, Vec<usize>>,
    start: Start,
    /// Where the mounted window ends when it stops before the newest row (`visibleRowsEnd`): `session.first` mounts
    /// the head only, and a move up drops the rows far below the view.
    end: Option<End>,
    /// Set when rows mount above the window, so the reader's rows stay in place.
    pin: Option<Pin>,
    /// Set when the terminal resizes away from the bottom, holding the reader's top row through layout and refit.
    resize: Option<ResizePin>,
    /// Monotonic counter identifying the active [`ResizePin`] across `after_layout` callbacks.
    resize_gen: u64,
    /// The height of the rows dropped since the last layout, and the frame number then. The content's rect still
    /// counts them, so a pin set before the next layout takes them off.
    dropped: Option<(u64, f32)>,
    /// The height of the rows dropped above the view since the last layout, and the frame number then, so a same-frame
    /// resize anchors against the kept rows' future positions.
    dropped_above: Option<(u64, f32)>,
    /// An older page is loading.
    loading: bool,
    /// Message navigation or its slack holds the view, so the bottom it reaches is not the tail.
    navigating: bool,
    /// Message count at the last group-boundary page request.
    boundary: Option<usize>,
    width: Option<u16>,
    /// Counts the renders.
    revision: u64,
    /// Number of preceding messages at this window start and revision.
    above: Option<(u64, Start, u32)>,
    /// The row indices a patch updates, kept between patches for their buffer.
    stale: Vec<usize>,
}

/// What rows paint with: the theme's colors and syntax, and the shortcuts read at the keymap revision kept beside them.
struct Look {
    paint: Rc<Paint>,
    keys: (u64, Rc<Keys>),
}

/// A render's outcome, worked out from the model and the store before any widget is touched.
struct Plan {
    specs: Vec<Spec>,
    weights: Vec<usize>,
    legacy: bool,
    /// The mounted rows, as a range of `specs`.
    window: Range<usize>,
    /// The keys of the rows in `window`.
    wanted: HashSet<RowKey>,
    /// Set when rows mount above the first mounted one.
    pin: Option<Pin>,
}

/// What rows ask of the transcript.
pub enum RowEvent {
    /// A claim's view at a paint changed which row shows one of the message's parts: its rows render again.
    Switched(MessageKey),
    /// A claimed row whose top is at `top` on screen changed height by `grown`.
    Reflowed { top: f64, grown: f32 },
    /// The reader opened or closed a group.
    Toggled,
}

/// Where rows send their [`RowEvent`]s.
#[derive(Clone)]
pub struct Events(Weak<Inner>);

impl Events {
    pub fn send(&self, event: RowEvent) {
        if let Some(inner) = self.0.upgrade() {
            inner.receive(event);
        }
    }
}

/// What the reader opened in the session's rows, by a key each widget takes from what it shows, so that a row the
/// window drops and builds again opens as they left it. Groups keep theirs in [`grouping::Settings`].
#[derive(Clone, Default)]
pub struct Toggles(Rc<RefCell<HashSet<String>>>);

impl Toggles {
    /// A closed switch, until it has a key the reader opened.
    pub fn switch(&self) -> Switch {
        Switch { toggles: self.clone(), key: RefCell::default() }
    }
}

/// One widget's open state in [`Toggles`].
pub struct Switch {
    toggles: Toggles,
    key: RefCell<String>,
}

impl Switch {
    /// Names what the widget shows, once it knows: a tool call's ID, a message's, with what it opens.
    pub fn key(&self, key: String) {
        if *self.key.borrow() != key {
            *self.key.borrow_mut() = key;
        }
    }

    pub fn get(&self) -> bool {
        let key = self.key.borrow();
        !key.is_empty() && self.toggles.0.borrow().contains(key.as_str())
    }

    /// Opens a closed switch or closes an open one, and returns whether it is open. A switch without a key stays shut.
    pub fn flip(&self) -> bool {
        let key = self.key.borrow();
        if key.is_empty() {
            return false;
        }
        let mut open = self.toggles.0.borrow_mut();
        if open.remove(key.as_str()) {
            return false;
        }
        open.insert(key.clone());
        true
    }
}

struct Paint {
    theme: Theme,
    syntax: Arc<SyntaxTheme>,
    thinking_syntax: Arc<SyntaxTheme>,
    /// The categorical colors at step 400, each once: an agent without a color of its own takes one by position.
    palette: Vec<Color>,
}

impl Paint {
    fn new(theme: Theme) -> Self {
        let syntax = opencode_ui::code::syntax_theme(&theme);
        let mut palette = Vec::new();
        for color in theme.categorical().iter().map(|scale| scale.step(400)) {
            if !palette.contains(&color) {
                palette.push(color);
            }
        }
        Self { thinking_syntax: Arc::new(thinking_syntax(&syntax, theme.text.muted)), syntax, theme, palette }
    }
}

/// The content height before rows mounted above, and the frame it is from.
struct Pin {
    height: f32,
    frame: u64,
}

impl Pin {
    /// Whether the frame that lays out the new rows is still to come or running.
    fn live(&self, frame: u64) -> bool {
        frame <= self.frame + 1
    }
}

/// The row held at the top of the view through a terminal resize (`ScrollBox.anchor`).
///
/// The resize's layout and the deferred `refit` after it rewrap rows above and at the anchor; `ScrollBox` clamps the
/// offset to the new content height before child resize handlers run, so holding the anchor scrolls to its absolute
/// target rather than applying incremental deltas.
struct ResizePin {
    anchor: RowKey,
    /// `anchor` top minus `scroll_top` before the resize: `>= 0` when the row starts at or below the viewport top,
    /// `< 0` when scrolled `-screen_y` rows into the row.
    screen_y: f64,
    /// `anchor`'s height before the resize, to keep proportional position when a mid-row scroll rewraps.
    height: f32,
    /// `anchor`'s latest `y` in `content`, snapped on `anchor`'s resize and shifted by height changes of rows above.
    y: f64,
    /// `anchor`'s latest height, paired with `y` when a row above changes without `anchor` itself resizing.
    current_height: f32,
    /// Mounted rows above `anchor`, for `refit` frames where a row above changes height without `anchor` resizing.
    above: HashSet<RowKey>,
    frame: u64,
    generation: u64,
}

impl ResizePin {
    /// Whether the resize's layout and deferred `refit` frames are still to come or running.
    fn live(&self, frame: u64) -> bool {
        frame <= self.frame + 2
    }

    /// Scroll offset that keeps `anchor` at its pre-resize viewport row, scaling a mid-row scroll proportionally when
    /// the anchor row itself rewraps.
    fn target(&self, y: f64, height: f32) -> f64 {
        let offset = if self.screen_y < 0.0 && self.height > 0.0 && height != self.height {
            let into = (-self.screen_y * f64::from(height) / f64::from(self.height)).round();
            -into.min(f64::from((height - 1.0).max(0.0)))
        } else {
            self.screen_y
        };
        (y - offset).max(0.0)
    }
}

/// The end of a window that stops before the newest row. It follows its last row by key, since an older page or a
/// regrouping moves the rows' indices.
#[derive(Clone, Copy, Debug, PartialEq)]
enum End {
    /// Before the row at this index of the rows the next render plans.
    Index(usize),
    /// After this row; the index after it at the last render stands in while the row is gone.
    After(RowKey, usize),
}

impl End {
    fn index(self, specs: &[Spec]) -> usize {
        match self {
            Self::Index(index) => index,
            Self::After(key, index) => specs.iter().position(|spec| spec.key() == key).map_or(index, |at| at + 1),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Start {
    /// The newest [`TAIL_ROWS`], following appends while the reader stays at the bottom.
    #[default]
    Tail,
    Top,
    Row(RowKey),
}

impl Transcript {
    pub fn new(tui: &Tui) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let scroll = ScrollBox::new(app)
            .grow(1.0)
            .basis(Length::Auto)
            .sticky(true)
            .sticky_start(ScrollEdge::Bottom)
            .scrollbars(false)
            // The rows are a plain column (no grow, auto margin, or percent height), so a frame lays out only the rows
            // that changed.
            .layout_mode(LayoutMode::List);
        let hint = Text::new(app, "Loading session history…").fg(theme.text.feedback.info.base).visible(false);
        let status = View::new(app).row().height(1).shrink(0.0).justify(Justify::End).child(&hint);
        let root = View::new(app).column().grow(1.0).basis(Length::Auto).min_height(0).child(&scroll).child(&status);
        let background = background::Hint::new(app, &theme);
        let revert = revert::Banner::new(tui, &theme);
        scroll.add(background.root());
        scroll.add(revert.root());
        let inner = Rc::new_cyclic(|this| Inner {
            root,
            scroll,
            hint,
            hint_row: status.clone(),
            background,
            revert,
            limits: errors::LimitWatch::default(),
            tui: tui.weak(),
            this: this.clone(),
            renderers: crate::plugins::host::code_blocks(tui),
            claims: crate::plugins::host::tool_claims(tui),
            groups: grouping::Settings::new(&tui.settings.info()),
            toggles: Toggles::default(),
            model: RefCell::new(Model { settings: RowSettings::read(&tui.config()), ..Model::default() }),
            look: RefCell::new(Look { paint: Rc::new(Paint::new(theme)), keys: (u64::MAX, Rc::default()) }),
            rows: RefCell::default(),
            find_pinned: RefCell::default(),
            find_pinned_keys: RefCell::default(),
            hooks: RefCell::default(),
            find: RefCell::default(),
        });
        inner.install(tui);
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn sync(&self, tui: &Tui, session: &SessionID, changes: &Changes) {
        if self.0.model.borrow().session.as_ref() != Some(session) {
            self.0.model.borrow_mut().session = Some(session.clone());
            *self.0.groups.expanded.borrow_mut() = tui.tabs.expanded_groups(&session.0);
            self.0.toggles.0.borrow_mut().clear();
            self.clear_find_pinned(tui);
        }
        self.0.locate(tui, session);
        // The rows read the location's agents and models, what the local selection reads, and, a shell's rows, its
        // shells.
        let catalogs = self.0.model.borrow().location.as_ref().is_some_and(|location| {
            changes.location_parts(location, crate::local::READS)
                || changes.location_parts(location, Parts::catalogs(&[Catalog::Shell]))
                    && tui.data.read(|state| reads_shells(state.messages(session)))
        });
        let pending = changes.has(session, Touched::PENDING);
        // A tool row waiting on a permission request takes the warning color.
        let permissions = changes.has(session, Touched::PERMISSIONS);
        // A subagent row spins while its child session runs.
        let children = changes.any(Touched::STATUS)
            && tui
                .data
                .read(|state| state.family(session).iter().any(|id| id != session && changes.has(id, Touched::STATUS)));
        let force =
            changes.has(session, Touched::SHAPE | Touched::INFO) || catalogs || pending || permissions || children;
        if !force && !changes.has(session, Touched::SHAPE | Touched::CONTENT) {
            return;
        }
        if !force && self.0.patch(tui, session, changes) {
            return;
        }
        let changed: Vec<MessageKey> = tui.data.read(|state| changes.message_keys(state, session).collect());
        self.0.render(tui, |message| force || changed.contains(&message));
    }

    /// Near the top of the mounted rows, mounts older ones, or loads an older page, and drops the rows far below the
    /// view.
    pub fn reveal_older(&self, tui: &Tui) -> bool {
        let inner = &self.0;
        let (_, top) = inner.scroll.scroll_position();
        if top > f64::from(inner.scroll.rect().height) {
            return false;
        }
        inner.grow(tui, false) || inner.load_older(tui)
    }

    /// Publishes the transcript with `scroll` as its mover. Its moves, whatever moved it, and its resizes run the
    /// host's behaviors; a pointer that only moves over it does not.
    pub fn publish(&self, tui: &Tui, scroll: Rc<dyn Fn(&opencode_plugin::abi::v2::Scroll)>) {
        let read = bind!(self.0.this.clone(), |inner| inner.viewport());
        let published = opencode_plugin::behave::Published { read: Rc::new(read), scroll };
        let published = opencode_plugin::behave::publish_transcript(&tui.app, published);
        self.0.hooks.borrow_mut().published = Some(published);
        let app = tui.app.clone();
        self.0.scroll.on_scroll(move |_, _| opencode_plugin::behave::transcript_moved(&app));
        for resized in [self.0.scroll.as_any(), self.0.scroll.content_view().as_any()] {
            let app = tui.app.clone();
            resized.on_resize(move |_, _| opencode_plugin::behave::transcript_moved(&app));
        }
    }

    pub fn scroll(&self) -> &ScrollBox {
        &self.0.scroll
    }

    /// The row under the transcript that holds the history hint.
    pub fn status(&self) -> &View {
        &self.0.hint_row
    }

    pub fn hint(&self) -> &Text {
        &self.0.hint
    }

    pub fn session(&self) -> Option<SessionID> {
        self.0.model.borrow().session.clone()
    }

    pub fn set_find(&self, handle: FindHandle) {
        *self.0.find.borrow_mut() = handle;
    }

    pub fn conceal(&self) -> bool {
        self.0.model.borrow().settings.conceal
    }

    pub fn renderers(&self) -> &CodeBlockRenderers {
        &self.0.renderers
    }

    pub fn syntax(&self) -> Arc<SyntaxTheme> {
        self.0.look.borrow().paint.syntax.clone()
    }

    /// Searchable transcript parts across all loaded rows (mounted and unmounted) in transcript order.
    pub fn find_parts(&self, tui: &Tui) -> Vec<FindPart> {
        let Some(session) = self.session() else { return Vec::new() };
        let specs = self.0.model.borrow().specs.clone();
        tui.data.read(|state| find::find_parts(&specs, Visible::of(state, &session).lookup))
    }

    /// Refreshes Find highlights on mounted searchable rows (`User`, `TextPart`, `Compaction`).
    pub fn refresh_find(&self, tui: &Tui) {
        self.0.each_row(tui, Row::update_find, false);
    }

    /// Mounts `BACKFILL_CHUNK` rows on each side of the row owning `key`, unless already mounted.
    pub fn mount_find_row(&self, tui: &Tui, key: &FindPartKey) -> bool {
        self.clear_resize_pin();
        let inner = &self.0;
        let Some(session) = self.session() else { return false };
        let Some(msg_key) = tui.data.read(|state| state.transcript(&session)?.key(&key.message_id)) else {
            return false;
        };
        let target = match key.part {
            FindPartId::Message => RowKey::Message(msg_key),
            FindPartId::Text(ordinal) => RowKey::Part(msg_key, Part::Text(ordinal)),
        };
        let window = {
            let model = inner.model.borrow();
            let Some(index) = model.specs.iter().position(|spec| spec.key() == target) else { return false };
            let start = model.window_start();
            let mounted = start <= index && index < model.window_end();
            (!mounted).then(|| {
                let start = grouping::rows_before(&model.weights, index, BACKFILL_CHUNK);
                let end = grouping::rows_after(&model.weights, index, BACKFILL_CHUNK);
                let start = if start == 0 { Start::Top } else { Start::Row(model.specs[start].key()) };
                (start, (end < model.specs.len()).then_some(End::Index(end)))
            })
        };
        if let Some((start, end)) = window {
            inner.scroll.sticky(false);
            inner.show(tui, start, end);
        }
        true
    }

    /// Ensures every row in `keys` is mounted (in `rows` or in `find_pinned`) and updated with
    /// active Find state, dropping any previously pinned rows no longer in `keys`.
    pub fn pin_find_rows(&self, tui: &Tui, keys: &[FindPartKey]) {
        if keys.is_empty() {
            self.clear_find_pinned(tui);
            return;
        }
        let Some(session) = self.session() else { return };
        let wanted: HashSet<RowKey> = tui.data.read(|state| {
            let Some(transcript) = state.transcript(&session) else { return HashSet::new() };
            keys.iter()
                .filter_map(|key| {
                    let msg_key = transcript.key(&key.message_id)?;
                    Some(match key.part {
                        FindPartId::Message => RowKey::Message(msg_key),
                        FindPartId::Text(ordinal) => RowKey::Part(msg_key, Part::Text(ordinal)),
                    })
                })
                .collect()
        });
        *self.0.find_pinned_keys.borrow_mut() = wanted.clone();
        // Drop any previously pinned rows no longer needed for this query.
        let dropped = {
            let mut pinned = self.0.find_pinned.borrow_mut();
            let before = pinned.len();
            let rows = self.0.rows.borrow();
            pinned.retain(|key, _| wanted.contains(key) && !rows.contains_key(key));
            before - pinned.len()
        };
        if dropped > 0 {
            crate::features::release::dropped(&tui.app, dropped);
        }
        let (paint, key_shortcuts) = self.0.look(tui);
        let find = self.0.find.borrow().snapshot();
        let (specs, legacy) = {
            let model = self.0.model.borrow();
            (model.specs.clone(), model.legacy)
        };
        tui.data.read(|state| {
            let visible = Visible::of(state, &session);
            let cx = self.0.context(tui, state, &visible, (&paint, &key_shortcuts), legacy, find.as_ref());
            for spec in specs.iter() {
                let key = spec.key();
                if !wanted.contains(&key) {
                    continue;
                }
                if let Some(row) = self.0.rows.borrow().get(&key) {
                    row.update_find(&cx, spec);
                    continue;
                }
                if let Some(row) = self.0.find_pinned.borrow().get(&key) {
                    row.update_find(&cx, spec);
                    continue;
                }
                let row = Row::new(&cx, spec);
                self.0.hold(&row.wrapper, key);
                row.update(&cx, spec);
                self.0.find_pinned.borrow_mut().insert(key, row);
            }
        });
    }

    /// Drops all off-window rows pinned by Find.
    pub fn clear_find_pinned(&self, tui: &Tui) {
        if self.0.find_pinned_keys.borrow().is_empty() && self.0.find_pinned.borrow().is_empty() {
            return;
        }
        self.0.find_pinned_keys.borrow_mut().clear();
        let count = {
            let mut pinned = self.0.find_pinned.borrow_mut();
            let count = pinned.len();
            pinned.clear();
            count
        };
        if count > 0 {
            crate::features::release::dropped(&tui.app, count);
        }
    }

    /// Screen rect of the mounted row for `key`, if currently mounted.
    pub fn find_row_rect(&self, tui: &Tui, key: &FindPartKey) -> Option<Rect> {
        let session = self.session()?;
        let msg_key = tui.data.read(|state| state.transcript(&session)?.key(&key.message_id))?;
        let target = match key.part {
            FindPartId::Message => RowKey::Message(msg_key),
            FindPartId::Text(ordinal) => RowKey::Part(msg_key, Part::Text(ordinal)),
        };
        self.0.rows.borrow().get(&target).map(|row| row.wrapper.rect())
    }

    /// The rows outside the window are not built, so they mount in the new theme.
    pub fn restyle(&self, tui: &Tui) {
        let paint = Rc::new(Paint::new(tui.page()));
        self.0.look.borrow_mut().paint = paint.clone();
        self.0.hint.fg(paint.theme.text.feedback.info.base);
        self.0.background.restyle(&paint.theme);
        self.0.revert.restyle(&paint.theme);
        self.0.each_row(tui, Row::restyle, false);
    }

    /// Whether message navigation holds the view: the window then stays where it is, also at the bottom.
    pub fn navigating(&self, navigating: bool) {
        let mut model = self.0.model.borrow_mut();
        model.navigating = navigating;
        if navigating {
            model.start = model.held();
        }
    }

    /// Whether a terminal resize anchor is currently holding the view.
    pub fn resizing(&self) -> bool {
        self.0.resizing()
    }

    /// Releases any active resize anchor when the reader explicitly moves the view.
    pub fn clear_resize_pin(&self) {
        if self.0.model.borrow().resize.is_none() {
            return;
        }
        let restore = {
            let mut model = self.0.model.borrow_mut();
            model.resize.take().is_some() && model.at_end() && !model.navigating
        };
        if restore {
            self.0.scroll.sticky(true);
        }
    }

    /// Pins or follows the window after the view moved (`updateAwayFromBottom`).
    pub fn follow(&self, tui: &Tui, down: bool) {
        let inner = &self.0;
        // Newly mounted rows contribute to content size only after layout.
        if inner.mount_pinned() {
            return;
        }
        let (_, top) = inner.scroll.scroll_position();
        let content = inner.scroll.content_view().rect().height;
        let bottom = f64::from((content - inner.scroll.rect().height).max(0.0));
        let model = inner.model.borrow();
        // Only a step down reaches the bottom; after a step up the content's size may be a frame old.
        // The end of a head window is not the bottom, and nor is a navigation's slack.
        let tail = down && top >= bottom && model.at_end() && !model.navigating;
        let (next, end) = (if tail { Start::Tail } else { model.held() }, model.end);
        if model.start == next {
            return;
        }
        drop(model);
        inner.show(tui, next, end);
    }

    /// Mounts the oldest [`BACKFILL_CHUNK`] rows only, after `session.first` loaded the history; newer
    /// rows mount as the reader scrolls down.
    pub fn mount_head(&self, tui: &Tui) {
        self.clear_resize_pin();
        self.0.show(tui, Start::Top, Some(End::Index(BACKFILL_CHUNK)));
    }

    /// Mounts [`BACKFILL_CHUNK`] rows on each side of the first row of message `id`, unless that row is mounted
    /// already, for a jump to it. Returns whether the message has a row.
    pub fn mount_message(&self, tui: &Tui, id: &str) -> bool {
        self.clear_resize_pin();
        let inner = &self.0;
        // Use the store's rows even if the next sync has yet to paint them.
        inner.render(tui, |_| false);
        let Some(session) = self.session() else { return false };
        let Some(key) = tui.data.read(|state| state.transcript(&session)?.key(id)) else { return false };
        let window = {
            let model = inner.model.borrow();
            let index = model.specs.iter().position(|spec| {
                let mut shows = false;
                spec.messages(&mut |message| shows |= message == key);
                shows
            });
            let Some(index) = index else { return false };
            let start = model.window_start();
            let mounted = start <= index && index < model.window_end();
            (!mounted).then(|| {
                let start = grouping::rows_before(&model.weights, index, BACKFILL_CHUNK);
                let end = grouping::rows_after(&model.weights, index, BACKFILL_CHUNK);
                let start = if start == 0 { Start::Top } else { Start::Row(model.specs[start].key()) };
                (start, (end < model.specs.len()).then_some(End::Index(end)))
            })
        };
        if let Some((start, end)) = window {
            inner.scroll.sticky(false);
            inner.show(tui, start, end);
        }
        true
    }

    /// Mounts [`BACKFILL_CHUNK`] more rows below the window, or above it, dropping the rows far on the other side of
    /// the view, for a message navigation that found nothing among the mounted rows. Returns whether there were rows
    /// to mount.
    pub fn extend(&self, tui: &Tui, down: bool) -> bool {
        self.0.grow(tui, down)
    }

    pub fn to_tail(&self, tui: &Tui) {
        self.clear_resize_pin();
        self.0.show(tui, Start::Tail, None);
        self.0.scroll.sticky(true);
        self.0.scroll.scroll_to_bottom();
    }

    pub fn at_end(&self) -> bool {
        self.0.model.borrow().at_end()
    }

    /// Near the bottom of the mounted rows, mounts newer ones and drops the rows far above the view.
    pub fn reveal_newer(&self, tui: &Tui) -> bool {
        let inner = &self.0;
        let (_, top) = inner.scroll.scroll_position();
        let viewport = f64::from(inner.scroll.rect().height);
        let content = f64::from(inner.scroll.content_view().rect().height);
        if top + viewport < content - viewport {
            return false;
        }
        inner.grow(tui, true)
    }

    /// Mounted rows with their message and content y, top to bottom (`anchors.messagePositions`
    /// before the per-message dedupe). Footers and token usage do not anchor.
    pub fn anchors(&self, tui: &Tui) -> Vec<(String, f64)> {
        let mut out = Vec::new();
        let rows = self.0.rows.borrow();
        for key in self.0.model.borrow().mounted.iter() {
            let row = &rows[key];
            match (key, &row.body) {
                (_, Body::Group(group)) => group.anchors(&mut out),
                (RowKey::Message(message) | RowKey::Part(message, _), _) => {
                    out.push((*message, row.wrapper.rect().screen_y))
                }
                _ => {}
            }
        }
        let origin = self.0.scroll.content_view().rect().screen_y;
        out.sort_by(|a, b| a.1.total_cmp(&b.1));
        let Some(session) = self.session() else { return Vec::new() };
        tui.data.read(|state| {
            let transcript = state.transcript(&session);
            out.iter().filter_map(|(key, y)| Some((transcript?.by_key(*key)?.id().to_owned(), y - origin))).collect()
        })
    }

    /// The row `saveScrollAnchor` keeps: the lowest one that starts at or above the view's top, or one
    /// row below it for a reply part or a group, else the first mounted row. Footers and token usage do not
    /// anchor.
    pub fn anchor(&self, tui: &Tui) -> Option<ScrollAnchor> {
        let (row, screen_y) = self.0.anchor()?;
        let session = self.session()?;
        let message =
            tui.data.read(|state| Some(state.transcript(&session)?.by_key(row.message()?)?.id().to_owned()))?;
        Some(ScrollAnchor { message, row, screen_y })
    }

    /// The row of `anchor` in the messages shown now.
    fn row(&self, tui: &Tui, anchor: &ScrollAnchor) -> Option<RowKey> {
        let session = self.session()?;
        tui.data.read(|state| state.transcript(&session)?.key(&anchor.message)).map(|key| anchor.row.with(key))
    }

    pub fn row_y(&self, tui: &Tui, anchor: &ScrollAnchor) -> Option<f64> {
        self.0.row_y(&self.row(tui, anchor)?)
    }

    /// Mounts [`BACKFILL_CHUNK`] rows on each side of the anchor's row (`restoreScrollPosition`). Returns whether
    /// the row exists.
    pub fn mount_around(&self, tui: &Tui, anchor: &ScrollAnchor) -> bool {
        self.clear_resize_pin();
        // Use the store's rows even if the next sync has yet to paint them.
        self.0.render(tui, |_| false);
        let Some(key) = self.row(tui, anchor) else { return false };
        let window = {
            let model = self.0.model.borrow();
            model.specs.iter().position(|spec| spec.key() == key).map(|index| {
                let start = grouping::rows_before(&model.weights, index, BACKFILL_CHUNK);
                let end = grouping::rows_after(&model.weights, index, BACKFILL_CHUNK);
                let start = if start == 0 { Start::Top } else { Start::Row(model.specs[start].key()) };
                (start, (end < model.specs.len()).then_some(End::Index(end)))
            })
        };
        let Some((start, end)) = window else { return false };
        self.0.show(tui, start, end);
        true
    }

    /// Mounts [`BACKFILL_CHUNK`] more rows below the window and keeps the rest, for a restore or an alignment whose
    /// view must reach past the window's end before it can move. Returns whether there were rows to mount.
    pub fn mount_newer(&self, tui: &Tui) -> bool {
        let model = self.0.model.borrow();
        if model.at_end() {
            return false;
        }
        let next = grouping::rows_after(&model.weights, model.window_end(), BACKFILL_CHUNK);
        let (start, end) = (model.start, (next < model.specs.len()).then_some(End::Index(next)));
        drop(model);
        self.0.show(tui, start, end);
        true
    }

    /// Loads every older page in one publication (`session.first`). The window stays until `done`
    /// mounts the head; a failure reaches it as the error's message alone (`toast.error`).
    pub fn load_all(&self, tui: &Tui, done: impl FnOnce(&Tui, Result<(), String>) + 'static) {
        let Some(session) = self.session() else { return };
        tui.app.spawn(
            tui.data.message_load_more(&session, LoadMore { all: true, ..LoadMore::default() }),
            bind!(self.0.this, |inner, _, result| {
                let Some(tui) = inner.tui.upgrade() else { return };
                done(&tui, result.map_err(|error| error.tui_message()));
            }),
        );
    }
}

impl Model {
    fn window_start(&self) -> usize {
        window_start(&self.start, &self.specs, &self.weights)
    }

    /// The row after the last mounted one.
    fn window_end(&self) -> usize {
        window_end(self.end.map(|end| end.index(&self.specs)), self.window_start(), self.specs.len())
    }

    fn at_end(&self) -> bool {
        self.end.is_none() || self.window_end() >= self.specs.len()
    }

    fn content_width(&self, tui: &Tui) -> u16 {
        self.width.unwrap_or_else(|| tui.app.size().0.saturating_sub(tui.frame.rail_width(tui)).saturating_sub(4))
    }

    /// The window's start, fixed at its first row while it follows the tail.
    fn held(&self) -> Start {
        match self.start {
            Start::Tail => match self.window_start() {
                0 => Start::Top,
                index => Start::Row(self.specs[index].key()),
            },
            start => start,
        }
    }

    /// Bumps the generation of a live [`ResizePin`], optionally extending its frame window, and returns the new
    /// generation.
    fn rearm_resize(&mut self, frame: u64, extend: bool) -> Option<u64> {
        if !self.resize.as_ref().is_some_and(|pin| pin.live(frame)) {
            return None;
        }
        self.resize_gen += 1;
        let generation = self.resize_gen;
        if let Some(pin) = self.resize.as_mut() {
            if extend {
                pin.frame = frame;
            }
            pin.generation = generation;
        }
        Some(generation)
    }

    /// The rows of the visible messages, and the window over them. `layout` is the content's height and the frame
    /// number, for the pin rows mounting above the window set.
    fn plan(&self, state: &State, visible: &Visible<'_>, groups: &grouping::Settings, layout: (f32, u64)) -> Plan {
        let lookup = visible.lookup;
        // Queued prompts belong to the dock rather than the transcript.
        let queued: HashSet<MessageKey> =
            crate::routes::session::queued::ids(state, visible.session).filter_map(|id| lookup.key(id)).collect();
        let mut rows = reduce(lookup, self.settings.turn_tokens.is_some());
        rows.retain(|spec| !matches!(spec, Spec::Message(key) if queued.contains(key)));
        let mut specs = grouping::project(rows, lookup, groups.verbosity.get());
        let blocked: HashSet<&str> = state
            .permissions(visible.session)
            .unwrap_or_default()
            .iter()
            .filter_map(|request| request.source.as_ref().filter(|source| source.r#type == "tool"))
            .map(|source| source.id.as_str())
            .collect();
        grouping::partition_pending(&mut specs, &blocked, lookup);
        // Compactions waiting in the inbox go last (`createSessionRows`).
        specs.extend(state.pending(visible.session).iter().filter_map(|item| match item {
            SessionInboxInfo::Compaction(compaction) => Some(Spec::CompactionQueued(compaction.id.0.clone())),
            _ => None,
        }));
        let weights: Vec<usize> =
            specs.iter().map(|spec| groups.weight(spec, self.settings.hide_thinking, &lookup)).collect();
        let start = window_start(&self.start, &specs, &weights);
        let window = start..window_end(self.end.map(|end| end.index(&specs)), start, specs.len());
        let wanted: HashSet<RowKey> = specs[window.clone()].iter().map(Spec::key).collect();
        // Rows mounting above the first mounted one would push the reader's rows down; the next layout scrolls by
        // what they add (`pinAbove`).
        let first = self.mounted.iter().find(|key| wanted.contains(key));
        let above = first.is_some_and(|first| specs[start].key() != *first);
        let dropped = self.dropped.filter(|(frame, _)| *frame == layout.1).map_or(0.0, |(_, height)| height);
        let pin = (above && !self.pin.as_ref().is_some_and(|pin| pin.live(layout.1)))
            .then_some(Pin { height: layout.0 - dropped, frame: layout.1 });
        Plan { specs, weights, legacy: legacy(lookup.visible), window, wanted, pin }
    }

    /// Takes `plan` as the transcript's rows, with `mounted` as the scroll box's children.
    fn commit(&mut self, plan: Plan, mounted: Vec<RowKey>, lookup: Messages<'_>) {
        self.shapes.clear();
        self.shapes.extend(lookup.visible.iter().enumerate().map(|(at, message)| (lookup.key_at(at), shape(message))));
        let refs = &mut self.refs;
        refs.values_mut().for_each(Vec::clear);
        for index in plan.window.clone() {
            plan.specs[index].messages(&mut |message| {
                let indices = refs.entry(message).or_default();
                if indices.last() != Some(&index) {
                    indices.push(index);
                }
            });
        }
        refs.retain(|_, indices| !indices.is_empty());
        if plan.pin.is_some() {
            self.pin = plan.pin;
        }
        // The end follows its last row from now on; a window that reaches the newest row follows new ones.
        let end = plan.window.end;
        self.end =
            self.end.filter(|_| end > 0 && end < plan.specs.len()).map(|_| End::After(plan.specs[end - 1].key(), end));
        // The specs' box is reused unless a row update still holds it.
        match Rc::get_mut(&mut self.specs) {
            Some(specs) => *specs = plan.specs,
            None => self.specs = Rc::new(plan.specs),
        }
        (self.legacy, self.weights, self.mounted) = (plan.legacy, plan.weights, mounted);
        self.revision += 1;
    }
}

impl Inner {
    fn receive(&self, event: RowEvent) {
        let Some(tui) = self.tui.upgrade() else { return };
        match event {
            RowEvent::Switched(key) => self.render(&tui, |shown| shown == key),
            RowEvent::Reflowed { top, grown } => {
                // At the tail the transcript follows the bottom; away from it, a row above the reader's that grows or
                // shrinks would move the rows below it on screen (`pinAbove` for a change in place). A resize's pin
                // already holds the reader's row.
                let away = self.model.borrow().start != Start::Tail && top < self.scroll.rect().screen_y;
                if away && !self.resizing() {
                    self.scroll.scroll_by(0.0, f64::from(grown));
                }
            }
            RowEvent::Toggled => {
                if let Some(session) = self.model.borrow().session.as_ref() {
                    tui.tabs.set_expanded_groups(&session.0, self.groups.expanded.borrow().clone());
                }
                self.render(&tui, |_| true);
            }
        }
    }

    /// The row `saveScrollAnchor` keeps and its distance below the view's top.
    fn anchor(&self) -> Option<(RowKey, f64)> {
        let (_, top) = self.scroll.scroll_position();
        let mut first = None;
        let mut anchor: Option<(RowKey, f64)> = None;
        for key in self.model.borrow().mounted.iter() {
            let inset = match key {
                RowKey::Message(_) => 0.0,
                RowKey::Part(..) | RowKey::Group(_) => 1.0,
                _ => continue,
            };
            let Some(y) = self.row_y(key) else { continue };
            let item = (*key, y - top);
            if item.1 <= inset && anchor.is_none_or(|anchor| item.1 > anchor.1) {
                anchor = Some(item);
            }
            first.get_or_insert(item);
        }
        anchor.or(first)
    }

    /// The row's top in the content, while it is mounted and laid out. The rows map holds the mounted rows only.
    fn row_y(&self, key: &RowKey) -> Option<f64> {
        let rect = self.rows.borrow().get(key)?.wrapper.rect();
        (rect.height > 0.0).then(|| rect.screen_y - self.scroll.content_view().rect().screen_y)
    }

    /// Whether a live mount-above [`Pin`] holds the view.
    fn mount_pinned(&self) -> bool {
        let model = self.model.borrow();
        let Some(pin) = model.pin.as_ref() else { return false };
        self.tui.upgrade().is_some_and(|tui| pin.live(tui.app.frame_number()))
    }

    /// Whether a live [`ResizePin`] holds the reader's row across a resize.
    fn resizing(&self) -> bool {
        let model = self.model.borrow();
        let Some(pin) = model.resize.as_ref() else { return false };
        self.tui.upgrade().is_some_and(|tui| pin.live(tui.app.frame_number()))
    }

    /// The first laid-out mounted row that overlaps the viewport (or the first laid-out row if all start below), with
    /// its content `y`, its viewport offset `y - top`, and its height. Subtracts rows dropped above in `frame` so a
    /// same-frame resize anchors against the kept rows' future positions.
    fn resize_anchor(&self, frame: u64) -> Option<(RowKey, f64, f64, f32)> {
        let (_, top) = self.scroll.scroll_position();
        let origin = self.scroll.content_view().rect().screen_y;
        let model = self.model.borrow();
        let dropped = model.dropped_above.filter(|(at, _)| *at == frame).map_or(0.0, |(_, height)| f64::from(height));
        let rows = self.rows.borrow();
        let mut first = None;
        for key in model.mounted.iter() {
            let Some(rect) = rows.get(key).map(|row| row.wrapper.rect()).filter(|rect| rect.height > 0.0) else {
                continue;
            };
            let y = rect.screen_y - origin - dropped;
            let item = (*key, y, y - top, rect.height);
            if y + f64::from(rect.height) > top {
                return Some(item);
            }
            first.get_or_insert(item);
        }
        first
    }

    /// Scrolls directly to `target` during a resize. While `!at_end`, stops one cell shy of `max_y` so OpenTUI does
    /// not record an `INFINITY` end-target that would jump past rows mounted by [`Self::reanchor`].
    fn scroll_to_resize(&self, target: f64, at_end: bool) {
        let content = f64::from(self.scroll.content_view().rect().height);
        let viewport = f64::from(self.scroll.rect().height);
        let max_y = (content - viewport).max(0.0).floor();
        let y = if !at_end && target >= max_y { (max_y - 1.0).max(0.0) } else { target };
        self.scroll.scroll_to(0.0, y);
    }

    /// Re-anchors the reader's row after a resize's layout settles, mounting newer rows if the resized viewport would
    /// otherwise clamp against the artificial end of the bounded window.
    fn reanchor(&self, tui: &Tui, generation: u64) {
        crate::routes::session::scroll::after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let (target, at_end, navigating) = {
                    let model = inner.model.borrow();
                    let Some(pin) = model.resize.as_ref().filter(|pin| pin.generation == generation) else {
                        return;
                    };
                    let (at_end, navigating) = (model.at_end(), model.navigating);
                    let Some(y) = inner.row_y(&pin.anchor) else {
                        drop(model);
                        inner.model.borrow_mut().resize = None;
                        if at_end && !navigating {
                            inner.scroll.sticky(true);
                        }
                        return;
                    };
                    let height = inner
                        .rows
                        .borrow()
                        .get(&pin.anchor)
                        .map_or(pin.current_height, |row| row.wrapper.rect().height);
                    (pin.target(y, height), at_end, navigating)
                };
                let content = f64::from(inner.scroll.content_view().rect().height);
                let viewport = f64::from(inner.scroll.rect().height);
                let max_y = (content - viewport).max(0.0).floor();
                if target > max_y && !at_end && Transcript(inner.clone()).mount_newer(&tui) {
                    if let Some(pin) =
                        inner.model.borrow_mut().resize.as_mut().filter(|pin| pin.generation == generation)
                    {
                        pin.frame = tui.app.frame_number();
                    }
                    inner.reanchor(&tui, generation);
                    return;
                }
                inner.scroll_to_resize(target, at_end);
                inner.model.borrow_mut().resize = None;
                if at_end && !navigating {
                    inner.scroll.sticky(true);
                }
            }),
        );
    }

    /// Reads the session's location once its info is known, with the location's agents and models, whose names and
    /// colors the footer and user rows show (`local.agent.color`, `ctx.models`).
    fn locate(&self, tui: &Tui, session: &SessionID) {
        if self.model.borrow().location.is_some() {
            return;
        }
        let location =
            tui.data.read(|state| state.session(session).map(|info| Location::new(info.location.directory.as_str())));
        let Some(location) = location else { return };
        for catalog in [Catalog::Agent, Catalog::Model] {
            drop(tui.data.catalog_sync(catalog, Some(&location)));
        }
        // Queued compactions are pending inbox items (`createSessionRows` syncs them on connect).
        drop(tui.data.pending_sync(session));
        self.model.borrow_mut().location = Some(location);
    }

    /// The paint and the shortcuts rows read, the shortcuts read again once the keymap changed.
    fn look(&self, tui: &Tui) -> (Rc<Paint>, Rc<Keys>) {
        let revision = tui.keymap.keymap().revision();
        if self.look.borrow().keys.0 != revision {
            let keys = Rc::new(Keys::read(tui));
            self.look.borrow_mut().keys = (revision, keys);
        }
        let look = self.look.borrow();
        (look.paint.clone(), look.keys.1.clone())
    }

    fn install(&self, tui: &Tui) {
        let weak = self.this.clone();
        let settings = tui.settings.subscribe(bind!(weak, |inner, tui| {
            let view = RowSettings::read(&tui.config());
            let before = std::mem::replace(&mut inner.model.borrow_mut().settings, view);
            let groups = inner.groups.read(&tui.settings.info());
            if before.hide_thinking != view.hide_thinking {
                let layer = inner.hooks.borrow_mut().layer.take();
                dispose(tui, layer);
                inner.register(tui);
            }
            if groups || before != view {
                inner.render(tui, |_| true);
            }
        }));
        self.hooks.borrow_mut().settings = Some(settings);
        let weak = self.this.clone();
        self.root.on_resize(bind!(weak, |inner, cx, rect| {
            let Some(tui) = inner.tui.upgrade() else { return };
            let width = rect.width as u16;
            let same = inner.model.borrow().content_width(&tui) == width;
            inner.model.borrow_mut().width = Some(width);
            if same {
                return;
            }
            cx.defer(bind!(inner.this.clone(), |inner, _| {
                if let Some(tui) = inner.tui.upgrade() {
                    inner.refit(&tui);
                }
            }));
        }));
        // Before the layout, while the rows have their old places: away from the bottom (or before the window reaches
        // the newest row), anchor the reader's top row through layout and refit (see `ResizePin`). A resize while one
        // holds extends it without losing the original anchor.
        let resize = tui.app.on_resize(bind!(self.this, |inner, cx, _, _| {
            let Some(tui) = inner.tui.upgrade() else { return };
            let frame = cx.app().frame_number();
            if let Some(generation) = inner.model.borrow_mut().rearm_resize(frame, true) {
                inner.scroll.sticky(false);
                inner.reanchor(&tui, generation);
                return;
            }
            let (_, top) = inner.scroll.scroll_position();
            let (content, viewport) = (inner.scroll.content_view().rect().height, inner.scroll.rect().height);
            if top >= f64::from((content - viewport).max(0.0)).floor() && inner.model.borrow().at_end() {
                return;
            }
            let Some((anchor, y, screen_y, height)) = inner.resize_anchor(frame) else { return };
            let generation = {
                let mut model = inner.model.borrow_mut();
                model.resize_gen += 1;
                let generation = model.resize_gen;
                let above = model.mounted.iter().take_while(|key| **key != anchor).copied().collect();
                model.resize =
                    Some(ResizePin { anchor, screen_y, height, y, current_height: height, above, frame, generation });
                generation
            };
            inner.scroll.sticky(false);
            inner.reanchor(&tui, generation);
        }));
        self.hooks.borrow_mut().resize = Some(resize);
        let weak = self.this.clone();
        self.scroll.content_view().on_resize(bind!(weak, |inner, cx, rect| {
            let mut model = inner.model.borrow_mut();
            let Some(pin) = model.pin.take() else { return };
            // Only the frames that lay the new rows out move the view.
            if !pin.live(cx.app().frame_number()) {
                return;
            }
            drop(model);
            let grown = rect.height - pin.height;
            if grown > 0.0 {
                inner.scroll.scroll_by(0.0, f64::from(grown));
            }
        }));
        // Explicit user moves via scrollbar or box keys release any active resize anchor.
        let weak = self.this.clone();
        self.scroll.on_scroll(bind!(weak, |inner, _, event| {
            if matches!(event.cause, ScrollCause::Wheel | ScrollCause::Key | ScrollCause::Pointer) {
                Transcript(inner).clear_resize_pin();
            }
        }));
        // The wheel moves the view before this runs, so the window checks after it.
        let weak = self.this.clone();
        self.scroll.on_mouse(move |cx, event| {
            let up = match event.kind {
                MouseEventKind::ScrollUp => true,
                MouseEventKind::ScrollDown => false,
                _ => return,
            };
            if let Some(inner) = weak.upgrade() {
                Transcript(inner).clear_resize_pin();
            }
            cx.set_timeout(
                Duration::ZERO,
                bind!(weak, |inner, _| {
                    let Some(tui) = inner.tui.upgrade() else { return };
                    let transcript = Transcript(inner);
                    if up && transcript.reveal_older(&tui) || !up && transcript.reveal_newer(&tui) {
                        return;
                    }
                    transcript.follow(&tui, !up);
                }),
            );
        });
        self.register(tui);
    }

    fn viewport(&self) -> opencode_plugin::abi::v2::TranscriptView {
        // Counted again only when the specs or the window's start change: a key or a wheel step costs nothing
        // proportional to the history.
        let above = {
            let mut model = self.model.borrow_mut();
            let at = (model.revision, model.start);
            match model.above {
                Some((revision, start, above)) if (revision, start) == at => above,
                _ => {
                    // A group counts once, apart from its messages.
                    let above: HashSet<RowKey> = model.specs[..model.window_start()]
                        .iter()
                        .map(|spec| match spec.key() {
                            RowKey::Part(key, _) | RowKey::Footer(key) | RowKey::TurnUsage(key) => RowKey::Message(key),
                            key => key,
                        })
                        .collect();
                    let above = above.len() as u32;
                    model.above = Some((at.0, at.1, above));
                    above
                }
            }
        };
        let origin = self.scroll.content_view().rect().screen_y;
        let (model, rows) = (self.model.borrow(), self.rows.borrow());
        // The rows leave the process by message and tool call ID; a group by its name, a queued compaction by its
        // inbox ID.
        let name = |state: &State, key: &RowKey| -> Option<(String, Option<String>)> {
            let session = model.session.as_ref()?;
            let lookup = Messages { transcript: state.transcript(session), visible: state.messages(session) };
            match key {
                RowKey::Group(id) => return Some((id.name(&lookup), None)),
                RowKey::CompactionQueued(_) => {
                    let id = model.specs.iter().find_map(|spec| match spec {
                        Spec::CompactionQueued(id) if spec.key() == *key => Some(id.clone()),
                        _ => None,
                    });
                    return id.map(|id| (id, None));
                }
                _ => {}
            }
            let message = lookup.get(key.message()?)?;
            let tool = match (key, message) {
                (RowKey::Part(_, part @ Part::Tool(_)), SessionMessageInfo::Assistant(assistant)) => {
                    match part.resolve(assistant)? {
                        SessionMessageAssistantContentItem::Tool(tool) => Some(tool.id.clone()),
                        _ => None,
                    }
                }
                _ => None,
            };
            Some((message.id().to_owned(), tool))
        };
        let names: Vec<(String, Option<String>)> = match self.tui.upgrade() {
            Some(tui) => {
                tui.data.read(|state| model.mounted.iter().map(|key| name(state, key).unwrap_or_default()).collect())
            }
            None => Vec::new(),
        };
        let published: Vec<opencode_plugin::abi::v2::TranscriptRow> = model
            .mounted
            .iter()
            .zip(names)
            .filter_map(|(key, (message, part))| {
                let row = rows.get(key)?;
                let rect = row.wrapper.rect();
                let kind = match &row.body {
                    Body::User(_) => "user",
                    Body::Text(_) => "text",
                    Body::Reasoning(_) => "reasoning",
                    Body::Tool(_) | Body::Shell(_) => "tool",
                    Body::Group(_) => "group",
                    _ => "other",
                };
                (rect.height > 0.0).then(|| opencode_plugin::abi::v2::TranscriptRow {
                    kind: kind.to_owned(),
                    message,
                    part,
                    row: (rect.screen_y - origin).round() as i32,
                    height: rect.height.round() as i32,
                })
            })
            .collect();
        let mut revision = DefaultHasher::new();
        published.hash(&mut revision);
        opencode_plugin::abi::v2::TranscriptView {
            offset: self.scroll.scroll_position().1.round() as i32,
            viewport: self.scroll.rect().height as i32,
            extent: self.scroll.content_view().rect().height as i32,
            revision: revision.finish(),
            above,
            rows: published,
        }
    }

    fn register(&self, tui: &Tui) {
        let hidden = self.model.borrow().settings.hide_thinking;
        let toggle = TuiCommand::new(
            "session.toggle.thinking",
            bind!(self.this, |inner, _, _| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let hidden = inner.model.borrow().settings.hide_thinking;
                let next = if hidden { Visibility::Show } else { Visibility::Hide };
                crate::dialogs::settings::update(&tui, move |draft| {
                    crate::dialogs::settings::set_path(draft, &["session", "thinking"], next.as_str().into());
                });
                tui.dialogs.clear();
            }),
        )
        .title(if hidden { "Expand thinking" } else { "Collapse thinking" })
        .group("Session");
        let layer = KeymapLayer::new(vec![toggle]);
        match tui.keymap.layer(layer) {
            Ok(disposer) => self.hooks.borrow_mut().layer = Some(disposer),
            Err(error) => log::error!("transcript keymap layer: {error}"),
        }
    }

    fn render(&self, tui: &Tui, changed: impl Fn(MessageKey) -> bool) {
        let Some(session) = self.model.borrow().session.clone() else { return };
        let (paint, keys) = self.look(tui);
        let find = self.find.borrow().snapshot();
        let layout = (self.scroll.content_view().rect().height, tui.app.frame_number());
        let stops = tui.data.read(|state| {
            let visible = Visible::of(state, &session);
            let plan = self.model.borrow().plan(state, &visible, &self.groups, layout);
            let mut mounted = std::mem::take(&mut self.model.borrow_mut().mounted);
            let cx = self.context(tui, state, &visible, (&paint, &keys), plan.legacy, find.as_ref());
            self.apply(&cx, &plan, changed, &mut mounted);
            self.model.borrow_mut().commit(plan, mounted, visible.lookup);
            self.trailing(tui, &visible, &keys);
            self.limits.check(visible.lookup.visible, &|id| state.has_input(&session, id))
        });
        for stop in stops {
            stop.run(tui);
        }
        self.complete_group_boundary(tui);
    }

    /// Puts `plan`'s window in the scroll box: drops the rows that left it, builds the new ones, updates those whose
    /// messages `changed`, and orders them. `mounted` holds the children's keys before and after.
    fn apply(&self, cx: &Context<'_>, plan: &Plan, changed: impl Fn(MessageKey) -> bool, mounted: &mut Vec<RowKey>) {
        let mut rows = self.rows.borrow_mut();
        let mut pinned = self.find_pinned.borrow_mut();
        let pinned_keys = self.find_pinned_keys.borrow();
        let gone: Vec<RowKey> = rows.keys().copied().filter(|key| !plan.wanted.contains(key)).collect();
        let mut dropped_count = 0usize;
        for key in gone {
            if let Some(row) = rows.remove(&key) {
                row.wrapper.detach();
                if pinned_keys.contains(&key) {
                    pinned.insert(key, row);
                } else {
                    dropped_count += 1;
                }
            }
        }
        if dropped_count > 0 {
            crate::features::release::dropped(cx.app, dropped_count);
        }
        mounted.retain(|key| plan.wanted.contains(key));
        let window = &plan.specs[plan.window.clone()];
        for spec in window {
            let key = spec.key();
            let mut touched = false;
            spec.messages(&mut |message| touched = touched || changed(message));
            let fresh = !rows.contains_key(&key);
            let adopted = fresh && pinned.contains_key(&key);
            let row = rows.entry(key).or_insert_with(|| {
                if let Some(row) = pinned.remove(&key) {
                    return row;
                }
                let row = Row::new(cx, spec);
                self.hold(&row.wrapper, key);
                row
            });
            if adopted {
                if touched {
                    row.update(cx, spec);
                } else {
                    row.update_find(cx, spec);
                }
            } else if fresh || touched {
                row.update(cx, spec);
            }
        }
        if !pinned.is_empty() {
            let valid: HashSet<RowKey> = plan.specs.iter().map(Spec::key).collect();
            let before = pinned.len();
            pinned.retain(|key, _| valid.contains(key));
            if before > pinned.len() {
                crate::features::release::dropped(cx.app, before - pinned.len());
            }
            for spec in &plan.specs {
                if let Some(row) = pinned.get(&spec.key()) {
                    let mut touched = false;
                    spec.messages(&mut |message| touched = touched || changed(message));
                    if touched {
                        row.update(cx, spec);
                    }
                }
            }
        }
        for (index, key) in window.iter().map(Spec::key).enumerate() {
            if mounted.get(index) == Some(&key) {
                continue;
            }
            if let Some(position) = mounted.iter().position(|other| *other == key) {
                mounted.remove(position);
            }
            self.scroll.insert(index, &rows[&key].wrapper);
            mounted.insert(index, key);
        }
    }

    /// Updates the rows of the messages changed in place; false when the transcript must render.
    fn patch(&self, tui: &Tui, session: &SessionID, changes: &Changes) -> bool {
        if self.model.borrow().settings.turn_tokens.is_some() {
            return false;
        }
        if !self.find_pinned.borrow().is_empty()
            && tui.data.read(|state| {
                let pinned = self.find_pinned.borrow();
                changes
                    .message_keys(state, session)
                    .any(|msg| pinned.keys().any(|row_key| row_key.message() == Some(msg)))
            })
        {
            return false;
        }
        let (paint, keys) = self.look(tui);
        let find = self.find.borrow().snapshot();
        tui.data.read(|state| {
            let visible = Visible::of(state, session);
            let lookup = visible.lookup;
            let (specs, legacy, mut stale) = {
                let mut model = self.model.borrow_mut();
                // Each changed message is where the last render saw it, in the same shape.
                let same = model.shapes.len() == lookup.visible.len()
                    && changes.message_keys(state, session).all(|key| {
                        lookup.position(key).is_some_and(|at| model.shapes[at] == (key, shape(&lookup.visible[at])))
                    });
                if !same {
                    return false;
                }
                let mut stale = std::mem::take(&mut model.stale);
                let rows = changes.message_keys(state, session).filter_map(|key| model.refs.get(&key));
                stale.extend(rows.flatten());
                (model.specs.clone(), model.legacy, stale)
            };
            stale.sort_unstable();
            stale.dedup();
            let cx = self.context(tui, state, &visible, (&paint, &keys), legacy, find.as_ref());
            self.update(&cx, stale.iter().map(|index| &specs[*index]), Row::update);
            self.trailing(tui, &visible, &keys);
            stale.clear();
            self.model.borrow_mut().stale = stale;
            true
        })
    }

    /// Renders the window at a new width. A row's spec does not depend on the width, so while the store holds nothing
    /// the transcript has not seen and the window is the one mounted, the rows update in place; otherwise the
    /// transcript renders.
    fn refit(&self, tui: &Tui) {
        let current = tui.synced() && {
            let model = self.model.borrow();
            let window = &model.specs[model.window_start()..model.window_end()];
            model.mounted.iter().copied().eq(window.iter().map(Spec::key))
        };
        if !current {
            self.render(tui, |_| true);
        } else {
            for stop in self.each_row(tui, Row::update, true) {
                stop.run(tui);
            }
            self.complete_group_boundary(tui);
        }
        if let Some(generation) = self.model.borrow_mut().rearm_resize(tui.app.frame_number(), false) {
            self.reanchor(tui, generation);
        }
    }

    /// Runs `each` on every mounted row, then updates the trailing hint and banner; with `check`, runs the limit checks
    /// as a render does.
    fn each_row(&self, tui: &Tui, each: fn(&Row, &Context<'_>, &Spec), check: bool) -> Vec<errors::Stop> {
        let Some(session) = self.model.borrow().session.clone() else { return Vec::new() };
        let (paint, keys) = self.look(tui);
        let find = self.find.borrow().snapshot();
        let (specs, legacy) = {
            let model = self.model.borrow();
            (model.specs.clone(), model.legacy)
        };
        tui.data.read(|state| {
            let visible = Visible::of(state, &session);
            let cx = self.context(tui, state, &visible, (&paint, &keys), legacy, find.as_ref());
            self.update(&cx, specs.iter(), each);
            self.trailing(tui, &visible, &keys);
            let check = check.then(|| self.limits.check(visible.lookup.visible, &|id| state.has_input(&session, id)));
            check.unwrap_or_default()
        })
    }

    /// Runs `each` on the mounted (and Find-pinned) rows of `specs`, in order.
    fn update<'s>(&self, cx: &Context<'_>, specs: impl Iterator<Item = &'s Spec>, each: fn(&Row, &Context<'_>, &Spec)) {
        let rows = self.rows.borrow();
        let pinned = self.find_pinned.borrow();
        let has_pinned = !pinned.is_empty();
        for spec in specs {
            let key = spec.key();
            if let Some(row) = rows.get(&key) {
                each(row, cx, spec);
            } else if has_pinned && let Some(row) = pinned.get(&key) {
                each(row, cx, spec);
            }
        }
    }

    /// The background hint and the revert banner after the rows.
    fn trailing(&self, tui: &Tui, visible: &Visible<'_>, keys: &Keys) {
        self.background.update(visible.lookup.visible, keys.background.as_deref(), errors::now());
        let revert = visible
            .info
            .and_then(|info| info.revert.as_ref())
            .map(|revert| (revert.message_id.as_str(), revert.files.as_deref().unwrap_or_default()));
        let width = usize::from(self.model.borrow().content_width(tui));
        self.revert.update(visible.session, revert, visible.all, keys.redo.as_deref(), width);
    }

    fn context<'a>(
        &'a self,
        tui: &'a Tui,
        state: &'a State,
        visible: &Visible<'a>,
        (paint, keys): (&'a Paint, &'a Keys),
        legacy: bool,
        find: Option<&'a FindSnapshot>,
    ) -> Context<'a> {
        let model = self.model.borrow();
        let view = model.settings;
        let info = visible.info;
        let catalogs = model.location.as_ref().and_then(|location| state.location(Some(location)));
        Context {
            tui,
            state,
            keys,
            directory: info.map(|info| info.location.directory.as_str()),
            image_preview: view.image_preview,
            session: visible.session,
            agents: catalogs.and_then(|data| data.agent.as_deref()).unwrap_or_default(),
            models: catalogs.and_then(|data| data.model.as_deref()).unwrap_or_default(),
            app: &tui.app,
            theme: &paint.theme,
            syntax: &paint.syntax,
            thinking_syntax: &paint.thinking_syntax,
            palette: &paint.palette,
            renderers: &self.renderers,
            claims: &self.claims,
            events: Events(self.this.clone()),
            conceal: view.conceal,
            hide_thinking: view.hide_thinking,
            groups: &self.groups,
            toggles: &self.toggles,
            tps: view.tps,
            verbose_tokens: view.turn_tokens == Some(TurnTokens::Verbose),
            mode: tui.theme.borrow().mode(),
            width: tui.app.size().0,
            content: model.content_width(tui),
            session_agent: info.and_then(|info| info.agent.as_ref()).map(|agent| agent.as_str()),
            lookup: visible.lookup,
            legacy,
            find,
        }
    }

    /// `completeGroupBoundary`: a page boundary can cut the oldest group in half, so while the oldest row is a
    /// group, older pages load until something precedes it. The footer's turn duration needs that turn's prompt.
    fn complete_group_boundary(&self, tui: &Tui) {
        let model = self.model.borrow();
        let group = !model.loading && matches!(model.specs.first(), Some(Spec::Group(_)));
        let Some(session) = group.then(|| model.session.clone()).flatten() else { return };
        drop(model);
        let count = tui.data.read(|state| state.has_more_messages(&session).then(|| state.messages(&session).len()));
        // A page that adds nothing would otherwise load again forever.
        let Some(count) = count.filter(|count| self.model.borrow().boundary != Some(*count)) else { return };
        let mut model = self.model.borrow_mut();
        (model.boundary, model.loading) = (Some(count), true);
        drop(model);
        tui.app.spawn(
            tui.data.message_load_more(&session, LoadMore::default()),
            bind!(self.this, |inner, _, result| {
                inner.model.borrow_mut().loading = false;
                if let Err(error) = result {
                    log::error!("Failed to load older messages: {error}");
                }
                if let Some(tui) = inner.tui.upgrade() {
                    inner.complete_group_boundary(&tui);
                }
            }),
        );
    }

    /// While a [`ResizePin`] holds the reader's row, updates the scroll target from `anchor`'s own settled geometry or
    /// shifts it when a row above changes height during `refit`, scrolling to the absolute target so an earlier clamp
    /// by `ScrollBox` never double-shifts the view.
    fn hold(&self, wrapper: &View, key: RowKey) {
        let laid = Cell::new(None);
        wrapper.on_resize(bind!(self.this, |inner, cx, rect| {
            let before = laid.replace(Some(rect.height));
            if inner.model.borrow().resize.is_none() {
                return;
            }
            let frame = cx.app().frame_number();
            let target = {
                let mut model = inner.model.borrow_mut();
                let Some(pin) = model.resize.as_mut().filter(|pin| pin.live(frame)) else { return };
                if pin.anchor == key && rect.height > 0.0 {
                    let y = rect.screen_y - inner.scroll.content_view().rect().screen_y;
                    pin.y = y;
                    pin.current_height = rect.height;
                    Some(pin.target(y, rect.height))
                } else if pin.above.contains(&key)
                    && let Some(before) = before.filter(|before| *before != rect.height)
                {
                    pin.y += f64::from(rect.height - before);
                    Some(pin.target(pin.y, pin.current_height))
                } else {
                    None
                }
            };
            if let Some(target) = target {
                let at_end = inner.model.borrow().at_end();
                inner.scroll_to_resize(target, at_end);
            }
        }));
    }

    /// Moves the window to start at `start` and end at `end`.
    fn show(&self, tui: &Tui, start: Start, end: Option<End>) {
        let mut model = self.model.borrow_mut();
        (model.start, model.end) = (start, end);
        drop(model);
        self.render(tui, |_| false);
    }

    /// Mounts [`BACKFILL_CHUNK`] more rows past the window's end (`down`) or before its start, and drops the rows more
    /// than [`MARGIN`] past the view on the other side. Returns false when the window already reaches the last loaded
    /// row that way.
    fn grow(&self, tui: &Tui, down: bool) -> bool {
        let model = self.model.borrow();
        if if down { model.at_end() } else { model.window_start() == 0 } {
            return false;
        }
        drop(model);
        if down {
            let above = self.drop_above(tui);
            let model = self.model.borrow();
            let next = grouping::rows_after(&model.weights, model.window_end(), BACKFILL_CHUNK);
            let start = above.map_or(model.start, |(start, _)| start);
            let end = (next < model.specs.len()).then_some(End::Index(next));
            drop(model);
            self.scroll.sticky(false);
            self.show(tui, start, end);
            // The rows on screen move up by what dropped above them; the next frame's layout takes it with the move
            // that asked for the rows.
            if let Some((_, height)) = above {
                self.scroll.scroll_by(0.0, -f64::from(height));
                self.dropped(tui, height);
                self.dropped_above(tui, height);
            }
            if end.is_none() {
                self.restore_sticky_after_layout(tui);
            }
            return true;
        }
        let model = self.model.borrow();
        let start = match grouping::rows_before(&model.weights, model.window_start(), BACKFILL_CHUNK) {
            0 => Start::Top,
            next => Start::Row(model.specs[next].key()),
        };
        let end = model.end;
        drop(model);
        self.scroll.sticky(false);
        self.show(tui, start, end);
        self.drop_below_later(tui);
        true
    }

    /// Re-enables sticky scrolling once the newly mounted rows are laid out, so OpenTUI's `sticky(true)` edge check
    /// sees the updated `max_y` instead of sticking against the pre-mount bottom.
    fn restore_sticky_after_layout(&self, tui: &Tui) {
        crate::routes::session::scroll::after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                let model = inner.model.borrow();
                if model.at_end() && !model.navigating && !inner.resizing() {
                    drop(model);
                    inner.scroll.sticky(true);
                }
            }),
        );
    }

    /// Drops the rows far below the view once the rows mounted above are laid out. The rows mounted above hold the
    /// view by how much the content grows (`Pin`); rows dropped below in the same frame would take from that, and
    /// could cancel it out.
    fn drop_below_later(&self, tui: &Tui) {
        crate::routes::session::scroll::after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let Some((end, height)) = inner.drop_below(&tui) else {
                    let model = inner.model.borrow();
                    if model.at_end() && !model.navigating && !inner.resizing() {
                        drop(model);
                        inner.scroll.sticky(true);
                    }
                    return;
                };
                inner.model.borrow_mut().end = Some(end);
                inner.render(&tui, |_| false);
                inner.dropped(&tui, height);
            }),
        );
    }

    /// The window's start once the rows more than [`MARGIN`] above the view drop, and the height they take with them;
    /// None when no row is that far, or while the rows must stay (see [`Self::visible`]).
    fn drop_above(&self, tui: &Tui) -> Option<(Start, f32)> {
        let visible = self.visible(tui)?;
        let model = self.model.borrow();
        let (start, keep) = (model.window_start(), grouping::rows_before(&model.weights, visible.start, MARGIN));
        if keep <= start {
            return None;
        }
        // Both rows were laid out in an earlier frame: only rows past the window's end are new. Either may be empty,
        // with no height, and still has its place.
        let top = |index: usize| {
            let content = self.scroll.content_view().rect().screen_y;
            Some(self.rows.borrow().get(&model.specs[index].key())?.wrapper.rect().screen_y - content)
        };
        let height = top(keep)? - top(start)?;
        Some((Start::Row(model.specs[keep].key()), height as f32))
    }

    /// The window's end once the rows more than [`MARGIN`] below the view drop, and the height they take with them;
    /// None when no row is that far, or while the rows must stay (see [`Self::visible`]).
    fn drop_below(&self, tui: &Tui) -> Option<(End, f32)> {
        let visible = self.visible(tui)?;
        let model = self.model.borrow();
        let (end, keep) = (model.window_end(), grouping::rows_after(&model.weights, visible.end, MARGIN));
        if keep >= end {
            return None;
        }
        let bottom = |index: usize| {
            let rect = self.rows.borrow().get(&model.specs[index].key())?.wrapper.rect();
            Some(rect.screen_y + f64::from(rect.height))
        };
        let height = bottom(end - 1)? - bottom(keep - 1)?;
        Some((End::After(model.specs[keep - 1].key(), keep), height as f32))
    }

    /// Notes rows of `height` dropped before the next layout (see `Model::dropped`).
    fn dropped(&self, tui: &Tui, height: f32) {
        let frame = tui.app.frame_number();
        let mut model = self.model.borrow_mut();
        let before = model.dropped.filter(|(at, _)| *at == frame).map_or(0.0, |(_, before)| before);
        model.dropped = Some((frame, before + height));
    }

    /// Notes rows of `height` dropped above the kept rows before the next layout (see `Model::dropped_above`).
    fn dropped_above(&self, tui: &Tui, height: f32) {
        let frame = tui.app.frame_number();
        let mut model = self.model.borrow_mut();
        let before = model.dropped_above.filter(|(at, _)| *at == frame).map_or(0.0, |(_, before)| before);
        model.dropped_above = Some((frame, before + height));
    }

    /// The mounted rows on screen, as a range of the rows, while rows may drop. They may not before the rows are laid
    /// out, while a resize or rows mounted above hold the view, or while the reader selects text: the selection holds
    /// its rows until it clears, which any key does.
    fn visible(&self, tui: &Tui) -> Option<Range<usize>> {
        if self.mount_pinned() || self.resizing() || tui.app.is_selecting() || tui.app.selected_text().is_some() {
            return None;
        }
        let (_, top) = self.scroll.scroll_position();
        let bottom = top + f64::from(self.scroll.rect().height);
        let model = self.model.borrow();
        let start = model.window_start();
        let rows = self.rows.borrow();
        let mut visible: Option<Range<usize>> = None;
        for (offset, key) in model.mounted.iter().enumerate() {
            let Some(y) = self.row_y(key) else { continue };
            let height = f64::from(rows.get(key).map_or(0.0, |row| row.wrapper.rect().height));
            if y + height > top && y < bottom {
                let index = start + offset;
                visible = Some(visible.map_or(index, |visible| visible.start)..index + 1);
            }
        }
        visible
    }

    fn load_older(&self, tui: &Tui) -> bool {
        let Some(session) = self.model.borrow().session.clone() else { return false };
        if self.model.borrow().loading || !tui.data.read(|state| state.has_more_messages(&session)) {
            return false;
        }
        let mut model = self.model.borrow_mut();
        (model.loading, model.start) = (true, Start::Top);
        drop(model);
        self.hint.visible(true);
        tui.app.spawn(
            tui.data.message_load_more(&session, LoadMore::default()),
            bind!(self.this, |inner, _, result| {
                inner.model.borrow_mut().loading = false;
                inner.hint.visible(false);
                let Some(tui) = inner.tui.upgrade() else { return };
                match result {
                    Ok(_) => {
                        inner.complete_group_boundary(&tui);
                        inner.drop_below_later(&tui);
                    }
                    Err(error) => tui.toasts.error(error.tui_message()),
                }
            }),
        );
        true
    }
}

/// The first mounted row: the tail, or earlier while the reader is away from the bottom.
fn window_start(start: &Start, specs: &[Spec], weights: &[usize]) -> usize {
    let tail = grouping::rows_before(weights, specs.len(), TAIL_ROWS);
    match start {
        Start::Tail => tail,
        Start::Top => 0,
        Start::Row(key) => specs.iter().position(|spec| spec.key() == *key).map_or(tail, |index| index.min(tail)),
    }
}

/// The row after the last mounted one (`visibleEnd`): never before the window's start.
fn window_end(end: Option<usize>, start: usize, rows: usize) -> usize {
    end.map_or(rows, |end| end.min(rows)).max(start)
}

/// Shortcuts rows show, read before the store is locked.
#[derive(Default)]
pub struct Keys {
    pub background: Option<String>,
    pub redo: Option<String>,
    pub model_list: Option<String>,
}

impl Keys {
    /// The keymap's conditions read the store, so this must run before it is locked.
    fn read(tui: &Tui) -> Self {
        Self {
            background: tui.keymap.shortcut("session.background"),
            redo: tui.keymap.shortcut("session.redo"),
            model_list: tui.keymap.shortcut("model.list"),
        }
    }
}

struct Visible<'a> {
    session: &'a SessionID,
    info: Option<&'a SessionInfo>,
    all: &'a [SessionMessageInfo],
    /// Visible messages before the revert boundary.
    lookup: Messages<'a>,
}

impl<'a> Visible<'a> {
    fn of(state: &'a State, session: &'a SessionID) -> Self {
        let all = state.messages(session);
        let info = state.session(session);
        let messages = match info.and_then(|info| info.revert.as_ref()) {
            Some(revert) => {
                let boundary = revert.message_id.as_str();
                &all[..all.iter().position(|message| message.id() >= boundary).unwrap_or(all.len())]
            }
            None => all,
        };
        let lookup = Messages { transcript: state.transcript(session), visible: messages };
        Self { session, info, all, lookup }
    }
}

/// The visible messages, found by key.
#[derive(Clone, Copy)]
pub struct Messages<'a> {
    /// `None` for messages outside the store, whose keys are their positions.
    transcript: Option<&'a opencode_store::Transcript>,
    pub visible: &'a [SessionMessageInfo],
}

impl<'a> Messages<'a> {
    /// Messages outside the store, keyed by their positions.
    pub fn of(visible: &'a [SessionMessageInfo]) -> Self {
        Self { transcript: None, visible }
    }

    pub fn key_at(&self, position: usize) -> MessageKey {
        self.transcript.map_or(MessageKey(position as u32), |transcript| transcript.keys()[position])
    }

    /// Where the message of `key` is, while it is visible.
    pub fn position(&self, key: MessageKey) -> Option<usize> {
        let position = match self.transcript {
            Some(transcript) => transcript.position(key)?,
            None => key.0 as usize,
        };
        (position < self.visible.len()).then_some(position)
    }

    pub fn get(&self, key: MessageKey) -> Option<&'a SessionMessageInfo> {
        self.position(key).map(|position| &self.visible[position])
    }

    pub fn assistant(&self, key: MessageKey) -> Option<&'a SessionMessageAssistant> {
        match self.get(key)? {
            SessionMessageInfo::Assistant(assistant) => Some(assistant),
            _ => None,
        }
    }

    /// The key of visible message `id`.
    pub fn key(&self, id: &str) -> Option<MessageKey> {
        let key = match self.transcript {
            Some(transcript) => transcript.key(id)?,
            None => MessageKey(self.visible.iter().position(|message| message.id() == id)? as u32),
        };
        self.position(key).map(|_| key)
    }
}

/// What `reduce` and `grouping::project` read from a message, hashed: while it stays the same, a change to
/// the message changes no row's shape, only the content of its rows. `debug.turn_tokens` is left out, so its
/// usage rows always take a full render.
fn shape(message: &SessionMessageInfo) -> u64 {
    let mut hasher = DefaultHasher::new();
    std::mem::discriminant(message).hash(&mut hasher);
    message.id().hash(&mut hasher);
    fn error(error: &SessionStructuredError) -> (&str, &str) {
        (&error.r#type, &error.message)
    }
    match message {
        SessionMessageInfo::Assistant(assistant) => {
            let (mut texts, mut reasonings) = (0usize, 0usize);
            for item in &assistant.content {
                match item {
                    SessionMessageAssistantContentItem::Text(text) => {
                        texts += 1;
                        if !text.text.trim().is_empty() {
                            (0u8, texts).hash(&mut hasher);
                        }
                    }
                    SessionMessageAssistantContentItem::Reasoning(reasoning) => {
                        reasonings += 1;
                        if !reasoning.text.trim().is_empty() {
                            let done = reasoning.time.as_ref().is_some_and(|time| time.completed.is_some());
                            (1u8, reasonings, done).hash(&mut hasher);
                        }
                    }
                    SessionMessageAssistantContentItem::Tool(tool) => (2u8, &tool.id, &tool.name).hash(&mut hasher),
                    SessionMessageAssistantContentItem::Unknown(_) => {}
                }
            }
            (terminal(assistant), assistant.retry.is_some(), assistant.error.as_ref().map(error)).hash(&mut hasher);
        }
        SessionMessageInfo::Idle(idle) => idle.error.as_ref().map(error).hash(&mut hasher),
        SessionMessageInfo::Synthetic(synthetic) => {
            synthetic.description.as_deref().is_none_or(|text| text.trim().is_empty()).hash(&mut hasher);
            grouping::instruction_paths(Some(message)).hash(&mut hasher);
        }
        SessionMessageInfo::Compaction(compaction) => {
            std::mem::discriminant(compaction).hash(&mut hasher);
            if let SessionMessageCompaction::Failed(failed) = compaction {
                error(&failed.error).hash(&mut hasher);
            }
        }
        _ => {}
    }
    hasher.finish()
}

fn terminal(assistant: &SessionMessageAssistant) -> bool {
    assistant.finish.as_ref().is_some_and(|finish| {
        !matches!(finish, SessionMessageAssistantFinish::ToolCalls | SessionMessageAssistantFinish::Unknown2)
    }) || assistant.error.is_some()
}

/// What rows read while they render.
pub struct Context<'a> {
    /// Rows render under `tui.data.read`; a nested read reuses its guard, and a store write from a row panics.
    pub tui: &'a Tui,
    /// The store, locked while rows render.
    pub state: &'a State,
    pub keys: &'a Keys,
    pub session: &'a SessionID,
    pub app: &'a App,
    pub theme: &'a Theme,
    pub syntax: &'a Arc<SyntaxTheme>,
    /// Syntax theme for reasoning text, with all tokens muted.
    pub thinking_syntax: &'a Arc<SyntaxTheme>,
    /// The categorical colors agents take by position.
    pub palette: &'a [Color],
    pub renderers: &'a CodeBlockRenderers,
    pub claims: &'a ToolClaims,
    pub events: Events,
    pub conceal: bool,
    /// `session.thinking` is `hide`.
    pub hide_thinking: bool,
    pub groups: &'a Rc<grouping::Settings>,
    pub toggles: &'a Toggles,
    pub tps: bool,
    /// `debug.turn_tokens` is `verbose`.
    pub verbose_tokens: bool,
    pub image_preview: bool,
    pub directory: Option<&'a str>,
    pub mode: ThemeMode,
    pub width: u16,
    /// The session pane's width less its padding (`contentWidth`).
    pub content: u16,
    pub session_agent: Option<&'a str>,
    /// The location's agents, hidden ones included.
    pub agents: &'a [AgentInfo],
    pub models: &'a [ModelInfo],
    /// The visible messages, oldest first.
    pub lookup: Messages<'a>,
    pub legacy: bool,
    /// Active Find state when Find is open with a query; `None` while closed.
    pub find: Option<&'a FindSnapshot>,
}

impl Context<'_> {
    pub fn content_width(&self) -> usize {
        usize::from(self.content)
    }

    pub fn message(&self, key: MessageKey) -> Option<&SessionMessageInfo> {
        self.lookup.get(key)
    }

    pub fn assistant(&self, key: MessageKey) -> Option<&SessionMessageAssistant> {
        self.lookup.assistant(key)
    }

    /// `local.agent.color`: the agent's own color, else the categorical color at its position among
    /// the visible agents; an agent the location does not list takes the first.
    pub fn agent_color(&self, agent: &str) -> Color {
        let mut visible = self.agents.iter().filter(|item| !item.hidden).enumerate();
        let Some((index, item)) = visible.find(|(_, item)| item.id.as_str() == agent) else { return self.palette[0] };
        let own = item.color.as_ref().and_then(|color| Color::parse(color.as_str()));
        own.unwrap_or(self.palette[index % self.palette.len()])
    }

    pub fn model_name(&self, model: &ModelRef) -> String {
        self.models
            .iter()
            .find(|item| item.provider_id == model.provider_id && item.id == model.id)
            .map_or_else(|| format!("{}/{}", model.provider_id.as_str(), model.id), |item| item.name.clone())
    }
}

/// A part of an assistant message: a text or a reasoning by its ordinal among its kind, a tool by its place in the
/// content.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    Text(usize),
    Reasoning(usize),
    Tool(usize),
}

impl Part {
    pub fn resolve<'a>(&self, message: &'a SessionMessageAssistant) -> Option<&'a SessionMessageAssistantContentItem> {
        let (want_text, ordinal) = match self {
            Self::Tool(index) => {
                return message
                    .content
                    .get(*index)
                    .filter(|item| matches!(item, SessionMessageAssistantContentItem::Tool(_)));
            }
            Self::Text(ordinal) => (true, *ordinal),
            Self::Reasoning(ordinal) => (false, *ordinal),
        };
        message
            .content
            .iter()
            .filter(|item| match item {
                SessionMessageAssistantContentItem::Text(_) => want_text,
                SessionMessageAssistantContentItem::Reasoning(_) => !want_text,
                _ => false,
            })
            .nth(ordinal)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Spec {
    Message(MessageKey),
    Part {
        message: MessageKey,
        part: Part,
    },
    Footer(MessageKey),
    TurnUsage {
        messages: Vec<MessageKey>,
        previous: Option<footer::CacheUsage>,
    },
    Group(grouping::Group),
    /// A compaction waiting in the inbox, by inbox ID.
    CompactionQueued(String),
}

/// Which row a widget shows: the same key keeps the widget.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RowKey {
    Message(MessageKey),
    Part(MessageKey, Part),
    Footer(MessageKey),
    TurnUsage(MessageKey),
    Group(grouping::GroupId),
    /// A queued compaction, by a hash of its inbox ID.
    CompactionQueued(u64),
}

impl RowKey {
    /// The message the row shows, or starts with.
    fn message(self) -> Option<MessageKey> {
        match self {
            Self::Message(key) | Self::Part(key, _) | Self::Footer(key) | Self::TurnUsage(key) => Some(key),
            Self::Group(id) => Some(id.message),
            Self::CompactionQueued(_) => None,
        }
    }

    /// The same row of the message `key`.
    fn with(self, key: MessageKey) -> Self {
        match self {
            Self::Message(_) => Self::Message(key),
            Self::Part(_, part) => Self::Part(key, part),
            Self::Footer(_) => Self::Footer(key),
            Self::TurnUsage(_) => Self::TurnUsage(key),
            Self::Group(id) => Self::Group(grouping::GroupId { message: key, ..id }),
            Self::CompactionQueued(_) => self,
        }
    }
}

impl Spec {
    fn key(&self) -> RowKey {
        match self {
            Self::Message(key) => RowKey::Message(*key),
            Self::Part { message, part } => RowKey::Part(*message, *part),
            Self::Footer(key) => RowKey::Footer(*key),
            Self::TurnUsage { messages, .. } => RowKey::TurnUsage(messages.first().copied().unwrap_or(NO_MESSAGE)),
            Self::Group(group) => RowKey::Group(group.id(0).unwrap_or(grouping::GroupId {
                message: NO_MESSAGE,
                part: None,
                kind: group.kind,
                level: 0,
            })),
            Self::CompactionQueued(id) => {
                let mut hasher = DefaultHasher::new();
                id.hash(&mut hasher);
                RowKey::CompactionQueued(hasher.finish())
            }
        }
    }

    /// The messages whose change re-renders the row: a turn's usage follows its last step, and a
    /// group every row in it.
    fn messages(&self, each: &mut dyn FnMut(MessageKey)) {
        match self {
            Self::Message(key) | Self::Footer(key) | Self::Part { message: key, .. } => each(*key),
            Self::TurnUsage { messages, .. } => messages.last().copied().into_iter().for_each(each),
            Self::Group(group) => group.each_entry(&mut |spec| spec.messages(each)),
            // No message: it changes with every row.
            Self::CompactionQueued(_) => each(NO_MESSAGE),
        }
    }
}

/// The key of no message, for a row that has none.
pub const NO_MESSAGE: MessageKey = MessageKey(u32::MAX);

/// `reduceSessionRows` without grouping and pending inputs.
pub fn reduce(messages: Messages<'_>, turn_tokens: bool) -> Vec<Spec> {
    let legacy = legacy(messages.visible);
    let mut rows = Vec::new();
    let mut steps: Vec<(&SessionMessageAssistant, MessageKey)> = Vec::new();
    let mut previous_turn: Option<footer::CacheUsage> = None;
    let flush = |rows: &mut Vec<Spec>,
                 steps: &mut Vec<(&SessionMessageAssistant, MessageKey)>,
                 previous_turn: &mut Option<footer::CacheUsage>| {
        if !turn_tokens {
            return;
        }
        let used: Vec<_> = steps.drain(..).filter(|(step, _)| footer::total(step) > 0.0).collect();
        let Some((last, _)) = used.last() else { return };
        rows.push(Spec::TurnUsage {
            messages: used.iter().map(|(_, key)| *key).collect(),
            previous: previous_turn.clone(),
        });
        *previous_turn = Some(footer::CacheUsage::of(last));
    };
    // An execution failure that repeats the error of the turn's last step or compaction is
    // already on screen.
    let mut shown_error: Option<(String, String)> = None;
    for (position, message) in compaction::running_last(messages.visible) {
        let key = messages.key_at(position);
        let assistant = match message {
            SessionMessageInfo::Assistant(assistant) => assistant,
            SessionMessageInfo::Idle(idle) => {
                if let Some(error) = &idle.error
                    && shown_error.as_ref() != Some(&(error.r#type.clone(), error.message.clone()))
                {
                    rows.push(Spec::Message(key));
                }
                shown_error = None;
                flush(&mut rows, &mut steps, &mut previous_turn);
                continue;
            }
            SessionMessageInfo::Synthetic(synthetic)
                if synthetic.description.as_deref().is_none_or(|text| text.trim().is_empty()) =>
            {
                continue;
            }
            SessionMessageInfo::Compaction(compaction) => {
                match compaction {
                    SessionMessageCompaction::Failed(failed) => {
                        shown_error = Some((failed.error.r#type.clone(), failed.error.message.clone()))
                    }
                    SessionMessageCompaction::Completed(_) => {
                        shown_error = None;
                        previous_turn = None;
                    }
                    _ => {}
                }
                rows.push(Spec::Message(key));
                continue;
            }
            SessionMessageInfo::Unknown(_) => continue,
            _ => {
                rows.push(Spec::Message(key));
                continue;
            }
        };
        steps.push((assistant, key));
        shown_error = assistant.error.as_ref().map(|error| (error.r#type.clone(), error.message.clone()));
        let (mut texts, mut reasonings) = (0, 0);
        for (index, item) in assistant.content.iter().enumerate() {
            let part = match item {
                SessionMessageAssistantContentItem::Text(text) => {
                    texts += 1;
                    if text.text.trim().is_empty() {
                        continue;
                    }
                    Part::Text(texts - 1)
                }
                SessionMessageAssistantContentItem::Reasoning(reasoning) => {
                    reasonings += 1;
                    if reasoning.text.trim().is_empty() {
                        continue;
                    }
                    Part::Reasoning(reasonings - 1)
                }
                SessionMessageAssistantContentItem::Tool(_) => Part::Tool(index),
                SessionMessageAssistantContentItem::Unknown(_) => continue,
            };
            rows.push(Spec::Part { message: key, part });
        }
        let terminal = terminal(assistant);
        if terminal || assistant.retry.is_some() {
            rows.push(Spec::Footer(key));
        }
        if terminal && legacy {
            flush(&mut rows, &mut steps, &mut previous_turn);
        }
    }
    rows
}

pub fn legacy(messages: &[SessionMessageInfo]) -> bool {
    !messages.iter().any(|message| matches!(message, SessionMessageInfo::Idle(_)))
}

/// A row's wrapper (`SessionRowView`: one blank line above) and its content. Groups mount their
/// children as rows too, without the blank line.
pub(crate) struct Row {
    pub(crate) wrapper: View,
    body: Body,
}

enum Body {
    Group(grouping::GroupView),
    User(user::User),
    Text(assistant::TextPart),
    Reasoning(reasoning::Reasoning),
    Tool(tools::dispatch::Tool),
    Footer(footer::Footer),
    Usage(footer::TurnUsage),
    Notice(skill::Notice),
    Shell(shell::Shell),
    Compaction(compaction::Compaction),
    Queued(compaction::Queued),
    Error(errors::ExecutionError),
}

impl Row {
    pub(crate) fn new(cx: &Context<'_>, spec: &Spec) -> Self {
        let wrapper = View::new(cx.app).column().shrink(0.0).margin_edge(Edge::Top, 1);
        let body = Body::new(cx, spec);
        wrapper.add(body.root());
        Self { wrapper, body }
    }

    fn restyle(&self, cx: &Context<'_>, spec: &Spec) {
        self.restyle_body(cx);
        self.update(cx, spec);
    }

    /// [`Self::restyle`] without the update that paints what the body left to it; a group updates its rows itself.
    pub(crate) fn restyle_body(&self, cx: &Context<'_>) {
        match &self.body {
            Body::Group(view) => view.restyle(cx),
            Body::User(view) => view.restyle(cx),
            Body::Text(view) => view.restyle(cx),
            Body::Reasoning(view) => view.restyle(cx),
            Body::Tool(view) => view.restyle(cx),
            Body::Footer(view) => view.restyle(cx),
            Body::Usage(view) => view.restyle(),
            Body::Notice(view) => view.restyle(),
            Body::Shell(view) => view.restyle(),
            Body::Compaction(view) => view.restyle(cx),
            Body::Queued(view) => view.restyle(cx),
            Body::Error(view) => view.restyle(cx),
        }
    }

    pub(crate) fn update(&self, cx: &Context<'_>, spec: &Spec) {
        match (&self.body, spec) {
            (Body::Group(view), Spec::Group(group)) => view.update(cx, group, group.completed),
            (Body::User(view), Spec::Message(id)) => {
                if let Some(SessionMessageInfo::User(message)) = cx.message(*id) {
                    view.update(cx, message);
                }
            }
            (Body::Notice(view), Spec::Message(id)) => {
                if let Some(message) = cx.message(*id) {
                    view.update(cx, message);
                }
            }
            (Body::Shell(view), Spec::Message(id)) => {
                if let Some(SessionMessageInfo::Shell(message)) = cx.message(*id) {
                    view.update(cx, message);
                }
            }
            (Body::Compaction(view), Spec::Message(id)) => {
                if let Some(info @ SessionMessageInfo::Compaction(message)) = cx.message(*id) {
                    view.update(cx, info.id(), message);
                }
            }
            (Body::Error(view), Spec::Message(id)) => {
                if let Some(message) = cx.message(*id) {
                    view.update(message);
                }
            }
            (Body::Text(view), Spec::Part { message, part }) => {
                if let Part::Text(ordinal) = *part
                    && let Some(assistant) = cx.assistant(*message)
                    && let Some(SessionMessageAssistantContentItem::Text(text)) = part.resolve(assistant)
                {
                    view.update(cx, assistant, ordinal, text);
                }
            }
            (Body::Reasoning(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(*message)
                    && let Some(SessionMessageAssistantContentItem::Reasoning(reasoning)) = part.resolve(assistant)
                {
                    view.update(cx, assistant, reasoning);
                }
            }
            (Body::Tool(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(*message)
                    && let Some(SessionMessageAssistantContentItem::Tool(tool)) = part.resolve(assistant)
                {
                    view.update(cx, assistant, tool);
                }
            }
            (Body::Footer(view), Spec::Footer(id)) => {
                if let Some(assistant) = cx.assistant(*id) {
                    view.update(cx, assistant);
                }
            }
            (Body::Usage(view), Spec::TurnUsage { messages, previous }) => {
                view.update(cx, messages, previous.as_ref());
            }
            _ => {}
        }
    }

    pub(crate) fn update_find(&self, cx: &Context<'_>, spec: &Spec) {
        match (&self.body, spec) {
            (Body::User(view), Spec::Message(id)) => {
                if let Some(SessionMessageInfo::User(message)) = cx.message(*id) {
                    view.update_find(cx, message);
                }
            }
            (Body::Compaction(view), Spec::Message(id)) => {
                if let Some(info @ SessionMessageInfo::Compaction(_)) = cx.message(*id) {
                    view.update_find(cx, info.id());
                }
            }
            (Body::Text(view), Spec::Part { message, part }) => {
                if let Part::Text(ordinal) = *part
                    && let Some(assistant) = cx.assistant(*message)
                    && let Some(SessionMessageAssistantContentItem::Text(text)) = part.resolve(assistant)
                {
                    view.update_find(cx, assistant, ordinal, text);
                }
            }
            _ => {}
        }
    }
}

impl Body {
    fn new(cx: &Context<'_>, spec: &Spec) -> Self {
        match spec {
            Spec::Message(id) => match cx.message(*id) {
                Some(SessionMessageInfo::User(_)) => Body::User(user::User::new(cx)),
                Some(SessionMessageInfo::Shell(_)) => Body::Shell(shell::Shell::new(cx)),
                Some(SessionMessageInfo::Compaction(_)) => Body::Compaction(compaction::Compaction::new(cx)),
                Some(SessionMessageInfo::Idle(_)) => Body::Error(errors::ExecutionError::new(cx)),
                _ => Body::Notice(skill::Notice::new(cx)),
            },
            Spec::CompactionQueued(_) => Body::Queued(compaction::Queued::new(cx)),
            Spec::Part { part, .. } => match part {
                Part::Text(_) => Body::Text(assistant::TextPart::new(cx)),
                Part::Reasoning(_) => Body::Reasoning(reasoning::Reasoning::new(cx)),
                Part::Tool(_) => Body::Tool(tools::dispatch::Tool::new(cx)),
            },
            Spec::Footer(_) => Body::Footer(footer::Footer::new(cx)),
            Spec::TurnUsage { .. } => Body::Usage(footer::TurnUsage::new(cx)),
            Spec::Group(_) => Body::Group(grouping::GroupView::new(cx, 0)),
        }
    }

    fn root(&self) -> &View {
        match self {
            Body::Group(view) => view.root(),
            Body::User(view) => view.root(),
            Body::Text(view) => view.root(),
            Body::Reasoning(view) => view.root(),
            Body::Tool(view) => view.root(),
            Body::Footer(view) => view.root(),
            Body::Usage(view) => view.root(),
            Body::Notice(view) => view.root(),
            Body::Shell(view) => view.root(),
            Body::Compaction(view) => view.root(),
            Body::Queued(view) => view.root(),
            Body::Error(view) => view.root(),
        }
    }
}

fn thinking_syntax(syntax: &SyntaxTheme, foreground: Color) -> SyntaxTheme {
    let mut thinking = SyntaxTheme::new();
    for name in syntax.names() {
        if let Some(style) = syntax.get(name) {
            thinking.set(name, style.fg(foreground));
        }
    }
    thinking
}

/// Whether a row of `messages` reads the shells the store lists: a shell's, or a shell tool's.
fn reads_shells(messages: &[SessionMessageInfo]) -> bool {
    messages.iter().any(|message| match message {
        SessionMessageInfo::Shell(_) => true,
        SessionMessageInfo::Assistant(assistant) => assistant.content.iter().any(|item| {
            matches!(item, SessionMessageAssistantContentItem::Tool(tool) if ToolKind::of(&tool.name) == ToolKind::Shell)
        }),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn messages(value: serde_json::Value) -> Vec<SessionMessageInfo> {
        serde_json::from_value(value).unwrap()
    }

    fn assistant(id: &str, content: serde_json::Value, finish: Option<&str>) -> serde_json::Value {
        let mut message = json!({
            "id": id, "type": "assistant", "agent": "build",
            "model": { "providerID": "p", "id": "m" }, "time": { "created": 1 }, "content": content,
        });
        if let Some(finish) = finish {
            message["finish"] = json!(finish);
            message["tokens"] = json!({ "input": 1, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
        }
        message
    }

    #[test]
    fn reduce_splits_assistants_into_parts_and_footers() {
        let list = messages(json!([
            { "id": "msg_1", "type": "user", "text": "hi", "time": { "created": 1 } },
            assistant("msg_2", json!([
                { "type": "reasoning", "text": "  " },
                { "type": "reasoning", "text": "think" },
                { "type": "text", "text": "a" },
                { "type": "tool", "id": "call_1", "name": "read", "state": { "status": "streaming", "input": "" }, "time": { "created": 1 } },
            ]), Some("tool-calls")),
            assistant("msg_3", json!([{ "type": "text", "text": "done" }]), Some("stop")),
            { "id": "msg_4", "type": "synthetic", "text": "hidden", "time": { "created": 1 } },
        ]));
        // Messages outside the store are keyed by their positions.
        let part = |message, part| Spec::Part { message: MessageKey(message), part };
        assert_eq!(
            reduce(Messages::of(&list), false),
            vec![
                Spec::Message(MessageKey(0)),
                part(1, Part::Reasoning(1)),
                part(1, Part::Text(0)),
                part(1, Part::Tool(3)),
                part(2, Part::Text(0)),
                Spec::Footer(MessageKey(2)),
            ]
        );
        let usage = reduce(Messages::of(&list), true);
        assert_eq!(
            usage.last(),
            Some(&Spec::TurnUsage { messages: vec![MessageKey(1), MessageKey(2)], previous: None })
        );
    }

    #[test]
    fn a_shape_changes_with_the_rows_and_not_with_streamed_content() {
        let streaming = assistant(
            "msg_1",
            json!([
                { "type": "reasoning", "text": "think", "time": { "created": 1 } },
                { "type": "text", "text": "a" },
                { "type": "tool", "id": "call_1", "name": "read", "state": { "status": "streaming", "input": "" }, "time": { "created": 1 } },
            ]),
            None,
        );
        let base = shape(&messages(json!([streaming.clone()]))[0]);
        let edit = |change: &dyn Fn(&mut serde_json::Value)| {
            let mut message = streaming.clone();
            change(&mut message);
            shape(&messages(json!([message]))[0])
        };
        assert_eq!(edit(&|m| m["content"][1]["text"] = json!("a longer answer")), base);
        assert_eq!(edit(&|m| m["content"][0]["text"] = json!("thinking more")), base);
        assert_eq!(
            edit(&|m| m["content"][2]["state"] = json!({ "status": "running", "input": {}, "metadata": {} })),
            base
        );
        assert_eq!(edit(&|m| m["content"].as_array_mut().unwrap().push(json!({ "type": "text", "text": "" }))), base);
        let changes: [&dyn Fn(&mut serde_json::Value); 8] = [
            &|m| m["content"][1]["text"] = json!("  "),
            // An empty text before the answer moves its ordinal.
            &|m| m["content"].as_array_mut().unwrap().insert(0, json!({ "type": "text", "text": "" })),
            &|m| m["content"][0]["time"]["completed"] = json!(2),
            &|m| m["content"][2]["name"] = json!("shell"),
            &|m| m["content"].as_array_mut().unwrap().insert(0, json!({ "type": "text", "text": "b" })),
            &|m| m["finish"] = json!("stop"),
            &|m| m["error"] = json!({ "type": "provider", "message": "boom" }),
            &|m| m["retry"] = json!({ "attempt": 1, "at": 2, "error": { "type": "provider", "message": "busy" } }),
        ];
        for change in changes {
            assert_ne!(edit(change), base);
        }
    }

    #[test]
    fn the_window_follows_the_tail_until_pinned() {
        let specs: Vec<Spec> = (0..100).map(|index| Spec::Message(MessageKey(index))).collect();
        let weights = vec![1; 100];
        assert_eq!(window_start(&Start::Tail, &specs, &weights), 100 - TAIL_ROWS);
        assert_eq!(window_start(&Start::Top, &specs, &weights), 0);
        let pinned = Start::Row(RowKey::Message(MessageKey(10)));
        assert_eq!(window_start(&pinned, &specs, &weights), 10);
        // A pinned row inside the tail still mounts the whole tail; a vanished one falls back.
        let late = Start::Row(RowKey::Message(MessageKey(90)));
        assert_eq!(window_start(&late, &specs, &weights), 100 - TAIL_ROWS);
        let gone = Start::Row(RowKey::Message(MessageKey(1000)));
        assert_eq!(window_start(&gone, &specs, &weights), 100 - TAIL_ROWS);
        assert_eq!(window_start(&Start::Tail, &specs[..5], &weights[..5]), 0);
        let mut heavy = weights.clone();
        heavy[95] = 10;
        assert_eq!(window_start(&Start::Tail, &specs, &heavy), 100 - TAIL_ROWS + 9);
    }
}
