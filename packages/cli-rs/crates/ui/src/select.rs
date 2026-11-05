//! Select dialog (U.3): `packages/tui/src/ui/dialog-select.tsx` and `ui/select-controller.ts`.
//!
//! [`select`] builds `DialogSelect` inside a dialog: a search input, options grouped by category, fuzzy filtering
//! with `fuzzysort`'s scores and order ([`fuzzy`]), keyboard and mouse selection, actions with their shortcuts in
//! the footer, and the `dialog.select.*` commands. It returns a [`Select`] handle, the TS `DialogSelectRef`.

use crate::bind;
use crate::dialog::{
    DIALOG_INSET, DIALOG_LIST_INSET, DialogCx, Dialogs, FocusId, FooterAction, FooterProps, HeaderProps, header,
    layout_view,
};
use crate::fuzzy;
use crate::keymap::{Bind, KeymapLayer, TuiCommand};
use crate::theme::Surface;
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

/// How a long title is cut (`truncateTitle`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Truncate {
    /// `Locale.truncate`: cut the end.
    #[default]
    Right,
    /// `Locale.truncateLeft`: cut the start.
    Left,
    /// Show the whole title.
    None,
}

/// A handler of one option.
pub type OnOption<T> = Rc<dyn Fn(&SelectOption<T>)>;
/// An option's own select handler, given the dialog stack.
pub type OnDialog = Rc<dyn Fn(&Dialogs)>;
/// A handler of text, such as the filter.
pub type OnText = Rc<dyn Fn(&str)>;
/// Whether an action is disabled for the selected option.
pub type ActionDisabled<T> = Rc<dyn Fn(Option<&SelectOption<T>>) -> bool>;

/// Draws a row's gutter in the row's text color (TS `gutter`).
pub type Gutter = Rc<dyn Fn(&App, Color) -> AnyWidget>;

/// What shows below the list while an option is selected (TS `detail`).
#[derive(Clone)]
pub enum Detail {
    /// Muted text that wraps by word.
    Text(String),
    /// Built each time the option becomes selected.
    View(Rc<dyn Fn(&DialogCx) -> AnyWidget>),
}

/// `DialogSelectChoice`: the trailing value of a row that can be changed. The selected row shows how: `‹ dark ›`
/// cycles with ←/→, `opencode ↵` opens a picker. Other rows pad the value to the same width so it does not shift
/// as the selection moves. The value extends two cells into the row's right padding, so it ends where plain
/// footers do.
#[derive(Clone, Debug, PartialEq)]
pub struct Choice {
    pub value: String,
    /// Enter opens a picker instead of cycling.
    pub open: bool,
}

/// `DialogSelectOption`.
#[derive(Clone)]
pub struct SelectOption<T> {
    pub title: String,
    pub value: T,
    pub description: Option<String>,
    pub search_text: Option<String>,
    /// The footer while the list is flattened by a search.
    pub search_footer: Option<String>,
    /// Muted lines under the row, cut in the middle to fit.
    pub details: Vec<String>,
    pub footer: Option<String>,
    pub footer_color: Option<Color>,
    /// The footer's own color, kept on the highlighted row too (a styled span in TS, such as the favorite marker).
    pub footer_fg: Option<Color>,
    /// Cells the footer extends into the row's right padding, such as 2 for a `DialogSelectChoice` value.
    pub footer_overhang: u32,
    pub title_width: Option<usize>,
    pub truncate: Truncate,
    /// Replaces the title (TS `titleView`): spans with their own color, or the row's for `None`.
    pub title_spans: Option<Vec<(String, Option<Color>)>>,
    pub category: Option<String>,
    pub disabled: bool,
    /// The row background while selected.
    pub bg: Option<Color>,
    /// The row text color while selected.
    pub fg: Option<Color>,
    pub gutter: Option<Gutter>,
    /// Shown below the list while this option is selected.
    pub detail: Option<Detail>,
    /// Replaces the footer with a value that can be changed.
    pub choice: Option<Choice>,
    pub on_select: Option<OnDialog>,
}

impl<T> SelectOption<T> {
    pub fn new(title: impl Into<String>, value: T) -> Self {
        Self {
            title: title.into(),
            value,
            description: None,
            search_text: None,
            search_footer: None,
            details: Vec::new(),
            footer: None,
            footer_color: None,
            footer_fg: None,
            footer_overhang: 0,
            title_width: None,
            truncate: Truncate::Right,
            title_spans: None,
            category: None,
            disabled: false,
            bg: None,
            fg: None,
            gutter: None,
            detail: None,
            choice: None,
            on_select: None,
        }
    }

    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn category(mut self, category: impl Into<String>) -> Self {
        self.category = Some(category.into());
        self
    }

    pub fn footer(mut self, footer: impl Into<String>) -> Self {
        self.footer = Some(footer.into());
        self
    }

    pub fn search_text(mut self, text: impl Into<String>) -> Self {
        self.search_text = Some(text.into());
        self
    }

    pub fn on_select(mut self, run: impl Fn(&Dialogs) + 'static) -> Self {
        self.on_select = Some(Rc::new(run));
        self
    }
}

/// The footer group an action sits in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Primary,
    Secondary,
}

/// What an action runs on.
pub enum ActionRun<T> {
    /// The selected option; the action is disabled without one.
    Selected(OnOption<T>),
    /// The dialog (`selection: "none"`).
    Dialog(Rc<dyn Fn()>),
}

impl<T> Clone for ActionRun<T> {
    fn clone(&self) -> Self {
        match self {
            Self::Selected(run) => Self::Selected(run.clone()),
            Self::Dialog(run) => Self::Dialog(run.clone()),
        }
    }
}

/// A title that may follow the selected option, such as `favorite` and `unfavorite`.
pub type ActionTitle<T> = Rc<dyn Fn(Option<&SelectOption<T>>) -> String>;

/// `DialogSelectAction`: a command shown in the footer with its shortcut.
pub struct SelectAction<T> {
    pub command: String,
    pub title: ActionTitle<T>,
    /// The binding when the config has none.
    pub bind: Option<String>,
    pub group: Option<Group>,
    pub hidden: bool,
    /// Hides the action for some selections, such as a toggle that only applies to some rows. Its binding is off
    /// while it is hidden, so the key goes on to the select.
    pub hidden_when: Option<ActionDisabled<T>>,
    pub disabled: Option<ActionDisabled<T>>,
    pub run: ActionRun<T>,
}

impl<T> Clone for SelectAction<T> {
    fn clone(&self) -> Self {
        Self {
            command: self.command.clone(),
            title: self.title.clone(),
            bind: self.bind.clone(),
            group: self.group,
            hidden: self.hidden,
            hidden_when: self.hidden_when.clone(),
            disabled: self.disabled.clone(),
            run: self.run.clone(),
        }
    }
}

impl<T: 'static> SelectAction<T> {
    pub fn new(command: impl Into<String>, title: impl Into<String>, run: impl Fn(&SelectOption<T>) + 'static) -> Self {
        let title = title.into();
        Self {
            command: command.into(),
            title: Rc::new(move |_| title.clone()),
            bind: None,
            group: None,
            hidden: false,
            hidden_when: None,
            disabled: None,
            run: ActionRun::Selected(Rc::new(run)),
        }
    }
}

/// `footerHints`: a label shown in the footer with no command.
#[derive(Clone, Debug)]
pub struct FooterHint {
    pub title: String,
    pub label: String,
    pub group: Option<Group>,
}

/// Options for a filter, from the TS `search` prop: they replace filtering, and the list is flat.
pub type Search<T> = Rc<dyn Fn(&str) -> Vec<SelectOption<T>>>;
/// Options as a function of the filter, for lists that change with it, such as the command palette.
pub type Options<T> = Rc<dyn Fn(&str) -> Vec<SelectOption<T>>>;

/// `DialogSelectProps`.
pub struct SelectProps<T> {
    pub title: String,
    /// Muted line below the title.
    pub description: Option<String>,
    /// Blank rows above the footer; 1 by default.
    pub footer_gap: u32,
    pub placeholder: Option<String>,
    /// Puts the search input in the header row in place of the title.
    pub search_in_title: bool,
    /// The search input's placeholder while it replaces the title, such as `Search models`.
    pub title_placeholder: Option<String>,
    pub options: Options<T>,
    pub flat: bool,
    /// `fuzzysort`'s normalized threshold; 0 keeps every match.
    pub filter_threshold: f64,
    pub on_move: Option<OnOption<T>>,
    pub on_filter: Option<OnText>,
    pub on_select: Option<OnOption<T>>,
    pub on_cancel: Option<Rc<dyn Fn()>>,
    pub skip_filter: bool,
    pub search: Option<Search<T>>,
    pub render_filter: bool,
    pub locked: bool,
    pub preserve_selection: bool,
    pub actions: Vec<SelectAction<T>>,
    pub footer_hints: Vec<FooterHint>,
    /// Hints read again at each render, after `footer_hints`, for hints that follow the caller's state.
    pub dynamic_hints: Option<Rc<dyn Fn() -> Vec<FooterHint>>>,
    /// Replaces the title text (TS `titleView`).
    pub title_view: Option<AnyWidget>,
    /// Drawn instead of `No items available`, built at each render (TS `emptyView`).
    pub empty_view: Option<Rc<dyn Fn() -> AnyWidget>>,
    /// Drawn instead of `No results found` (TS `noMatchView`).
    pub no_match_view: Option<Rc<dyn Fn() -> AnyWidget>>,
    /// More commands for the dialog's layer (TS `bindings`).
    pub bindings: Vec<TuiCommand>,
    pub current: Option<T>,
    /// Selected when the dialog opens, like `current` but without its marker.
    pub focus_target: Option<T>,
    pub focus_current: bool,
    pub section_navigation: bool,
    /// Content before the footer's secondary actions.
    pub footer: Option<AnyWidget>,
}

impl<T: Clone + 'static> SelectProps<T> {
    pub fn new(title: impl Into<String>, options: Vec<SelectOption<T>>) -> Self {
        Self::dynamic(title, Rc::new(move |_| options.clone()))
    }

    pub fn dynamic(title: impl Into<String>, options: Options<T>) -> Self {
        Self {
            title: title.into(),
            description: None,
            footer_gap: 1,
            placeholder: None,
            search_in_title: false,
            title_placeholder: None,
            options,
            flat: false,
            filter_threshold: 0.0,
            on_move: None,
            on_filter: None,
            on_select: None,
            on_cancel: None,
            skip_filter: false,
            search: None,
            render_filter: true,
            locked: false,
            preserve_selection: false,
            actions: Vec::new(),
            footer_hints: Vec::new(),
            dynamic_hints: None,
            title_view: None,
            empty_view: None,
            no_match_view: None,
            bindings: Vec::new(),
            current: None,
            focus_target: None,
            focus_current: true,
            section_navigation: false,
            footer: None,
        }
    }
}

/// `dialogSelectContentWidth`.
pub fn content_width(dialog_width: u32) -> u32 {
    dialog_width.saturating_sub(DIALOG_LIST_INSET * 2 + 4)
}

struct State<T> {
    options: Vec<SelectOption<T>>,
    filter: String,
    selected: usize,
    selection: Option<(T, Option<String>)>,
    reset_selection: bool,
    grouped: Vec<(String, Vec<usize>)>,
    flat: Vec<usize>,
    filtered: Vec<SelectOption<T>>,
    /// Whether the last row is the `…` that says more rows are below.
    ellipsis: bool,
}

struct Inner<T> {
    cx: Rc<DialogCx>,
    props: SelectProps<T>,
    state: RefCell<State<T>>,
    input: Option<Input>,
    body: View,
    scroll: ScrollBox,
    footer_slot: View,
    /// One row per option in list order, kept across renders as TS `<For>` keeps them.
    rows: RefCell<Vec<Row<T>>>,
    /// The category rows: name, whether first, and the row.
    headers: RefCell<Vec<(String, bool, View)>>,
    /// Set when `filtered` changes, so the next render matches rows to it.
    rows_stale: Cell<bool>,
    /// The content width the rows' details were cut to.
    width: Cell<u32>,
    /// The position of the row drawn as selected.
    active: Cell<Option<usize>>,
    /// Whether the body holds the list rather than the empty view.
    listed: Cell<bool>,
    /// What follows the list in the body: the `…` and the detail area.
    tail: RefCell<Vec<AnyWidget>>,
    /// What the footer shows, to rebuild it only when that changes.
    footer_key: RefCell<Option<FooterKey>>,
    /// A selection scroll waiting for the list's new height (`scrollAfterLayout`).
    scroll_after_layout: Cell<bool>,
}

struct Row<T> {
    option: SelectOption<T>,
    description: Option<String>,
    footer: Option<String>,
    active: bool,
    /// The option's line, built again when `active` changes.
    line: View,
    /// The line and the detail lines, with the mouse handler.
    view: View,
}

/// Each footer item's group, title, key, whether disabled, and whether it runs an action.
type FooterKey = Vec<(Group, String, Option<String>, bool, bool)>;

/// An option as its row draws it: the option, its description, and its footer.
type Look<'a, T> = (&'a SelectOption<T>, Option<&'a str>, Option<&'a str>);

impl<T: PartialEq> Row<T> {
    // Whether this row draws `look` as a new row would. Gutters are compared by identity.
    fn draws(&self, (option, description, footer): Look<'_, T>) -> bool {
        let row = &self.option;
        self.description.as_deref() == description
            && self.footer.as_deref() == footer
            && row.value == option.value
            && row.title == option.title
            && row.title_spans == option.title_spans
            && row.title_width == option.title_width
            && row.truncate == option.truncate
            && row.category == option.category
            && row.details == option.details
            && row.fg == option.fg
            && row.bg == option.bg
            && row.footer_color == option.footer_color
            && row.footer_fg == option.footer_fg
            && row.footer_overhang == option.footer_overhang
            && row.choice == option.choice
            && match (&row.gutter, &option.gutter) {
                (None, None) => true,
                (Some(a), Some(b)) => Rc::ptr_eq(a, b),
                _ => false,
            }
    }
}

/// The select's handle (TS `DialogSelectRef`). Cloning is cheap.
pub struct Select<T>(Rc<Inner<T>>);

impl<T> Clone for Select<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

/// Builds `DialogSelect` in `cx` and returns the dialog content and the handle.
pub fn select<T: Clone + PartialEq + 'static>(cx: &Rc<DialogCx>, props: SelectProps<T>) -> (View, Select<T>) {
    let app = &cx.app;
    let theme = &cx.theme;
    let search_in_title = props.search_in_title && props.render_filter;
    let placeholder = props
        .title_placeholder
        .as_deref()
        .filter(|_| search_in_title)
        .or(props.placeholder.as_deref())
        .unwrap_or("Search");
    let input = props.render_filter.then(|| {
        Input::new(app)
            .mouse_pointer(MousePointer::DEFAULT)
            .grow(1.0)
            .basis(Length::Auto)
            .placeholder(placeholder)
            .placeholder_color(theme.text.muted)
            .colors(theme.text.formfield.focused, Color::TRANSPARENT)
            .focused_colors(theme.text.formfield.base, theme.background.formfield.focused)
            .cursor_color(search_cursor(theme, ""))
    });
    let scroll = ScrollBox::new(app).scrollbars(false);
    let body =
        View::new(app).margin_edge(Edge::Left, -(DIALOG_INSET as i32)).margin_edge(Edge::Right, -(DIALOG_INSET as i32));
    let footer_slot = View::new(app);
    let inner = Rc::new(Inner {
        cx: cx.clone(),
        props,
        state: RefCell::new(State {
            options: Vec::new(),
            filter: String::new(),
            selected: 0,
            selection: None,
            reset_selection: false,
            grouped: Vec::new(),
            flat: Vec::new(),
            filtered: Vec::new(),
            ellipsis: false,
        }),
        input: input.clone(),
        body,
        scroll,
        footer_slot,
        rows: RefCell::new(Vec::new()),
        headers: RefCell::new(Vec::new()),
        rows_stale: Cell::new(true),
        width: Cell::new(0),
        active: Cell::new(None),
        listed: Cell::new(false),
        tail: RefCell::new(Vec::new()),
        footer_key: RefCell::new(None),
        scroll_after_layout: Cell::new(false),
    });
    // The dialog owns the select; handlers hold weak references.
    let owner = inner.clone();
    cx.on_close(opentui::keymap::Disposer::new(move || drop(owner)));
    let handle = Select(inner);
    handle.0.state.borrow_mut().options = (handle.0.props.options)("");
    handle.recompute();
    handle.update_overflow();
    handle.focus_initial();
    handle.register_layer();
    let weak = Rc::downgrade(&handle.0);
    handle.0.scroll.content_view().on_resize({
        let weak = weak.clone();
        move |_, _| {
            if let Some(inner) = weak.upgrade()
                && inner.scroll_after_layout.replace(false)
            {
                Select(inner).scroll_to_selection(false);
            }
        }
    });
    handle.0.scroll.on_mouse(move |cx, event| {
        if !matches!(event.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown) {
            return;
        }
        cx.app().defer(bind!(weak, |inner, _cx| Select(inner).wheeled()));
    });

    let props = &handle.0.props;
    let on_close: Option<Rc<dyn Fn()>> = props.on_cancel.clone();
    // Rows reserve a gutter, so the header and footer line up with the list's inset rather than the layout's.
    let head = View::new(app).padding_x(DIALOG_LIST_INSET - DIALOG_INSET);
    match input.as_ref().filter(|_| search_in_title) {
        Some(input) => {
            head.add(&header(
                cx,
                HeaderProps { title_view: Some(input.as_any()), gap: Some(2), on_close, ..HeaderProps::default() },
            ));
        }
        None => {
            head.add(&header(
                cx,
                HeaderProps {
                    title: props.title.clone(),
                    title_view: props.title_view.clone(),
                    description: props.description.clone(),
                    on_close,
                    ..HeaderProps::default()
                },
            ));
            if let Some(input) = &input {
                head.add(&View::new(app).padding_edge(Edge::Top, 1).child(input));
            }
        }
    }
    if let Some(input) = &input {
        let weak = Rc::downgrade(&handle.0);
        input.on_change(bind!(weak, |inner, _cx, value| {
            let select = Select(inner);
            if select.0.props.locked {
                return;
            }
            select.filter_changed(value.to_owned());
        }));
        let weak = Rc::downgrade(&handle.0);
        cx.editor(bind!(weak, |inner| {
            let select = Select(inner);
            let focused = select.0.input.as_ref().is_some_and(|input| input.is_focused());
            if !focused || select.filter().is_empty() {
                return false;
            }
            select.set_filter("");
            true
        }));
        cx.focus(input);
    }
    handle.render();
    let root =
        layout_view(cx, &head, &handle.0.body, Some(&handle.0.footer_slot), DIALOG_INSET, handle.0.props.footer_gap);
    (root, handle)
}

/// Terminals paint the glyph under a block cursor in their own color, so a near-white cursor hides the
/// placeholder's first letter. Until the user types, the cursor matches the highlighted row so that letter shows.
fn search_cursor(theme: &crate::theme::Theme, filter: &str) -> Color {
    if filter.is_empty() { theme.background.action.primary.focused } else { theme.text.base }
}

impl<T: Clone + PartialEq + 'static> Select<T> {
    pub fn filter(&self) -> String {
        self.0.state.borrow().filter.clone()
    }

    /// The options after filtering, in list order.
    pub fn filtered(&self) -> Vec<SelectOption<T>> {
        self.0.state.borrow().filtered.clone()
    }

    pub fn selected(&self) -> Option<SelectOption<T>> {
        let state = self.0.state.borrow();
        state.flat.get(state.selected).map(|&index| state.filtered[index].clone())
    }

    /// Sets the filter, through the input when there is one.
    pub fn set_filter(&self, value: &str) {
        if let Some(input) = &self.0.input {
            input.set_value(value);
            self.filter_changed(value.to_owned());
            return;
        }
        if value == self.0.state.borrow().filter {
            return;
        }
        self.filter_changed(value.to_owned());
    }

    /// Draws the footer again, after the `footer` content was shown or hidden.
    pub fn refresh_footer(&self) {
        self.0.footer_key.replace(None);
        self.render_footer();
    }

    /// Replaces the search input's placeholder, as a changed `titlePlaceholder` does.
    pub fn set_placeholder(&self, text: &str) {
        if let Some(input) = &self.0.input {
            input.placeholder(text);
        }
    }

    /// Selects the option with `value`, centering it.
    pub fn move_to(&self, value: &T) {
        let index = self.index_of(value);
        if let Some(index) = index {
            self.move_index(index, true, true);
        }
    }

    /// The list's scroll offset in rows.
    pub fn scroll_top(&self) -> f64 {
        self.0.scroll.scroll_position().1
    }

    /// Selects `value` and scrolls the list to `top` without running `on_move`, so a dialog built again shows
    /// the rows the old one showed.
    pub fn restore(&self, value: &T, top: f64) {
        if let Some(index) = self.index_of(value) {
            self.0.state.borrow_mut().selected = index;
            self.remember_selection();
        }
        self.0.scroll.scroll_to(0.0, top);
        self.update_overflow();
        self.render();
    }

    /// Replaces the options, keeping the selection on the same value where it can (the TS options effect).
    pub fn set_options(&self, options: Vec<SelectOption<T>>) {
        self.0.state.borrow_mut().options = options;
        self.recompute();
        self.options_changed();
        self.render();
    }

    fn props(&self) -> &SelectProps<T> {
        &self.0.props
    }

    fn index_of(&self, value: &T) -> Option<usize> {
        let state = self.0.state.borrow();
        state.flat.iter().position(|&index| state.filtered[index].value == *value)
    }

    fn count(&self) -> usize {
        self.0.state.borrow().flat.len()
    }

    // `filtered`, `grouped`, and `flat`.
    fn recompute(&self) {
        let props = self.props();
        let mut state = self.0.state.borrow_mut();
        let filter = state.filter.clone();
        let filtered: Vec<SelectOption<T>> = match &props.search {
            Some(search) => search(&filter).into_iter().filter(|x| !x.disabled).collect(),
            None => {
                let options: Vec<SelectOption<T>> = state.options.iter().filter(|x| !x.disabled).cloned().collect();
                let needle = filter.to_lowercase();
                if props.skip_filter || !props.render_filter || needle.is_empty() {
                    options
                } else {
                    fuzzy::go(
                        &needle,
                        &options,
                        |option| {
                            [Some(option.title.as_str()), option.category.as_deref(), option.search_text.as_deref()]
                        },
                        // Title matches weigh twice as much as category and search text.
                        |scores| scores[0] * 2.0 + scores[1] + scores[2],
                        props.filter_threshold,
                    )
                    .into_iter()
                    .map(|index| options[index].clone())
                    .collect()
                }
            }
        };
        let flatten = props.search.is_some() || (props.flat && !filter.is_empty());
        let grouped: Vec<(String, Vec<usize>)> = if flatten {
            if filtered.is_empty() { Vec::new() } else { vec![(String::new(), (0..filtered.len()).collect())] }
        } else {
            let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
            for (index, option) in filtered.iter().enumerate() {
                let category = option.category.clone().unwrap_or_default();
                match groups.iter_mut().find(|(name, _)| *name == category) {
                    Some((_, members)) => members.push(index),
                    None => groups.push((category, vec![index])),
                }
            }
            groups
        };
        state.flat = grouped.iter().flat_map(|(_, members)| members.clone()).collect();
        state.grouped = grouped;
        state.filtered = filtered;
        self.0.rows_stale.set(true);
    }

    // `focusTarget ?? current` with `focusCurrent`, used at mount and when the filter clears.
    fn current(&self) -> Option<T> {
        let props = self.props();
        props.focus_target.clone().or_else(|| props.current.clone()).filter(|_| props.focus_current)
    }

    fn focus_initial(&self) {
        if self.props().search.is_some() {
            self.search_changed(false, true);
            return;
        }
        let Some(current) = self.current() else {
            self.remember_selection();
            return;
        };
        match self.index_of(&current) {
            Some(index) => {
                self.0.state.borrow_mut().selected = index;
                self.remember_selection();
                self.scroll_to_selection(true);
            }
            None => self.remember_selection(),
        }
    }

    fn remember_selection(&self) {
        let option = self.selected();
        self.0.state.borrow_mut().selection = option.map(|option| (option.value, option.category));
    }

    fn filter_changed(&self, value: String) {
        if let Some(input) = &self.0.input {
            input.cursor_color(search_cursor(&self.0.cx.theme, &value));
        }
        let options = (self.props().options)(&value);
        {
            let mut state = self.0.state.borrow_mut();
            state.filter = value.clone();
            state.options = options;
        }
        if let Some(on_filter) = &self.props().on_filter {
            on_filter(&value);
        }
        self.recompute();
        if self.props().search.is_some() {
            self.search_changed(true, false);
            self.render();
            return;
        }
        if !value.is_empty() {
            self.0.state.borrow_mut().reset_selection = true;
            if self.count() > 0 {
                self.move_index(0, true, false);
            }
            self.render();
            return;
        }
        // The options effect runs as well, since the options may depend on the filter.
        self.options_changed();
        if let Some(index) = self.current().and_then(|current| self.index_of(&current)) {
            self.move_index(index, true, true);
        }
        self.render();
    }

    // The options effect of `dialog-select.tsx:290-350`.
    fn options_changed(&self) {
        if self.props().search.is_some() {
            return;
        }
        let count = self.count();
        let props = self.props();
        if !props.preserve_selection && self.current().is_none() {
            if count > 0 {
                let mut state = self.0.state.borrow_mut();
                state.selected = reconcile(state.selected, count);
            }
            return;
        }
        let (reset, filtering) = {
            let state = self.0.state.borrow();
            (state.reset_selection, !state.filter.is_empty())
        };
        if reset && filtering {
            if count == 0 {
                return;
            }
            self.0.state.borrow_mut().selected = 0;
            self.remember_selection();
            return;
        }
        let previous = self.0.state.borrow().selection.clone();
        let Some((value, category)) = previous else {
            if let Some(index) = self.current().and_then(|current| self.index_of(&current)) {
                self.0.state.borrow_mut().selected = index;
            }
            self.remember_selection();
            return;
        };
        match self.index_of(&value) {
            Some(index) => {
                let moved = {
                    let state = self.0.state.borrow();
                    index != state.selected || state.filtered[state.flat[index]].category != category
                };
                self.0.state.borrow_mut().selected = index;
                self.remember_selection();
                if moved && (props.preserve_selection || (self.current().is_some() && !filtering)) {
                    // Before layout the scroll box still has the old rows' limits, and a move past them goes to
                    // the end, so a list whose rows changed scrolls once its content has the new height.
                    let laid_out = self.0.scroll.content_view().rect().height;
                    if laid_out == self.list_rows().0 as f32 {
                        self.scroll_to_selection(false);
                    } else {
                        self.0.scroll_after_layout.set(true);
                    }
                }
            }
            None => {
                if count == 0 {
                    return;
                }
                let mut state = self.0.state.borrow_mut();
                state.selected = reconcile(state.selected, count);
                drop(state);
                self.remember_selection();
            }
        }
    }

    // The search effect of `dialog-select.tsx:351-380`.
    fn search_changed(&self, query_changed: bool, current_changed: bool) {
        let (query, count) = (self.filter(), self.count());
        let current = self.current();
        let intended: Option<T> = if query_changed && !query.is_empty() {
            self.0.state.borrow().flat.first().map(|&index| self.0.state.borrow().filtered[index].value.clone())
        } else if (query_changed || current_changed) && current.is_some() {
            current
        } else if query_changed {
            let state = self.0.state.borrow();
            state.flat.get(reconcile(state.selected, count)).map(|&index| state.filtered[index].value.clone())
        } else {
            self.0.state.borrow().selection.as_ref().map(|(value, _)| value.clone())
        };
        let next = intended
            .and_then(|value| self.index_of(&value))
            .unwrap_or_else(|| reconcile(self.0.state.borrow().selected, count));
        if next >= count {
            return;
        }
        self.0.state.borrow_mut().selected = next;
        self.remember_selection();
        self.scroll_to_selection(query_changed || current_changed);
    }

    fn step(&self, delta: i64) {
        if self.props().locked || self.count() == 0 {
            return;
        }
        let next = move_wrap(self.0.state.borrow().selected, self.count(), delta);
        self.move_index(next, true, true);
    }

    fn move_section(&self, direction: i64) {
        if self.props().locked {
            return;
        }
        let target = {
            let state = self.0.state.borrow();
            let sections: Vec<&(String, Vec<usize>)> =
                state.grouped.iter().filter(|(_, members)| !members.is_empty()).collect();
            if sections.is_empty() {
                return;
            }
            let category =
                state.flat.get(state.selected).map(|&index| state.filtered[index].category.clone().unwrap_or_default());
            let current =
                sections.iter().position(|(name, _)| Some(name) == category.as_ref()).map_or(-1, |index| index as i64);
            let len = sections.len() as i64;
            let section = sections[((current + direction + len) % len) as usize];
            state.flat.iter().position(|&index| index == section.1[0])
        };
        if let Some(index) = target {
            self.move_index(index, true, true);
        }
    }

    // `moveTo`.
    fn move_index(&self, next: usize, center: bool, preserve: bool) {
        self.0.state.borrow_mut().selected = next;
        let option = self.selected();
        if let Some(option) = &option {
            let mut state = self.0.state.borrow_mut();
            state.selection = Some((option.value.clone(), option.category.clone()));
            state.reset_selection = !preserve;
        }
        if let (Some(option), Some(on_move)) = (&option, &self.props().on_move) {
            on_move(option);
        }
        self.scroll_to_selection(center);
        self.render();
    }

    fn submit(&self) {
        if self.props().locked {
            return;
        }
        let Some(option) = self.selected() else {
            return;
        };
        if let Some(run) = &option.on_select {
            run(&self.0.cx.dialogs);
        }
        if let Some(on_select) = &self.props().on_select {
            on_select(&option);
        }
    }

    fn trigger(&self, action: &SelectAction<T>) {
        if self.props().locked || self.action_disabled(action) {
            return;
        }
        match &action.run {
            ActionRun::Dialog(run) => run(),
            ActionRun::Selected(run) => {
                if let Some(option) = self.selected() {
                    run(&option);
                }
            }
        }
    }

    fn action_hidden(&self, action: &SelectAction<T>) -> bool {
        action.hidden_when.as_ref().is_some_and(|hidden| hidden(self.selected().as_ref()))
    }

    fn action_disabled(&self, action: &SelectAction<T>) -> bool {
        let option = self.selected();
        if matches!(action.run, ActionRun::Selected(_)) && option.is_none() {
            return true;
        }
        action.disabled.as_ref().is_some_and(|disabled| disabled(option.as_ref()))
    }

    fn register_layer(&self) {
        let weak = Rc::downgrade(&self.0);
        let command = |id: &str, title: &str, run: fn(&Select<T>)| {
            let weak: Weak<Inner<T>> = weak.clone();
            TuiCommand::new(id, bind!(weak, |inner, _, _| run(&Select(inner)))).title(title).group("Dialog")
        };
        let mut commands = vec![
            command("dialog.select.prev", "Previous item", |s| s.step(-1)),
            command("dialog.select.next", "Next item", |s| s.step(1)),
            command("dialog.select.page_up", "Page up", |s| s.step(-10)),
            command("dialog.select.page_down", "Page down", |s| s.step(10)),
            command("dialog.select.home", "First item", |s| {
                if !s.props().locked {
                    s.move_index(0, false, true);
                }
            }),
            command("dialog.select.end", "Last item", |s| {
                if !s.props().locked && s.count() > 0 {
                    s.move_index(s.count() - 1, false, true);
                }
            }),
            command("dialog.select.submit", "Select item", Select::submit),
        ];
        for action in self.props().actions.iter().filter(|action| !action.hidden) {
            let weak = weak.clone();
            let run = action.clone();
            let mut item =
                TuiCommand::new(action.command.clone(), bind!(weak, |inner, _, _| Select(inner).trigger(&run)))
                    // Resolved without a selection so moving through the list does not rebuild the layer.
                    .title((action.title)(None))
                    .group("Dialog");
            if let Some(bind) = &action.bind {
                item = item.bind(Bind::Key(bind.clone()));
            }
            if action.hidden_when.is_some() {
                let (weak, action) = (Rc::downgrade(&self.0), action.clone());
                item = item.enabled(opentui::keymap::Condition::When(Rc::new(move || {
                    weak.upgrade().is_some_and(|inner| !Select(inner).action_hidden(&action))
                })));
            }
            commands.push(item);
        }
        commands.extend(self.props().bindings.iter().cloned());
        if self.props().on_cancel.is_some() {
            commands.push(
                TuiCommand::inline(
                    "escape",
                    bind!(weak, |inner, _, _| {
                        if inner.cx.app.selected_text().is_some() {
                            inner.cx.app.clear_selection();
                            return;
                        }
                        if let Some(cancel) = &inner.props.on_cancel {
                            cancel();
                        }
                    }),
                )
                .title("Back")
                .group("Dialog"),
            );
        }
        if self.props().section_navigation {
            let (up, down) = (weak.clone(), weak.clone());
            commands.push(
                TuiCommand::inline("alt+up", bind!(up, |inner, _, _| Select(inner).move_section(-1)))
                    .title("Previous section")
                    .group("Dialog"),
            );
            commands.push(
                TuiCommand::inline("alt+down", bind!(down, |inner, _, _| Select(inner).move_section(1)))
                    .title("Next section")
                    .group("Dialog"),
            );
        }
        self.0.cx.layer(KeymapLayer::<FocusId> { commands, ..KeymapLayer::default() });
    }

    // The list height: `min(rows, floor(height / 2) - 6)`, less the row the `…` takes.
    fn list_height(&self) -> u32 {
        let (rows, limit) = self.list_rows();
        rows.min(limit) - u32::from(self.0.state.borrow().ellipsis)
    }

    // An overflowing list gives its last row to a `…` while rows are below the view. At the bottom the `…` hands
    // its row back to the list, so the dialog keeps its height. The scroll position is the one the moves made so
    // far land on; with the `…` the view is one row shorter, so a list scrolled one row past the end loses it.
    fn update_overflow(&self) {
        let (rows, limit) = self.list_rows();
        let top = self.0.scroll.scroll_position().1;
        let mut state = self.0.state.borrow_mut();
        let view = f64::from(limit) - if state.ellipsis { 1.0 } else { 0.0 };
        state.ellipsis = rows > limit && top + view < f64::from(rows);
    }

    // A wheel scroll moved the list.
    fn wheeled(&self) {
        let before = self.0.state.borrow().ellipsis;
        self.update_overflow();
        if self.0.state.borrow().ellipsis != before {
            self.render();
        }
    }

    // The rows of the whole list and the most it shows.
    fn list_rows(&self) -> (u32, u32) {
        let state = self.0.state.borrow();
        let headers: u32 = state
            .grouped
            .iter()
            .enumerate()
            .filter(|(_, (category, _))| !category.is_empty())
            .map(|(i, _)| if i > 0 { 2 } else { 1 })
            .sum();
        let rows: u32 =
            state.flat.iter().map(|&index| 1 + state.filtered[index].details.len() as u32).sum::<u32>() + headers;
        let limit = (i64::from(self.0.cx.app.size().1) / 2 - 6).max(0) as u32;
        (rows, limit)
    }

    // The y offset of the selected row inside the list.
    fn selected_y(&self) -> Option<u32> {
        let state = self.0.state.borrow();
        let mut y = 0;
        let mut position = 0;
        for (i, (category, members)) in state.grouped.iter().enumerate() {
            if !category.is_empty() {
                y += if i > 0 { 2 } else { 1 };
            }
            for &index in members {
                if position == state.selected {
                    return Some(y);
                }
                // TS scrolls by the laid-out row: a title's line breaks add rows, as the queued prompts' do.
                let option = &state.filtered[index];
                y += 1 + option.title.matches('\n').count() as u32 + option.details.len() as u32;
                position += 1;
            }
        }
        None
    }

    // `scrollToSelection`. The scroll box sums `scroll_by` moves made before a frame and clamps them once, as
    // OpenTUI's does.
    fn scroll_to_selection(&self, center: bool) {
        let Some(y) = self.selected_y() else { return };
        let height = f64::from(self.list_height());
        let scroll = &self.0.scroll;
        let y = f64::from(y) - scroll.scroll_position().1;
        if center {
            scroll.scroll_by(0.0, y - (height / 2.0).floor());
            return;
        }
        if y >= height {
            scroll.scroll_by(0.0, y - height + 1.0);
        }
        if y < 0.0 {
            scroll.scroll_by(0.0, y);
            if self.0.state.borrow().selected == 0 {
                scroll.scroll_to(0.0, 0.0);
            }
        }
    }

    fn render(&self) {
        let cx = &self.0.cx;
        let app = &cx.app;
        let theme = &cx.theme;
        let body = &self.0.body;
        let scroll = &self.0.scroll;
        let state = self.0.state.borrow();
        if state.grouped.is_empty() {
            body.clear();
            scroll.clear();
            self.0.rows.borrow_mut().clear();
            self.0.headers.borrow_mut().clear();
            self.0.tail.borrow_mut().clear();
            self.0.active.set(None);
            self.0.listed.set(false);
            let no_match = self.props().render_filter && !state.filter.is_empty();
            let (view, text) = if no_match {
                (&self.props().no_match_view, "No results found")
            } else {
                (&self.props().empty_view, "No items available")
            };
            match view {
                Some(view) => body.add(&view()),
                None => body.add(
                    &View::new(app).padding_x(DIALOG_LIST_INSET).child(&Text::new(app, text).fg(theme.text.muted)),
                ),
            };
            drop(state);
            self.render_footer();
            return;
        }
        let width = content_width(cx.dialogs.size().width().min(u32::from(app.size().0)));
        if self.0.width.replace(width) != width {
            // Details are cut to the width, so no row is kept.
            self.0.rows.borrow_mut().clear();
            self.0.rows_stale.set(true);
        }
        let synced = self.0.rows_stale.replace(false);
        if synced {
            self.sync_rows(&state);
        }
        // A move restyles the row it leaves and the row it reaches; matching the rows may have moved any.
        let active = (!self.props().locked && state.selected < state.flat.len()).then_some(state.selected);
        let previous = self.0.active.replace(active);
        for (position, row) in self.0.rows.borrow_mut().iter_mut().enumerate() {
            let want = Some(position) == active;
            if row.active != want && (synced || Some(position) == previous || Some(position) == active) {
                let line = self.option_line(&row.option, row.description.as_deref(), row.footer.as_deref(), want);
                row.line.detach();
                row.view.insert(0, &line);
                row.line = line;
                row.active = want;
            }
        }
        let selected = state.flat.get(state.selected).copied();
        // Reserved whenever any option has a detail, so the dialog does not resize as the selection moves.
        let detail = state
            .flat
            .iter()
            .any(|&index| state.filtered[index].detail.is_some())
            .then(|| selected.and_then(|index| state.filtered[index].detail.clone()));
        drop(state);
        self.update_overflow();
        scroll.height(self.list_height());
        let mut tail = self.0.tail.borrow_mut();
        if self.0.listed.replace(true) {
            tail.drain(..).for_each(|widget| widget.detach());
        } else {
            body.clear();
            body.add(scroll);
        }
        if self.0.state.borrow().ellipsis {
            let ellipsis = View::new(app)
                .padding_edge(Edge::Left, DIALOG_LIST_INSET)
                .shrink(0.0)
                .child(&Text::new(app, "…").fg(theme.text.muted));
            body.add(&ellipsis);
            tail.push(ellipsis.as_any());
        }
        if let Some(detail) = detail {
            let area = View::new(app).padding_edge(Edge::Top, 1).padding_x(DIALOG_LIST_INSET).shrink(0.0);
            match detail {
                Some(Detail::View(build)) => area.add(&build(cx)),
                text => area.add(
                    &Text::new(
                        app,
                        match text {
                            Some(Detail::Text(text)) if !text.is_empty() => text,
                            _ => " ".to_owned(),
                        },
                    )
                    .fg(theme.surface(Surface::DialogFooter).text.muted)
                    .wrap(WrapMode::Word),
                ),
            };
            body.add(&area);
            tail.push(area.as_any());
        }
        drop(tail);
        self.render_footer();
    }

    // Matches the rows to `filtered`: a row whose option draws the same stays, and only the other options get new
    // rows. The list's children are put in order again only when the rows or categories changed.
    fn sync_rows(&self, state: &State<T>) {
        let cx = &self.0.cx;
        let flattened = self.props().search.is_some() || (self.props().flat && !state.filter.is_empty());
        let wanted: Vec<Look<'_, T>> = state
            .grouped
            .iter()
            .flat_map(|(category, members)| {
                members.iter().map(move |&index| {
                    let option = &state.filtered[index];
                    let footer = if flattened {
                        option.search_footer.as_deref().or(option.category.as_deref()).or(option.footer.as_deref())
                    } else {
                        option.footer.as_deref()
                    };
                    (option, option.description.as_deref().filter(|description| description != category), footer)
                })
            })
            .collect();
        // The positions of each title; options that share a title chain through `next`.
        let mut first: HashMap<&str, usize> = HashMap::with_capacity(wanted.len());
        let mut next = vec![usize::MAX; wanted.len()];
        for (position, (option, ..)) in wanted.iter().enumerate().rev() {
            if let Some(after) = first.insert(option.title.as_str(), position) {
                next[position] = after;
            }
        }
        let old = std::mem::take(&mut *self.0.rows.borrow_mut());
        let mut in_place = old.len() == wanted.len();
        let mut slots: Vec<Option<Row<T>>> = std::iter::repeat_with(|| None).take(wanted.len()).collect();
        for (old_position, row) in old.into_iter().enumerate() {
            let mut position = first.get(row.option.title.as_str()).copied().unwrap_or(usize::MAX);
            while position != usize::MAX && (slots[position].is_some() || !row.draws(wanted[position])) {
                position = next[position];
            }
            // A row left out stays in the list until the children are put in order below.
            if position == usize::MAX {
                in_place = false;
                continue;
            }
            in_place &= position == old_position;
            slots[position] = Some(row);
        }
        let rows: Vec<Row<T>> =
            slots.into_iter().zip(&wanted).map(|(slot, &look)| slot.unwrap_or_else(|| self.new_row(look))).collect();
        let named = || {
            state
                .grouped
                .iter()
                .enumerate()
                .filter(|(_, (category, _))| !category.is_empty())
                .map(|(i, (category, _))| (category.as_str(), i == 0))
        };
        let same_headers = self.0.headers.borrow().iter().map(|(name, first, _)| (name.as_str(), *first)).eq(named());
        if !in_place || !same_headers {
            let scroll = &self.0.scroll;
            scroll.clear();
            let old_headers = std::mem::take(&mut *self.0.headers.borrow_mut());
            let mut headers = Vec::new();
            let mut list = rows.iter();
            for (i, (category, members)) in state.grouped.iter().enumerate() {
                if !category.is_empty() {
                    let first = i == 0;
                    let header = old_headers
                        .iter()
                        .find(|(name, of, _)| name == category && *of == first)
                        .map(|(_, _, header)| header.clone())
                        .unwrap_or_else(|| category_row(cx, category, first));
                    scroll.add(&header);
                    headers.push((category.clone(), first, header));
                }
                for row in list.by_ref().take(members.len()) {
                    scroll.add(&row.view);
                }
            }
            *self.0.headers.borrow_mut() = headers;
        }
        *self.0.rows.borrow_mut() = rows;
    }

    fn new_row(&self, (option, description, footer): Look<'_, T>) -> Row<T> {
        let cx = &self.0.cx;
        let app = &cx.app;
        let width = self.0.width.get();
        let line = self.option_line(option, description, footer, false);
        let view = View::new(app).column().child(&line);
        for detail in &option.details {
            view.add(
                &View::new(app).padding_x(DIALOG_LIST_INSET).child(
                    &Text::new(app, truncate_middle(detail, width.max(1) as usize))
                        .fg(cx.theme.text.muted)
                        .wrap(WrapMode::None),
                ),
            );
        }
        self.row_mouse(&view, option.value.clone());
        Row {
            option: option.clone(),
            description: description.map(str::to_owned),
            footer: footer.map(str::to_owned),
            active: false,
            line,
            view,
        }
    }

    fn option_line(
        &self,
        option: &SelectOption<T>,
        description: Option<&str>,
        footer: Option<&str>,
        active: bool,
    ) -> View {
        let current = self.props().current.as_ref() == Some(&option.value);
        option_row(&self.0.cx, option, description, footer, active, current)
    }

    fn row_mouse(&self, row: &View, value: T) {
        let weak = Rc::downgrade(&self.0);
        row.mouse_pointer(MousePointer::POINTER).on_mouse(bind!(weak, |inner, _cx, event| {
            let select = Select(inner);
            if select.props().locked {
                return;
            }
            let index = select.index_of(&value);
            match event.kind {
                // TS also selects the row on press. Here the press leaves the rows alone: rebuilding them would
                // detach the widget the release goes to, and the release selects the row anyway.
                MouseEventKind::Moved => {
                    let Some(index) = index else { return };
                    if index == select.0.state.borrow().selected {
                        return;
                    }
                    let app = select.0.cx.app.clone();
                    app.defer(move |_cx| select.move_index(index, false, true));
                }
                MouseEventKind::Up(MouseButton::Left) => {
                    let Some(index) = index else { return };
                    let option = {
                        let state = select.0.state.borrow();
                        state.filtered[state.flat[index]].clone()
                    };
                    let app = select.0.cx.app.clone();
                    app.defer(move |_cx| {
                        select.move_index(index, false, true);
                        if let Some(run) = &option.on_select {
                            run(&select.0.cx.dialogs);
                        }
                        if let Some(on_select) = &select.props().on_select {
                            on_select(&option);
                        }
                    });
                }
                _ => {}
            }
        }));
    }

    fn render_footer(&self) {
        let cx = &self.0.cx;
        let slot = &self.0.footer_slot;
        let props = self.props();
        let selected = self.selected();
        let mut items: Vec<(Group, FooterAction)> = Vec::new();
        for action in props.actions.iter().filter(|action| !action.hidden && !self.action_hidden(action)) {
            let Some(label) = cx.keymap.shortcut_all(&action.command).filter(|label| !label.is_empty()) else {
                continue;
            };
            let group = action.group.unwrap_or(match action.run {
                ActionRun::Dialog(_) => Group::Secondary,
                ActionRun::Selected(_) => Group::Primary,
            });
            let weak = Rc::downgrade(&self.0);
            let run = action.clone();
            items.push((
                group,
                FooterAction::new((action.title)(selected.as_ref()))
                    .key(label)
                    .disabled(self.action_disabled(action))
                    .on_trigger(bind!(weak, |inner| Select(inner).trigger(&run))),
            ));
        }
        let dynamic = props.dynamic_hints.as_ref().map(|hints| hints());
        for hint in props.footer_hints.iter().chain(dynamic.iter().flatten()) {
            items.push((
                hint.group.unwrap_or(Group::Secondary),
                FooterAction::new(hint.title.clone()).key(hint.label.clone()),
            ));
        }
        let key: Vec<_> = items
            .iter()
            .map(|(group, item)| {
                (*group, item.title.clone(), item.key.clone(), item.disabled, item.on_trigger.is_some())
            })
            .collect();
        if self.0.footer_key.borrow().as_ref() == Some(&key) {
            return;
        }
        self.0.footer_key.replace(Some(key));
        slot.clear();
        let pick = |group: Group| -> Vec<FooterAction> {
            items.iter().filter(|(of, _)| *of == group).map(|(_, action)| action.clone()).collect()
        };
        let (secondary, primary) = (pick(Group::Secondary), pick(Group::Primary));
        slot.add(&crate::dialog::footer(
            cx,
            FooterProps {
                secondary,
                primary,
                inset: Some(DIALOG_LIST_INSET - DIALOG_INSET),
                children: props.footer.iter().cloned().collect(),
            },
        ));
    }
}

fn category_row(cx: &DialogCx, title: &str, first: bool) -> View {
    View::new(&cx.app)
        .padding_edge(Edge::Top, if first { 0 } else { 1 })
        .padding_edge(Edge::Left, DIALOG_LIST_INSET)
        .child(&Text::new(&cx.app, title).fg(cx.theme.text.muted).bold())
}

// `DialogSelectRow`: rows run edge to edge, and a 1-cell gutter holds the selection bar on the left.
fn option_row<T>(
    cx: &DialogCx,
    option: &SelectOption<T>,
    description: Option<&str>,
    footer: Option<&str>,
    active: bool,
    current: bool,
) -> View {
    let app = &cx.app;
    let theme = &cx.theme;
    let text = if active { option.fg.unwrap_or(theme.text.action.primary.focused) } else { theme.text.base };
    // Secondary text: the description and the footer.
    let secondary = if active { theme.text.action.secondary.focused } else { theme.text.muted };
    // A marker or gutter takes its cell plus the row gap out of the left padding, so titles line up with unmarked
    // rows.
    let marked = current || option.gutter.is_some();
    let row = View::new(app)
        .row()
        .grow(1.0)
        .basis(Length::Auto)
        .padding_edge(Edge::Left, if marked { DIALOG_LIST_INSET - 3 } else { DIALOG_LIST_INSET - 1 })
        .padding_edge(Edge::Right, DIALOG_LIST_INSET)
        .gap(1)
        .bg(if active { option.bg.unwrap_or(theme.background.action.primary.focused) } else { Color::TRANSPARENT });
    if current && option.gutter.is_none() {
        row.add(&Text::new(app, "▪").shrink(0.0).fg(theme.text.formfield.selected));
    }
    if let Some(gutter) = &option.gutter {
        row.add(&View::new(app).shrink(0.0).child(&gutter(app, text)));
    }
    let title = match option.truncate {
        Truncate::None => option.title.clone(),
        Truncate::Left => truncate_left(&option.title, option.title_width.unwrap_or(61)),
        Truncate::Right => truncate(&option.title, option.title_width.unwrap_or(61)),
    };
    let mut spans = match &option.title_spans {
        Some(spans) => spans.iter().map(|(part, color)| part.clone().fg(color.unwrap_or(text))).collect(),
        None => vec![title.fg(text)],
    };
    if let Some(description) = description {
        spans.push(format!(" {description}").fg(secondary));
    }
    row.add(
        &Text::new(app, spans)
            .grow(1.0)
            .basis(Length::Auto)
            .fg(text)
            .overflow(Overflow::Hidden)
            .wrap(WrapMode::None)
            .padding_edge(Edge::Left, 3),
    );
    let footer = match &option.choice {
        Some(choice) => {
            let text = match (active, choice.open) {
                (false, _) => format!("  {}  ", choice.value),
                (true, true) => format!("  {} ↵", choice.value),
                (true, false) => format!("‹ {} ›", choice.value),
            };
            let color = if active { theme.text.action.primary.focused } else { theme.text.muted };
            Some((text, color, 2))
        }
        None => footer.map(|footer| {
            let color = match (option.footer_fg, option.footer_color) {
                (Some(color), _) => color,
                (None, Some(color)) if !active => color,
                _ => secondary,
            };
            (footer.to_owned(), color, option.footer_overhang)
        }),
    };
    if let Some((footer, color, overhang)) = footer {
        let cell = View::new(app).shrink(0.0).child(&Text::new(app, footer).fg(color));
        if overhang > 0 {
            cell.margin_edge(Edge::Right, -(overhang as i32));
        }
        row.add(&cell);
    }
    View::new(app)
        .row()
        .child(&Text::new(app, if active { "┃" } else { " " }).width(1).shrink(0.0).fg(theme.text.formfield.focused))
        .child(&row)
}

/// `reconcileSelection`.
pub fn reconcile(selected: usize, count: usize) -> usize {
    selected.min(count.saturating_sub(1))
}

/// `moveSelection` with the `wrap` policy.
pub fn move_wrap(selected: usize, count: usize, delta: i64) -> usize {
    if count == 0 {
        return 0;
    }
    let next = selected as i64 + delta;
    if next < 0 {
        return count - 1;
    }
    if next >= count as i64 {
        return 0;
    }
    next as usize
}

/// `Locale.truncate`, counting characters.
pub fn truncate(text: &str, len: usize) -> String {
    if text.chars().count() <= len {
        return text.to_owned();
    }
    let kept: String = text.chars().take(len.saturating_sub(1)).collect();
    kept + "…"
}

/// `Locale.truncateLeft`, counting characters.
pub fn truncate_left(text: &str, len: usize) -> String {
    let count = text.chars().count();
    if count <= len {
        return text.to_owned();
    }
    let kept: String = text.chars().skip(count - len.saturating_sub(1)).collect();
    format!("…{kept}")
}

/// `Locale.truncateMiddle`, counting characters.
pub fn truncate_middle(text: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return text.to_owned();
    }
    let keep_start = (max - 1).div_ceil(2);
    let keep_end = (max - 1) / 2;
    let head: String = chars[..keep_start].iter().collect();
    if keep_end == 0 {
        return head + "…";
    }
    let tail: String = chars[chars.len() - keep_end..].iter().collect();
    format!("{head}…{tail}")
}
