//! The form footer (`footer.form.tsx`, `form.shared.ts`): one field at a time, choices as numbered rows, typed
//! answers in a field, and a review before the answers are sent.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use opencode_api::generated::{FormAnswer, FormField, FormInfo, FormValue};
use opencode_ui::form::{
    custom, display_value, initial_values, key, label, rows, selected_row, set_multiselect_custom,
    textual, toggle_multiselect, validate,
};
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::scroll::Scroller;
use crate::theme::FooterTheme;

/// `FormBodyState`.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub form: String,
    pub field: usize,
    pub answers: IndexMap<String, FormValue>,
    pub custom: HashMap<String, String>,
    pub selected: usize,
    pub editing: bool,
    pub external_ready: HashSet<String>,
    pub submitting: bool,
    pub error: String,
}

impl State {
    /// `createFormBodyState`.
    pub fn new(form: &FormInfo) -> Self {
        let (answers, custom) = initial_values(&form.fields);
        let first = form.fields.first();
        let selected = selected_row(first, first.and_then(|field| answers.get(key(field))));
        Self {
            form: form.id.0.clone(),
            field: 0,
            answers,
            custom,
            selected,
            editing: textual(first),
            external_ready: HashSet::new(),
            submitting: false,
            error: String::new(),
        }
    }

    pub fn answer(&self, field: &FormField) -> Option<&FormValue> {
        self.answers.get(key(field))
    }

    fn set_answer(&mut self, field: &FormField, value: Option<FormValue>) {
        match value {
            Some(value) => self.answers.insert(key(field).to_owned(), value),
            None => self.answers.shift_remove(key(field)),
        };
    }

    fn acknowledged(&self, field: &FormField) -> bool {
        self.answer(field) == Some(&FormValue::Bool(true))
    }

    /// `formMove`.
    pub fn step(&mut self, form: &FormInfo, down: bool) {
        let field = current(form, self);
        let total = rows(field).len() + usize::from(custom(field));
        if total == 0 {
            return;
        }
        self.selected = (self.selected + if down { 1 } else { total - 1 }) % total;
        self.error.clear();
    }

    /// `formSetSelected`.
    pub fn select(&mut self, selected: usize) {
        self.selected = selected;
        self.error.clear();
    }

    /// `formSetError`.
    pub fn fail(&mut self, error: impl Into<String>) {
        self.error = error.into();
        self.submitting = false;
    }

    /// `formInput`: the field's draft, else its answer as text.
    pub fn input(&self, field: Option<&FormField>) -> String {
        match field {
            None | Some(FormField::External(_)) => String::new(),
            Some(field) => self
                .custom
                .get(key(field))
                .cloned()
                .unwrap_or_else(|| display_value(field, self.answer(field), "")),
        }
    }

    /// `formSetDraft`.
    pub fn set_draft(&mut self, field: Option<&FormField>, value: &str) {
        let Some(field) = field.filter(|field| !matches!(field, FormField::External(_))) else {
            return;
        };
        self.custom.insert(key(field).to_owned(), value.to_owned());
    }

    /// `formSetField`.
    pub fn set_field(&mut self, form: &FormInfo, index: usize) {
        let bounded = index.min(form.fields.len());
        let field = form.fields.get(bounded);
        self.field = bounded;
        self.selected = selected_row(field, field.and_then(|field| self.answer(field)));
        self.editing = textual(field);
        self.error.clear();
    }

    /// `formPick`: the selected row answers the field, or opens the custom field.
    pub fn pick(&mut self, form: &FormInfo) {
        let Some(field) = current(form, self).cloned() else {
            return;
        };
        if matches!(field, FormField::External(_)) || textual(Some(&field)) {
            return;
        }
        let choices = rows(Some(&field));
        if self.selected == choices.len() && custom(Some(&field)) {
            self.editing = true;
            self.error.clear();
            return;
        }
        let Some(row) = choices.get(self.selected) else {
            return;
        };
        if matches!(field, FormField::Multiselect(_)) {
            let item = match &row.value {
                FormValue::String(text) => text.clone(),
                other => format!("{other:?}"),
            };
            let values = toggle_multiselect(self.answer(&field), &item);
            self.set_answer(&field, Some(FormValue::Array(values)));
            self.error.clear();
            return;
        }
        self.set_answer(&field, Some(row.value.clone()));
        self.error.clear();
        let next = if single(form) {
            self.field
        } else {
            self.field + 1
        };
        self.set_field(form, next);
    }

    /// `formCommitInput`: the typed text answers the field, or explains why it cannot.
    pub fn commit(&mut self, form: &FormInfo, text: &str) {
        let Some(field) = current(form, self).cloned() else {
            return;
        };
        if matches!(field, FormField::External(_) | FormField::Boolean(_)) {
            return;
        }
        let input = text.trim();
        if let FormField::Multiselect(_) = field {
            let values = set_multiselect_custom(
                self.answer(&field),
                self.custom.get(key(&field)).map(String::as_str),
                input,
            );
            let values = FormValue::Array(values);
            if let Some(invalid) = validate(&field, Some(&values)) {
                return self.fail(invalid);
            }
            self.set_answer(&field, Some(values));
            self.custom.insert(key(&field).to_owned(), input.to_owned());
            self.editing = false;
            self.error.clear();
            return;
        }
        let value = if input.is_empty() {
            None
        } else if matches!(field, FormField::Number(_) | FormField::Integer(_)) {
            Some(FormValue::Number(input.parse().unwrap_or(f64::NAN)))
        } else {
            Some(FormValue::String(input.to_owned()))
        };
        if let Some(invalid) = validate(&field, value.as_ref()) {
            return self.fail(invalid);
        }
        let draft = match &value {
            Some(FormValue::String(text)) => text.clone(),
            _ => input.to_owned(),
        };
        self.set_answer(&field, value);
        self.custom.insert(key(&field).to_owned(), draft);
        self.editing = false;
        self.error.clear();
    }

    /// `formAcknowledge`.
    pub fn acknowledge(&mut self, form: &FormInfo) {
        let Some(field) = current(form, self).cloned() else {
            return;
        };
        if !matches!(field, FormField::External(_)) || !self.external_ready.contains(key(&field)) {
            return;
        }
        self.set_answer(&field, Some(FormValue::Bool(true)));
        self.error.clear();
        let next = if single(form) {
            self.field
        } else {
            self.field + 1
        };
        self.set_field(form, next);
    }
}

/// `formCurrent`.
pub fn current<'a>(form: &'a FormInfo, state: &State) -> Option<&'a FormField> {
    form.fields.get(state.field)
}

/// `formConfirm`: past the last field, on the review.
pub fn confirm(form: &FormInfo, state: &State) -> bool {
    state.field >= form.fields.len()
}

/// `formSingle`: one field that answers and submits at once.
pub fn single(form: &FormInfo) -> bool {
    form.fields.len() == 1
        && matches!(
            form.fields[0],
            FormField::Boolean(_)
                | FormField::Number(_)
                | FormField::Integer(_)
                | FormField::External(_)
                | FormField::String(_)
        )
}

/// `formPlaceholder`.
pub fn placeholder(field: Option<&FormField>) -> String {
    match field {
        Some(FormField::String(field)) => field
            .placeholder
            .clone()
            .unwrap_or_else(|| "Type your answer".to_owned()),
        _ => "Enter a number".to_owned(),
    }
}

/// `formUnsupported`: why mini cannot show this form, if it cannot.
pub fn unsupported(form: &FormInfo) -> Option<String> {
    if form.fields.is_empty() {
        return Some("This form has no supported fields.".to_owned());
    }
    for field in form.fields.iter() {
        let when = match field {
            FormField::String(field) => field.when.as_ref(),
            FormField::Number(field) => field.when.as_ref(),
            FormField::Integer(field) => field.when.as_ref(),
            FormField::Boolean(field) => field.when.as_ref(),
            FormField::Multiselect(field) => field.when.as_ref(),
            FormField::External(_) => None,
            FormField::Unknown(value) => {
                let kind = value.get("type").and_then(|kind| kind.as_str());
                let Some(kind) = kind else {
                    return Some("This form uses an unknown field.".to_owned());
                };
                if !value.get("key").is_some_and(serde_json::Value::is_string) {
                    return Some("This form uses an invalid field.".to_owned());
                }
                return Some(format!("Field type {kind} is not supported in Mini yet."));
            }
        };
        if when.is_some_and(|when| !when.is_empty()) {
            return Some("Conditional forms are not supported in Mini yet.".to_owned());
        }
        if let FormField::String(field) = field
            && field.pattern.is_some()
        {
            return Some("Pattern-constrained forms are not supported in Mini yet.".to_owned());
        }
    }
    None
}

/// `formValidate`.
pub fn invalid(form: &FormInfo, state: &State) -> Option<String> {
    if let Some(unsupported) = unsupported(form) {
        return Some(unsupported);
    }
    for field in form.fields.iter() {
        if matches!(field, FormField::External(_)) {
            if !state.acknowledged(field) {
                return Some(format!("Acknowledge {}", label(field)));
            }
            continue;
        }
        if let Some(invalid) = validate(field, state.answer(field)) {
            return Some(format!("{}: {invalid}", label(field)));
        }
    }
    None
}

/// `formAnswer`.
pub fn answer(form: &FormInfo, state: &State) -> Option<FormAnswer> {
    if invalid(form, state).is_some() {
        return None;
    }
    Some(
        form.fields
            .iter()
            .filter_map(|field| Some((key(field).to_owned(), state.answer(field)?.clone())))
            .collect(),
    )
}

/// `action`: what Enter does, for the hint row.
pub fn action(form: &FormInfo, state: &State, width: u16) -> &'static str {
    let field = current(form, state);
    if confirm(form, state) {
        return "submit";
    }
    if textual(field) || state.editing {
        return "save";
    }
    let Some(field) = field.filter(|field| matches!(field, FormField::External(_))) else {
        return "choose";
    };
    if state.acknowledged(field) {
        return if single(form) { "submit" } else { "next" };
    }
    if state.external_ready.contains(key(field)) {
        return if width < 24 { "done" } else { "acknowledge" };
    }
    "open URL"
}

pub struct Body<'a> {
    pub form: &'a FormInfo,
    pub state: &'a State,
    pub theme: &'a FooterTheme,
    pub mono: bool,
    pub width: u16,
    pub height: u16,
}

/// What the body hands back: the scroll box to page, and the answer field to focus while editing.
pub struct Painted {
    pub scroll: Scroller,
    pub field: Option<Textarea>,
}

/// `RunFormBody`.
pub fn paint(app: &App, root: &View, body: &Body<'_>) -> Painted {
    let theme = body.theme;
    let form = body.form;
    let state = body.state;
    let width = body.width;
    let compact = width < 56 || body.height < 12;
    let gap = u32::from(!compact);
    let unsupported = unsupported(form);
    let field = current(form, state);
    let external = field.filter(|field| matches!(field, FormField::External(_)));
    let answering = field.filter(|field| !matches!(field, FormField::External(_)));
    let confirm = confirm(form, state);
    let choices = rows(field);
    let has_custom = custom(field);
    let is_textual = textual(field);
    let multiple = matches!(field, Some(FormField::Multiselect(_)));
    let editing = unsupported.is_none() && !confirm && (is_textual || state.editing);
    root.clear();
    root.bg(theme.surface)
        .padding_edge(Edge::Left, if compact { 0 } else { 2 })
        .padding_edge(Edge::Right, if compact { 0 } else { 3 })
        .padding_edge(Edge::Top, gap)
        .padding_edge(Edge::Bottom, gap);

    let title = View::new(app)
        .row()
        .height(1)
        .gap(1)
        .shrink(0.0)
        .margin_edge(Edge::Bottom, gap)
        .child(
            &Text::new(app, if body.mono { "*" } else { "◆" })
                .fg(if unsupported.is_some() {
                    theme.warning
                } else {
                    theme.question
                })
                .wrap(WrapMode::None)
                .shrink(0.0),
        )
        .child(
            &Text::new(app, form.title.clone())
                .fg(theme.text)
                .wrap(WrapMode::None)
                .truncate(true)
                .min_width(0),
        );
    if unsupported.is_none() && !single(form) {
        title.add(
            &Text::new(
                app,
                if confirm {
                    "Review".to_owned()
                } else {
                    format!(
                        "{}/{}",
                        (state.field + 1).min(form.fields.len()),
                        form.fields.len()
                    )
                },
            )
            .fg(theme.muted)
            .wrap(WrapMode::None)
            .shrink(0.0),
        );
    }
    root.add(&title);

    let line = |text: String, color: Color| {
        Text::new(app, text)
            .fg(color)
            .wrap(WrapMode::Word)
            .width(Length::percent(100.0))
            .shrink(0.0)
    };
    let content = View::new(app)
        .column()
        .width(Length::percent(100.0))
        .shrink(0.0)
        .gap(gap);
    if let Some(message) = form
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("message"))
        .and_then(serde_json::Value::as_str)
    {
        content.add(&line(message.to_owned(), theme.muted));
    }
    if let Some(unsupported) = &unsupported {
        content.add(
            &View::new(app)
                .column()
                .width(Length::percent(100.0))
                .shrink(0.0)
                .gap(gap)
                .child(&line(unsupported.clone(), theme.warning))
                .child(&line(
                    "This request remains pending until you dismiss it.".to_owned(),
                    theme.muted,
                )),
        );
    }
    if let (None, Some(outer @ FormField::External(field))) = (&unsupported, external) {
        let done = state.acknowledged(outer);
        let ready = state.external_ready.contains(&field.key);
        content.add(
            &View::new(app)
                .column()
                .width(Length::percent(100.0))
                .shrink(0.0)
                .gap(gap)
                .child(&line(
                    field.description.clone().unwrap_or_else(|| label(outer)),
                    theme.text,
                ))
                .child(&line(field.url.clone(), theme.link))
                .child(&line(
                    if done {
                        "Acknowledged"
                    } else if ready {
                        "Press enter to acknowledge completion"
                    } else {
                        "Press enter to open the URL"
                    }
                    .to_owned(),
                    if done { theme.selection } else { theme.muted },
                )),
        );
    }
    if let (None, Some(field), false) = (&unsupported, answering, confirm) {
        let question = description(field).map_or_else(|| label(field), str::to_owned);
        let block = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .shrink(0.0)
            .gap(gap)
            .child(&line(
                format!(
                    "{question}{}{}",
                    if required(field) { " (required)" } else { "" },
                    if multiple {
                        " (select all that apply)"
                    } else {
                        ""
                    }
                ),
                theme.text,
            ));
        if !is_textual && !state.editing {
            let list = View::new(app)
                .column()
                .width(Length::percent(100.0))
                .shrink(0.0);
            let value = state.answer(field);
            for (index, row) in choices.iter().enumerate() {
                let active = state.selected == index;
                let picked = match value {
                    Some(FormValue::Array(items)) => {
                        matches!(&row.value, FormValue::String(text) if items.contains(text))
                    }
                    Some(value) => *value == row.value,
                    None => false,
                };
                let ordinal = if body.mono {
                    format!("{}{}.", if active { ">" } else { " " }, index + 1)
                } else {
                    format!("{}.", index + 1)
                };
                let fg = if active {
                    theme.formfield_focused_text
                } else {
                    theme.formfield_text
                };
                let inline = row.description.as_ref().is_some_and(|description| {
                    ordinal.width()
                        + 2
                        + row.label.width()
                        + if multiple {
                            4
                        } else if picked {
                            2
                        } else {
                            0
                        }
                        + description.width()
                        <= usize::from(width)
                            .saturating_sub(if compact { 0 } else { 5 })
                            .saturating_sub(if body.mono { 0 } else { 1 })
                });
                let mut spans = Vec::new();
                if multiple {
                    spans.push(
                        format!("[{}] ", if picked { "x" } else { " " }).fg(if picked {
                            theme.selection
                        } else {
                            fg
                        }),
                    );
                }
                spans.push(row.label.clone().fg(fg));
                if !multiple && picked {
                    spans.push(" *".fg(theme.selection));
                }
                let text = View::new(app)
                    .direction(if inline {
                        FlexDirection::Row
                    } else {
                        FlexDirection::Column
                    })
                    .gap(u32::from(inline))
                    .grow(1.0)
                    .basis(Length::Auto)
                    .min_width(0)
                    .child(&Text::new(app, spans).wrap(WrapMode::Word).shrink(0.0));
                if let Some(description) = &row.description {
                    text.add(
                        &Text::new(app, description.clone())
                            .fg(theme.muted)
                            .wrap(WrapMode::Word)
                            .shrink(0.0),
                    );
                }
                list.add(
                    &View::new(app)
                        .row()
                        .gap(1)
                        .shrink(0.0)
                        .align_items(Align::Start)
                        .bg(if active {
                            theme.formfield_focused_bg
                        } else {
                            Color::TRANSPARENT
                        })
                        .child(
                            &Text::new(app, ordinal)
                                .fg(fg)
                                .wrap(WrapMode::None)
                                .shrink(0.0),
                        )
                        .child(&text),
                );
            }
            if has_custom {
                let active = state.selected == choices.len();
                let fg = if active {
                    theme.formfield_focused_text
                } else {
                    theme.formfield_text
                };
                let ordinal = if body.mono {
                    format!("{}{}.", if active { ">" } else { " " }, choices.len() + 1)
                } else {
                    format!("{}.", choices.len() + 1)
                };
                list.add(
                    &View::new(app)
                        .row()
                        .gap(1)
                        .shrink(0.0)
                        .bg(if active {
                            theme.formfield_focused_bg
                        } else {
                            Color::TRANSPARENT
                        })
                        .child(
                            &Text::new(app, ordinal)
                                .fg(fg)
                                .wrap(WrapMode::None)
                                .shrink(0.0),
                        )
                        .child(
                            &Text::new(app, "Type your own answer")
                                .fg(fg)
                                .wrap(WrapMode::Word)
                                .grow(1.0)
                                .basis(Length::Auto)
                                .min_width(0),
                        ),
                );
            }
            block.add(&list);
        }
        content.add(&block);
    }
    if unsupported.is_none() && confirm {
        let review = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .shrink(0.0);
        for field in form.fields.iter() {
            let value = if matches!(field, FormField::External(_)) {
                if state.acknowledged(field) {
                    "acknowledged".to_owned()
                } else {
                    "required".to_owned()
                }
            } else {
                let shown = display_value(field, state.answer(field), "");
                if shown.is_empty() {
                    "(not answered)".to_owned()
                } else {
                    shown
                }
            };
            review.add(&line(format!("{}: {value}", label(field)), theme.muted));
        }
        content.add(&review);
    }
    if state.error.width() > usize::from(width) || state.error.contains('\n') {
        content.add(&line(state.error.clone(), theme.error));
    }

    let (frame, scroller) = Scroller::new(app, theme, !body.mono, false);
    scroller
        .scroll
        .content_view()
        .padding_edge(Edge::Right, if body.mono { 0 } else { 1 });
    if !compact && editing {
        // The content's height, capped to leave the field and the hints their rows.
        let rows = content_rows(form, state, width);
        frame
            .height(rows.min(usize::from(body.height).saturating_sub(9).max(1)) as u32)
            .shrink(0.0);
    } else {
        frame.grow(1.0).basis(Length::Auto);
    }
    scroller.scroll.add(&content);
    root.add(&frame);

    let mut area = None;
    if let (None, Some(field), true) = (&unsupported, answering, editing) {
        let text = Textarea::new(app)
            .wrap(WrapMode::Word)
            .width(Length::percent(100.0))
            .min_height(1)
            .max_height(u32::from(body.height.saturating_sub(6).clamp(1, 3)))
            .shrink(0.0)
            .margin_edge(Edge::Top, gap)
            .placeholder(placeholder(Some(field)))
            .placeholder_color(theme.muted)
            .colors(theme.formfield_text, theme.surface)
            .focused_colors(theme.formfield_focused_text, theme.formfield_focused_bg)
            .cursor_color(theme.formfield_focused_text);
        text.set_text(state.input(Some(field)));
        root.add(&text);
        area = Some(text);
    }
    if !state.error.is_empty() && compact {
        root.add(
            &Text::new(app, state.error.clone())
                .fg(theme.error)
                .height(1)
                .wrap(WrapMode::None)
                .truncate(true)
                .shrink(0.0),
        );
    }
    if !compact && editing {
        root.add(&View::new(app).grow(1.0).basis(Length::Auto).min_height(0));
    }
    let status = if state.submitting {
        theme.running
    } else {
        theme.muted
    };
    if compact {
        let hints = View::new(app)
            .row()
            .flex_wrap(Wrap::Wrap)
            .column_gap(1)
            .shrink(0.0);
        if unsupported.is_none() {
            hints.add(
                &Text::new(
                    app,
                    if state.submitting {
                        "submitting…".to_owned()
                    } else {
                        format!("enter {}", action(form, state, width))
                    },
                )
                .fg(status)
                .height(1)
                .wrap(WrapMode::None)
                .shrink(0.0),
            );
        }
        if !state.submitting {
            hints.add(
                &Text::new(app, "esc dismiss")
                    .fg(theme.muted)
                    .height(1)
                    .wrap(WrapMode::None)
                    .shrink(0.0),
            );
        }
        if !state.submitting && body.height >= 10 {
            let select = width >= 56 && !choices.is_empty() && !state.editing;
            hints.add(
                &Text::new(
                    app,
                    format!(
                        "{}pgup/pgdn scroll",
                        if select {
                            "up/down select  tab next  "
                        } else {
                            ""
                        }
                    ),
                )
                .fg(theme.muted)
                .wrap(WrapMode::Word)
                .shrink(0.0),
            );
        }
        root.add(&hints);
    } else {
        let hint = if state.submitting {
            "submitting…".to_owned()
        } else if unsupported.is_some() {
            "esc dismiss".to_owned()
        } else if confirm {
            "enter submit   esc dismiss".to_owned()
        } else if editing {
            "enter save   esc dismiss".to_owned()
        } else if external.is_some() {
            format!("enter {}   esc dismiss", action(form, state, width))
        } else if body.mono {
            "up/down select   enter choose   tab next   esc dismiss".to_owned()
        } else {
            "↑↓ select   enter choose   tab next   esc dismiss".to_owned()
        };
        let row = View::new(app)
            .row()
            .justify(Justify::SpaceBetween)
            .gap(1)
            .shrink(0.0)
            .child(
                &Text::new(app, hint)
                    .fg(status)
                    .wrap(WrapMode::Word)
                    .shrink(1.0)
                    .min_width(0),
            );
        if !state.error.is_empty() {
            row.add(
                &Text::new(app, state.error.clone())
                    .fg(theme.error)
                    .wrap(WrapMode::None)
                    .truncate(true)
                    .shrink(1.0),
            );
        }
        root.add(&row);
    }
    Painted {
        scroll: scroller,
        field: area,
    }
}

/// The rows of the question and its message while editing, for the scroll box's height (`contentHeight`).
fn content_rows(form: &FormInfo, state: &State, width: u16) -> usize {
    let width = usize::from(width).saturating_sub(6).max(1);
    let wrapped = |text: &str| text.width().div_ceil(width).max(1);
    let mut rows = Vec::new();
    if let Some(message) = form
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("message"))
        .and_then(serde_json::Value::as_str)
    {
        rows.push(wrapped(message));
    }
    if let Some(field) = current(form, state) {
        let question = description(field).map_or_else(|| label(field), str::to_owned);
        let suffix = if required(field) { " (required)" } else { "" };
        rows.push(wrapped(&format!("{question}{suffix}")));
    }
    rows.iter().sum::<usize>() + rows.len().saturating_sub(1)
}

fn description(field: &FormField) -> Option<&str> {
    opencode_ui::form::description(field)
}

fn required(field: &FormField) -> bool {
    opencode_ui::form::required(field)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(fields: serde_json::Value) -> FormInfo {
        serde_json::from_value(serde_json::json!({
            "id": "frm_1",
            "sessionID": "ses_mini",
            "title": "Deploy",
            "fields": fields,
        }))
        .unwrap()
    }

    #[test]
    fn a_choice_moves_to_the_next_field_and_the_review_submits() {
        let form = form(serde_json::json!([
            { "type": "boolean", "key": "confirm", "title": "Confirm" },
            { "type": "string", "key": "target", "title": "Target", "options": [
                { "value": "staging", "label": "Staging" },
                { "value": "prod", "label": "Production" },
            ] },
        ]));
        let mut state = State::new(&form);
        assert!(!state.editing);
        state.step(&form, true);
        assert_eq!(state.selected, 1);
        state.step(&form, true);
        assert_eq!(state.selected, 0);
        state.pick(&form);
        assert_eq!(state.field, 1);
        assert_eq!(state.answer(&form.fields[0]), Some(&FormValue::Bool(true)));
        state.select(1);
        state.pick(&form);
        assert!(confirm(&form, &state));
        let answer = answer(&form, &state).unwrap();
        assert_eq!(
            answer.get("target"),
            Some(&FormValue::String("prod".into()))
        );
        assert_eq!(action(&form, &state, 80), "submit");
    }

    #[test]
    fn typed_answers_are_validated() {
        let form = form(serde_json::json!([
            { "type": "integer", "key": "count", "title": "Count", "minimum": 1, "required": true },
        ]));
        let mut state = State::new(&form);
        assert!(state.editing && single(&form));
        state.commit(&form, "0");
        assert_eq!(state.error, "Must be at least 1");
        state.commit(&form, "3");
        assert_eq!(state.error, "");
        assert_eq!(
            answer(&form, &state).unwrap().get("count"),
            Some(&FormValue::Number(3.0))
        );
        assert_eq!(
            invalid(&form, &State::new(&form)).as_deref(),
            Some("Count: Answer required")
        );
    }

    #[test]
    fn unsupported_forms_say_why() {
        assert_eq!(
            unsupported(&form(serde_json::json!([]))).as_deref(),
            Some("This form has no supported fields.")
        );
        assert_eq!(
            unsupported(&form(
                serde_json::json!([{ "type": "string", "key": "a", "pattern": "x" }])
            ))
            .as_deref(),
            Some("Pattern-constrained forms are not supported in Mini yet.")
        );
        assert_eq!(
            unsupported(&form(serde_json::json!([{ "type": "color", "key": "a" }]))).as_deref(),
            Some("Field type color is not supported in Mini yet.")
        );
    }
}
