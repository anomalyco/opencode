//! Find-in-session bar, key mode, match navigation, and Markdown highlight attachment.

use std::collections::VecDeque;
use std::sync::Arc;

use opencode_ui::markdown::{
    CodeBlockRenderers, MarkdownParser, ParsedMarkdown, ShownBlock, hyperlinks, tag_untagged_code_blocks,
};
use opentui::syntax::SyntaxTheme;
use opentui::widget::{CodeBlock, InlineContext, InlineSpan, Input, Markdown, MarkdownColors, WeakWidget};

use super::find::{
    FindMatch, FindPart, FindPartId, FindPartKey, FindPattern, PLAIN_FENCE_LANG, find_matches, find_pattern,
    find_ranges, paint_inline_spans, paint_spans, wrapped_row,
};
use super::messages::list::{Context, Transcript};
use super::scroll::{self, after_layout};
use crate::features::session_links::{self, Links};
use crate::prelude::*;

pub const FIND_MODE: &str = "find";

type RowLocator = Box<dyn Fn() -> Option<f64>>;
type OnVisibility = Box<dyn Fn(&Tui, bool)>;

struct ShownEntry {
    pattern_key: String,
    text: String,
    conceal: bool,
    hyperlinks: bool,
    has_claimed: bool,
    count: usize,
}

struct CachedBlock {
    text: String,
    claimed: bool,
}

struct CachedBlocks {
    text: String,
    conceal: bool,
    hyperlinks: bool,
    blocks: Vec<CachedBlock>,
}

struct FindSpot {
    matched: FindMatch,
    pattern_key: String,
    row: RowLocator,
}

/// Active find state read by mounted transcript rows during a render or patch.
pub struct FindSnapshot {
    pub pattern: FindPattern,
    pub current: Option<FindMatch>,
    parse_epoch: u64,
    handle: Weak<FindInner>,
}

impl FindSnapshot {
    /// Occurrence index of the current match if it falls inside `key`.
    pub fn current_occurrence(&self, key: &FindPartKey) -> Option<usize> {
        self.current.as_ref().filter(|matched| matched.key == *key).map(|matched| matched.occurrence)
    }

    /// Parses `source` through the shared widget-free native Markdown engine.
    pub fn parse_markdown(&self, tui: &Tui, source: &str, conceal: bool) -> ParsedMarkdown {
        match self.handle.upgrade() {
            Some(inner) => inner.parse_markdown(tui, source, conceal),
            None => ParsedMarkdown::default(),
        }
    }

    /// Reports how many matches a rendered part shows for the current pattern.
    pub fn counted(&self, key: FindPartKey, text: &str, conceal: bool, links: bool, has_claimed: bool, count: usize) {
        if let Some(inner) = self.handle.upgrade() {
            inner.counted(key, &self.pattern.key, text, conceal, links, has_claimed, count);
        }
    }

    /// Reports how to read the screen row of `matched` once laid out.
    pub fn located(&self, matched: FindMatch, row: impl Fn() -> Option<f64> + 'static) {
        if let Some(inner) = self.handle.upgrade() {
            inner.located(matched, &self.pattern.key, Box::new(row));
        }
    }
}

/// Cloneable weak handle given to [`Transcript`] so rows can query active find state with zero cost
/// when Find is closed.
#[derive(Clone, Default)]
pub struct FindHandle(Weak<FindInner>);

impl FindHandle {
    pub fn snapshot(&self) -> Option<FindSnapshot> {
        let inner = self.0.upgrade()?;
        if !inner.open.get() {
            return None;
        }
        let pattern = inner.pattern.borrow().clone()?;
        let current = inner.current();
        Some(FindSnapshot { pattern, current, parse_epoch: inner.parse_epoch.get(), handle: self.0.clone() })
    }
}

/// Session-scoped controller for Find-in-session. The bar widgets and native Markdown parser mount
/// lazily on first open so sessions that never open Find allocate neither.
pub struct Find(Rc<FindInner>);

pub(super) struct FindInner {
    tui: Weak<Tui>,
    this: Weak<FindInner>,
    transcript: Transcript,
    scroll: Weak<scroll::Inner>,
    root: View,
    bar: RefCell<Option<FindBar>>,
    parser: RefCell<Option<MarkdownParser>>,
    parsed_cache: RefCell<HashMap<FindPartKey, CachedBlocks>>,
    on_visibility: OnVisibility,
    open: Cell<bool>,
    query: RefCell<String>,
    pattern: RefCell<Option<FindPattern>>,
    selected: RefCell<Option<FindMatch>>,
    shown: RefCell<HashMap<FindPartKey, ShownEntry>>,
    list: RefCell<Vec<FindMatch>>,
    index: Cell<usize>,
    seek: RefCell<Option<FindMatch>>,
    spot: RefCell<Option<FindSpot>>,
    reconcile_due: Cell<bool>,
    pinning: Cell<bool>,
    parse_epoch: Cell<u64>,
    layers: RefCell<Vec<Disposer>>,
    resize: Cell<Option<HandlerId>>,
    settings: RefCell<Option<Disposer>>,
}

struct FindBar {
    frame: View,
    body: View,
    input: Input,
    counter: Text,
    bottom: View,
    edge: View,
    next_hint: Text,
    prev_hint: Text,
    close_hint: Text,
}

impl FindBar {
    fn new(tui: &Tui, inner: &Rc<FindInner>) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let width = app.size().0;
        let padding = if width < 44 { 1 } else { 2 };
        let cursor = crate::features::system_commands::cursor(&tui.config());
        let input = Input::new(app)
            .width(Length::percent(100.0))
            .placeholder("Find in session...")
            .cursor_style(cursor.0, cursor.1);
        input.on_change(bind!(inner, |inner, _, value| {
            let Some(tui) = inner.tui.upgrade() else { return };
            inner.on_input(&tui, value);
        }));
        let counter = Text::new(app, "Find").wrap(WrapMode::None);
        let counter_row = View::new(app).row().shrink(0.0).padding_edge(Edge::Top, 1).child(&counter);
        let body = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .shrink(0.0)
            .width(Length::percent(100.0))
            .padding_edge(Edge::Left, padding)
            .padding_edge(Edge::Right, padding)
            .padding_edge(Edge::Top, 1)
            .child(&input)
            .child(&counter_row);
        let frame = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .shrink(0.0)
            .border_sides(Sides::LEFT)
            .border_chars(Some(border_chars('┃', '╹', ' ')))
            .child(&body);
        let edge = View::new(app).height(1).grow(1.0).basis(Length::Auto).border_sides(Sides::BOTTOM);
        let bottom = View::new(app).row().height(1).shrink(0.0).border_sides(Sides::LEFT).child(&edge);
        let wide = width >= 50;
        let next_hint = Text::new(app, "").wrap(WrapMode::None).shrink(0.0).visible(wide);
        let prev_hint = Text::new(app, "").wrap(WrapMode::None).shrink(0.0).visible(wide);
        let close_hint = Text::new(app, "").wrap(WrapMode::None).shrink(0.0);
        let footer = View::new(app)
            .row()
            .width(Length::percent(100.0))
            .height(1)
            .shrink(0.0)
            .justify(Justify::End)
            .gap(2)
            .child(&next_hint)
            .child(&prev_hint)
            .child(&close_hint);
        inner.root.add(&frame);
        inner.root.add(&bottom);
        inner.root.add(&footer);
        let bar = Self { frame, body, input, counter, bottom, edge, next_hint, prev_hint, close_hint };
        bar.paint(&theme, "", 0, 0);
        bar
    }

    fn paint(&self, theme: &Theme, query: &str, index: usize, count: usize) {
        let background = theme.decrease(&theme.background.raised.base, 1);
        self.frame.border_color(theme.border.base);
        self.body.bg(background);
        self.input
            .colors(theme.text.base, Color::TRANSPARENT)
            .focused_colors(theme.text.base, Color::TRANSPARENT)
            .placeholder_color(theme.text.muted)
            .cursor_color(theme.text.base);
        let opaque = background.a != 0;
        self.bottom.border_color(theme.border.base).border_chars(Some(border_chars(
            if opaque { '╹' } else { ' ' },
            ' ',
            ' ',
        )));
        self.edge.border_color(background).border_chars(Some(border_chars(' ', ' ', if opaque { '▀' } else { ' ' })));
        let muted = Style::new().fg(theme.text.muted);
        self.next_hint.fg(theme.text.base).set_text(vec![Span::raw("enter "), Span::styled("next", muted)]);
        self.prev_hint.fg(theme.text.base).set_text(vec![Span::raw("shift+enter "), Span::styled("previous", muted)]);
        self.close_hint.fg(theme.text.base).set_text(vec![Span::raw("esc "), Span::styled("close", muted)]);
        self.paint_counter(theme, query, index, count);
    }

    fn paint_counter(&self, theme: &Theme, query: &str, index: usize, count: usize) {
        self.counter.fg(theme.text.base);
        if query.is_empty() {
            self.counter.set_text("Find");
            return;
        }
        let status = if count > 0 { format!(" · {} of {count}", index + 1) } else { " · No matches".to_owned() };
        self.counter.set_text(vec![Span::raw("Find"), Span::styled(status, Style::new().fg(theme.text.muted))]);
    }

    fn layout_for_width(&self, width: u16) {
        let padding = if width < 44 { 1 } else { 2 };
        self.body.padding_edge(Edge::Left, padding).padding_edge(Edge::Right, padding);
        let wide = width >= 50;
        self.next_hint.visible(wide);
        self.prev_hint.visible(wide);
    }
}

impl Find {
    pub fn new(
        tui: &Tui,
        transcript: &Transcript,
        scroll: &scroll::Controls,
        on_visibility: impl Fn(&Tui, bool) + 'static,
    ) -> Self {
        let root = View::new(&tui.app).column().width(Length::percent(100.0)).shrink(0.0).visible(false);
        let inner = Rc::new_cyclic(|this| FindInner {
            tui: tui.weak(),
            this: this.clone(),
            transcript: transcript.clone(),
            scroll: Rc::downgrade(&scroll.0),
            root,
            bar: RefCell::new(None),
            parser: RefCell::new(None),
            parsed_cache: RefCell::new(HashMap::new()),
            on_visibility: Box::new(on_visibility),
            open: Cell::new(false),
            query: RefCell::new(String::new()),
            pattern: RefCell::new(None),
            selected: RefCell::new(None),
            shown: RefCell::new(HashMap::new()),
            list: RefCell::new(Vec::new()),
            index: Cell::new(0),
            seek: RefCell::new(None),
            spot: RefCell::new(None),
            reconcile_due: Cell::new(false),
            pinning: Cell::new(false),
            parse_epoch: Cell::new(0),
            layers: RefCell::default(),
            resize: Cell::new(None),
            settings: RefCell::default(),
        });
        transcript.set_find(FindHandle(Rc::downgrade(&inner)));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn is_open(&self) -> bool {
        self.0.open.get()
    }

    pub fn input(&self) -> Option<Input> {
        self.0.bar.borrow().as_ref().map(|bar| bar.input.clone())
    }

    pub fn close(&self, tui: &Tui, restore_prompt: bool) {
        self.0.close(tui, restore_prompt);
    }

    /// Recomputes matches after transcript or session-title updates while Find is open.
    pub fn sync(&self, tui: &Tui, sessions_changed: bool) {
        if !self.0.open.get() {
            return;
        }
        if sessions_changed {
            self.0.parsed_cache.borrow_mut().clear();
            self.0.shown.borrow_mut().clear();
            self.0.parse_epoch.set(self.0.parse_epoch.get().wrapping_add(1));
        }
        if self.0.pattern.borrow().is_some() {
            self.0.reconcile(tui);
        }
    }

    pub fn restyle(&self, tui: &Tui) {
        self.0.parsed_cache.borrow_mut().clear();
        self.0.parse_epoch.set(self.0.parse_epoch.get().wrapping_add(1));
        if let Some(bar) = self.0.bar.borrow().as_ref() {
            let theme = tui.page();
            bar.paint(&theme, &self.0.query.borrow(), self.0.index.get(), self.0.list.borrow().len());
        }
    }

    pub(super) fn weak(&self) -> Weak<FindInner> {
        Rc::downgrade(&self.0)
    }
}

impl Drop for Find {
    fn drop(&mut self) {
        let layers = std::mem::take(&mut *self.0.layers.borrow_mut());
        let resize = self.0.resize.take();
        *self.0.settings.borrow_mut() = None;
        *self.0.spot.borrow_mut() = None;
        *self.0.parser.borrow_mut() = None;
        self.0.parsed_cache.borrow_mut().clear();
        if let Some(tui) = self.0.tui.upgrade() {
            if let Some(id) = resize {
                tui.app.remove_handler(id);
            }
            if !layers.is_empty() {
                tui.app.defer(move |_| drop(layers));
            }
        }
    }
}

impl FindInner {
    pub(super) fn open(&self, tui: &Tui) {
        let Some(this) = self.this.upgrade() else { return };
        if self.bar.borrow().is_none() {
            let bar = FindBar::new(tui, &this);
            *self.bar.borrow_mut() = Some(bar);
            self.resize.set(Some(tui.app.on_resize(bind!(self.this, |inner, _, width, _| {
                if let Some(bar) = inner.bar.borrow().as_ref() {
                    bar.layout_for_width(width);
                }
                if inner.open.get()
                    && inner.pattern.borrow().is_some()
                    && let Some(tui) = inner.tui.upgrade()
                {
                    inner.reconcile(&tui);
                }
            }))));
            *self.settings.borrow_mut() = Some(tui.settings.subscribe(bind!(self.this, |inner, tui| {
                let cursor = crate::features::system_commands::cursor(&tui.config());
                if let Some(bar) = inner.bar.borrow().as_ref() {
                    bar.input.cursor_style(cursor.0, cursor.1);
                }
                if inner.open.get() && inner.pattern.borrow().is_some() {
                    inner.reconcile(tui);
                }
            })));
        }
        if !self.open.replace(true) {
            self.root.visible(true);
            (self.on_visibility)(tui, true);
            let active = Condition::when(bind!(tui, |tui| !tui.dialogs.is_open()));
            let mut layers = self.layers.borrow_mut();
            layers.push(tui.keymap.push_mode(FIND_MODE, active));
            let commands = vec![
                TuiCommand::inline(
                    "return,down",
                    bind!(self.this, |inner, _, _| {
                        if let Some(tui) = inner.tui.upgrade() {
                            inner.move_match(&tui, 1);
                        }
                    }),
                )
                .title("Next match")
                .group("Find"),
                TuiCommand::inline(
                    "shift+return,up",
                    bind!(self.this, |inner, _, _| {
                        if let Some(tui) = inner.tui.upgrade() {
                            inner.move_match(&tui, -1);
                        }
                    }),
                )
                .title("Previous match")
                .group("Find"),
                TuiCommand::inline(
                    "escape",
                    bind!(self.this, |inner, _, _| {
                        if let Some(tui) = inner.tui.upgrade() {
                            inner.close(&tui, true);
                        }
                    }),
                )
                .title("Close find")
                .group("Find"),
            ];
            match tui.keymap.layer(KeymapLayer::new(commands).mode(FIND_MODE)) {
                Ok(disposer) => layers.push(disposer),
                Err(error) => log::error!("find keymap layer: {error}"),
            }
            drop(layers);
            self.paint_counter(tui);
        }
        if let Some(bar) = self.bar.borrow().as_ref() {
            tui.app.focus(&bar.input);
        }
    }

    pub(super) fn close(&self, tui: &Tui, restore_prompt: bool) {
        if !self.open.replace(false) {
            return;
        }
        *self.seek.borrow_mut() = None;
        *self.spot.borrow_mut() = None;
        self.query.borrow_mut().clear();
        *self.pattern.borrow_mut() = None;
        *self.selected.borrow_mut() = None;
        self.shown.borrow_mut().clear();
        self.parsed_cache.borrow_mut().clear();
        *self.parser.borrow_mut() = None;
        self.list.borrow_mut().clear();
        self.index.set(0);
        let layers = std::mem::take(&mut *self.layers.borrow_mut());
        if !layers.is_empty() {
            tui.app.defer(move |_| drop(layers));
        }
        if let Some(bar) = self.bar.borrow().as_ref() {
            bar.input.set_value("");
        }
        self.root.visible(false);
        self.transcript.clear_find_pinned(tui);
        self.transcript.refresh_find(tui);
        if restore_prompt {
            (self.on_visibility)(tui, false);
        }
    }

    fn parse_markdown(&self, tui: &Tui, source: &str, conceal: bool) -> ParsedMarkdown {
        let mut slot = self.parser.borrow_mut();
        let parser = match slot.as_mut() {
            Some(parser) => parser,
            None => match MarkdownParser::new(&tui.app) {
                Ok(parser) => slot.insert(parser),
                Err(_) => return ParsedMarkdown::default(),
            },
        };
        let renderers = self.transcript.renderers();
        let syntax = self.transcript.syntax();
        parser.parse(&tui.app, source, renderers, conceal, &syntax, |spans, icx| {
            session_links::transform_readonly(tui, spans, icx)
        })
    }

    /// Ensures `parsed_cache` holds the parsed blocks for `part` and returns whether any
    /// plugin-claimed code block in `part` matches `pattern`, plus the non-claimed match count.
    fn inspect_unmounted(
        &self,
        tui: &Tui,
        part: &FindPart,
        pattern: &FindPattern,
        conceal: bool,
        links: bool,
    ) -> (bool, usize) {
        let hit = {
            let cache = self.parsed_cache.borrow();
            cache
                .get(&part.key)
                .filter(|entry| entry.text == part.text && entry.conceal == conceal && entry.hyperlinks == links)
                .map(|entry| scan_cached_blocks(&entry.blocks, pattern))
        };
        if let Some(result) = hit {
            return result;
        }
        let parsed = self.parse_markdown(tui, &part.text, conceal);
        let blocks: Vec<CachedBlock> = parsed
            .blocks
            .into_iter()
            .map(|block| CachedBlock { claimed: block.is_claimed_code(), text: block.text().to_owned() })
            .collect();
        let result = scan_cached_blocks(&blocks, pattern);
        self.parsed_cache
            .borrow_mut()
            .insert(part.key.clone(), CachedBlocks { text: part.text.clone(), conceal, hyperlinks: links, blocks });
        result
    }

    fn on_input(&self, tui: &Tui, value: &str) {
        if !self.open.get() {
            return;
        }
        let prev_key = self.pattern.borrow().as_ref().map(|pattern| pattern.key.clone());
        value.clone_into(&mut self.query.borrow_mut());
        let next_pattern = find_pattern(value);
        let next_key = next_pattern.as_ref().map(|pattern| pattern.key.clone());
        let same = prev_key == next_key;
        *self.pattern.borrow_mut() = next_pattern;
        if !same {
            *self.selected.borrow_mut() = None;
            *self.spot.borrow_mut() = None;
            self.shown.borrow_mut().clear();
        }
        self.recompute(tui);
        self.paint_counter(tui);
        if !same {
            self.transcript.refresh_find(tui);
            self.reveal(tui, self.current());
        }
    }

    fn move_match(&self, tui: &Tui, delta: isize) {
        let len = self.list.borrow().len();
        if len == 0 {
            return;
        }
        let next_index = (self.index.get() as isize + delta).rem_euclid(len as isize) as usize;
        let next = self.list.borrow()[next_index].clone();
        *self.selected.borrow_mut() = Some(next.clone());
        self.index.set(next_index);
        *self.spot.borrow_mut() = None;
        self.paint_counter(tui);
        self.transcript.refresh_find(tui);
        self.reveal(tui, Some(next));
    }

    fn current(&self) -> Option<FindMatch> {
        self.list.borrow().get(self.index.get()).cloned()
    }

    fn recompute(&self, tui: &Tui) {
        let pattern = self.pattern.borrow().clone();
        let conceal = self.transcript.conceal();
        let links = hyperlinks(&tui.app);
        let next_list = match pattern.as_ref() {
            Some(pattern) => {
                let parts = self.transcript.find_parts(tui);
                // Find any Markdown parts with a plugin-claimed fence whose code matches `pattern`:
                // mount only those rare parts for real so their plugins decide without throwaway probes.
                let mut pinned = Vec::new();
                let mut counts: Vec<Option<usize>> = Vec::with_capacity(parts.len());
                for part in &parts {
                    if !part.markdown {
                        counts.push(Some(find_ranges(&part.text, Some(pattern)).len()));
                        continue;
                    }
                    let shown = self
                        .shown
                        .borrow()
                        .get(&part.key)
                        .filter(|entry| {
                            !entry.has_claimed
                                && entry.pattern_key == pattern.key
                                && entry.text == part.text
                                && entry.conceal == conceal
                                && entry.hyperlinks == links
                        })
                        .map(|entry| entry.count);
                    if let Some(count) = shown {
                        counts.push(Some(count));
                        continue;
                    }
                    let (has_claimed_match, unmounted_count) =
                        self.inspect_unmounted(tui, part, pattern, conceal, links);
                    if has_claimed_match {
                        pinned.push(part.key.clone());
                        counts.push(None);
                        continue;
                    }
                    counts.push(Some(unmounted_count));
                }
                self.pinning.set(true);
                self.transcript.pin_find_rows(tui, &pinned);
                self.pinning.set(false);
                let mut index = 0usize;
                find_matches(&parts, Some(pattern), |part, _| {
                    let count = counts[index].unwrap_or_else(|| {
                        self.shown
                            .borrow()
                            .get(&part.key)
                            .filter(|entry| {
                                entry.pattern_key == pattern.key
                                    && entry.text == part.text
                                    && entry.conceal == conceal
                                    && entry.hyperlinks == links
                            })
                            .map_or(0, |entry| entry.count)
                    });
                    index += 1;
                    count
                })
            }
            None => {
                self.transcript.clear_find_pinned(tui);
                Vec::new()
            }
        };
        let selected = self.selected.borrow().clone();
        let next_index =
            selected.as_ref().and_then(|wanted| next_list.iter().position(|item| item == wanted)).unwrap_or(0);
        *self.list.borrow_mut() = next_list;
        self.index.set(next_index);
    }

    fn paint_counter(&self, tui: &Tui) {
        if let Some(bar) = self.bar.borrow().as_ref() {
            bar.paint_counter(&tui.page(), &self.query.borrow(), self.index.get(), self.list.borrow().len());
        }
    }

    fn reveal(&self, tui: &Tui, target: Option<FindMatch>) {
        *self.seek.borrow_mut() = target.clone();
        if self.pattern.borrow().is_none() {
            return;
        }
        let Some(target) = target else { return };
        self.transcript.mount_find_row(tui, &target.key);
        after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                if let Some(tui) = inner.tui.upgrade() {
                    inner.locate(&tui, target);
                }
            }),
        );
    }

    fn locate(&self, tui: &Tui, target: FindMatch) {
        if self.seek.borrow().as_ref() != Some(&target) {
            return;
        }
        let active_key = self.pattern.borrow().as_ref().map(|pattern| pattern.key.clone());
        let row = self.spot.borrow().as_ref().and_then(|spot| {
            (spot.matched == target && Some(&spot.pattern_key) == active_key.as_ref()).then(|| (spot.row)()).flatten()
        });
        if let Some(screen_y) = row {
            *self.seek.borrow_mut() = None;
            if let Some(scroll) = self.scroll.upgrade() {
                scroll.center_find(tui, target.key.message_id, screen_y);
            }
            return;
        }
        let Some(rect) = self.transcript.find_row_rect(tui, &target.key) else { return };
        let viewport = self.transcript.scroll().rect();
        let clamped =
            rect.screen_y < viewport.screen_y && self.spot.borrow().as_ref().is_some_and(|spot| spot.matched == target);
        let offscreen = rect.screen_y + f64::from(rect.height) <= viewport.screen_y
            || rect.screen_y >= viewport.screen_y + f64::from(viewport.height);
        if rect.height > 0.0
            && (offscreen || clamped)
            && let Some(scroll) = self.scroll.upgrade()
        {
            scroll.center_find(tui, target.key.message_id.clone(), rect.screen_y);
            after_layout(
                &tui.app,
                bind!(self.this, |inner| {
                    let Some(tui) = inner.tui.upgrade() else { return };
                    after_layout(
                        &tui.app,
                        bind!(inner.this, |inner| {
                            if let Some(tui) = inner.tui.upgrade() {
                                inner.locate(&tui, target);
                            }
                        }),
                    );
                }),
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn counted(
        &self,
        key: FindPartKey,
        pattern_key: &str,
        text: &str,
        conceal: bool,
        links: bool,
        has_claimed: bool,
        count: usize,
    ) {
        let mut shown = self.shown.borrow_mut();
        if shown.get(&key).is_some_and(|entry| {
            entry.pattern_key == pattern_key
                && entry.text == text
                && entry.conceal == conceal
                && entry.hyperlinks == links
                && entry.has_claimed == has_claimed
                && entry.count == count
        }) {
            return;
        }
        shown.insert(
            key,
            ShownEntry {
                pattern_key: pattern_key.to_owned(),
                text: text.to_owned(),
                conceal,
                hyperlinks: links,
                has_claimed,
                count,
            },
        );
        drop(shown);
        if self.pinning.get() {
            return;
        }
        if !self.reconcile_due.replace(true)
            && let Some(tui) = self.tui.upgrade()
        {
            tui.app.defer(bind!(self.this, |inner, _| {
                inner.reconcile_due.set(false);
                if let Some(tui) = inner.tui.upgrade() {
                    inner.reconcile(&tui);
                }
            }));
        }
    }

    fn reconcile(&self, tui: &Tui) {
        if !self.open.get() {
            return;
        }
        let previous = self.current();
        self.recompute(tui);
        self.paint_counter(tui);
        let next = self.current();
        if next != previous {
            self.transcript.refresh_find(tui);
            if *self.seek.borrow() != next {
                self.reveal(tui, next);
            }
        }
    }

    fn located(&self, matched: FindMatch, pattern_key: &str, row: RowLocator) {
        if self.pattern.borrow().as_ref().is_none_or(|pattern| pattern.key != pattern_key) {
            return;
        }
        *self.spot.borrow_mut() = Some(FindSpot { matched: matched.clone(), pattern_key: pattern_key.to_owned(), row });
        if self.seek.borrow().as_ref() == Some(&matched)
            && let Some(tui) = self.tui.upgrade()
        {
            after_layout(
                &tui.app,
                bind!(self.this, |inner| {
                    if let Some(tui) = inner.tui.upgrade() {
                        inner.locate(&tui, matched);
                    }
                }),
            );
        }
    }
}

/// Attaches Find highlighting, counting, and match-row locating to a transcript `Markdown` widget
/// (`TextPart` and `Compaction`). Allocates nothing while Find is closed.
#[derive(Default)]
pub struct FindMarkdown {
    active: Cell<bool>,
    tagged_plain: Cell<bool>,
    inner: RefCell<Option<Rc<RefCell<FindMarkdownInner>>>>,
}

#[derive(Clone)]
enum MatchLoc {
    Code { widget: WeakWidget, code: String, byte_offset: usize },
    Prose { top_index: usize, shown: String, byte_offset: usize },
    Table { top_index: usize, row: usize, total_rows: usize },
}

#[derive(Clone)]
struct CodeSlot {
    drawn: bool,
    /// When `drawn` is false and Find built a custom highlight `View(Text)`, holds `container`
    /// weakly (to verify Markdown still shows it) and `text` for in-place `Text::set_text`.
    highlight: Option<(WeakWidget, Text)>,
}

struct FindMarkdownInner {
    pattern: Option<FindPattern>,
    current: Option<usize>,
    last_source: String,
    last_conceal: bool,
    last_hyperlinks: bool,
    last_colors: (Color, Color, Color),
    last_width: u16,
    last_parse_epoch: u64,
    last_parsed: Option<Rc<ParsedMarkdown>>,
    has_claimed: bool,
    theme: Theme,
    syntax: Arc<SyntaxTheme>,
    md_colors: MarkdownColors,
    registered_langs: Vec<String>,
    pass_active: bool,
    actual_total: usize,
    code_slots: Vec<CodeSlot>,
    actual_code_slots: Vec<CodeSlot>,
    prose_plan: VecDeque<(usize, usize)>,
    table_plan: VecDeque<(usize, usize, usize, usize)>,
    code_plan: VecDeque<usize>,
    current_loc: Option<MatchLoc>,
}

fn feed_raw(markdown: &Markdown, text: &str) {
    let kept =
        markdown.with_markdown(|shown| (shown != text).then(|| if text.starts_with(shown) { shown.len() } else { 0 }));
    match kept {
        Some(0) => {
            markdown.set_markdown(text);
        }
        Some(len) => {
            markdown.append(&text[len..]);
        }
        None => {}
    }
}

impl FindMarkdown {
    /// Feeds Markdown content into `markdown`. When Find is closed, keeps the exact streaming fast
    /// path with zero extra work; when Find is open and untagged code blocks are tagged, defers to
    /// `sync` to feed the updated tagged text once.
    pub fn feed(&self, markdown: &Markdown, text: &str, find_active: bool) {
        if find_active && self.tagged_plain.get() {
            return;
        }
        feed_raw(markdown, text);
    }

    /// Synchronizes Find highlights and counts on `markdown` using the shared native Markdown parser.
    pub fn sync(
        &self,
        cx: &Context<'_>,
        markdown: &Markdown,
        links: &Rc<Links>,
        message_id: &str,
        part: FindPartId,
        source: &str,
    ) {
        let Some(active) = cx.find else {
            if self.active.replace(false) {
                self.clear(cx.tui, markdown, links, cx.renderers, source);
            }
            return;
        };
        let part_key = FindPartKey { message_id: message_id.to_owned(), part };
        let colors = (cx.theme.find.text.current, cx.theme.find.background.r#match, cx.theme.find.background.current);
        let has_links = hyperlinks(cx.app);
        let my_current = active.current_occurrence(&part_key);
        let state = {
            let mut slot = self.inner.borrow_mut();
            slot.get_or_insert_with(|| {
                Rc::new(RefCell::new(FindMarkdownInner {
                    pattern: None,
                    current: None,
                    last_source: String::new(),
                    last_conceal: cx.conceal,
                    last_hyperlinks: has_links,
                    last_colors: colors,
                    last_width: cx.content,
                    last_parse_epoch: active.parse_epoch,
                    last_parsed: None,
                    has_claimed: false,
                    theme: cx.theme.clone(),
                    syntax: cx.syntax.clone(),
                    md_colors: opencode_ui::markdown::view_colors(cx.theme, cx.syntax),
                    registered_langs: Vec::new(),
                    pass_active: false,
                    actual_total: 0,
                    code_slots: Vec::new(),
                    actual_code_slots: Vec::new(),
                    prose_plan: VecDeque::new(),
                    table_plan: VecDeque::new(),
                    code_plan: VecDeque::new(),
                    current_loc: None,
                }))
            })
            .clone()
        };
        let was_active = self.active.replace(true);
        let unchanged = {
            let inner = state.borrow();
            was_active
                && inner.pattern.as_ref() == Some(&active.pattern)
                && inner.current == my_current
                && inner.last_source == source
                && inner.last_conceal == cx.conceal
                && inner.last_hyperlinks == has_links
                && inner.last_colors == colors
                && inner.last_parse_epoch == active.parse_epoch
                && (!inner.has_claimed || inner.last_width == cx.content)
        };
        if unchanged {
            return;
        }
        let fresh_empty = markdown.with_markdown(str::is_empty);
        let reuse_parsed = {
            let inner = state.borrow();
            was_active
                && !fresh_empty
                && inner.last_source == source
                && inner.last_conceal == cx.conceal
                && inner.last_hyperlinks == has_links
                && inner.last_parse_epoch == active.parse_epoch
                && inner.last_parsed.is_some()
        };
        let parsed: Rc<ParsedMarkdown> = if reuse_parsed {
            state.borrow().last_parsed.clone().unwrap()
        } else {
            let parsed = Rc::new(active.parse_markdown(cx.tui, source, cx.conceal));
            state.borrow_mut().last_parsed = Some(parsed.clone());
            parsed
        };
        let tagged = if reuse_parsed { None } else { tag_untagged_code_blocks(source, &parsed, PLAIN_FENCE_LANG) };
        if !fresh_empty && !reuse_parsed {
            if let Some(tagged) = &tagged {
                feed_raw(markdown, tagged);
                self.tagged_plain.set(true);
            } else if self.tagged_plain.replace(false) {
                feed_raw(markdown, source);
            }
        }
        // Register code-block renderers for every code block language in this document.
        let mut needed: Vec<String> = Vec::new();
        for block in &parsed.blocks {
            let lang = match block {
                ShownBlock::Code { language: Some(lang), .. } => Some(lang.as_str()),
                ShownBlock::Code { has_info: false, .. } => Some(PLAIN_FENCE_LANG),
                _ => None,
            };
            if let Some(lang) = lang
                && !needed.iter().any(|existing| existing == lang)
            {
                needed.push(lang.to_owned());
            }
        }
        for lang in needed {
            if state.borrow().registered_langs.contains(&lang) {
                continue;
            }
            let original = cx.renderers.get(&lang).cloned();
            let state_ref = state.clone();
            markdown.code_block_renderer(&lang, move |block: &CodeBlock<'_>| {
                if !state_ref.borrow().pass_active {
                    // During wrapper registration on a non-empty widget, keep any existing custom
                    // widget in place without issuing a duplicate plugin render call.
                    return block.previous.cloned();
                }
                let first = state_ref.borrow_mut().code_plan.pop_front().unwrap_or(0);
                if let Some(original) = &original
                    && let Some(widget) = original(block)
                {
                    state_ref.borrow_mut().actual_code_slots.push(CodeSlot { drawn: true, highlight: None });
                    return Some(widget);
                }
                let mut inner = state_ref.borrow_mut();
                let Some(pattern) = inner.pattern.as_ref() else {
                    inner.actual_code_slots.push(CodeSlot { drawn: false, highlight: None });
                    return None;
                };
                let ranges = find_ranges(block.code, Some(pattern));
                inner.actual_total += ranges.len();
                if ranges.is_empty() {
                    inner.actual_code_slots.push(CodeSlot { drawn: false, highlight: None });
                    return None;
                }
                let lang = (block.language != PLAIN_FENCE_LANG).then_some(block.language);
                let base = highlight_code_spans(block.code, lang, &inner.syntax, inner.md_colors.text);
                let painted = paint_spans(base, &ranges, first, inner.current, &inner.theme);
                let text = Text::new(block.app, painted).fg(inner.md_colors.text).wrap(WrapMode::Word);
                let container = View::new(block.app).bg(inner.md_colors.code_bg).child(&text);
                inner
                    .actual_code_slots
                    .push(CodeSlot { drawn: false, highlight: Some((container.downgrade(), text.clone())) });
                if let Some(occ) = inner.current
                    && occ >= first
                    && occ < first + ranges.len()
                {
                    let range = ranges[occ - first];
                    inner.current_loc = Some(MatchLoc::Code {
                        widget: text.downgrade(),
                        code: block.code.to_owned(),
                        byte_offset: range.start,
                    });
                }
                Some(container.as_any())
            });
            state.borrow_mut().registered_langs.push(lang);
        }
        let (assumed_drawn, in_place, nested_code_with_inline) = {
            let mut inner = state.borrow_mut();
            let source_changed = inner.last_source != source;
            let conceal_changed = inner.last_conceal != cx.conceal;
            let has_claimed = parsed.blocks.iter().any(ShownBlock::is_claimed_code);
            let width_changed = has_claimed && inner.last_width != cx.content;
            if source_changed {
                inner.code_slots.clear();
            }
            // When our inline_hook is already installed on an unchanged document and every code
            // block that matches `active.pattern` already has a live highlight `Text` widget (or is
            // drawn by a plugin), update prose/tables via `rerun_inline_hook` and code spans via
            // `Text::set_text` without rebuilding sibling plugin-drawn fences.
            let code_count = parsed.blocks.iter().filter(|b| matches!(b, ShownBlock::Code { .. })).count();
            // A code block nested inside a list/quote alongside prose shares its `top_index` with
            // inline content, so `rerun_inline_hook` would rebuild that code block too.
            let nested_code_with_inline = parsed.blocks.iter().any(|block| {
                let ShownBlock::Code { top_index, .. } = block else { return false };
                parsed.blocks.iter().any(|other| {
                    matches!(
                        other,
                        ShownBlock::Prose { top_index: other_top, .. }
                            | ShownBlock::TableCell { top_index: other_top, .. }
                        if other_top == top_index
                    )
                })
            });
            let in_place = was_active
                && !fresh_empty
                && !source_changed
                && !conceal_changed
                && !width_changed
                && !nested_code_with_inline
                && inner.code_slots.len() == code_count
                && parsed
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        ShownBlock::Code { text, .. } => Some(text.as_str()),
                        _ => None,
                    })
                    .enumerate()
                    .all(|(idx, code)| match inner.code_slots.get(idx) {
                        Some(slot) if slot.drawn => true,
                        Some(slot) if slot.highlight.as_ref().is_some_and(|(c, _)| c.upgrade().is_some()) => true,
                        Some(_) => find_ranges(code, Some(&active.pattern)).is_empty(),
                        None => false,
                    });
            inner.pattern = Some(active.pattern.clone());
            inner.current = my_current;
            source.clone_into(&mut inner.last_source);
            inner.last_conceal = cx.conceal;
            inner.last_hyperlinks = has_links;
            inner.last_colors = colors;
            inner.last_width = cx.content;
            inner.last_parse_epoch = active.parse_epoch;
            inner.has_claimed = has_claimed;
            inner.theme = cx.theme.clone();
            inner.syntax = cx.syntax.clone();
            inner.md_colors = opencode_ui::markdown::view_colors(cx.theme, cx.syntax);
            (prepare_pass(&mut inner, &parsed, &active.pattern), in_place, nested_code_with_inline)
        };
        let install_hook = || {
            let weak_tui = cx.tui.weak();
            let weak_links = Rc::downgrade(links);
            let state_ref = state.clone();
            opencode_ui::markdown::inline_hook(
                markdown,
                cx.renderers,
                move |spans: Vec<InlineSpan>, icx: &InlineContext<'_>| {
                    let spans = match (weak_tui.upgrade(), weak_links.upgrade()) {
                        (Some(tui), Some(links)) => links.transform(&tui, spans, icx),
                        _ => spans,
                    };
                    let mut inner = state_ref.borrow_mut();
                    let Some(pattern) = inner.pattern.as_ref() else {
                        return spans;
                    };
                    let joined: String = spans.iter().map(|span| span.span.content.as_ref()).collect();
                    let ranges = find_ranges(&joined, Some(pattern));
                    if !inner.pass_active {
                        return paint_inline_spans(spans, &ranges, 0, None, &inner.theme);
                    }
                    inner.actual_total += ranges.len();
                    if icx.table_cell {
                        let (top_index, row, total_rows, first) = inner.table_plan.pop_front().unwrap_or((0, 0, 1, 0));
                        if inner.current.is_some_and(|occ| occ >= first && occ < first + ranges.len()) {
                            inner.current_loc = Some(MatchLoc::Table { top_index, row, total_rows });
                        }
                        paint_inline_spans(spans, &ranges, first, inner.current, &inner.theme)
                    } else {
                        let (top_index, first) = inner.prose_plan.pop_front().unwrap_or((0, 0));
                        if let Some(occ) = inner.current.filter(|&occ| occ >= first && occ < first + ranges.len()) {
                            let range = ranges[occ - first];
                            inner.current_loc =
                                Some(MatchLoc::Prose { top_index, shown: joined, byte_offset: range.start });
                        }
                        paint_inline_spans(spans, &ranges, first, inner.current, &inner.theme)
                    }
                },
            );
        };
        let repaint_in_place = || {
            markdown.rerun_inline_hook(|_| true);
            let mut inner = state.borrow_mut();
            let mut code_idx = 0usize;
            for block in &parsed.blocks {
                let ShownBlock::Code { language, text, .. } = block else { continue };
                let first = inner.code_plan.pop_front().unwrap_or(0);
                let slot = inner.code_slots.get(code_idx).cloned();
                code_idx += 1;
                let Some(slot) = slot else { continue };
                if slot.drawn {
                    continue;
                }
                let ranges = find_ranges(text, Some(&active.pattern));
                inner.actual_total += ranges.len();
                if let Some((_, widget)) = slot.highlight.as_ref().filter(|(c, _)| c.upgrade().is_some()) {
                    let base = highlight_code_spans(text, language.as_deref(), &inner.syntax, inner.md_colors.text);
                    let painted = if ranges.is_empty() {
                        base
                    } else {
                        paint_spans(base, &ranges, first, inner.current, &inner.theme)
                    };
                    widget.set_text(painted);
                    if let Some(occ) = inner.current.filter(|&occ| occ >= first && occ < first + ranges.len()) {
                        inner.current_loc = Some(MatchLoc::Code {
                            widget: widget.downgrade(),
                            code: text.clone(),
                            byte_offset: ranges[occ - first].start,
                        });
                    }
                }
            }
        };
        if in_place {
            repaint_in_place();
        } else {
            install_hook();
            if fresh_empty {
                let shown_text = tagged.as_deref().unwrap_or(source);
                self.tagged_plain.set(tagged.is_some());
                feed_raw(markdown, shown_text);
            }
        }
        let needs_repaint = {
            let mut inner = state.borrow_mut();
            inner.pass_active = false;
            let actual = std::mem::take(&mut inner.actual_code_slots);
            if !in_place {
                inner.code_slots = actual;
            }
            !in_place
                && my_current.is_some()
                && !inner.code_slots.iter().map(|slot| slot.drawn).eq(assumed_drawn.iter().copied())
        };
        if needs_repaint {
            {
                let mut inner = state.borrow_mut();
                prepare_pass(&mut inner, &parsed, &active.pattern);
            }
            if nested_code_with_inline {
                install_hook();
                let mut inner = state.borrow_mut();
                inner.pass_active = false;
                inner.code_slots = std::mem::take(&mut inner.actual_code_slots);
            } else {
                repaint_in_place();
                state.borrow_mut().pass_active = false;
            }
        }
        let (total, has_claimed, loc) = {
            let inner = state.borrow();
            (inner.actual_total, inner.has_claimed, inner.current_loc.clone())
        };
        active.counted(part_key.clone(), source, cx.conceal, has_links, has_claimed, total);
        if let Some(occurrence) = my_current {
            let md = markdown.clone();
            let row = move || -> Option<f64> {
                match &loc {
                    Some(MatchLoc::Code { widget, code, byte_offset }) => {
                        let widget = widget.upgrade()?;
                        let rect = widget.rect();
                        (rect.height > 0.0)
                            .then(|| rect.screen_y + f64::from(wrapped_row(code, *byte_offset, rect.width as u16)))
                    }
                    Some(MatchLoc::Prose { top_index, shown, byte_offset }) => {
                        let md_rect = md.rect();
                        let rows = md.block_rows();
                        let range = rows.get(*top_index)?;
                        if range.start == 0 && md_rect.screen_y < 0.0 {
                            return None;
                        }
                        let width = md_rect.width as u16;
                        Some(f64::from(range.start) + f64::from(wrapped_row(shown, *byte_offset, width)))
                    }
                    Some(MatchLoc::Table { top_index, row, total_rows }) => {
                        let md_rect = md.rect();
                        let rows = md.block_rows();
                        let range = rows.get(*top_index)?;
                        if range.start == 0 && md_rect.screen_y < 0.0 {
                            return None;
                        }
                        let height = range.end.saturating_sub(range.start);
                        Some(f64::from(range.start + (height * (*row as u32)) / (*total_rows).max(1) as u32))
                    }
                    None => {
                        let rect = md.rect();
                        (rect.height > 0.0).then_some(rect.screen_y)
                    }
                }
            };
            active.located(FindMatch { key: part_key, occurrence }, row);
        }
    }

    fn clear(&self, tui: &Tui, markdown: &Markdown, links: &Rc<Links>, renderers: &CodeBlockRenderers, source: &str) {
        let tagged_plain = self.tagged_plain.replace(false);
        let Some(state) = self.inner.borrow_mut().take() else { return };
        let langs = {
            let mut inner = state.borrow_mut();
            inner.pattern = None;
            inner.current = None;
            inner.pass_active = false;
            inner.code_slots.clear();
            inner.actual_code_slots.clear();
            inner.last_parsed = None;
            std::mem::take(&mut inner.registered_langs)
        };
        for lang in langs {
            if let Some(original) = renderers.get(&lang).cloned() {
                markdown.code_block_renderer(&lang, move |block| original(block));
            } else {
                markdown.remove_code_block_renderer(&lang);
            }
        }
        if tagged_plain {
            markdown.set_markdown(source);
        }
        let weak_tui = tui.weak();
        let weak_links = Rc::downgrade(links);
        opencode_ui::markdown::inline_hook(markdown, renderers, move |spans, icx| {
            match (weak_tui.upgrade(), weak_links.upgrade()) {
                (Some(tui), Some(links)) => links.transform(&tui, spans, icx),
                _ => spans,
            }
        });
    }
}

fn scan_cached_blocks(blocks: &[CachedBlock], pattern: &FindPattern) -> (bool, usize) {
    let mut has_claimed_match = false;
    let mut total = 0usize;
    for block in blocks {
        let count = find_ranges(&block.text, Some(pattern)).len();
        if block.claimed && count > 0 {
            has_claimed_match = true;
        }
        total += count;
    }
    (has_claimed_match, total)
}

fn highlight_code_spans(code: &str, language: Option<&str>, syntax: &SyntaxTheme, fg: Color) -> Vec<Span<'static>> {
    if let Some(language) = language
        && let Some(captures) = opentui::syntax::highlights(code, language)
    {
        opentui::syntax::spans(code, &captures, syntax)
    } else {
        vec![Span::styled(code.to_owned(), Style::new().fg(fg))]
    }
}

/// Populates the preorder occurrence queues for a `FindMarkdown` pass using the last known
/// per-code-block `code_slots` outcomes (defaulting claimed fences to drawn on the first pass).
fn prepare_pass(inner: &mut FindMarkdownInner, parsed: &ParsedMarkdown, pattern: &FindPattern) -> Vec<bool> {
    inner.pass_active = true;
    inner.actual_total = 0;
    inner.actual_code_slots.clear();
    inner.prose_plan.clear();
    inner.table_plan.clear();
    inner.code_plan.clear();
    inner.current_loc = None;
    let mut cursor = 0usize;
    let mut code_index = 0usize;
    let mut assumed = Vec::new();
    for block in &parsed.blocks {
        match block {
            ShownBlock::Prose { top_index, text } => {
                let count = find_ranges(text, Some(pattern)).len();
                inner.prose_plan.push_back((*top_index, cursor));
                cursor += count;
            }
            ShownBlock::TableCell { top_index, row, total_rows, text } => {
                let count = find_ranges(text, Some(pattern)).len();
                inner.table_plan.push_back((*top_index, *row, *total_rows, cursor));
                cursor += count;
            }
            ShownBlock::Code { claimed, text, .. } => {
                let drawn = *claimed && inner.code_slots.get(code_index).is_none_or(|slot| slot.drawn);
                assumed.push(drawn);
                code_index += 1;
                inner.code_plan.push_back(cursor);
                if !drawn {
                    cursor += find_ranges(text, Some(pattern)).len();
                }
            }
        }
    }
    assumed
}

fn border_chars(vertical: char, bottom_left: char, horizontal: char) -> [char; 11] {
    [' ', ' ', bottom_left, ' ', horizontal, vertical, ' ', ' ', ' ', ' ', ' ']
}
