//! Window the transcript from the tail. A store update refreshes the rows owned by changed messages; scrolling toward
//! the head loads older pages.

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};

use opencode_api::generated::{
    AgentInfo, ModelInfo, ModelRef, SessionInboxInfo, SessionInfo, SessionMessageAssistant,
    SessionMessageAssistantContentItem, SessionMessageAssistantFinish, SessionMessageCompaction, SessionMessageID,
    SessionStructuredError,
};
use opencode_local::cli_config::{Markdown as MarkdownMode, Resolved, TurnTokens, Visibility};
use opencode_plugin::claim::ToolClaims;
use opencode_store::location::{Catalog, Location};
use opencode_store::{LoadMore, State};
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::ThemeMode;
use opentui::input::MouseEventKind;
use opentui::syntax::SyntaxTheme;
use opentui::widget::ScrollEdge;

use super::super::tools;
use super::{assistant, background, compaction, errors, footer, reasoning, revert, shell, skill, user};
use crate::prelude::*;
use crate::routes::session::grouping;

pub const TAIL_ROWS: usize = 40;
pub const BACKFILL_CHUNK: usize = 60;

#[derive(Clone)]
pub struct Transcript(Rc<Inner>);

#[derive(Clone, Debug, PartialEq)]
pub struct ScrollAnchor {
    pub row: RowKey,
    pub screen_y: f64,
}

#[derive(Clone, Copy, PartialEq)]
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
    paint: RefCell<Rc<Paint>>,
    renderers: CodeBlockRenderers,
    claims: ToolClaims,
    /// Renders a message's rows again, after a claim's view at a paint changed which row shows one of its parts.
    switched: Rc<dyn Fn(&str)>,
    /// Keeps the reader's rows in place after a claimed row above them changed height.
    reflowed: Rc<dyn Fn(f64, f32)>,
    view: Cell<RowSettings>,
    groups: Rc<grouping::Settings>,
    session: RefCell<Option<SessionID>>,
    location: RefCell<Option<Location>>,
    specs: RefCell<Vec<Spec>>,
    weights: RefCell<Vec<usize>>,
    /// Each visible message's position at the last render (`Context::index`).
    positions: RefCell<HashMap<String, usize>>,
    /// Each visible message's [`shape`] at the last render, by position.
    shapes: RefCell<Vec<u64>>,
    /// The visible messages have no idle marker (`legacy`), at the last render.
    legacy: Cell<bool>,
    rows: RefCell<HashMap<RowKey, Row>>,
    /// The keys of the scroll box's children, in order.
    mounted: RefCell<Vec<RowKey>>,
    refs: RefCell<HashMap<String, Vec<usize>>>,
    start: RefCell<Start>,
    /// Where the mounted window ends, by row index, when it stops before the newest row
    /// (`visibleRowsEnd`): `session.first` mounts the head only.
    end: Cell<Option<usize>>,
    /// Set when rows mount above the window or the terminal resizes, so the reader's rows stay in place.
    pin: RefCell<Option<Pin>>,
    /// The terminal resize handler, which pins the reader's row before the layout.
    resize: Cell<Option<HandlerId>>,
    loading: Cell<bool>,
    /// Message count at the last group-boundary page request.
    boundary: Cell<Option<usize>>,
    layer: RefCell<Option<Disposer>>,
    /// The settings listener, until the transcript drops.
    settings: RefCell<Option<Disposer>>,
    width: Cell<Option<u16>>,
    /// Plugin viewport published for the lifetime of the transcript.
    published: RefCell<Option<opencode_plugin::behave::Publication>>,
    specs_revision: Cell<u64>,
    /// Number of preceding messages at this window start and revision.
    above: RefCell<Option<(u64, Start, u32)>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(tui) = self.tui.upgrade() {
            dispose(&tui, self.layer.take());
            if let Some(id) = self.resize.take() {
                tui.app.remove_handler(id);
            }
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

struct Paint {
    theme: Theme,
    syntax: SyntaxTheme,
    thinking_syntax: SyntaxTheme,
}

impl Paint {
    fn new(theme: Theme) -> Self {
        let syntax = opencode_ui::code::syntax_theme(&theme);
        Self { thinking_syntax: thinking_syntax(&syntax, theme.text.muted), syntax, theme }
    }
}

/// The content height before rows mounted above, and the frame it is from. A terminal resize away from the bottom
/// pins the reader's row instead (`ScrollBox.anchor`): through the resize's layout and the rebuild's after it, a row
/// above it that rewraps scrolls the view by as much. A row taller than the view keeps its top; its own content may
/// still move as it rewraps.
struct Pin {
    height: f32,
    frame: u64,
    /// The mounted rows above the reader's, while a resize holds it.
    above: Option<HashSet<RowKey>>,
}

impl Pin {
    /// Whether the frames that lay out the change are still to come or running.
    fn live(&self, frame: u64) -> bool {
        frame <= self.frame + if self.above.is_some() { 2 } else { 1 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Start {
    /// The newest [`TAIL_ROWS`], following appends while the reader stays at the bottom.
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
            paint: RefCell::new(Rc::new(Paint::new(theme))),
            renderers: crate::plugins::host::code_blocks(tui),
            claims: crate::plugins::host::tool_claims(tui),
            switched: {
                let weak = this.clone();
                Rc::new(move |message: &str| {
                    if let Some(inner) = weak.upgrade()
                        && let Some(tui) = inner.tui.upgrade()
                    {
                        inner.render(&tui, |shown| shown == message);
                    }
                })
            },
            reflowed: {
                let weak = this.clone();
                Rc::new(move |top: f64, grown: f32| {
                    let Some(inner) = weak.upgrade() else { return };
                    // At the tail the transcript follows the bottom; away from it, a row above the reader's that
                    // grows or shrinks would move the rows below it on screen (`pinAbove` for a change in place).
                    // A resize's pin already holds the reader's row.
                    if *inner.start.borrow() != Start::Tail
                        && top < inner.scroll.rect().screen_y
                        && !inner.pinned(|pin| pin.above.is_some())
                    {
                        inner.scroll.scroll_by(0.0, f64::from(grown));
                    }
                })
            },
            view: Cell::new(RowSettings::read(&tui.config())),
            groups: grouping::Settings::new(&tui.settings.info()),
            session: RefCell::default(),
            location: RefCell::default(),
            specs: RefCell::default(),
            weights: RefCell::default(),
            positions: RefCell::default(),
            shapes: RefCell::default(),
            legacy: Cell::new(true),
            rows: RefCell::default(),
            mounted: RefCell::default(),
            refs: RefCell::default(),
            start: RefCell::new(Start::Tail),
            end: Cell::new(None),
            pin: RefCell::default(),
            resize: Cell::new(None),
            loading: Cell::new(false),
            boundary: Cell::new(None),
            layer: RefCell::default(),
            settings: RefCell::default(),
            width: Cell::new(None),
            published: RefCell::default(),
            specs_revision: Cell::new(0),
            above: RefCell::default(),
        });
        inner.install(tui);
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn sync(&self, tui: &Tui, session: &SessionID, changes: &Changes) {
        if self.0.session.replace(Some(session.clone())).as_ref() != Some(session) {
            *self.0.groups.expanded.borrow_mut() = tui.tabs.expanded_groups(&session.0);
        }
        let location = self.0.location(tui);
        let catalogs = location.as_ref().is_some_and(|location| changes.location(location));
        let pending = changes.pending(session);
        // A tool row waiting on a permission request takes the warning color.
        let permissions = changes.permissions(session);
        // A subagent row spins while its child session runs.
        let children = !changes.status.is_empty()
            && tui.data.read(|state| state.family(session).iter().any(|id| id != session && changes.status(id)));
        let force =
            changes.messages(session) || changes.session(session) || catalogs || pending || permissions || children;
        if !force && !changes.any_message(session) {
            return;
        }
        if !force
            && let Some(messages) = changes.message.get(session)
            && self.0.patch(tui, session, messages)
        {
            return;
        }
        self.0.render(tui, |message| force || changes.message(session, message));
    }

    pub fn reveal_older(&self, tui: &Tui) -> bool {
        self.0.reveal_older(tui)
    }

    pub fn publish(&self, tui: &Tui, scroll: Rc<dyn Fn(&opencode_plugin::abi::v2::Scroll)>) {
        self.0.publish(tui, scroll);
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
        self.0.session.borrow().clone()
    }

    pub fn groups(&self) -> &Rc<grouping::Settings> {
        &self.0.groups
    }

    pub fn restyle(&self, tui: &Tui) {
        self.0.restyle(tui);
    }

    /// Re-renders every row, after a grouping setting changed.
    pub fn refresh(&self, tui: &Tui) {
        self.0.render(tui, |_| true);
    }

    /// Pins or follows the window after the view moved (`updateAwayFromBottom`).
    pub fn follow(&self, tui: &Tui, down: bool) {
        self.0.follow(tui, down);
    }

    pub fn mount_all(&self, tui: &Tui) {
        if *self.0.start.borrow() == Start::Top && self.0.end.get().is_none() {
            return;
        }
        *self.0.start.borrow_mut() = Start::Top;
        self.0.end.set(None);
        self.0.render(tui, |_| false);
    }

    /// Mounts the oldest [`BACKFILL_CHUNK`] rows only, after `session.first` loaded the history; newer
    /// rows mount as the reader scrolls down.
    pub fn mount_head(&self, tui: &Tui) {
        *self.0.start.borrow_mut() = Start::Top;
        self.0.end.set(Some(BACKFILL_CHUNK));
        self.0.render(tui, |_| false);
        if self.0.specs.borrow().len() <= BACKFILL_CHUNK {
            self.0.end.set(None);
        }
    }

    pub fn to_tail(&self, tui: &Tui) {
        *self.0.start.borrow_mut() = Start::Tail;
        self.0.end.set(None);
        self.0.render(tui, |_| false);
        self.0.scroll.sticky(true);
        self.0.scroll.scroll_to_bottom();
    }

    pub fn all_mounted(&self) -> bool {
        self.0.window_start(&self.0.specs.borrow()) == 0 && self.at_end()
    }

    pub fn at_end(&self) -> bool {
        self.0.at_end()
    }

    pub fn reveal_newer(&self, tui: &Tui) -> bool {
        self.0.reveal_newer(tui)
    }

    /// Mounted rows with their message and content y, top to bottom (`anchors.messagePositions`
    /// before the per-message dedupe). Footers and token usage do not anchor.
    pub fn anchors(&self) -> Vec<(String, f64)> {
        let mut out = Vec::new();
        let rows = self.0.rows.borrow();
        for key in self.0.mounted.borrow().iter() {
            let row = &rows[key];
            match (key, &row.body) {
                (_, Body::Group(group)) => group.anchors(&mut out),
                (RowKey::Message(id) | RowKey::Part(id, _), _) => out.push((id.clone(), row.wrapper.rect().screen_y)),
                _ => {}
            }
        }
        let origin = self.0.scroll.content_view().rect().screen_y;
        out.iter_mut().for_each(|(_, y)| *y -= origin);
        out.sort_by(|a, b| a.1.total_cmp(&b.1));
        out
    }

    /// The row `saveScrollAnchor` keeps: the lowest one that starts at or above the view's top, or one
    /// row below it for a reply part or a group, else the first mounted row. Footers and token usage do not
    /// anchor.
    pub fn anchor(&self) -> Option<ScrollAnchor> {
        self.0.anchor()
    }

    pub fn row_y(&self, key: &RowKey) -> Option<f64> {
        self.0.row_y(key)
    }

    /// Mounts [`BACKFILL_CHUNK`] rows on each side of `key` (`restoreScrollPosition`). Returns whether
    /// the row exists.
    pub fn mount_around(&self, tui: &Tui, key: &RowKey) -> bool {
        // Use the store's rows even if the next sync has yet to paint them.
        self.0.render(tui, |_| false);
        let window = {
            let specs = self.0.specs.borrow();
            let weights = self.0.weights.borrow();
            specs.iter().position(|spec| spec.key() == *key).map(|index| {
                let start = grouping::rows_before(&weights, index, BACKFILL_CHUNK);
                let end = grouping::rows_after(&weights, index, BACKFILL_CHUNK);
                let start = if start == 0 { Start::Top } else { Start::Row(specs[start].key()) };
                (start, (end < specs.len()).then_some(end))
            })
        };
        let Some((start, end)) = window else { return false };
        *self.0.start.borrow_mut() = start;
        self.0.end.set(end);
        self.0.render(tui, |_| false);
        true
    }

    pub fn mount_newer(&self, tui: &Tui) -> bool {
        let Some(end) = self.0.end.get() else { return false };
        self.0.mount_newer(tui, end);
        true
    }

    /// Loads every older page in one publication (`session.first`). The window stays until `done`
    /// mounts the head; a failure reaches it as the error's message alone (`toast.error`).
    pub fn load_all(&self, tui: &Tui, done: impl FnOnce(&Tui, Result<(), String>) + 'static) {
        let Some(session) = self.session() else { return };
        let data = tui.data.clone();
        tui.app.spawn(
            async move { data.message_load_more(&session, LoadMore { all: true, ..LoadMore::default() }).await },
            bind!(self.0.this, |inner, _, result| {
                let Some(tui) = inner.tui.upgrade() else { return };
                done(&tui, result.map_err(|error| error.tui_message()));
            }),
        );
    }
}

impl Inner {
    fn anchor(&self) -> Option<ScrollAnchor> {
        let (_, top) = self.scroll.scroll_position();
        let mut first = None;
        let mut anchor: Option<ScrollAnchor> = None;
        for key in self.mounted.borrow().iter() {
            let inset = match key {
                RowKey::Message(_) => 0.0,
                RowKey::Part(..) | RowKey::Group(_) => 1.0,
                _ => continue,
            };
            let Some(y) = self.row_y(key) else { continue };
            let item = ScrollAnchor { row: key.clone(), screen_y: y - top };
            if item.screen_y <= inset && anchor.as_ref().is_none_or(|anchor| item.screen_y > anchor.screen_y) {
                anchor = Some(item.clone());
            }
            first.get_or_insert(item);
        }
        anchor.or(first)
    }

    fn row_y(&self, key: &RowKey) -> Option<f64> {
        if !self.mounted.borrow().contains(key) {
            return None;
        }
        let rect = self.rows.borrow().get(key)?.wrapper.rect();
        (rect.height > 0.0).then(|| rect.screen_y - self.scroll.content_view().rect().screen_y)
    }

    /// Whether a live [`Pin`] holds the view and matches `matches`.
    fn pinned(&self, matches: impl Fn(&Pin) -> bool) -> bool {
        let Some(tui) = self.tui.upgrade() else { return false };
        self.pin.borrow().as_ref().is_some_and(|pin| pin.live(tui.app.frame_number()) && matches(pin))
    }

    /// The session's location, once its info is known. The first call reads the location's agents and
    /// models, whose names and colors the footer and user rows show (`local.agent.color`, `ctx.models`).
    fn location(&self, tui: &Tui) -> Option<Location> {
        if let Some(location) = self.location.borrow().clone() {
            return Some(location);
        }
        let session = self.session.borrow().clone()?;
        let location = tui
            .data
            .read(|state| state.session(&session).map(|info| Location::new(info.location.directory.as_str())))?;
        for catalog in [Catalog::Agent, Catalog::Model] {
            drop(tui.data.catalog_sync(catalog, Some(&location)));
        }
        // Queued compactions are pending inbox items (`createSessionRows` syncs them on connect).
        drop(tui.data.pending_sync(&session));
        *self.location.borrow_mut() = Some(location.clone());
        Some(location)
    }

    fn install(&self, tui: &Tui) {
        let weak = self.this.clone();
        *self.groups.refresh.borrow_mut() = Some(Rc::new(bind!(weak, |inner| {
            let Some(tui) = inner.tui.upgrade() else { return };
            if let Some(session) = inner.session.borrow().as_ref() {
                tui.tabs.set_expanded_groups(&session.0, inner.groups.expanded.borrow().clone());
            }
            inner.render(&tui, |_| true);
        })));
        let weak = self.this.clone();
        *self.settings.borrow_mut() = Some(tui.settings.subscribe(bind!(weak, |inner, tui| {
            let view = RowSettings::read(&tui.config());
            let before = inner.view.replace(view);
            let groups = inner.groups.read(&tui.settings.info());
            if before.hide_thinking != view.hide_thinking {
                dispose(tui, inner.layer.take());
                inner.register(tui);
            }
            if groups || before != view {
                inner.render(tui, |_| true);
            }
        })));
        let weak = self.this.clone();
        self.root.on_resize(bind!(weak, |inner, cx, rect| {
            let Some(tui) = inner.tui.upgrade() else { return };
            let width = rect.width as u16;
            if inner.content_width(&tui) == width {
                inner.width.set(Some(width));
                return;
            }
            inner.width.set(Some(width));
            cx.defer(bind!(inner.this.clone(), |inner, _| {
                if let Some(tui) = inner.tui.upgrade() {
                    inner.render(&tui, |_| true);
                }
            }));
        }));
        // Before the layout, while the rows have their old places: away from the bottom, the rows above the reader's
        // hold it (see `Pin`). A resize while one holds extends it.
        self.resize.set(Some(tui.app.on_resize(bind!(self.this, |inner, cx, _, _| {
            let frame = cx.app().frame_number();
            if let Some(pin) = inner.pin.borrow_mut().as_mut().filter(|pin| pin.above.is_some() && pin.live(frame)) {
                pin.frame = frame;
                return;
            }
            let (_, top) = inner.scroll.scroll_position();
            let (content, viewport) = (inner.scroll.content_view().rect().height, inner.scroll.rect().height);
            if top >= f64::from((content - viewport).max(0.0)).floor() {
                return;
            }
            let Some(anchor) = inner.anchor() else { return };
            let above = inner.mounted.borrow().iter().take_while(|key| **key != anchor.row).cloned().collect();
            *inner.pin.borrow_mut() = Some(Pin { height: content, frame, above: Some(above) });
        }))));
        let weak = self.this.clone();
        self.scroll.content_view().on_resize(bind!(weak, |inner, cx, rect| {
            let Some(pin) = inner.pin.take() else { return };
            // Only the frames that lay the new rows out move the view.
            if !pin.live(cx.app().frame_number()) {
                return;
            }
            // A resize's rows move the view themselves (`Inner::hold`).
            if pin.above.is_some() {
                *inner.pin.borrow_mut() = Some(pin);
                return;
            }
            let grown = rect.height - pin.height;
            if grown > 0.0 {
                inner.scroll.scroll_by(0.0, f64::from(grown));
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
            cx.set_timeout(
                Duration::ZERO,
                bind!(weak, |inner, _| {
                    let Some(tui) = inner.tui.upgrade() else { return };
                    if up && inner.reveal_older(&tui) || !up && inner.reveal_newer(&tui) {
                        return;
                    }
                    inner.follow(&tui, !up);
                }),
            );
        });
        self.register(tui);
    }

    /// Publishes the transcript with `scroll` as its mover. Its moves, whatever moved it, and its resizes run the
    /// host's behaviors; a pointer that only moves over it does not.
    fn publish(&self, tui: &Tui, scroll: Rc<dyn Fn(&opencode_plugin::abi::v2::Scroll)>) {
        let read = bind!(self.this.clone(), |inner| inner.viewport());
        let published = opencode_plugin::behave::Published { read: Rc::new(read), scroll };
        *self.published.borrow_mut() = Some(opencode_plugin::behave::publish_transcript(&tui.app, published));
        let app = tui.app.clone();
        self.scroll.on_scroll(move |_, _| opencode_plugin::behave::transcript_moved(&app));
        for resized in [self.scroll.as_any(), self.scroll.content_view().as_any()] {
            let app = tui.app.clone();
            resized.on_resize(move |_, _| opencode_plugin::behave::transcript_moved(&app));
        }
    }

    fn viewport(&self) -> opencode_plugin::abi::v2::TranscriptView {
        let origin = self.scroll.content_view().rect().screen_y;
        let rows = self.rows.borrow();
        let published: Vec<opencode_plugin::abi::v2::TranscriptRow> = self
            .mounted
            .borrow()
            .iter()
            .filter_map(|key| {
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
                let (message, part) = match key {
                    RowKey::Part(id, Part::Tool(call)) => (id.clone(), Some(call.clone())),
                    RowKey::Message(id)
                    | RowKey::Part(id, _)
                    | RowKey::Footer(id)
                    | RowKey::TurnUsage(id)
                    | RowKey::Group(id)
                    | RowKey::CompactionQueued(id) => (id.clone(), None),
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
        // Counted again only when the specs or the window's start change: a key or a wheel step costs nothing
        // proportional to the history.
        let (revision, start) = (self.specs_revision.get(), self.start.borrow().clone());
        let cached =
            self.above.borrow().as_ref().filter(|(at, from, _)| *at == revision && *from == start).map(|it| it.2);
        let above = cached.unwrap_or_else(|| {
            let specs = self.specs.borrow();
            let above: HashSet<String> = specs[..self.window_start(&specs)]
                .iter()
                .map(|spec| match spec.key() {
                    RowKey::Message(id)
                    | RowKey::Part(id, _)
                    | RowKey::Footer(id)
                    | RowKey::TurnUsage(id)
                    | RowKey::Group(id)
                    | RowKey::CompactionQueued(id) => id,
                })
                .collect();
            let above = above.len() as u32;
            *self.above.borrow_mut() = Some((revision, start, above));
            above
        });
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
        let title = if self.view.get().hide_thinking { "Expand thinking" } else { "Collapse thinking" };
        let toggle = TuiCommand::new(
            "session.toggle.thinking",
            bind!(self.this, |inner, _, _| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let next = if inner.view.get().hide_thinking { Visibility::Show } else { Visibility::Hide };
                crate::dialogs::settings::update(&tui, move |draft| {
                    crate::dialogs::settings::set_path(draft, &["session", "thinking"], next.as_str().into());
                });
                tui.dialogs.clear();
            }),
        )
        .title(title)
        .group("Session");
        let layer = KeymapLayer::new(vec![toggle]);
        match tui.keymap.layer(layer) {
            Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
            Err(error) => log::error!("transcript keymap layer: {error}"),
        }
    }

    fn render(&self, tui: &Tui, changed: impl Fn(&str) -> bool) {
        let Some(session) = self.session.borrow().clone() else { return };
        let keys = Keys::read(tui);
        let stops = tui.data.read(|state| {
            let visible = Visible::of(state, &session);
            let messages = visible.messages;
            // Queued prompts belong to the dock rather than the transcript.
            let queued: HashSet<&str> = crate::routes::session::queued::ids(state, &session).collect();
            let mut rows = reduce(messages, self.view.get().turn_tokens.is_some());
            rows.retain(|spec| !matches!(spec, Spec::Message(id) if queued.contains(id.as_str())));
            let mut specs = grouping::project(rows, messages, self.groups.verbosity.get());
            let blocked: HashSet<&str> = state
                .permissions(&session)
                .unwrap_or_default()
                .iter()
                .filter_map(|request| request.source.as_ref().filter(|source| source.r#type == "tool"))
                .map(|source| source.id.as_str())
                .collect();
            grouping::partition_pending(&mut specs, &blocked);
            // Compactions waiting in the inbox go last (`createSessionRows`).
            specs.extend(state.pending(&session).iter().filter_map(|item| match item {
                SessionInboxInfo::Compaction(compaction) => Some(Spec::CompactionQueued(compaction.id.0.clone())),
                _ => None,
            }));
            self.remember(messages);
            let positions = self.positions.borrow();
            let paint = self.paint.borrow().clone();
            let cx = self.context(tui, state, &visible, &keys, &positions, &paint);
            *self.weights.borrow_mut() = specs.iter().map(|spec| self.groups.weight(spec, cx.hide_thinking)).collect();
            self.mount(&cx, &specs, changed);
            *self.specs.borrow_mut() = specs;
            self.specs_revision.set(self.specs_revision.get() + 1);
            self.trailing(tui, &visible, &keys);
            self.limits.check(messages, &|id| state.has_input(&session, id))
        });
        for stop in stops {
            stop.run(tui);
        }
        self.complete_group_boundary(tui);
    }

    fn patch(&self, tui: &Tui, session: &SessionID, changed: &HashSet<SessionMessageID>) -> bool {
        if self.view.get().turn_tokens.is_some() {
            return false;
        }
        let keys = Keys::read(tui);
        tui.data.read(|state| {
            let visible = Visible::of(state, session);
            let messages = visible.messages;
            let positions = self.positions.borrow();
            let shapes = self.shapes.borrow();
            let same = positions.len() == messages.len()
                && changed.iter().all(|id| {
                    positions.get(id.as_str()).is_some_and(|&index| {
                        messages.get(index).map(shape).is_some_and(|shape| shapes.get(index) == Some(&shape))
                    })
                });
            if !same {
                return false;
            }
            let paint = self.paint.borrow().clone();
            let cx = self.context(tui, state, &visible, &keys, &positions, &paint);
            let (specs, rows, refs) = (self.specs.borrow(), self.rows.borrow(), self.refs.borrow());
            let mut stale: Vec<usize> =
                changed.iter().filter_map(|id| refs.get(id.as_str())).flatten().copied().collect();
            stale.sort_unstable();
            stale.dedup();
            for index in stale {
                if let Some(row) = rows.get(&specs[index].key()) {
                    row.update(&cx, &specs[index]);
                }
            }
            self.trailing(tui, &visible, &keys);
            true
        })
    }

    /// [`Transcript::restyle`]. The rows outside the window are not built, so they mount in the new theme.
    fn restyle(&self, tui: &Tui) {
        let paint = Rc::new(Paint::new(tui.page()));
        *self.paint.borrow_mut() = paint.clone();
        self.hint.fg(paint.theme.text.feedback.info.base);
        self.background.restyle(&paint.theme);
        self.revert.restyle(&paint.theme);
        let Some(session) = self.session.borrow().clone() else { return };
        let keys = Keys::read(tui);
        tui.data.read(|state| {
            let visible = Visible::of(state, &session);
            // A stored position can refer to a message removed between renders.
            let positions =
                visible.messages.iter().enumerate().map(|(index, message)| (message.id().to_owned(), index)).collect();
            let cx = self.context(tui, state, &visible, &keys, &positions, &paint);
            let specs = self.specs.borrow();
            let rows = self.rows.borrow();
            for spec in specs.iter() {
                if let Some(row) = rows.get(&spec.key()) {
                    row.restyle(&cx, spec);
                }
            }
            drop(rows);
            self.trailing(tui, &visible, &keys);
        });
    }

    fn remember(&self, messages: &[SessionMessageInfo]) {
        let mut positions = self.positions.borrow_mut();
        for (index, message) in messages.iter().enumerate() {
            match positions.get_mut(message.id()) {
                Some(position) => *position = index,
                None => {
                    positions.insert(message.id().to_owned(), index);
                }
            }
        }
        if positions.len() > messages.len() {
            positions.retain(|id, index| messages.get(*index).is_some_and(|message| message.id() == id));
        }
        let mut shapes = self.shapes.borrow_mut();
        shapes.clear();
        shapes.extend(messages.iter().map(shape));
        self.legacy.set(legacy(messages));
    }

    /// The background hint and the revert banner after the rows.
    fn trailing(&self, tui: &Tui, visible: &Visible<'_>, keys: &Keys) {
        self.background.update(visible.messages, keys.background.clone(), errors::now());
        let revert = visible
            .info
            .and_then(|info| info.revert.as_ref())
            .map(|revert| (revert.message_id.as_str(), revert.files.as_deref().unwrap_or_default()));
        let width = usize::from(self.content_width(tui));
        self.revert.update(visible.session, revert, visible.all, keys.redo.clone(), width);
    }

    fn context<'a>(
        &'a self,
        tui: &'a Tui,
        state: &'a State,
        visible: &Visible<'a>,
        keys: &'a Keys,
        index: &'a HashMap<String, usize>,
        paint: &'a Paint,
    ) -> Context<'a> {
        let view = self.view.get();
        let info = visible.info;
        let catalogs = self.location.borrow().as_ref().and_then(|location| state.location(Some(location)));
        Context {
            tui,
            state,
            keys,
            directory: info.map(|info| info.location.directory.as_str()),
            image_preview: view.image_preview,
            session: visible.session,
            agents: catalogs
                .and_then(|data| data.agent.as_deref())
                .unwrap_or_default()
                .iter()
                .filter(|agent| !agent.hidden)
                .collect(),
            models: catalogs.and_then(|data| data.model.as_deref()).unwrap_or_default(),
            app: &tui.app,
            theme: &paint.theme,
            syntax: &paint.syntax,
            thinking_syntax: &paint.thinking_syntax,
            renderers: &self.renderers,
            claims: &self.claims,
            switched: &self.switched,
            reflowed: &self.reflowed,
            conceal: view.conceal,
            hide_thinking: view.hide_thinking,
            groups: &self.groups,
            tps: view.tps,
            verbose_tokens: view.turn_tokens == Some(TurnTokens::Verbose),
            mode: tui.theme.borrow().mode(),
            width: tui.app.size().0,
            content: self.content_width(tui),
            session_agent: info.and_then(|info| info.agent.as_ref()).map(|agent| agent.as_str()),
            index,
            messages: visible.messages,
            legacy: self.legacy.get(),
        }
    }

    fn content_width(&self, tui: &Tui) -> u16 {
        self.width.get().unwrap_or_else(|| tui.app.size().0.saturating_sub(tui.frame.rail_width(tui)).saturating_sub(4))
    }

    /// `completeGroupBoundary`: a page boundary can cut the oldest group in half, so while the oldest row is a
    /// group, older pages load until something precedes it. The footer's turn duration needs that turn's prompt.
    fn complete_group_boundary(&self, tui: &Tui) {
        let Some(session) = self.session.borrow().clone() else { return };
        if self.loading.get() || !matches!(self.specs.borrow().first(), Some(Spec::Group(_))) {
            return;
        }
        let count = tui.data.read(|state| state.has_more_messages(&session).then(|| state.messages(&session).len()));
        // A page that adds nothing would otherwise load again forever.
        let Some(count) = count.filter(|count| self.boundary.get() != Some(*count)) else { return };
        self.boundary.set(Some(count));
        self.loading.set(true);
        let data = tui.data.clone();
        tui.app.spawn(
            async move { data.message_load_more(&session, LoadMore::default()).await },
            bind!(self.this, |inner, _, result| {
                inner.loading.set(false);
                if let Err(error) = result {
                    log::error!("Failed to load older messages: {error}");
                }
                if let Some(tui) = inner.tui.upgrade() {
                    inner.complete_group_boundary(&tui);
                }
            }),
        );
    }

    fn mount(&self, cx: &Context<'_>, specs: &[Spec], changed: impl Fn(&str) -> bool) {
        let start = self.window_start(specs);
        let end = window_end(self.end.get(), start, specs.len());
        let specs = &specs[..end];
        let keys: Vec<RowKey> = specs[start..].iter().map(Spec::key).collect();
        let wanted: HashSet<&RowKey> = keys.iter().collect();
        let mut rows = self.rows.borrow_mut();
        let mut mounted = self.mounted.borrow_mut();
        rows.retain(|key, row| {
            let keep = wanted.contains(key);
            if !keep {
                row.wrapper.detach();
            }
            keep
        });
        mounted.retain(|key| wanted.contains(key));

        // Rows mounting above the first mounted one would push the reader's rows down; the next
        // layout scrolls by what they add (`pinAbove`), in place of a resize's pin.
        if let Some(first) = mounted.first()
            && keys.first() != Some(first)
            && self.pin.borrow().as_ref().is_none_or(|pin| pin.above.is_some())
        {
            let (height, frame) = (self.scroll.content_view().rect().height, cx.app.frame_number());
            *self.pin.borrow_mut() = Some(Pin { height, frame, above: None });
        }

        let mut refs = self.refs.borrow_mut();
        refs.values_mut().for_each(Vec::clear);
        for (index, (spec, key)) in specs[start..].iter().zip(&keys).enumerate() {
            let index = start + index;
            let messages = spec.messages();
            for id in &messages {
                match refs.get_mut(*id) {
                    Some(indices) if indices.last() == Some(&index) => {}
                    Some(indices) => indices.push(index),
                    None => {
                        refs.insert((*id).to_owned(), vec![index]);
                    }
                }
            }
            let fresh = !rows.contains_key(key);
            let row = rows.entry(key.clone()).or_insert_with(|| {
                let row = Row::new(cx, spec);
                self.hold(&row.wrapper, key.clone());
                row
            });
            if fresh || messages.into_iter().any(&changed) {
                row.update(cx, spec);
            }
        }
        refs.retain(|_, indices| !indices.is_empty());
        for (index, key) in keys.iter().enumerate() {
            if mounted.get(index) == Some(key) {
                continue;
            }
            if let Some(position) = mounted.iter().position(|other| other == key) {
                mounted.remove(position);
            }
            self.scroll.insert(index, &rows[key].wrapper);
            mounted.insert(index, key.clone());
        }
    }

    /// While a resize's pin holds the reader's row, a row above it that changes height scrolls the view by as much
    /// (`pinAbove`). Its own geometry is current in its resize, which the content's is not.
    fn hold(&self, wrapper: &View, key: RowKey) {
        let laid = Cell::new(None);
        wrapper.on_resize(bind!(self.this, |inner, _, rect| {
            let Some(before) = laid.replace(Some(rect.height)).filter(|before| *before != rect.height) else { return };
            if inner.pinned(|pin| pin.above.as_ref().is_some_and(|above| above.contains(&key))) {
                inner.scroll.scroll_by(0.0, f64::from(rect.height - before));
            }
        }));
    }

    fn window_start(&self, specs: &[Spec]) -> usize {
        let weights = self.weights.borrow();
        if weights.len() != specs.len() {
            return window_start(&self.start.borrow(), specs, &vec![1; specs.len()]);
        }
        window_start(&self.start.borrow(), specs, &weights)
    }

    fn reveal_older(&self, tui: &Tui) -> bool {
        let (_, top) = self.scroll.scroll_position();
        if top > f64::from(self.scroll.rect().height) {
            return false;
        }
        let start = {
            let specs = self.specs.borrow();
            let start = self.window_start(&specs);
            if start > 0 {
                let next = grouping::rows_before(&self.weights.borrow(), start, BACKFILL_CHUNK);
                Some(if next == 0 { Start::Top } else { Start::Row(specs[next].key()) })
            } else {
                None
            }
        };
        let Some(start) = start else { return self.load_older(tui) };
        self.scroll.sticky(false);
        *self.start.borrow_mut() = start;
        self.render(tui, |_| false);
        self.scroll.sticky(true);
        true
    }

    fn at_end(&self) -> bool {
        self.end.get().is_none_or(|end| end >= self.specs.borrow().len())
    }

    fn reveal_newer(&self, tui: &Tui) -> bool {
        let Some(end) = self.end.get() else { return false };
        let rows = self.specs.borrow().len();
        let (_, top) = self.scroll.scroll_position();
        let viewport = f64::from(self.scroll.rect().height);
        let content = f64::from(self.scroll.content_view().rect().height);
        if end >= rows || top + viewport < content - viewport {
            return false;
        }
        self.mount_newer(tui, end);
        true
    }

    fn mount_newer(&self, tui: &Tui, end: usize) {
        let rows = self.specs.borrow().len();
        let next = grouping::rows_after(&self.weights.borrow(), end, BACKFILL_CHUNK);
        self.end.set((next < rows).then_some(next));
        self.render(tui, |_| false);
    }

    fn load_older(&self, tui: &Tui) -> bool {
        let Some(session) = self.session.borrow().clone() else { return false };
        if self.loading.get() || !tui.data.read(|state| state.has_more_messages(&session)) {
            return false;
        }
        self.loading.set(true);
        self.hint.visible(true);
        *self.start.borrow_mut() = Start::Top;
        let data = tui.data.clone();
        tui.app.spawn(
            async move { data.message_load_more(&session, LoadMore::default()).await },
            bind!(self.this, |inner, _, result| {
                inner.loading.set(false);
                inner.hint.visible(false);
                let Some(tui) = inner.tui.upgrade() else { return };
                match result {
                    Ok(_) => inner.complete_group_boundary(&tui),
                    Err(error) => tui.toasts.error(error.tui_message()),
                }
            }),
        );
        true
    }

    fn follow(&self, tui: &Tui, down: bool) {
        // Newly mounted rows contribute to content size only after layout.
        if self.pinned(|pin| pin.above.is_none()) {
            return;
        }
        let (_, top) = self.scroll.scroll_position();
        let content = self.scroll.content_view().rect().height;
        let bottom = f64::from((content - self.scroll.rect().height).max(0.0));
        // Only a step down reaches the bottom; after a step up the content's size may be a frame old.
        // The end of a head window is not the bottom.
        let next = if down && top >= bottom && self.at_end() {
            Start::Tail
        } else {
            match &*self.start.borrow() {
                Start::Tail => {
                    let specs = self.specs.borrow();
                    match self.window_start(&specs) {
                        0 => Start::Top,
                        index => Start::Row(specs[index].key()),
                    }
                }
                start => start.clone(),
            }
        };
        if *self.start.borrow() == next {
            return;
        }
        *self.start.borrow_mut() = next;
        self.render(tui, |_| false);
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
    messages: &'a [SessionMessageInfo],
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
        Self { session, info, all, messages }
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
    pub syntax: &'a SyntaxTheme,
    /// Syntax theme for reasoning text, with all tokens muted.
    pub thinking_syntax: &'a SyntaxTheme,
    pub renderers: &'a CodeBlockRenderers,
    pub claims: &'a ToolClaims,
    /// Renders a message's rows again: a claim's view at a paint changed which row shows one of its parts.
    pub switched: &'a Rc<dyn Fn(&str)>,
    pub reflowed: &'a Rc<dyn Fn(f64, f32)>,
    pub conceal: bool,
    /// `session.thinking` is `hide`.
    pub hide_thinking: bool,
    pub groups: &'a Rc<grouping::Settings>,
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
    pub agents: Vec<&'a AgentInfo>,
    pub models: &'a [ModelInfo],
    /// The visible messages, oldest first, and each one's position.
    pub messages: &'a [SessionMessageInfo],
    pub index: &'a HashMap<String, usize>,
    pub legacy: bool,
}

impl Context<'_> {
    pub fn content_width(&self) -> usize {
        usize::from(self.content)
    }

    pub fn message(&self, id: &str) -> Option<&SessionMessageInfo> {
        self.index.get(id).map(|&index| &self.messages[index])
    }

    pub fn assistant(&self, id: &str) -> Option<&SessionMessageAssistant> {
        match self.message(id)? {
            SessionMessageInfo::Assistant(assistant) => Some(assistant),
            _ => None,
        }
    }

    /// `local.agent.color`: the agent's own color, else the categorical color at its position among
    /// the visible agents; an agent the location does not list takes the first.
    pub fn agent_color(&self, agent: &str) -> Color {
        let step = 400;
        let mut colors: Vec<Color> = Vec::new();
        for scale in self.theme.categorical() {
            let color = scale.step(step);
            if !colors.contains(&color) {
                colors.push(color);
            }
        }
        let Some(index) = self.agents.iter().position(|item| item.id.as_str() == agent) else { return colors[0] };
        self.agents[index]
            .color
            .as_ref()
            .and_then(|color| Color::parse(color.as_str()))
            .unwrap_or(colors[index % colors.len()])
    }

    pub fn model_name(&self, model: &ModelRef) -> String {
        self.models
            .iter()
            .find(|item| item.provider_id == model.provider_id && item.id == model.id)
            .map_or_else(|| format!("{}/{}", model.provider_id.as_str(), model.id), |item| item.name.clone())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    Text(usize),
    Reasoning(usize),
    Tool(String),
}

impl Part {
    pub fn resolve<'a>(&self, message: &'a SessionMessageAssistant) -> Option<&'a SessionMessageAssistantContentItem> {
        let (want_text, ordinal) = match self {
            Self::Tool(id) => {
                return message
                    .content
                    .iter()
                    .find(|item| matches!(item, SessionMessageAssistantContentItem::Tool(tool) if tool.id == *id));
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
    Message(String),
    Part {
        message: String,
        part: Part,
    },
    Footer(String),
    TurnUsage {
        messages: Vec<String>,
        previous: Option<footer::CacheUsage>,
    },
    Group(grouping::Group),
    /// A compaction waiting in the inbox, by inbox ID.
    CompactionQueued(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum RowKey {
    Message(String),
    Part(String, Part),
    Footer(String),
    TurnUsage(String),
    Group(String),
    CompactionQueued(String),
}

impl Spec {
    fn key(&self) -> RowKey {
        match self {
            Self::Message(id) => RowKey::Message(id.clone()),
            Self::Part { message, part } => RowKey::Part(message.clone(), part.clone()),
            Self::Footer(id) => RowKey::Footer(id.clone()),
            Self::TurnUsage { messages, .. } => RowKey::TurnUsage(messages.first().cloned().unwrap_or_default()),
            Self::Group(group) => RowKey::Group(group.id(0).map(|id| id.to_string()).unwrap_or_default()),
            Self::CompactionQueued(id) => RowKey::CompactionQueued(id.clone()),
        }
    }

    /// The messages whose change re-renders the row: a turn's usage follows its last step, and a
    /// group every row in it.
    fn messages(&self) -> Vec<&str> {
        match self {
            Self::Message(id) | Self::Footer(id) | Self::Part { message: id, .. } | Self::CompactionQueued(id) => {
                vec![id]
            }
            Self::TurnUsage { messages, .. } => messages.last().map(String::as_str).into_iter().collect(),
            Self::Group(group) => group.entries().into_iter().flat_map(|spec| spec.messages()).collect(),
        }
    }
}

/// `reduceSessionRows` without grouping and pending inputs.
pub fn reduce(messages: &[SessionMessageInfo], turn_tokens: bool) -> Vec<Spec> {
    let legacy = legacy(messages);
    let mut rows = Vec::new();
    let mut steps: Vec<&SessionMessageAssistant> = Vec::new();
    let mut previous_turn: Option<footer::CacheUsage> = None;
    let flush = |rows: &mut Vec<Spec>,
                 steps: &mut Vec<&SessionMessageAssistant>,
                 previous_turn: &mut Option<footer::CacheUsage>| {
        if !turn_tokens {
            return;
        }
        let used: Vec<_> = steps.drain(..).filter(|step| footer::total(step) > 0.0).collect();
        let Some(last) = used.last() else { return };
        rows.push(Spec::TurnUsage {
            messages: used.iter().map(|step| step.id.0.clone()).collect(),
            previous: previous_turn.clone(),
        });
        *previous_turn = Some(footer::CacheUsage::of(last));
    };
    // An execution failure that repeats the error of the turn's last step or compaction is
    // already on screen.
    let mut shown_error: Option<(String, String)> = None;
    for message in compaction::running_last(messages) {
        let assistant = match message {
            SessionMessageInfo::Assistant(assistant) => assistant,
            SessionMessageInfo::Idle(idle) => {
                if let Some(error) = &idle.error
                    && shown_error.as_ref() != Some(&(error.r#type.clone(), error.message.clone()))
                {
                    rows.push(Spec::Message(idle.id.0.clone()));
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
                rows.push(Spec::Message(message.id().to_owned()));
                continue;
            }
            SessionMessageInfo::Unknown(_) => continue,
            other => {
                rows.push(Spec::Message(other.id().to_owned()));
                continue;
            }
        };
        steps.push(assistant);
        shown_error = assistant.error.as_ref().map(|error| (error.r#type.clone(), error.message.clone()));
        let (mut texts, mut reasonings) = (0, 0);
        for item in &assistant.content {
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
                SessionMessageAssistantContentItem::Tool(tool) => Part::Tool(tool.id.clone()),
                SessionMessageAssistantContentItem::Unknown(_) => continue,
            };
            rows.push(Spec::Part { message: assistant.id.0.clone(), part });
        }
        let terminal = terminal(assistant);
        if terminal || assistant.retry.is_some() {
            rows.push(Spec::Footer(assistant.id.0.clone()));
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
                if let Some(SessionMessageInfo::User(message)) = cx.message(id) {
                    view.update(cx, message);
                }
            }
            (Body::Notice(view), Spec::Message(id)) => {
                if let Some(message) = cx.message(id) {
                    view.update(cx, message);
                }
            }
            (Body::Shell(view), Spec::Message(id)) => {
                if let Some(SessionMessageInfo::Shell(message)) = cx.message(id) {
                    view.update(cx, message);
                }
            }
            (Body::Compaction(view), Spec::Message(id)) => {
                if let Some(SessionMessageInfo::Compaction(message)) = cx.message(id) {
                    view.update(cx, message);
                }
            }
            (Body::Error(view), Spec::Message(id)) => {
                if let Some(message) = cx.message(id) {
                    view.update(message);
                }
            }
            (Body::Text(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(message)
                    && let Some(SessionMessageAssistantContentItem::Text(text)) = part.resolve(assistant)
                {
                    view.update(assistant, text, cx.conceal, cx.content);
                }
            }
            (Body::Reasoning(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(message)
                    && let Some(SessionMessageAssistantContentItem::Reasoning(reasoning)) = part.resolve(assistant)
                {
                    view.update(cx, assistant, reasoning);
                }
            }
            (Body::Tool(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(message)
                    && let Some(SessionMessageAssistantContentItem::Tool(tool)) = part.resolve(assistant)
                {
                    view.update(cx, assistant, tool);
                }
            }
            (Body::Footer(view), Spec::Footer(id)) => {
                if let Some(assistant) = cx.assistant(id) {
                    view.update(cx, assistant);
                }
            }
            (Body::Usage(view), Spec::TurnUsage { messages, previous }) => {
                view.update(cx, messages, previous.as_ref());
            }
            _ => {}
        }
    }
}

impl Body {
    fn new(cx: &Context<'_>, spec: &Spec) -> Self {
        match spec {
            Spec::Message(id) => match cx.message(id) {
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
            Spec::Group(_) => Body::Group(grouping::GroupView::new(cx, cx.groups, 0)),
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
        let part = |message: &str, part| Spec::Part { message: message.into(), part };
        assert_eq!(
            reduce(&list, false),
            vec![
                Spec::Message("msg_1".into()),
                part("msg_2", Part::Reasoning(1)),
                part("msg_2", Part::Text(0)),
                part("msg_2", Part::Tool("call_1".into())),
                part("msg_3", Part::Text(0)),
                Spec::Footer("msg_3".into()),
            ]
        );
        let usage = reduce(&list, true);
        assert_eq!(
            usage.last(),
            Some(&Spec::TurnUsage { messages: vec!["msg_2".into(), "msg_3".into()], previous: None })
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
        let specs: Vec<Spec> = (0..100).map(|index| Spec::Message(format!("msg_{index:03}"))).collect();
        let weights = vec![1; 100];
        assert_eq!(window_start(&Start::Tail, &specs, &weights), 100 - TAIL_ROWS);
        assert_eq!(window_start(&Start::Top, &specs, &weights), 0);
        let pinned = Start::Row(RowKey::Message("msg_010".into()));
        assert_eq!(window_start(&pinned, &specs, &weights), 10);
        // A pinned row inside the tail still mounts the whole tail; a vanished one falls back.
        let late = Start::Row(RowKey::Message("msg_090".into()));
        assert_eq!(window_start(&late, &specs, &weights), 100 - TAIL_ROWS);
        let gone = Start::Row(RowKey::Message("msg_x".into()));
        assert_eq!(window_start(&gone, &specs, &weights), 100 - TAIL_ROWS);
        assert_eq!(window_start(&Start::Tail, &specs[..5], &weights[..5]), 0);
        let mut heavy = weights.clone();
        heavy[95] = 10;
        assert_eq!(window_start(&Start::Tail, &specs, &heavy), 100 - TAIL_ROWS + 9);
    }
}
