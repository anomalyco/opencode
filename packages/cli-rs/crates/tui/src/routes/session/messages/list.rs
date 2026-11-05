//! The transcript (E.6a): the rows of `reduceSessionRows` (`routes/session/rows.ts`), mounted tail
//! first and windowed as `routes/session/index.tsx:418-513` does, with older pages loaded when the
//! reader scrolls near the top.
//!
//! A row is one TS `SessionRow`: a message, an assistant part (text, reasoning, tool), an assistant
//! footer, or a turn's token usage. Each row owns its widgets and updates them in place; a sync
//! updates only the rows whose message changed. Groups (E.8) are rows too, folded by
//! `grouping::project`. Queued inputs (E.10b) are not here yet. The background hint and the
//! revert banner (E.6b) follow the rows.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::generated::{
    AgentInfo, ModelInfo, ModelRef, SessionID, SessionInboxInfo, SessionMessageAssistant,
    SessionMessageAssistantContentItem, SessionMessageAssistantFinish, SessionMessageCompaction,
    SessionMessageID, SessionMessageInfo,
};
use opencode_local::cli_config::{Markdown as MarkdownMode, Resolved, TurnTokens, Visibility};
use opencode_store::location::{Catalog, Location};
use opencode_store::{Changes, LoadMore, MessageExt, State};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::{Theme, ThemeMode};
use opentui::input::MouseEventKind;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::ScrollEdge;

use super::super::tools;
use super::{
    assistant, background, compaction, errors, footer, reasoning, revert, shell, skill, user,
};
use crate::app::Tui;
use crate::routes::session::grouping;

/// Rows mounted when a session opens (`TRANSCRIPT_TAIL_ROWS`).
pub const TAIL_ROWS: usize = 40;
/// Rows mounted per reveal near the top (`TRANSCRIPT_BACKFILL_CHUNK`).
pub const BACKFILL_CHUNK: usize = 60;

#[derive(Clone)]
pub struct Transcript(Rc<Inner>);

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
    theme: Theme,
    syntax: SyntaxTheme,
    thinking_syntax: SyntaxTheme,
    renderers: CodeBlockRenderers,
    /// The `session` and `debug` settings the rows show with, as the config has them now.
    view: Cell<RowSettings>,
    groups: Rc<grouping::Settings>,
    session: RefCell<Option<SessionID>>,
    location: RefCell<Option<Location>>,
    specs: RefCell<Vec<Spec>>,
    /// Each row's mount cost (`rowWeight`).
    weights: RefCell<Vec<usize>>,
    rows: RefCell<HashMap<RowKey, Row>>,
    /// The keys of the scroll box's children, in order.
    mounted: RefCell<Vec<RowKey>>,
    start: RefCell<Start>,
    /// Where the mounted window ends, by row index, when it stops before the newest row
    /// (`visibleRowsEnd`): `session.first` mounts the head only.
    end: Cell<Option<usize>>,
    /// Set when rows mount above the window, so the reader's rows stay in place.
    pin: RefCell<Option<Pin>>,
    loading: Cell<bool>,
    /// How many messages were loaded when the last group-boundary page was asked for.
    boundary: Cell<Option<usize>>,
    layer: RefCell<Option<Disposer>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(tui) = self.tui.upgrade() {
            dispose(&tui, self.layer.take());
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

/// The content height before rows mounted above, and the frame it is from.
struct Pin {
    height: f32,
    frame: u64,
}

/// Where the mounted window starts (`hiddenRows`).
#[derive(Clone, Debug, PartialEq, Eq)]
enum Start {
    /// The newest [`TAIL_ROWS`], following appends while the reader stays at the bottom.
    Tail,
    /// Every row, including pages loaded later.
    Top,
    /// From this row on (or the tail, if that starts earlier).
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
            .scrollbars(false);
        let hint = Text::new(app, "Loading session history…")
            .fg(theme.text.feedback.info.base)
            .visible(false);
        // `index.tsx:1573`: one row under the transcript for the history and "Jump to latest" hints.
        let status = View::new(app)
            .row()
            .height(1)
            .shrink(0.0)
            .justify(Justify::End)
            .child(&hint);
        let root = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .child(&scroll)
            .child(&status);
        let background = background::Hint::new(app, &theme);
        let revert = revert::Banner::new(tui, &theme);
        scroll.add(background.root());
        scroll.add(revert.root());
        let syntax = opencode_ui::code::syntax_theme(&theme);
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
            thinking_syntax: thinking_syntax(&syntax, theme.text.muted),
            syntax,
            theme,
            renderers: crate::plugins::host::code_blocks(tui),
            view: Cell::new(RowSettings::read(&tui.config())),
            groups: grouping::Settings::new(&tui.settings.info()),
            session: RefCell::default(),
            location: RefCell::default(),
            specs: RefCell::default(),
            weights: RefCell::default(),
            rows: RefCell::default(),
            mounted: RefCell::default(),
            start: RefCell::new(Start::Tail),
            end: Cell::new(None),
            pin: RefCell::default(),
            loading: Cell::new(false),
            boundary: Cell::new(None),
            layer: RefCell::default(),
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
        let catalogs = location
            .as_ref()
            .is_some_and(|location| changes.location(location));
        let pending = changes.pending(session);
        // A tool row waiting on a permission request takes the warning color.
        let permissions = changes.permissions(session);
        if !changes.any_message(session)
            && !changes.session(session)
            && !catalogs
            && !pending
            && !permissions
        {
            return;
        }
        let force = changes.messages(session)
            || changes.session(session)
            || catalogs
            || pending
            || permissions;
        self.0.render(tui, |message| {
            force || changes.message(session, &SessionMessageID(message.to_owned()))
        });
    }

    /// Mounts older rows, or loads an older page when every row is mounted. Returns whether it did
    /// either. Scrolling up near the top calls it; E.8's navigation can too.
    pub fn reveal_older(&self, tui: &Tui) -> bool {
        self.0.reveal_older(tui)
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

    /// Re-renders every row, after a grouping setting changed.
    pub fn refresh(&self, tui: &Tui) {
        self.0.render(tui, |_| true);
    }

    /// Pins or follows the window after the view moved (`updateAwayFromBottom`).
    pub fn follow(&self, tui: &Tui, down: bool) {
        self.0.follow(tui, down);
    }

    /// Mounts every loaded row (`ensureAllRows`).
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
        // The render reads the history the load just stored.
        self.0.render(tui, |_| false);
        if self.0.specs.borrow().len() <= BACKFILL_CHUNK {
            self.0.end.set(None);
        }
    }

    /// Mounts the tail again and follows the bottom (`toBottom`).
    pub fn to_tail(&self, tui: &Tui) {
        *self.0.start.borrow_mut() = Start::Tail;
        self.0.end.set(None);
        self.0.render(tui, |_| false);
        self.0.scroll.sticky(true);
        self.0.scroll.scroll_to_bottom();
    }

    /// Whether every loaded row is mounted.
    pub fn all_mounted(&self) -> bool {
        self.0.window_start(&self.0.specs.borrow()) == 0 && self.at_end()
    }

    /// Whether the newest row is mounted.
    pub fn at_end(&self) -> bool {
        self.0.at_end()
    }

    /// Mounts newer rows below a head window when the reader nears its end. Returns whether it did.
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
                (RowKey::Message(id) | RowKey::Part(id, _), _) => {
                    out.push((id.clone(), row.wrapper.rect().screen_y))
                }
                _ => {}
            }
        }
        let origin = self.0.scroll.content_view().rect().screen_y;
        out.iter_mut().for_each(|(_, y)| *y -= origin);
        out.sort_by(|a, b| a.1.total_cmp(&b.1));
        out
    }

    /// Loads every older page in one publication (`session.first`). The window stays until `done`
    /// mounts the head.
    pub fn load_all(&self, tui: &Tui, done: impl FnOnce(&Tui, Result<(), String>) + 'static) {
        let Some(session) = self.session() else {
            return;
        };
        let data = tui.data.clone();
        let weak = self.0.this.clone();
        tui.app.spawn(
            async move {
                data.message_load_more(
                    &session,
                    LoadMore {
                        all: true,
                        ..LoadMore::default()
                    },
                )
                .await
            },
            move |_, result| {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                done(&tui, result.map_err(|error| error.to_string()));
            },
        );
    }
}

impl Inner {
    /// The session's location, once its info is known. The first call reads the location's agents and
    /// models, whose names and colors the footer and user rows show (`local.agent.color`, `ctx.models`).
    fn location(&self, tui: &Tui) -> Option<Location> {
        if let Some(location) = self.location.borrow().clone() {
            return Some(location);
        }
        let session = self.session.borrow().clone()?;
        let location = tui.data.read(|state| {
            state
                .session(&session)
                .map(|info| Location::new(info.location.directory.as_str()))
        })?;
        for catalog in [Catalog::Agent, Catalog::Model] {
            drop(tui.data.catalog_sync(catalog, Some(&location)));
        }
        // Queued compactions are pending inbox items (`createSessionRows` syncs them on connect).
        drop(tui.data.pending_sync(&session));
        *self.location.borrow_mut() = Some(location.clone());
        Some(location)
    }

    fn install(&self, tui: &Tui) {
        // A group header click re-renders the rows; a config change of the grouping settings too.
        let weak = self.this.clone();
        *self.groups.refresh.borrow_mut() = Some(Rc::new(move || {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            if let Some(session) = inner.session.borrow().as_ref() {
                tui.tabs
                    .set_expanded_groups(&session.0, inner.groups.expanded.borrow().clone());
            }
            inner.render(&tui, |_| true);
        }));
        let weak = self.this.clone();
        tui.settings.on_change(move |tui| {
            let Some(inner) = weak.upgrade() else { return };
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
        });
        // Keep the reader's row in place when rows mount above it.
        let weak = self.this.clone();
        self.scroll.content_view().on_resize(move |cx, rect| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(pin) = inner.pin.take() else { return };
            // Only the frame that lays the new rows out moves the view.
            if cx.app().frame_number() > pin.frame + 1 {
                return;
            }
            let grown = rect.height - pin.height;
            if grown > 0.0 {
                inner.scroll.scroll_by(0.0, f64::from(grown));
            }
        });
        // The wheel moves the view before this runs, so the window checks after it.
        let weak = self.this.clone();
        self.scroll.on_mouse(move |cx, event| {
            let up = match event.kind {
                MouseEventKind::ScrollUp => true,
                MouseEventKind::ScrollDown => false,
                _ => return,
            };
            let weak = weak.clone();
            cx.set_timeout(Duration::ZERO, move |_| {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                if up && inner.reveal_older(&tui) || !up && inner.reveal_newer(&tui) {
                    return;
                }
                inner.follow(&tui, !up);
            });
        });
        self.register(tui);
    }

    /// `session.toggle.thinking` (`index.tsx:1163-1180`): writes `session.thinking`, which the rows follow.
    fn register(&self, tui: &Tui) {
        let weak = self.this.clone();
        let title = if self.view.get().hide_thinking {
            "Expand thinking"
        } else {
            "Collapse thinking"
        };
        let toggle = TuiCommand::new("session.toggle.thinking", move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            let next = if inner.view.get().hide_thinking {
                Visibility::Show
            } else {
                Visibility::Hide
            };
            crate::dialogs::settings::update(&tui, move |draft| {
                crate::dialogs::settings::set_path(
                    draft,
                    &["session", "thinking"],
                    next.as_str().into(),
                );
            });
            tui.dialogs.clear();
        })
        .title(title)
        .group("Session");
        let layer = KeymapLayer {
            commands: vec![toggle],
            ..KeymapLayer::default()
        };
        match tui.keymap.layer(layer) {
            Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
            Err(error) => log::error!("transcript keymap layer: {error}"),
        }
    }

    /// Rebuilds the row list, mounts the window, and updates the rows `changed` names (by message
    /// ID) plus every new row.
    fn render(&self, tui: &Tui, changed: impl Fn(&str) -> bool) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        let (width, _) = tui.app.size();
        let mode = tui.theme.borrow().mode();
        // The keymap's conditions read the store, so shortcuts are looked up before it is locked.
        let keys = Keys {
            background: tui.keymap.shortcut("session.background"),
            redo: tui.keymap.shortcut("session.redo"),
            model_list: tui.keymap.shortcut("model.list"),
        };
        let stops = tui.data.read(|state| {
            let messages = state.messages(&session);
            let all = messages;
            let info = state.session(&session);
            let revert = info
                .and_then(|info| info.revert.as_ref())
                .map(|revert| revert.message_id.as_str());
            let messages = match revert {
                // Messages after the revert boundary are hidden (`rows.ts:70`).
                Some(boundary) => {
                    let end = messages
                        .iter()
                        .position(|message| message.id() >= boundary)
                        .unwrap_or(messages.len());
                    &messages[..end]
                }
                None => messages,
            };
            // Queued prompts show in the dock (E.10b), not the transcript (`rows.ts:63-67`).
            let queued: HashSet<String> = crate::routes::session::queued::prompts(state, &session)
                .into_iter()
                .map(|(id, _)| id)
                .collect();
            let view = self.view.get();
            let mut rows = reduce(messages, view.turn_tokens.is_some());
            rows.retain(|spec| !matches!(spec, Spec::Message(id) if queued.contains(id)));
            let mut specs = grouping::project(rows, messages, self.groups.verbosity.get());
            // Compactions waiting in the inbox go last (`createSessionRows`).
            specs.extend(
                state
                    .pending(&session)
                    .iter()
                    .filter_map(|item| match item {
                        SessionInboxInfo::Compaction(compaction) => {
                            Some(Spec::CompactionQueued(compaction.id.0.clone()))
                        }
                        _ => None,
                    }),
            );
            let catalogs = self
                .location
                .borrow()
                .as_ref()
                .and_then(|location| state.location(Some(location)));
            let cx = Context {
                tui,
                state,
                keys: &keys,
                directory: info.map(|info| info.location.directory.as_str()),
                image_preview: view.image_preview,
                session: &session,
                agents: catalogs
                    .and_then(|data| data.agent.as_deref())
                    .unwrap_or_default()
                    .iter()
                    .filter(|agent| !agent.hidden)
                    .collect(),
                models: catalogs
                    .and_then(|data| data.model.as_deref())
                    .unwrap_or_default(),
                app: &tui.app,
                theme: &self.theme,
                syntax: &self.syntax,
                thinking_syntax: &self.thinking_syntax,
                renderers: &self.renderers,
                conceal: view.conceal,
                hide_thinking: view.hide_thinking,
                groups: &self.groups,
                tps: view.tps,
                verbose_tokens: view.turn_tokens == Some(TurnTokens::Verbose),
                animations: opencode_ui::motion::enabled(tui.config().info.animations),
                mode,
                width,
                session_agent: info
                    .and_then(|info| info.agent.as_ref())
                    .map(|agent| agent.as_str()),
                index: messages
                    .iter()
                    .enumerate()
                    .map(|(index, message)| (message.id(), index))
                    .collect(),
                messages,
                legacy: legacy(messages),
            };
            *self.weights.borrow_mut() = specs
                .iter()
                .map(|spec| self.groups.weight(spec, cx.hide_thinking))
                .collect();
            self.mount(&cx, &specs, changed);
            *self.specs.borrow_mut() = specs;
            self.background
                .update(messages, keys.background.clone(), errors::now());
            let revert = info.and_then(|info| info.revert.as_ref()).map(|revert| {
                (
                    revert.message_id.as_str(),
                    revert.files.as_deref().unwrap_or_default(),
                )
            });
            self.revert
                .update(tui, &session, revert, all, keys.redo.clone());
            self.limits
                .check(messages, &|id| state.has_input(&session, id))
        });
        for stop in stops {
            stop.run(tui);
        }
        self.complete_group_boundary(tui);
    }

    /// `completeGroupBoundary`: a page boundary can cut the oldest group in half, so while the oldest row is a
    /// group, older pages load until something precedes it. The footer's turn duration needs that turn's prompt.
    fn complete_group_boundary(&self, tui: &Tui) {
        let Some(session) = self.session.borrow().clone() else {
            return;
        };
        if self.loading.get() || !matches!(self.specs.borrow().first(), Some(Spec::Group(_))) {
            return;
        }
        let count = tui.data.read(|state| {
            state
                .has_more_messages(&session)
                .then(|| state.messages(&session).len())
        });
        // A page that adds nothing would otherwise load again forever.
        let Some(count) = count.filter(|count| self.boundary.get() != Some(*count)) else {
            return;
        };
        self.boundary.set(Some(count));
        self.loading.set(true);
        let data = tui.data.clone();
        let weak = self.this.clone();
        tui.app.spawn(
            async move { data.message_load_more(&session, LoadMore::default()).await },
            move |_, result| {
                let Some(inner) = weak.upgrade() else { return };
                inner.loading.set(false);
                if let Err(error) = result {
                    log::error!("Failed to load older messages: {error}");
                }
                if let Some(tui) = inner.tui.upgrade() {
                    inner.complete_group_boundary(&tui);
                }
            },
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
        // layout scrolls by what they add (`pinAbove`).
        if let Some(first) = mounted.first()
            && keys.first() != Some(first)
            && self.pin.borrow().is_none()
        {
            *self.pin.borrow_mut() = Some(Pin {
                height: self.scroll.content_view().rect().height,
                frame: cx.app.frame_number(),
            });
        }

        for (spec, key) in specs[start..].iter().zip(&keys) {
            let fresh = !rows.contains_key(key);
            let row = rows
                .entry(key.clone())
                .or_insert_with(|| Row::new(cx, spec));
            if fresh || spec.messages().into_iter().any(&changed) {
                row.update(cx, spec);
            }
        }
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

    fn window_start(&self, specs: &[Spec]) -> usize {
        let weights = self.weights.borrow();
        if weights.len() != specs.len() {
            return window_start(&self.start.borrow(), specs, &vec![1; specs.len()]);
        }
        window_start(&self.start.borrow(), specs, &weights)
    }

    /// `revealOlderRows`: near the top, mount [`BACKFILL_CHUNK`] more rows, or load an older page.
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
                Some(if next == 0 {
                    Start::Top
                } else {
                    Start::Row(specs[next].key())
                })
            } else {
                None
            }
        };
        let Some(start) = start else {
            return self.load_older(tui);
        };
        self.scroll.sticky(false);
        *self.start.borrow_mut() = start;
        self.render(tui, |_| false);
        self.scroll.sticky(true);
        true
    }

    fn at_end(&self) -> bool {
        self.end
            .get()
            .is_none_or(|end| end >= self.specs.borrow().len())
    }

    /// `revealNewerRows`: near the end of a head window, mount [`BACKFILL_CHUNK`] more rows below it.
    fn reveal_newer(&self, tui: &Tui) -> bool {
        let Some(end) = self.end.get() else {
            return false;
        };
        let rows = self.specs.borrow().len();
        let (_, top) = self.scroll.scroll_position();
        let viewport = f64::from(self.scroll.rect().height);
        let content = f64::from(self.scroll.content_view().rect().height);
        if end >= rows || top + viewport < content - viewport {
            return false;
        }
        let next = grouping::rows_after(&self.weights.borrow(), end, BACKFILL_CHUNK);
        self.end.set((next < rows).then_some(next));
        self.render(tui, |_| false);
        true
    }

    /// `prependHistory`: loads the next older page; the store's flush mounts it.
    fn load_older(&self, tui: &Tui) -> bool {
        let Some(session) = self.session.borrow().clone() else {
            return false;
        };
        if self.loading.get() || !tui.data.read(|state| state.has_more_messages(&session)) {
            return false;
        }
        self.loading.set(true);
        self.hint.visible(true);
        *self.start.borrow_mut() = Start::Top;
        let data = tui.data.clone();
        let weak = self.this.clone();
        tui.app.spawn(
            async move { data.message_load_more(&session, LoadMore::default()).await },
            move |_, result| {
                let Some(inner) = weak.upgrade() else { return };
                inner.loading.set(false);
                inner.hint.visible(false);
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                match result {
                    Ok(_) => inner.complete_group_boundary(&tui),
                    Err(error) => tui.toasts.error(error.to_string()),
                }
            },
        );
        true
    }

    /// `updateAwayFromBottom`: away from the bottom the window stays put; back at it, the window
    /// follows the tail again.
    fn follow(&self, tui: &Tui, down: bool) {
        // Rows mounted since the last frame are not in the content's size yet.
        let frame = tui.app.frame_number();
        if self
            .pin
            .borrow()
            .as_ref()
            .is_some_and(|pin| frame <= pin.frame + 1)
        {
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
        Start::Row(key) => specs
            .iter()
            .position(|spec| spec.key() == *key)
            .map_or(tail, |index| index.min(tail)),
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

/// What rows read while they render.
pub struct Context<'a> {
    /// Never call into the keymap or `tui.data.read` from a row: the store is locked while rows
    /// render, and its mutex is not reentrant.
    pub tui: &'a Tui,
    /// The store, locked while rows render.
    pub state: &'a State,
    pub keys: &'a Keys,
    pub session: &'a SessionID,
    pub app: &'a App,
    pub theme: &'a Theme,
    pub syntax: &'a SyntaxTheme,
    /// Reasoning's syntax: every style in `text.muted` (`thinking-syntax.ts`).
    pub thinking_syntax: &'a SyntaxTheme,
    pub renderers: &'a CodeBlockRenderers,
    /// `session.markdown` is `rendered`.
    pub conceal: bool,
    /// `session.thinking` is `hide`.
    pub hide_thinking: bool,
    pub groups: &'a Rc<grouping::Settings>,
    /// `session.tps`.
    pub tps: bool,
    /// `debug.turn_tokens` is `verbose`.
    pub verbose_tokens: bool,
    /// `session.image_preview`.
    pub image_preview: bool,
    /// The session's directory.
    pub directory: Option<&'a str>,
    /// `animations` (spinners move).
    pub animations: bool,
    pub mode: ThemeMode,
    /// The terminal width.
    pub width: u16,
    pub session_agent: Option<&'a str>,
    /// The location's agents that are not hidden, and its models.
    pub agents: Vec<&'a AgentInfo>,
    pub models: &'a [ModelInfo],
    /// The visible messages, oldest first, and each one's position.
    pub messages: &'a [SessionMessageInfo],
    pub index: HashMap<&'a str, usize>,
    /// No idle markers: a turn ends at the next prompt (`SessionTurn.legacy`).
    pub legacy: bool,
}

impl Context<'_> {
    /// The session view's content width (`ctx.width`): the terminal less the route's padding.
    pub fn content_width(&self) -> usize {
        usize::from(self.width).saturating_sub(4)
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
        // The new designs palette keeps its vivid accent at 400; 200 there is a muted tint.
        let step = 400;
        let mut colors: Vec<Color> = Vec::new();
        for scale in self.theme.categorical() {
            let color = scale.step(step);
            if !colors.contains(&color) {
                colors.push(color);
            }
        }
        let Some(index) = self
            .agents
            .iter()
            .position(|item| item.id.as_str() == agent)
        else {
            return colors[0];
        };
        self.agents[index]
            .color
            .as_ref()
            .and_then(|color| hex(color.as_str()))
            .unwrap_or(colors[index % colors.len()])
    }

    /// The model's name, else `provider/model` (`AssistantFooter`'s `model`).
    pub fn model_name(&self, model: &ModelRef) -> String {
        self.models
            .iter()
            .find(|item| item.provider_id == model.provider_id && item.id == model.id)
            .map_or_else(
                || format!("{}/{}", model.provider_id.as_str(), model.id),
                |item| item.name.clone(),
            )
    }
}

/// An assistant part a row shows: `text:<n>`, `reasoning:<n>`, or a tool call ID (`resolvePart`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Part {
    Text(usize),
    Reasoning(usize),
    Tool(String),
}

impl Part {
    pub fn resolve<'a>(
        &self,
        message: &'a SessionMessageAssistant,
    ) -> Option<&'a SessionMessageAssistantContentItem> {
        let (want_text, ordinal) = match self {
            Self::Tool(id) => {
                return message.content.iter().find(
                    |item| matches!(item, SessionMessageAssistantContentItem::Tool(tool) if tool.id == *id),
                );
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

/// One row of the transcript (`SessionRow`, ungrouped).
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
            Self::TurnUsage { messages, .. } => {
                RowKey::TurnUsage(messages.first().cloned().unwrap_or_default())
            }
            Self::Group(group) => RowKey::Group(group.id(0).unwrap_or_default()),
            Self::CompactionQueued(id) => RowKey::CompactionQueued(id.clone()),
        }
    }

    /// The messages whose change re-renders the row: a turn's usage follows its last step, and a
    /// group every row in it.
    fn messages(&self) -> Vec<&str> {
        match self {
            Self::Message(id)
            | Self::Footer(id)
            | Self::Part { message: id, .. }
            | Self::CompactionQueued(id) => vec![id],
            Self::TurnUsage { messages, .. } => {
                messages.last().map(String::as_str).into_iter().collect()
            }
            Self::Group(group) => group
                .entries()
                .into_iter()
                .flat_map(|spec| spec.messages())
                .collect(),
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
        let used: Vec<_> = steps
            .drain(..)
            .filter(|step| footer::total(step) > 0.0)
            .collect();
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
                if synthetic
                    .description
                    .as_deref()
                    .is_none_or(|text| text.trim().is_empty()) =>
            {
                continue;
            }
            SessionMessageInfo::Compaction(compaction) => {
                match compaction {
                    SessionMessageCompaction::Failed(failed) => {
                        shown_error =
                            Some((failed.error.r#type.clone(), failed.error.message.clone()))
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
        shown_error = assistant
            .error
            .as_ref()
            .map(|error| (error.r#type.clone(), error.message.clone()));
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
            rows.push(Spec::Part {
                message: assistant.id.0.clone(),
                part,
            });
        }
        let terminal = assistant.finish.as_ref().is_some_and(|finish| {
            !matches!(
                finish,
                SessionMessageAssistantFinish::ToolCalls | SessionMessageAssistantFinish::Unknown2
            )
        }) || assistant.error.is_some();
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
    !messages
        .iter()
        .any(|message| matches!(message, SessionMessageInfo::Idle(_)))
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
        let wrapper = View::new(cx.app)
            .column()
            .shrink(0.0)
            .margin_edge(Edge::Top, 1);
        let body = match spec {
            Spec::Message(id) => match cx.message(id) {
                Some(SessionMessageInfo::User(_)) => Body::User(user::User::new(cx)),
                Some(SessionMessageInfo::Shell(_)) => Body::Shell(shell::Shell::new(cx)),
                Some(SessionMessageInfo::Compaction(_)) => {
                    Body::Compaction(compaction::Compaction::new(cx))
                }
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
        };
        let root = match &body {
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
        };
        wrapper.add(root);
        Self { wrapper, body }
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
                    && let Some(SessionMessageAssistantContentItem::Text(text)) =
                        part.resolve(assistant)
                {
                    view.update(assistant, text);
                }
            }
            (Body::Reasoning(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(message)
                    && let Some(SessionMessageAssistantContentItem::Reasoning(reasoning)) =
                        part.resolve(assistant)
                {
                    view.update(cx, assistant, reasoning);
                }
            }
            (Body::Tool(view), Spec::Part { message, part }) => {
                if let Some(assistant) = cx.assistant(message)
                    && let Some(SessionMessageAssistantContentItem::Tool(tool)) =
                        part.resolve(assistant)
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

/// `RGBA.fromHex` for `#rgb`, `#rrggbb`, and `#rrggbbaa`.
fn hex(value: &str) -> Option<Color> {
    let digits = value.strip_prefix('#').unwrap_or(value);
    let digits: String = match digits.len() {
        3 => digits.chars().flat_map(|digit| [digit, digit]).collect(),
        6 | 8 => digits.to_owned(),
        _ => return None,
    };
    let value = u32::from_str_radix(&digits, 16).ok()?;
    Some(if digits.len() == 8 {
        let [r, g, b, a] = value.to_be_bytes();
        Color::rgba(r, g, b, a)
    } else {
        Color::hex(value)
    })
}

/// Every style of `syntax` with `foreground` as its color.
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
        let part = |message: &str, part| Spec::Part {
            message: message.into(),
            part,
        };
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
        // With `debug.turn_tokens`, a legacy turn ends with its terminal step.
        let usage = reduce(&list, true);
        assert_eq!(
            usage.last(),
            Some(&Spec::TurnUsage {
                messages: vec!["msg_2".into(), "msg_3".into()],
                previous: None,
            })
        );
    }

    #[test]
    fn the_window_follows_the_tail_until_pinned() {
        let specs: Vec<Spec> = (0..100)
            .map(|index| Spec::Message(format!("msg_{index:03}")))
            .collect();
        let weights = vec![1; 100];
        assert_eq!(
            window_start(&Start::Tail, &specs, &weights),
            100 - TAIL_ROWS
        );
        assert_eq!(window_start(&Start::Top, &specs, &weights), 0);
        let pinned = Start::Row(RowKey::Message("msg_010".into()));
        assert_eq!(window_start(&pinned, &specs, &weights), 10);
        // A pinned row inside the tail still mounts the whole tail; a vanished one falls back.
        let late = Start::Row(RowKey::Message("msg_090".into()));
        assert_eq!(window_start(&late, &specs, &weights), 100 - TAIL_ROWS);
        let gone = Start::Row(RowKey::Message("msg_x".into()));
        assert_eq!(window_start(&gone, &specs, &weights), 100 - TAIL_ROWS);
        assert_eq!(window_start(&Start::Tail, &specs[..5], &weights[..5]), 0);
        // An open group costs its children: fewer rows fill the tail.
        let mut heavy = weights.clone();
        heavy[95] = 10;
        assert_eq!(
            window_start(&Start::Tail, &specs, &heavy),
            100 - TAIL_ROWS + 9
        );
    }
}
