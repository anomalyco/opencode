//! A connect method's form, one dialog per field (`formAnswer` and its field dialogs in
//! `component/dialog-integration.tsx:862-1247`).
//!
//! Each field replaces the dialog. Closing a field's dialog cancels the whole form; the next field's `replace`
//! closes the previous one too, so each step resolves once and ignores the close that follows.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{
    FormAnswer, FormBooleanField, FormExternalField, FormField, FormMultiselectField, FormStringField, FormValue,
    FormWhen, FormWhenOp, FormWhenValue,
};
use opencode_ui::bind;
use opencode_ui::dialog::{
    DIALOG_INSET, DialogCx, DialogOptions, FooterAction, FooterProps, HeaderProps, footer, header, layout_view,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use crate::dialogs::model::Local;
use crate::routes::session::form::{initial_values, label, rows, selected_row, toggle_multiselect, validate};

type Done = Box<dyn FnOnce(Option<FormAnswer>)>;

/// One field's outcome: an answer (`None` skips it), or a cancel.
enum Outcome {
    Value(Option<FormValue>),
    Cancel,
}

/// Resolves one step once; later calls do nothing.
type Resolve = Rc<dyn Fn(Outcome)>;

struct Run {
    local: Rc<Local>,
    title: String,
    fields: Vec<FormField>,
    index: Cell<usize>,
    answer: RefCell<FormAnswer>,
    done: RefCell<Option<Done>>,
}

/// Asks `fields` in order and calls `done` with the answer, or `None` when a field's dialog was closed.
pub(super) fn answer(
    local: &Rc<Local>,
    title: String,
    fields: Vec<FormField>,
    done: impl FnOnce(Option<FormAnswer>) + 'static,
) {
    let run = Rc::new(Run {
        local: local.clone(),
        title,
        fields,
        index: Cell::new(0),
        answer: RefCell::new(FormAnswer::default()),
        done: RefCell::new(Some(Box::new(done))),
    });
    run.next();
}

impl Run {
    fn next(self: &Rc<Self>) {
        while let Some(field) = self.fields.get(self.index.get()).cloned() {
            if matches!(field, FormField::Unknown(_)) || !active(&field, &self.answer.borrow()) {
                self.index.set(self.index.get() + 1);
                continue;
            }
            if hidden(&field) {
                let key = crate::routes::session::form::key(&field).to_owned();
                if let Some(value) = initial_values(std::slice::from_ref(&field)).0.shift_remove(&key) {
                    self.answer.borrow_mut().insert(key, value);
                }
                self.index.set(self.index.get() + 1);
                continue;
            }
            self.ask(field);
            return;
        }
        self.finish(Some(self.answer.borrow().clone()));
    }

    fn finish(&self, answer: Option<FormAnswer>) {
        if let Some(done) = self.done.borrow_mut().take() {
            done(answer);
        }
    }

    fn ask(self: &Rc<Self>, field: FormField) {
        let used = Rc::new(Cell::new(false));
        let me = self.clone();
        let key = crate::routes::session::form::key(&field).to_owned();
        let resolve: Resolve = Rc::new(move |outcome| {
            if used.replace(true) {
                return;
            }
            match outcome {
                Outcome::Cancel => me.finish(None),
                Outcome::Value(value) => {
                    if let Some(value) = value {
                        me.answer.borrow_mut().insert(key.clone(), value);
                    }
                    me.index.set(me.index.get() + 1);
                    me.next();
                }
            }
        });
        let title = {
            let label = label(&field);
            if label.is_empty() { self.title.clone() } else { label }
        };
        match field {
            FormField::External(field) => external(&self.local, title, field, false, resolve),
            FormField::Multiselect(field) => {
                let selected = field.default.clone().unwrap_or_default();
                multiselect(&self.local, title, Rc::new(field), selected, resolve);
            }
            FormField::String(string) if string.options.is_some() && string.custom == Some(true) => {
                string_choice(&self.local, title, string, resolve);
            }
            FormField::Boolean(boolean) => select_boolean(&self.local, title, boolean, resolve),
            FormField::String(string) if string.options.is_some() => {
                select_string(&self.local, title, string, resolve);
            }
            field => text(&self.local, title, field, resolve),
        }
    }
}

fn hidden(field: &FormField) -> bool {
    let hidden = match field {
        FormField::String(field) => field.hidden,
        FormField::Number(field) => field.hidden,
        FormField::Integer(field) => field.hidden,
        FormField::Boolean(field) => field.hidden,
        FormField::Multiselect(field) => field.hidden,
        FormField::External(_) | FormField::Unknown(_) => None,
    };
    hidden == Some(true)
}

fn required(field: &FormField) -> bool {
    let required = match field {
        FormField::String(field) => field.required,
        FormField::Number(field) => field.required,
        FormField::Integer(field) => field.required,
        FormField::Boolean(field) => field.required,
        FormField::Multiselect(field) => field.required,
        FormField::External(_) | FormField::Unknown(_) => None,
    };
    required == Some(true)
}

/// `active`: every `when` holds on the answers given so far.
fn active(field: &FormField, answer: &FormAnswer) -> bool {
    let when: &[FormWhen] = match field {
        FormField::String(field) => field.when.as_deref(),
        FormField::Number(field) => field.when.as_deref(),
        FormField::Integer(field) => field.when.as_deref(),
        FormField::Boolean(field) => field.when.as_deref(),
        FormField::Multiselect(field) => field.when.as_deref(),
        FormField::External(_) | FormField::Unknown(_) => None,
    }
    .unwrap_or_default();
    when.iter().all(|when| {
        let Some(value) = answer.get(&when.key) else {
            return false;
        };
        let hit = match (value, &when.value) {
            (FormValue::Array(items), want) => items.contains(&when_string(want)),
            (FormValue::String(a), FormWhenValue::String(b)) => a == b,
            (FormValue::Number(a), FormWhenValue::Number(b)) => a == b,
            (FormValue::Bool(a), FormWhenValue::Bool(b)) => a == b,
            _ => false,
        };
        if when.op == FormWhenOp::Eq { hit } else { !hit }
    })
}

/// `String(when.value)`.
fn when_string(value: &FormWhenValue) -> String {
    match value {
        FormWhenValue::String(text) => text.clone(),
        FormWhenValue::Number(number) if number.fract() == 0.0 => format!("{number:.0}"),
        FormWhenValue::Number(number) => number.to_string(),
        FormWhenValue::Bool(value) => value.to_string(),
        #[allow(unreachable_patterns)]
        _ => String::new(),
    }
}

/// Replaces the dialog; closing it cancels the step.
fn replace(local: &Local, resolve: &Resolve, build: impl FnOnce(&Rc<DialogCx>) -> View + 'static) {
    let cancel = resolve.clone();
    local.dialogs.replace(build, Some(Box::new(move || cancel(Outcome::Cancel))), DialogOptions::default());
}

/// A list of answers, each with its value, plus "Skip" unless the field is required.
fn select_values(
    local: &Local,
    title: String,
    choices: Vec<(String, Option<String>, FormValue)>,
    skip: bool,
    current: Option<usize>,
    resolve: Resolve,
) {
    let mut values: Vec<Option<FormValue>> = Vec::new();
    let mut options = Vec::new();
    for (index, (title, description, value)) in choices.into_iter().enumerate() {
        let mut option = SelectOption::new(title, index);
        option.description = description;
        options.push(option);
        values.push(Some(value));
    }
    if skip {
        options.push(SelectOption::new("Skip", values.len()));
        values.push(None);
    }
    let pick = resolve.clone();
    replace(local, &resolve, move |cx| {
        let mut props = SelectProps::new(title, options);
        props.current = current;
        props.on_select = Some(Rc::new(move |option: &SelectOption<usize>| {
            pick(Outcome::Value(values[option.value].clone()));
        }));
        select::select(cx, props).0
    });
}

fn select_boolean(local: &Local, title: String, field: FormBooleanField, resolve: Resolve) {
    let order = if field.default == Some(false) { [false, true] } else { [true, false] };
    let choices = order
        .into_iter()
        .map(|value| {
            let title = if value { "Yes" } else { "No" };
            (title.to_owned(), None, FormValue::Bool(value))
        })
        .collect();
    select_values(local, title, choices, field.required != Some(true), None, resolve);
}

fn select_string(local: &Local, title: String, field: FormStringField, resolve: Resolve) {
    let options = field.options.clone().unwrap_or_default();
    let current = field.default.as_ref().and_then(|default| options.iter().position(|option| option.value == *default));
    let choices =
        options.into_iter().map(|option| (option.label, option.description, FormValue::String(option.value))).collect();
    select_values(local, title, choices, field.required != Some(true), current, resolve);
}

/// `textAnswer`: typed text for a string, number, or integer, checked before it is accepted.
fn text(local: &Local, title: String, field: FormField, resolve: Resolve) {
    let initial = initial_values(std::slice::from_ref(&field)).0.into_values().next().map(|value| match value {
        FormValue::String(text) => text,
        FormValue::Number(number) if number.fract() == 0.0 => format!("{number:.0}"),
        FormValue::Number(number) => number.to_string(),
        other => format!("{other:?}"),
    });
    let placeholder = match &field {
        FormField::String(field) => field.placeholder.clone(),
        _ => None,
    };
    let description = match &field {
        FormField::String(field) => field.description.clone(),
        FormField::Number(field) => field.description.clone(),
        FormField::Integer(field) => field.description.clone(),
        _ => None,
    };
    let confirm = resolve.clone();
    replace(local, &resolve, move |cx| {
        let (errors, set_error) = super::error_slot(cx, true);
        if let Some(description) = description {
            errors.insert(0, &Text::new(&cx.app, description).fg(cx.theme.text.muted));
        }
        let on_confirm = Rc::new(move |input: &str| {
            let text = input.trim();
            let value = if text.is_empty() && !required(&field) {
                None
            } else if matches!(field, FormField::String(_)) {
                Some(FormValue::String(text.to_owned()))
            } else {
                // `Number(text)`: blank is 0, anything else unparsable is NaN.
                Some(FormValue::Number(if text.is_empty() { 0.0 } else { text.parse().unwrap_or(f64::NAN) }))
            };
            if let Some(invalid) = validate(&field, value.as_ref()) {
                set_error(invalid);
                return;
            }
            confirm(Outcome::Value(value));
        });
        prompt(
            cx,
            PromptProps {
                title,
                placeholder,
                value: initial,
                description: Some(Rc::new(move |_| errors.as_any())),
                on_confirm: Some(on_confirm),
                ..PromptProps::default()
            },
        )
        .0
    });
}

#[derive(Clone, PartialEq)]
enum Pick {
    Item(String),
    Custom,
    Submit,
}

/// `multiselectAnswer`: checkboxes, an own answer, and "Continue" once the selection is valid.
fn multiselect(
    local: &Rc<Local>,
    title: String,
    field: Rc<FormMultiselectField>,
    selected: Vec<String>,
    resolve: Resolve,
) {
    let whole = FormField::Multiselect((*field).clone());
    let invalid = validate(&whole, Some(&FormValue::Array(selected.clone())));
    let mut options: Vec<SelectOption<Pick>> = field
        .options
        .iter()
        .map(|option| {
            let checked = selected.contains(&option.value);
            let mut row = SelectOption::new(
                format!("[{}] {}", if checked { "x" } else { " " }, option.label),
                Pick::Item(option.value.clone()),
            );
            row.description = option.description.clone();
            row.disabled = !checked && field.max_items.is_some_and(|max| selected.len() as i64 >= max);
            row
        })
        .collect();
    if field.custom == Some(true) {
        options.push(SelectOption::new("Type your own answer", Pick::Custom));
    }
    let mut submit = SelectOption::new("Continue", Pick::Submit);
    submit.disabled = invalid.is_some();
    submit.description = invalid;
    options.push(submit);

    let local_pick = local.clone();
    let pick = resolve.clone();
    let step = Rc::new(Cell::new(false));
    // Each pick reshows the list; only the final outcome reaches `resolve`, so the reshow's close is ignored.
    let cancel_guard = step.clone();
    let cancel = resolve.clone();
    let on_close: Box<dyn FnOnce()> = Box::new(move || {
        if !cancel_guard.get() {
            cancel(Outcome::Cancel);
        }
    });
    local.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new(title.clone(), options);
            props.on_select = Some(Rc::new(move |option: &SelectOption<Pick>| {
                step.set(true);
                match &option.value {
                    Pick::Submit => pick(Outcome::Value(Some(FormValue::Array(selected.clone())))),
                    Pick::Item(item) => {
                        let next = toggle_multiselect(Some(&FormValue::Array(selected.clone())), item);
                        multiselect(&local_pick, title.clone(), field.clone(), next, pick.clone());
                    }
                    Pick::Custom => custom(&local_pick, title.clone(), field.clone(), selected.clone(), pick.clone()),
                }
            }));
            select::select(cx, props).0
        },
        Some(on_close),
        DialogOptions::default(),
    );
}

/// `customAnswer`: one typed answer for a multiselect, then back to the list.
fn custom(local: &Rc<Local>, title: String, field: Rc<FormMultiselectField>, selected: Vec<String>, resolve: Resolve) {
    let done = Rc::new(Cell::new(false));
    let guard = done.clone();
    let cancel = resolve.clone();
    let back = local.clone();
    local.dialogs.replace(
        move |cx| {
            let confirm_title = title.clone();
            let on_confirm = Rc::new(move |value: &str| {
                if value.is_empty() {
                    return;
                }
                done.set(true);
                let mut next = selected.clone();
                if !next.iter().any(|item| item == value) {
                    next.push(value.to_owned());
                }
                multiselect(&back, confirm_title.clone(), field.clone(), next, resolve.clone());
            });
            prompt(
                cx,
                PromptProps {
                    title,
                    placeholder: Some("Type your own answer".into()),
                    on_confirm: Some(on_confirm),
                    ..PromptProps::default()
                },
            )
            .0
        },
        Some(Box::new(move || {
            if !guard.get() {
                cancel(Outcome::Cancel);
            }
        })),
        DialogOptions::default(),
    );
}

/// `externalAnswer`: open the field's link, then confirm once it was opened.
fn external(local: &Rc<Local>, title: String, field: FormExternalField, opened: bool, resolve: Resolve) {
    let mut open = SelectOption::new(if opened { "Open link again" } else { "Open link" }, true);
    open.description = Some(field.url.clone());
    let mut finished = SelectOption::new("I finished", false);
    finished.description = field.description.clone();
    finished.disabled = !opened;
    let step = Rc::new(Cell::new(false));
    let guard = step.clone();
    let cancel = resolve.clone();
    let again = local.clone();
    local.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new(title.clone(), vec![open, finished]);
            props.on_select = Some(Rc::new(move |option: &SelectOption<bool>| {
                if !option.value {
                    resolve(Outcome::Value(Some(FormValue::Bool(true))));
                    return;
                }
                step.set(true);
                opening(&again, title.clone(), field.clone(), opened, resolve.clone());
            }));
            select::select(cx, props).0
        },
        Some(Box::new(move || {
            if !guard.get() {
                cancel(Outcome::Cancel);
            }
        })),
        DialogOptions::default(),
    );
}

/// "Opening link…" while the browser starts, then the link list again.
fn opening(local: &Rc<Local>, title: String, field: FormExternalField, opened: bool, resolve: Resolve) {
    let closed = Rc::new(Cell::new(false));
    let shown = closed.clone();
    let cancel = resolve.clone();
    let view_title = title.clone();
    local.dialogs.replace(
        move |cx| super::oauth_view(cx, &view_title, None, "Opening link…", None),
        Some(Box::new(move || {
            if !shown.replace(true) {
                cancel(Outcome::Cancel);
            }
        })),
        DialogOptions::default(),
    );
    let local = local.clone();
    local.app.clone().defer(move |_| {
        if closed.get() {
            return;
        }
        let open = local.open_url.borrow().clone();
        let ok = open(&field.url).is_ok();
        closed.set(true);
        external(&local, title, field, opened || ok, resolve);
    });
}

// ---------------------------------------------------------------------------------------------------------------
// `StringChoiceField`
// ---------------------------------------------------------------------------------------------------------------

struct Choice {
    cx: Rc<DialogCx>,
    field: FormField,
    rows: Vec<crate::routes::session::form::Row>,
    count: usize,
    selected: Cell<usize>,
    editing: Cell<bool>,
    text: RefCell<String>,
    error: RefCell<String>,
    list: ScrollBox,
    height: Cell<usize>,
    error_line: Text,
    footer: View,
    textarea: Textarea,
    resolve: Resolve,
}

/// A string with options and an own answer: numbered rows, a typed answer, and "Skip" unless required.
fn string_choice(local: &Local, title: String, string: FormStringField, resolve: Resolve) {
    let field = FormField::String(string.clone());
    let rows = rows(Some(&field));
    let count = rows.len() + if string.required == Some(true) { 1 } else { 2 };
    let default = string.default.clone().map(FormValue::String);
    let selected = selected_row(Some(&field), default.as_ref());
    let text = initial_values(std::slice::from_ref(&field)).1.remove(&string.key).unwrap_or_default();
    let resolve_build = resolve.clone();
    replace(local, &resolve, move |cx| {
        let app = &cx.app;
        let theme = &cx.theme;
        let height = (count + rows.iter().filter(|row| row.description.is_some()).count())
            .min((usize::from(app.size().1) / 2).saturating_sub(6).max(3));
        let list = ScrollBox::new(app).scrollbars(false).content_gap(1);
        list.height(height as u32);
        let focused = theme.text.formfield.focused;
        let textarea = Textarea::new(app)
            .mouse_pointer(MousePointer::DEFAULT)
            .height(1)
            .wrap(WrapMode::None)
            .grow(1.0)
            .basis(Length::Auto)
            .placeholder(string.placeholder.as_deref().unwrap_or("Type your own answer"))
            .placeholder_color(theme.text.muted)
            .colors(focused, Color::TRANSPARENT)
            .focused_colors(focused, Color::TRANSPARENT)
            .cursor_color(focused);
        let state = Rc::new(Choice {
            cx: cx.clone(),
            field,
            rows,
            count,
            selected: Cell::new(selected),
            editing: Cell::new(false),
            text: RefCell::new(text),
            error: RefCell::new(String::new()),
            list: list.clone(),
            height: Cell::new(height),
            error_line: Text::new(app, "").fg(theme.text.feedback.error.base),
            footer: View::new(app),
            textarea,
            resolve: resolve_build,
        });
        state.layers();
        let back = Rc::downgrade(&state);
        let head = header(
            cx,
            HeaderProps {
                title: title.clone(),
                on_close: Some(Rc::new(bind!(back, |state| {
                    if state.editing.get() {
                        state.back();
                        return;
                    }
                    state.cx.dialogs.clear();
                }))),
                ..HeaderProps::default()
            },
        );
        let body = View::new(app).gap(1);
        if let Some(description) = &string.description {
            body.add(&Text::new(app, description.clone()).fg(theme.text.muted));
        }
        body.add(&list).add(&state.error_line);
        state.render();
        let owner = state.clone();
        cx.on_close(Disposer::new(move || drop(owner)));
        layout_view(cx, &head, &body, Some(&state.footer), DIALOG_INSET, 1)
    });
}

impl Choice {
    fn layers(self: &Rc<Self>) {
        let command = |id: &str, title: &str, run: fn(&Rc<Choice>)| {
            TuiCommand::new(id, bind!(self, |state, _, _| run(&state))).title(title).group("Form")
        };
        let not_editing = {
            let weak = Rc::downgrade(self);
            Condition::when(move || weak.upgrade().is_some_and(|state| !state.editing.get()))
        };
        let editing = {
            let weak = Rc::downgrade(self);
            Condition::when(move || weak.upgrade().is_some_and(|state| state.editing.get()))
        };
        self.cx.layer(
            KeymapLayer::new(vec![
                command("dialog.select.prev", "Previous answer", |state| state.move_by(state.count - 1)),
                command("dialog.select.next", "Next answer", |state| state.move_by(1)),
                command("dialog.select.submit", "Select answer", |state| state.select(state.selected.get())),
            ])
            .enabled(not_editing),
        );
        let back = Rc::downgrade(self);
        self.cx.layer(
            KeymapLayer::new(vec![
                command("dialog.prompt.submit", "Submit answer", Choice::submit_text),
                TuiCommand::inline("escape", bind!(back, |state, _, _| state.back()))
                    .title("Back to answers")
                    .group("Form"),
            ])
            .enabled(editing)
            .target(self.textarea.id())
            .priority(1),
        );
    }

    fn move_by(self: &Rc<Self>, delta: usize) {
        self.selected.set((self.selected.get() + delta) % self.count);
        self.render();
    }

    fn select(self: &Rc<Self>, index: usize) {
        self.selected.set(index);
        self.error.borrow_mut().clear();
        if index == self.rows.len() {
            self.editing.set(true);
            self.textarea.set_text(self.text.borrow().as_str());
            self.textarea.perform(EditorAction::BufferEnd);
            self.render();
            self.textarea.focus();
            return;
        }
        let value = self.rows.get(index).map(|row| match &row.value {
            FormValue::String(text) => text.clone(),
            other => format!("{other:?}"),
        });
        self.render();
        self.submit(value);
    }

    fn submit_text(self: &Rc<Self>) {
        let text = self.textarea.text().trim().to_owned();
        self.submit((!text.is_empty()).then_some(text));
    }

    fn submit(self: &Rc<Self>, value: Option<String>) {
        let value = value.map(FormValue::String);
        if let Some(invalid) = validate(&self.field, value.as_ref()) {
            *self.error.borrow_mut() = invalid;
            self.render();
            return;
        }
        (self.resolve)(Outcome::Value(value));
    }

    fn back(self: &Rc<Self>) {
        *self.text.borrow_mut() = self.textarea.text();
        self.editing.set(false);
        self.error.borrow_mut().clear();
        self.cx.app.blur();
        self.render();
    }

    fn render(self: &Rc<Self>) {
        let app = &self.cx.app;
        let theme = &self.cx.theme;
        let selected = self.selected.get();
        let fg = |index: usize| {
            if selected == index { theme.text.formfield.focused } else { theme.text.formfield.base }
        };
        let content = self.list.content_view();
        // The textarea moves into the new custom row when it is added again.
        content.clear();
        let mut rows: Vec<View> = Vec::new();
        for (index, row) in self.rows.iter().enumerate() {
            let view = View::new(app).child(&Text::new(app, format!("{}. {}", index + 1, row.label)).fg(fg(index)));
            if let Some(description) = &row.description {
                view.add(
                    &View::new(app)
                        .padding_edge(Edge::Left, 3)
                        .child(&Text::new(app, description.clone()).fg(theme.text.muted)),
                );
            }
            rows.push(view);
        }
        let own = self.rows.len();
        let custom = View::new(app).row().gap(1).child(&Text::new(app, format!("{}.", own + 1)).fg(fg(own)));
        if self.editing.get() {
            custom.add(&self.textarea);
        } else {
            let text = self.text.borrow();
            let shown = if text.is_empty() { "Type your own answer".to_owned() } else { text.clone() };
            custom.add(&Text::new(app, shown).fg(fg(own)));
        }
        rows.push(custom);
        if self.count > own + 1 {
            rows.push(View::new(app).child(&Text::new(app, format!("{}. Skip", own + 2)).fg(fg(own + 1))));
        }
        for (index, row) in rows.iter().enumerate() {
            let weak = Rc::downgrade(self);
            row.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
                if matches!(event.kind, MouseEventKind::Up(_))
                    && let Some(state) = weak.upgrade()
                {
                    state.select(index);
                }
            });
            content.add(row);
        }
        self.scroll_to_selected();
        let error = self.error.borrow();
        self.error_line.set_text(error.clone());
        self.error_line.visible(!error.is_empty());
        self.render_footer();
        app.request_redraw();
    }

    // `scrollChildIntoView`, from the row heights: the rows were just rebuilt and have no layout yet. Each row is
    // one line plus its description, with one blank line between rows.
    fn scroll_to_selected(&self) {
        let selected = self.selected.get();
        let height = |index: usize| 1 + usize::from(self.rows.get(index).is_some_and(|row| row.description.is_some()));
        let top: usize = (0..selected).map(|index| height(index) + 1).sum();
        let bottom = top + height(selected);
        let view = self.height.get();
        let (_, offset) = self.list.scroll_position();
        let offset = offset.max(0.0) as usize;
        if top < offset {
            self.list.scroll_to(0.0, top as f64);
        } else if bottom > offset + view {
            self.list.scroll_to(0.0, (bottom - view) as f64);
        }
    }

    fn render_footer(self: &Rc<Self>) {
        let action = |title: &str, key: &str, run: fn(&Rc<Choice>)| {
            FooterAction::new(title).key(key).on_trigger(bind!(self, |state| run(&state)))
        };
        let secondary = if self.editing.get() {
            vec![action("submit", "enter", Choice::submit_text), action("back", "esc", Choice::back)]
        } else {
            vec![
                FooterAction::new("select").key("↑/↓"),
                action("confirm", "enter", |state| state.select(state.selected.get())),
                action("cancel", "esc", |state| state.cx.dialogs.clear()),
            ]
        };
        self.footer.clear();
        self.footer.add(&footer(&self.cx, FooterProps { secondary, ..FooterProps::default() }));
    }
}
