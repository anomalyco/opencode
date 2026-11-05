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
use crate::keymap::{Bind, KeymapLayer, TuiCommand};
use crate::theme::Surface;
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
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
#[derive(Clone, Debug)]
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
    rows: RefCell<Vec<View>>,
    /// A selection scroll waiting for the list's new height (`scrollAfterLayout`).
    scroll_after_layout: Cell<bool>,
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
        body.clear();
        let scroll = &self.0.scroll;
        scroll.clear();
        let mut rows = Vec::new();
        let state = self.0.state.borrow();
        if state.grouped.is_empty() {
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
        } else {
            let selected = state.flat.get(state.selected).copied();
            let flattened = self.props().search.is_some() || (self.props().flat && !state.filter.is_empty());
            let width = content_width(cx.dialogs.size().width().min(u32::from(app.size().0)));
            for (i, (category, members)) in state.grouped.iter().enumerate() {
                if !category.is_empty() {
                    scroll.add(&category_row(cx, category, i == 0));
                }
                for &index in members {
                    let option = &state.filtered[index];
                    let active = !self.props().locked && Some(index) == selected;
                    let current = self.props().current.as_ref() == Some(&option.value);
                    let footer = if flattened {
                        option
                            .search_footer
                            .clone()
                            .or_else(|| option.category.clone())
                            .or_else(|| option.footer.clone())
                    } else {
                        option.footer.clone()
                    };
                    let description = option.description.clone().filter(|description| description != category);
                    let row = View::new(app).column();
                    row.add(&option_row(cx, option, description, footer, active, current));
                    for detail in &option.details {
                        row.add(
                            &View::new(app).padding_x(DIALOG_LIST_INSET).child(
                                &Text::new(app, truncate_middle(detail, width.max(1) as usize))
                                    .fg(theme.text.muted)
                                    .wrap(WrapMode::None),
                            ),
                        );
                    }
                    self.row_mouse(&row, option.value.clone());
                    scroll.add(&row);
                    rows.push(row);
                }
            }
            // Reserved whenever any option has a detail, so the dialog does not resize as the selection moves.
            let detail = state
                .flat
                .iter()
                .any(|&index| state.filtered[index].detail.is_some())
                .then(|| selected.and_then(|index| state.filtered[index].detail.clone()));
            drop(state);
            self.update_overflow();
            scroll.height(self.list_height());
            body.add(scroll);
            if self.0.state.borrow().ellipsis {
                body.add(
                    &View::new(app)
                        .padding_edge(Edge::Left, DIALOG_LIST_INSET)
                        .shrink(0.0)
                        .child(&Text::new(app, "…").fg(theme.text.muted)),
                );
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
            }
        }
        *self.0.rows.borrow_mut() = rows;
        self.render_footer();
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
        slot.clear();
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
    description: Option<String>,
    footer: Option<String>,
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
            (footer, color, option.footer_overhang)
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

/// A port of `fuzzysort` 3.1's `go` with `keys`, `scoreFn`, and `threshold`, as `DialogSelect` calls it: the same
/// scores and the same order, ties included. Strings are compared in UTF-16 code units, as JavaScript does.
/// Accents are not removed from Latin letters (TS `remove_accents`).
pub mod fuzzy {
    const NEG: f64 = f64::NEG_INFINITY;

    struct Search {
        lower: Vec<u16>,
        bitflags: u32,
        contains_space: bool,
        spaces: Vec<Search>,
    }

    struct Prepared {
        lower: Vec<u16>,
        bitflags: u32,
        next: Vec<usize>,
    }

    /// Returns the indexes of the matching targets, best first. `keys` gives each target's searchable strings,
    /// and `score` combines their normalized scores.
    pub fn go<T, const N: usize>(
        search: &str,
        targets: &[T],
        keys: impl Fn(&T) -> [Option<&str>; N],
        score: impl Fn(&[f64; N]) -> f64,
        threshold: f64,
    ) -> Vec<usize> {
        go_scored(search, targets, keys, |keys, _, _| score(keys), threshold, usize::MAX)
    }

    /// [`go`] whose `score` also gets fuzzysort's own normalized score for the target, the `objResults.score` a
    /// TS `scoreFn` reads (the best key, with a bonus for matching several), and the target's index. At most
    /// `limit` results are kept, as fuzzysort's `limit` keeps them, ties included.
    pub fn go_scored<T, const N: usize>(
        search: &str,
        targets: &[T],
        keys: impl Fn(&T) -> [Option<&str>; N],
        score: impl Fn(&[f64; N], f64, usize) -> f64,
        threshold: f64,
        limit: usize,
    ) -> Vec<usize> {
        if search.is_empty() {
            return Vec::new();
        }
        let search = prepare_search(search);
        let threshold = denormalize(threshold);
        let mut heap = Heap::default();
        let mut partial = vec![NEG; search.spaces.len()];
        'outer: for (index, target) in targets.iter().enumerate() {
            let mut prepared: Vec<Option<Prepared>> =
                keys(target).iter().map(|key| key.filter(|key| !key.is_empty()).map(prepare)).collect();
            let bitflags = prepared.iter().flatten().fold(0, |flags, key| flags | key.bitflags);
            if search.bitflags & bitflags != search.bitflags {
                continue;
            }
            let mut best = vec![NEG; search.spaces.len()];
            let mut results = [NEG; N];
            for (key, target) in prepared.iter_mut().enumerate() {
                let Some(target) = target else { continue };
                let Some(result) = algorithm(&search, target, false, search.contains_space, &mut partial) else {
                    continue;
                };
                results[key] = result;
                if search.contains_space {
                    for i in 0..search.spaces.len() {
                        if partial[i] > -1000.0 && best[i] > NEG {
                            let tmp = (best[i] + partial[i]) / 4.0;
                            if tmp > best[i] {
                                best[i] = tmp;
                            }
                        }
                        if partial[i] > best[i] {
                            best[i] = partial[i];
                        }
                    }
                }
            }
            if search.contains_space {
                if best.contains(&NEG) {
                    continue 'outer;
                }
            } else if results.iter().all(|score| *score == NEG) {
                continue;
            }
            let combined = if search.contains_space {
                best.iter().sum()
            } else {
                results.iter().fold(NEG, |combined, &result| {
                    let bonus = if result > -1000.0 && combined > NEG {
                        ((combined + result) / 4.0).max(combined)
                    } else {
                        combined
                    };
                    bonus.max(result)
                })
            };
            let normalized = results.map(normalize);
            let total = score(&normalized, normalize(combined), index);
            if total == 0.0 || total.is_nan() {
                continue;
            }
            let total = denormalize(total);
            if total < threshold {
                continue;
            }
            if heap.len < limit {
                heap.add((total, index));
            } else if total > heap.items[0].0 {
                heap.items[0] = (total, index);
                heap.sift();
            }
        }
        let mut out = vec![0; heap.items.len()];
        for slot in (0..out.len()).rev() {
            out[slot] = heap.poll().expect("one item per slot").1;
        }
        out
    }

    fn normalize(score: f64) -> f64 {
        if score == NEG {
            return 0.0;
        }
        if score > 1.0 {
            return score;
        }
        std::f64::consts::E.powf(((-score + 1.0).powf(0.04307) - 1.0) * -2.0)
    }

    fn denormalize(score: f64) -> f64 {
        if score == 0.0 {
            return NEG;
        }
        if score > 1.0 {
            return score;
        }
        1.0 - (score.ln() / -2.0 + 1.0).powf(1.0 / 0.04307)
    }

    fn lower_info(text: &str) -> (Vec<u16>, u32, bool) {
        let lower: Vec<u16> = text.to_lowercase().encode_utf16().collect();
        let mut bitflags = 0u32;
        let mut space = false;
        for &code in &lower {
            if code == 32 {
                space = true;
                continue;
            }
            let bit = match code {
                97..=122 => code - 97,
                48..=57 => 26,
                0..=127 => 30,
                _ => 31,
            };
            bitflags |= 1 << bit;
        }
        (lower, bitflags, space)
    }

    fn prepare_search(search: &str) -> Search {
        let search = search.trim_matches(|c: char| c.is_whitespace());
        let (lower, bitflags, contains_space) = lower_info(search);
        let mut spaces = Vec::new();
        if contains_space {
            let mut seen: Vec<&str> = Vec::new();
            for word in search.split(char::is_whitespace) {
                if word.is_empty() || seen.contains(&word) {
                    continue;
                }
                seen.push(word);
                spaces.push(Search {
                    lower: lower_info(word).0,
                    bitflags: 0,
                    contains_space: false,
                    spaces: Vec::new(),
                });
            }
        }
        Search { lower, bitflags, contains_space, spaces }
    }

    fn prepare(target: &str) -> Prepared {
        let (lower, bitflags, _) = lower_info(target);
        Prepared { lower, bitflags, next: next_beginnings(target) }
    }

    fn next_beginnings(target: &str) -> Vec<usize> {
        let codes: Vec<u16> = target.encode_utf16().collect();
        let mut beginnings = Vec::new();
        let (mut was_upper, mut was_alnum) = (false, false);
        for (i, &code) in codes.iter().enumerate() {
            let upper = (65..=90).contains(&code);
            let alnum = upper || (97..=122).contains(&code) || (48..=57).contains(&code);
            if upper && !was_upper || !was_alnum || !alnum {
                beginnings.push(i);
            }
            was_upper = upper;
            was_alnum = alnum;
        }
        let len = codes.len();
        let mut next = vec![0; len];
        let mut last = beginnings.first().copied();
        let mut last_i = 0;
        for (i, slot) in next.iter_mut().enumerate() {
            if last.is_some_and(|last| last > i) {
                *slot = last.unwrap_or(len);
            } else {
                last_i += 1;
                last = beginnings.get(last_i).copied();
                *slot = last.unwrap_or(len);
            }
        }
        next
    }

    fn find(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
        if needle.is_empty() {
            return Some(from.min(haystack.len()));
        }
        (from..haystack.len().saturating_sub(needle.len() - 1)).find(|&i| haystack[i..].starts_with(needle))
    }

    // `algorithm`: the score of one search against one target, or `None`. Leaves the match indexes in `indexes`.
    fn single(search: &[u16], target: &Prepared, indexes: &mut Vec<usize>) -> Option<f64> {
        let search_len = search.len();
        let target_len = target.lower.len();
        if search_len == 0 || target_len == 0 {
            return None;
        }
        let codes = &target.lower;
        let next = &target.next;
        let mut simple = Vec::with_capacity(search_len);
        let (mut search_i, mut target_i) = (0, 0);
        loop {
            if search[search_i] == codes[target_i] {
                simple.push(target_i);
                search_i += 1;
                if search_i == search_len {
                    break;
                }
            }
            target_i += 1;
            if target_i >= target_len {
                return None;
            }
        }
        let mut strict: Vec<usize> = Vec::with_capacity(search_len);
        let mut success = false;
        search_i = 0;
        target_i = if simple[0] == 0 { 0 } else { next[simple[0] - 1] };
        let mut backtracks = 0;
        if target_i != target_len {
            loop {
                if target_i >= target_len {
                    if search_i == 0 {
                        break;
                    }
                    backtracks += 1;
                    if backtracks > 200 {
                        break;
                    }
                    search_i -= 1;
                    let last = strict.pop().expect("a match to undo");
                    target_i = next[last];
                } else if search[search_i] == codes[target_i] {
                    strict.push(target_i);
                    search_i += 1;
                    if search_i == search_len {
                        success = true;
                        break;
                    }
                    target_i += 1;
                } else {
                    target_i = next[target_i];
                }
            }
        }
        let mut substring = if search_len <= 1 { None } else { find(codes, search, simple[0]) };
        let mut substring_beginning = substring.is_some_and(|i| i == 0 || next[i - 1] == i);
        if let Some(found) = substring.filter(|_| !substring_beginning) {
            let mut i = 0;
            while i < next.len() {
                if i > found && (0..search_len).all(|s| codes.get(i + s) == Some(&search[s])) {
                    substring = Some(i);
                    substring_beginning = true;
                    break;
                }
                i = next[i];
            }
        }
        let is_substring = substring.is_some();
        let score_of = |matches: &[usize]| -> f64 {
            let mut score = 0.0;
            let mut groups = 0.0;
            for i in 1..search_len {
                if matches[i] as i64 - matches[i - 1] as i64 != 1 {
                    score -= matches[i] as f64;
                    groups += 1.0;
                }
            }
            let unmatched = matches[search_len - 1] as f64 - matches[0] as f64 - (search_len as f64 - 1.0);
            score -= (12.0 + unmatched) * groups;
            if matches[0] != 0 {
                score -= (matches[0] * matches[0]) as f64 * 0.2;
            }
            if !success {
                score *= 1000.0;
            } else {
                let mut unique = 1;
                let mut i = next[0];
                while i < target_len {
                    unique += 1;
                    i = next[i];
                }
                if unique > 24 {
                    score *= (unique - 24) as f64 * 10.0;
                }
            }
            let longer = (target_len as f64 - search_len as f64) / 2.0;
            score -= longer;
            let bonus = 1.0 + (search_len * search_len) as f64;
            if is_substring {
                score /= bonus;
            }
            if substring_beginning {
                score /= bonus;
            }
            score - longer
        };
        let substring_matches = |start: usize| (start..start + search_len).collect::<Vec<_>>();
        let best = match (success, substring) {
            (false, Some(start)) => substring_matches(start),
            (false, None) => simple,
            (true, Some(start)) if substring_beginning => substring_matches(start),
            (true, _) => strict,
        };
        let score = score_of(&best);
        *indexes = best;
        Some(score)
    }

    fn algorithm(
        search: &Search,
        target: &mut Prepared,
        allow_spaces: bool,
        partial_match: bool,
        partial: &mut [f64],
    ) -> Option<f64> {
        if !allow_spaces && search.contains_space {
            return spaces(search, target, partial_match, partial);
        }
        single(&search.lower, target, &mut Vec::new())
    }

    // `algorithmSpaces`; only the score is kept.
    fn spaces(search: &Search, target: &mut Prepared, partial_match: bool, partial: &mut [f64]) -> Option<f64> {
        let mut score = 0.0;
        let mut first_seen = 0usize;
        let count = search.spaces.len();
        let mut changes: Vec<(usize, usize)> = Vec::new();
        let mut any = false;
        let mut indexes = Vec::new();
        for (i, word) in search.spaces.iter().enumerate() {
            partial[i] = NEG;
            let result = single(&word.lower, target, &mut indexes);
            let Some(result) = result else {
                if partial_match {
                    continue;
                }
                for &(at, value) in changes.iter().rev() {
                    target.next[at] = value;
                }
                return None;
            };
            any = true;
            if i != count - 1 && indexes.windows(2).all(|pair| pair[1] - pair[0] == 1) {
                let beginning = indexes[indexes.len() - 1] + 1;
                let replace = target.next[beginning - 1];
                for at in (0..beginning).rev() {
                    if target.next[at] != replace {
                        break;
                    }
                    changes.push((at, replace));
                    target.next[at] = beginning;
                }
            }
            score += result / count as f64;
            partial[i] = result / count as f64;
            if indexes[0] < first_seen {
                score -= (first_seen - indexes[0]) as f64 * 2.0;
            }
            first_seen = indexes[0];
        }
        if partial_match && !any {
            return None;
        }
        for &(at, value) in changes.iter().rev() {
            target.next[at] = value;
        }
        if let Some(whole) = single(&search.lower, target, &mut Vec::new()).filter(|whole| *whole > score) {
            if partial_match {
                partial.iter_mut().for_each(|slot| *slot = whole / count as f64);
            }
            return Some(whole);
        }
        Some(score)
    }

    // `fastpriorityqueue` as fuzzysort hacks it: a min-heap on the score, polled in this exact order.
    #[derive(Default)]
    struct Heap {
        items: Vec<(f64, usize)>,
        len: usize,
    }

    impl Heap {
        fn add(&mut self, item: (f64, usize)) {
            let mut a = self.len;
            if self.items.len() <= self.len {
                self.items.push(item);
            }
            self.len += 1;
            while a > 0 {
                let parent = (a - 1) >> 1;
                if item.0 >= self.items[parent].0 {
                    break;
                }
                self.items[a] = self.items[parent];
                a = parent;
            }
            self.items[a] = item;
        }

        fn poll(&mut self) -> Option<(f64, usize)> {
            if self.len == 0 {
                return None;
            }
            let top = self.items[0];
            self.len -= 1;
            self.items[0] = self.items[self.len];
            self.sift();
            Some(top)
        }

        fn sift(&mut self) {
            let o = self.len;
            let mut a = 0;
            let v = self.items[0];
            let mut c = 1;
            while c < o {
                let s = c + 1;
                a = c;
                if s < o && self.items[s].0 < self.items[c].0 {
                    a = s;
                }
                self.items[(a - 1) >> 1] = self.items[a];
                c = 1 + (a << 1);
            }
            while a > 0 {
                let f = (a - 1) >> 1;
                if v.0 >= self.items[f].0 {
                    break;
                }
                self.items[a] = self.items[f];
                a = f;
            }
            self.items[a] = v;
        }
    }
}
