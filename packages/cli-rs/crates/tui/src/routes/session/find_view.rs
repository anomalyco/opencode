//! Find-in-session bar, key mode, match navigation, and Markdown highlight attachment.

use std::sync::Arc;

use opencode_ui::markdown::CodeBlockRenderers;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{CodeBlock, InlineContext, InlineSpan, Input, Markdown, MarkdownColors, WeakWidget};

use super::find::{
    FindMatch, FindPartKey, FindPattern, PLAIN_FENCE_LANG, TopBlock, find_matches, find_pattern, find_ranges,
    paint_inline_spans, paint_spans, scan_fences, tag_plain_fences, top_level_blocks, wrapped_row,
};
use super::messages::list::{Context, Transcript};
use super::scroll::{self, after_layout};
use crate::features::session_links::Links;
use crate::prelude::*;

pub const FIND_MODE: &str = "find";

type RowLocator = Box<dyn Fn() -> Option<f64>>;
type OnVisibility = Box<dyn Fn(&Tui, bool)>;

struct ShownEntry {
    pattern_key: String,
    text: String,
    conceal: bool,
    count: usize,
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
    handle: Weak<FindInner>,
}

impl FindSnapshot {
    /// Occurrence index of the current match if it falls inside `key`.
    pub fn current_occurrence(&self, key: &FindPartKey) -> Option<usize> {
        self.current.as_ref().filter(|matched| matched.key == *key).map(|matched| matched.occurrence)
    }

    /// Reports how many matches a rendered part shows for the current pattern.
    pub fn counted(&self, key: FindPartKey, text: &str, conceal: bool, count: usize) {
        if let Some(inner) = self.handle.upgrade() {
            inner.counted(key, &self.pattern.key, text, conceal, count);
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
        Some(FindSnapshot { pattern, current, handle: self.0.clone() })
    }
}

/// Session-scoped controller for Find-in-session. The bar widgets mount lazily on first open so
/// sessions that never open Find allocate no extra input or handlers.
pub struct Find(Rc<FindInner>);

pub(super) struct FindInner {
    tui: Weak<Tui>,
    this: Weak<FindInner>,
    transcript: Transcript,
    scroll: Weak<scroll::Inner>,
    root: View,
    bar: RefCell<Option<FindBar>>,
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

    /// Recomputes matches after transcript updates while Find is open.
    pub fn sync(&self, tui: &Tui) {
        if self.0.open.get() && self.0.pattern.borrow().is_some() {
            self.0.reconcile(tui);
        }
    }

    pub fn restyle(&self, tui: &Tui) {
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
        self.transcript.refresh_find(tui);
        if restore_prompt {
            (self.on_visibility)(tui, false);
        }
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
        let next_list = match pattern.as_ref() {
            Some(pattern) => {
                let parts = self.transcript.find_parts(tui);
                let shown = self.shown.borrow();
                find_matches(&parts, Some(pattern), conceal, |part| {
                    shown
                        .get(&part.key)
                        .filter(|entry| {
                            entry.pattern_key == pattern.key && entry.text == part.text && entry.conceal == conceal
                        })
                        .map(|entry| entry.count)
                })
            }
            None => Vec::new(),
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

    fn counted(&self, key: FindPartKey, pattern_key: &str, text: &str, conceal: bool, count: usize) {
        let mut shown = self.shown.borrow_mut();
        if shown.get(&key).is_some_and(|entry| {
            entry.pattern_key == pattern_key && entry.text == text && entry.conceal == conceal && entry.count == count
        }) {
            return;
        }
        shown.insert(key, ShownEntry { pattern_key: pattern_key.to_owned(), text: text.to_owned(), conceal, count });
        drop(shown);
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
    inner: RefCell<Option<Rc<RefCell<FindMarkdownInner>>>>,
}

#[derive(Clone)]
enum MatchLoc {
    Code { widget: WeakWidget, code: String, byte_offset: usize },
    Prose { top_index: usize, shown: String, byte_offset: usize },
    Table { top_index: usize, row: usize, total_rows: usize },
}

struct FindMarkdownInner {
    pattern: Option<FindPattern>,
    current: Option<usize>,
    last_source: String,
    last_conceal: bool,
    last_colors: (Color, Color, Color),
    theme: Theme,
    syntax: Arc<SyntaxTheme>,
    md_colors: MarkdownColors,
    tagged_plain: bool,
    registered_langs: Vec<String>,
    pass_active: bool,
    cursor: usize,
    top_blocks: Vec<TopBlock>,
    search_pos: usize,
    table_state: Option<(usize, usize)>,
    current_loc: Option<MatchLoc>,
}

impl FindMarkdown {
    /// Feeds Markdown content into `markdown`, tagging plain fences when Find is active so
    /// `code_block_renderer` receives them. When Find is closed, keeps the exact streaming fast path.
    pub fn feed(&self, markdown: &Markdown, text: &str, find_active: bool) {
        let tagged = find_active.then(|| tag_plain_fences(text)).flatten();
        let shown_text = tagged.as_deref().unwrap_or(text);
        if let Some(inner) = self.inner.borrow().as_ref() {
            inner.borrow_mut().tagged_plain = tagged.is_some();
        }
        let kept = markdown.with_markdown(|shown| {
            (shown != shown_text).then(|| if shown_text.starts_with(shown) { shown.len() } else { 0 })
        });
        match kept {
            Some(0) => {
                markdown.set_markdown(shown_text);
            }
            Some(len) => {
                markdown.append(&shown_text[len..]);
            }
            None => {}
        }
    }

    /// Synchronizes Find highlights and counts on `markdown`.
    pub fn sync(&self, cx: &Context<'_>, markdown: &Markdown, links: &Rc<Links>, part_key: FindPartKey, source: &str) {
        let Some(active) = cx.find else {
            if self.active.replace(false) {
                self.clear(cx.tui, markdown, links, cx.renderers, source);
            }
            return;
        };
        let colors = (cx.theme.find.text.current, cx.theme.find.background.r#match, cx.theme.find.background.current);
        let my_current = active.current_occurrence(&part_key);
        let state = {
            let mut slot = self.inner.borrow_mut();
            slot.get_or_insert_with(|| {
                Rc::new(RefCell::new(FindMarkdownInner {
                    pattern: None,
                    current: None,
                    last_source: String::new(),
                    last_conceal: cx.conceal,
                    last_colors: colors,
                    theme: cx.theme.clone(),
                    syntax: cx.syntax.clone(),
                    md_colors: opencode_ui::markdown::view_colors(cx.theme, cx.syntax),
                    tagged_plain: false,
                    registered_langs: Vec::new(),
                    pass_active: false,
                    cursor: 0,
                    top_blocks: Vec::new(),
                    search_pos: 0,
                    table_state: None,
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
                && inner.last_colors == colors
        };
        if unchanged {
            return;
        }
        let (langs, has_plain) = scan_fences(source);
        if has_plain && !state.borrow().tagged_plain {
            self.feed(markdown, source, true);
        } else if !has_plain && state.borrow().tagged_plain {
            self.feed(markdown, source, false);
        }
        let mut needed = langs;
        if has_plain {
            needed.push(PLAIN_FENCE_LANG.to_owned());
        }
        for lang in needed {
            if state.borrow().registered_langs.contains(&lang) {
                continue;
            }
            let original = cx.renderers.get(&lang).cloned();
            let state_ref = state.clone();
            markdown.code_block_renderer(&lang, move |block: &CodeBlock<'_>| {
                if let Some(original) = &original
                    && let Some(widget) = original(block)
                {
                    return Some(widget);
                }
                let mut inner = state_ref.borrow_mut();
                let pattern = inner.pattern.as_ref()?;
                let ranges = find_ranges(block.code, Some(pattern));
                let first = if inner.pass_active {
                    let first = inner.cursor;
                    inner.cursor += ranges.len();
                    first
                } else {
                    return None;
                };
                if ranges.is_empty() {
                    return None;
                }
                let base = if block.language == PLAIN_FENCE_LANG {
                    vec![Span::styled(block.code.to_owned(), Style::new().fg(inner.md_colors.text))]
                } else if let Some(captures) = opentui::syntax::highlights(block.code, block.language) {
                    opentui::syntax::spans(block.code, &captures, &inner.syntax)
                } else {
                    vec![Span::styled(block.code.to_owned(), Style::new().fg(inner.md_colors.text))]
                };
                let painted = paint_spans(base, &ranges, first, inner.current, &inner.theme);
                let text = Text::new(block.app, painted).fg(inner.md_colors.text).wrap(WrapMode::Word);
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
                Some(View::new(block.app).bg(inner.md_colors.code_bg).child(&text).as_any())
            });
            state.borrow_mut().registered_langs.push(lang);
        }
        {
            let mut inner = state.borrow_mut();
            inner.pattern = Some(active.pattern.clone());
            inner.current = my_current;
            source.clone_into(&mut inner.last_source);
            inner.last_conceal = cx.conceal;
            inner.last_colors = colors;
            inner.theme = cx.theme.clone();
            inner.syntax = cx.syntax.clone();
            inner.md_colors = opencode_ui::markdown::view_colors(cx.theme, cx.syntax);
            inner.pass_active = true;
            inner.cursor = 0;
            inner.top_blocks = top_level_blocks(source);
            inner.search_pos = 0;
            inner.table_state = None;
            inner.current_loc = None;
        }
        let weak_tui = cx.tui.weak();
        let links_ref = links.clone();
        let state_ref = state.clone();
        opencode_ui::markdown::inline_hook(
            markdown,
            cx.renderers,
            move |spans: Vec<InlineSpan>, icx: &InlineContext<'_>| {
                let spans = match weak_tui.upgrade() {
                    Some(tui) => links_ref.transform(&tui, spans, icx),
                    None => spans,
                };
                let mut inner = state_ref.borrow_mut();
                let Some(pattern) = inner.pattern.as_ref() else {
                    return spans;
                };
                let joined: String = spans.iter().map(|span| span.span.content.as_ref()).collect();
                let ranges = find_ranges(&joined, Some(pattern));
                let first = if inner.pass_active {
                    let first = inner.cursor;
                    inner.cursor += ranges.len();
                    first
                } else {
                    return paint_inline_spans(spans, &ranges, 0, None, &inner.theme);
                };
                let hit = inner.current.filter(|&occ| occ >= first && occ < first + ranges.len());
                if icx.table_cell {
                    let (top_index, row, total_rows) = locate_table_cell(&mut inner, icx.source);
                    if hit.is_some() {
                        inner.current_loc = Some(MatchLoc::Table { top_index, row, total_rows });
                    }
                } else {
                    let top_index = locate_prose_block(&mut inner, icx.source);
                    if let Some(occ) = hit {
                        let range = ranges[occ - first];
                        inner.current_loc =
                            Some(MatchLoc::Prose { top_index, shown: joined, byte_offset: range.start });
                    }
                }
                paint_inline_spans(spans, &ranges, first, inner.current, &inner.theme)
            },
        );
        let (total, loc) = {
            let mut inner = state.borrow_mut();
            inner.pass_active = false;
            (inner.cursor, inner.current_loc.clone())
        };
        active.counted(part_key.clone(), source, cx.conceal, total);
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
        let Some(state) = self.inner.borrow_mut().take() else { return };
        let (langs, tagged_plain) = {
            let mut inner = state.borrow_mut();
            inner.pattern = None;
            inner.current = None;
            inner.pass_active = false;
            (std::mem::take(&mut inner.registered_langs), inner.tagged_plain)
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
        let links_ref = links.clone();
        opencode_ui::markdown::inline_hook(markdown, renderers, move |spans, icx| match weak_tui.upgrade() {
            Some(tui) => links_ref.transform(&tui, spans, icx),
            None => spans,
        });
    }
}

fn locate_prose_block(inner: &mut FindMarkdownInner, inline_source: &str) -> usize {
    inner.table_state = None;
    let needle = inline_source.trim();
    if !needle.is_empty()
        && let Some(rel) = inner.last_source[inner.search_pos..].find(needle)
    {
        let at = inner.search_pos + rel;
        inner.search_pos = at + needle.len();
        if let Some(index) = inner.top_blocks.iter().position(|block| at >= block.start && at < block.end) {
            return index;
        }
    }
    inner
        .top_blocks
        .iter()
        .position(|block| inner.search_pos >= block.start && inner.search_pos < block.end)
        .unwrap_or(0)
}

fn locate_table_cell(inner: &mut FindMarkdownInner, cell_source: &str) -> (usize, usize, usize) {
    let (top_index, cell_pos) = match inner.table_state {
        Some((top, pos)) => (top, pos),
        None => {
            let top = inner
                .top_blocks
                .iter()
                .position(|block| block.table_rows.is_some() && block.end > inner.search_pos)
                .or_else(|| inner.top_blocks.iter().position(|block| block.table_rows.is_some()))
                .unwrap_or(0);
            let start = inner.top_blocks.get(top).map_or(0, |block| block.start);
            inner.table_state = Some((top, start));
            (top, start)
        }
    };
    let Some(block) = inner.top_blocks.get(top_index) else { return (0, 0, 1) };
    let total_rows = block.table_rows.unwrap_or(1);
    let slice = &inner.last_source[block.start..block.end];
    let rel_start = cell_pos.saturating_sub(block.start).min(slice.len());
    let needle = cell_source.trim();
    let hit_rel = if !needle.is_empty() {
        slice[rel_start..].find(needle).map(|found| {
            let at = rel_start + found;
            inner.table_state = Some((top_index, block.start + at + needle.len()));
            inner.search_pos = inner.search_pos.max(block.start + at + needle.len());
            at
        })
    } else {
        None
    }
    .unwrap_or(rel_start);
    // Line 0 is the header (row 0), line 1 is the delimiter (skipped), line 2+ are body rows (row 1+).
    let raw_line = slice[..hit_rel].bytes().filter(|&byte| byte == b'\n').count();
    let row = raw_line.saturating_sub(1).min(total_rows.saturating_sub(1));
    (top_index, row, total_rows)
}

fn border_chars(vertical: char, bottom_left: char, horizontal: char) -> [char; 11] {
    [' ', ' ', bottom_left, ' ', horizontal, vertical, ' ', ' ', ' ', ' ', ' ']
}
