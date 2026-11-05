//! The form prompt (E.9b, rows V18 and T30): `routes/session/form.tsx` and `util/form.ts`.
//!
//! A tool or an MCP server asks the user to fill a form. [`FormPrompt`] shows one form, one field per tab, with a
//! review tab before submitting. [`Host`] keeps the prompt of the first pending form in a region; the session route
//! (above its prompt, [`SessionForms`]) and home (an overlay, `features::home_forms`) each own one. While a form
//! shows, the keymap is in [`FORM_MODE`], so base-mode keys (the prompt's, the palette's) wait.
//!
//! A remount keeps the answers in progress: dropping a prompt whose form is still pending stashes its draft, and
//! the next prompt for that form takes it, as `drafts` in TS does.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};

use indexmap::IndexMap;
use opencode_api::generated::{FormField, FormID, FormValue, SessionFormCancelInput, SessionFormReplyInput, SessionID};
use opencode_store::forms::{Form, GLOBAL};
use opencode_store::location::Location;
use opencode_store::{Changes, State};
use opencode_ui::bind;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use crate::app::Tui;

pub const FORM_MODE: &str = "form";

thread_local! {
    /// Answers in progress per form, across remounts; a draft is consumed on take.
    static DRAFTS: RefCell<HashMap<FormID, Draft>> = RefCell::default();
}

pub use opencode_ui::form::*;

fn truncate(label: &str, max: usize) -> String {
    if label.chars().count() <= max {
        return label.to_owned();
    }
    let head: String = label.chars().take(max - 1).collect();
    format!("{}…", head.trim_end())
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------

/// Keeps the prompt of one form in a region; a new form ID remounts it, as TS keys `<FormPrompt>` by ID.
pub struct Host {
    tui: Weak<Tui>,
    region: View,
    current: RefCell<Option<FormPrompt>>,
}

impl Host {
    pub fn new(tui: &Tui, region: View) -> Self {
        Self { tui: tui.weak(), region, current: RefCell::default() }
    }

    pub fn region(&self) -> &View {
        &self.region
    }

    pub fn active(&self) -> bool {
        self.current.borrow().is_some()
    }

    /// Shows `form`, or nothing.
    pub fn show(&self, form: Option<&Form>) {
        let current = self.current.borrow().as_ref().map(|prompt| prompt.0.form.info.id.clone());
        if current.as_ref() == form.map(|form| &form.info.id) {
            return;
        }
        // Drop the old prompt first: it stashes its draft and releases its keys.
        self.current.take();
        self.region.clear();
        self.region.visible(form.is_some());
        let (Some(tui), Some(form)) = (self.tui.upgrade(), form) else {
            return;
        };
        let prompt = FormPrompt::new(&tui, form.clone());
        self.region.add(&prompt.0.root);
        *self.current.borrow_mut() = Some(prompt);
        tui.app.request_redraw();
    }
}

/// The session route's forms: the session's and its descendants', then the global forms of its location. A child
/// session shows only the global ones (`routes/session/index.tsx:214-220`). A permission request comes first.
pub struct SessionForms {
    host: Host,
    session: SessionID,
    /// Owners whose pending forms were read since the last full sync.
    synced: RefCell<HashSet<String>>,
}

impl SessionForms {
    pub fn new(tui: &Tui, session: &SessionID) -> Self {
        let region = View::new(&tui.app).column().shrink(0.0).visible(false);
        Self { host: Host::new(tui, region), session: session.clone(), synced: RefCell::default() }
    }

    pub fn root(&self) -> &View {
        self.host.region()
    }

    pub fn active(&self) -> bool {
        self.host.active()
    }

    /// `blocked`: a permission request shows instead.
    pub fn sync(&self, tui: &Tui, changes: &Changes, blocked: bool) {
        let (owners, location, head) = tui.data.read(|state| {
            let session = state.session(&self.session);
            let location = session.map(|info| Location::from(&info.location));
            let owners: Vec<String> = if session.is_some_and(|info| info.parent_id.is_some()) {
                Vec::new()
            } else {
                std::iter::once(&self.session)
                    .chain(state.family(&self.session).iter().filter(|id| **id != self.session))
                    .map(|id| id.0.clone())
                    .collect()
            };
            let head = first_form(state, &owners, location.as_ref());
            (owners, location, head)
        });
        // A full sync (a reconnect) reads again: the store invalidated what it read before.
        if changes.all {
            self.synced.borrow_mut().clear();
        }
        for owner in &owners {
            if self.synced.borrow_mut().insert(owner.clone()) {
                quiet(tui, tui.data.form_sync(owner, None));
            }
        }
        if let Some(location) = &location
            && self.synced.borrow_mut().insert(format!("{GLOBAL}:{}", location.key()))
        {
            quiet(tui, tui.data.form_sync(GLOBAL, Some(location)));
        }
        self.host.show(head.as_ref().filter(|_| !blocked));
    }
}

fn first_form(state: &State, owners: &[String], location: Option<&Location>) -> Option<Form> {
    owners
        .iter()
        .flat_map(|owner| state.forms(owner, None).unwrap_or_default())
        .chain(location.and_then(|location| state.forms(GLOBAL, Some(location))).unwrap_or_default())
        .next()
        .cloned()
}

/// Awaits a form or permission read; failures are ignored, as TS ignores them (`.catch(() => undefined)`).
pub(crate) fn quiet(tui: &Tui, task: opencode_store::Task<()>) {
    tui.app.spawn(task, |_, result| {
        if let Err(error) = result {
            log::debug!("read failed: {error}");
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
struct Draft {
    tab: usize,
    answers: IndexMap<String, FormValue>,
    custom: HashMap<String, String>,
    external_ready: HashSet<String>,
    selected: usize,
    editing: bool,
    error: String,
}

/// Which textarea the field shows: the typed answer of a textual field, or the custom row's editor.
#[derive(Clone, PartialEq, Eq)]
enum Editor {
    Answer(String),
    Custom(String),
}

/// The prompt for one form (`FormPrompt`).
pub struct FormPrompt(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    form: Form,
    root: View,
    draft: RefCell<Draft>,
    editor: RefCell<Option<(Editor, Textarea)>>,
    review: RefCell<Option<ScrollBox>>,
    layers: RefCell<Vec<Disposer>>,
    mode: RefCell<Option<Disposer>>,
    intercept: RefCell<Option<Disposer>>,
    handlers: RefCell<Vec<HandlerId>>,
    tab_hover: Cell<Option<usize>>,
    /// Rows the review's answers take, for the scroll hint.
    review_lines: Cell<usize>,
    render_queued: Cell<bool>,
}

impl FormPrompt {
    pub fn new(tui: &Tui, form: Form) -> Self {
        let draft = DRAFTS.with(|drafts| drafts.borrow_mut().remove(&form.info.id)).unwrap_or_else(|| {
            let (answers, custom) = initial_values(&form.info.fields);
            let first = form.info.fields.iter().find(|field| is_answer(field));
            let selected = selected_row(first, first.and_then(|field| answers.get(key(field))));
            Draft { answers, custom, selected, ..Draft::default() }
        });
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            form,
            root: View::new(&tui.app).column().shrink(0.0),
            draft: RefCell::new(draft),
            editor: RefCell::default(),
            review: RefCell::default(),
            layers: RefCell::default(),
            mode: RefCell::default(),
            intercept: RefCell::default(),
            handlers: RefCell::default(),
            tab_hover: Cell::new(None),
            review_lines: Cell::new(0),
            render_queued: Cell::new(false),
        });
        let dialogs = tui.weak();
        *inner.mode.borrow_mut() = Some(tui.keymap.push_mode(
            FORM_MODE,
            Condition::when(move || dialogs.upgrade().is_some_and(|tui| !tui.dialogs.is_open())),
        ));
        inner.install(tui);
        inner.render();
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }
}

impl Drop for FormPrompt {
    fn drop(&mut self) {
        let inner = &self.0;
        let keys: Vec<Disposer> =
            inner.layers.take().into_iter().chain(inner.intercept.take()).chain(inner.mode.take()).collect();
        let Some(tui) = inner.tui.upgrade() else {
            return;
        };
        dispose_later(&tui.app, keys);
        for id in inner.handlers.take() {
            tui.app.remove_handler(id);
        }
        // A reply or cancel removes the form from the store first, so a form still listed was only hidden by
        // navigation and is worth restoring.
        let info = &inner.form.info;
        let pending = tui.data.read(|state| {
            state
                .forms(&info.session_id, inner.form.location.as_ref())
                .is_some_and(|forms| forms.iter().any(|form| form.info.id == info.id))
        });
        if !pending {
            return;
        }
        let mut draft = inner.draft.borrow().clone();
        // Typed answers live in the editor until committed.
        if let Some((_, textarea)) = inner.editor.borrow().as_ref()
            && let Some(field) = inner.answer_field()
        {
            draft.custom.insert(key(&field).to_owned(), textarea.text());
        }
        DRAFTS.with(|drafts| drafts.borrow_mut().insert(info.id.clone(), draft));
    }
}

/// What a key handler does: a method on the prompt.
type Action = fn(&Rc<Inner>);

impl Inner {
    // Derived state (the TS memos).

    fn fields(&self) -> Vec<FormField> {
        visible_fields(&self.form.info.fields, &self.draft.borrow().answers)
    }

    fn single(&self) -> bool {
        let fields = self.fields();
        match fields.as_slice() {
            [FormField::Boolean(_)] => true,
            [FormField::String(field)] => field.options.is_some(),
            _ => false,
        }
    }

    fn tabs(&self) -> usize {
        if self.single() { 1 } else { self.fields().len() + 1 }
    }

    fn field(&self) -> Option<FormField> {
        self.fields().into_iter().nth(self.draft.borrow().tab)
    }

    fn answer_field(&self) -> Option<FormField> {
        self.field().filter(is_answer)
    }

    fn external_key(&self) -> Option<String> {
        match self.field() {
            Some(FormField::External(field)) => Some(field.key),
            _ => None,
        }
    }

    fn confirm(&self) -> bool {
        !self.single() && self.draft.borrow().tab >= self.fields().len()
    }

    fn rows(&self) -> Vec<Row> {
        let Some(field) = self.answer_field() else {
            return Vec::new();
        };
        let mut configured = rows(Some(&field));
        let draft = self.draft.borrow();
        if let (FormField::Multiselect(_), Some(FormValue::Array(items))) = (&field, draft.answers.get(key(&field))) {
            let custom = draft.custom.get(key(&field));
            let extra: Vec<Row> = items
                .iter()
                .filter(|item| {
                    !configured.iter().any(|row| row.value == FormValue::String((*item).clone()))
                        && Some(*item) != custom
                })
                .map(|item| Row { value: FormValue::String(item.clone()), label: item.clone(), description: None })
                .collect();
            configured.extend(extra);
        }
        configured
    }

    fn is_textual(&self) -> bool {
        !self.confirm() && textual(self.answer_field().as_ref())
    }

    fn has_custom(&self) -> bool {
        custom(self.answer_field().as_ref())
    }

    fn multi(&self) -> bool {
        matches!(self.answer_field(), Some(FormField::Multiselect(_)))
    }

    fn other(&self) -> bool {
        self.has_custom() && self.draft.borrow().selected == self.rows().len()
    }

    fn input(&self) -> String {
        let key = self.answer_field().map(|field| key(&field).to_owned()).unwrap_or_default();
        self.draft.borrow().custom.get(&key).cloned().unwrap_or_default()
    }

    fn custom_picked(&self) -> bool {
        let value = self.input();
        if value.is_empty() {
            return false;
        }
        let key = self.answer_field().map(|field| key(&field).to_owned()).unwrap_or_default();
        match self.draft.borrow().answers.get(&key) {
            Some(FormValue::Array(items)) => items.contains(&value),
            Some(FormValue::String(text)) => *text == value,
            _ => false,
        }
    }

    fn placeholder(&self) -> String {
        use opencode_api::generated::FormStringFieldFormat as Format;
        let range = |minimum: Option<f64>, maximum: Option<f64>| match (minimum, maximum) {
            (Some(minimum), Some(maximum)) => Some(format!("{}-{}", js_number(minimum), js_number(maximum))),
            (Some(minimum), None) => Some(format!("at least {}", js_number(minimum))),
            (None, Some(maximum)) => Some(format!("at most {}", js_number(maximum))),
            (None, None) => None,
        };
        let text = match self.answer_field() {
            Some(FormField::String(field)) => field.placeholder.clone().or_else(|| {
                match field.format {
                    Some(Format::Email) => Some("name@example.com"),
                    Some(Format::Uri) => Some("https://example.com"),
                    Some(Format::Date) => Some("YYYY-MM-DD"),
                    Some(Format::DateTime) => Some("YYYY-MM-DDTHH:MM:SSZ"),
                    _ => None,
                }
                .map(str::to_owned)
            }),
            Some(FormField::Number(field)) => range(number(&field.minimum), number(&field.maximum)),
            Some(FormField::Integer(field)) => range(number(&field.minimum), number(&field.maximum)),
            _ => None,
        };
        text.unwrap_or_else(|| "Type your answer".to_owned())
    }

    fn action_label(&self) -> &'static str {
        if self.confirm() {
            return "submit";
        }
        if let Some(key) = self.external_key() {
            let draft = self.draft.borrow();
            if draft.answers.get(&key) == Some(&FormValue::Bool(true)) {
                return "continue";
            }
            return if draft.external_ready.contains(&key) { "I finished" } else { "open link" };
        }
        if self.multi() {
            let editing = self.draft.borrow().editing;
            if self.other() && editing {
                return "done";
            }
            if self.other() && self.input().is_empty() {
                return "edit";
            }
            return "toggle";
        }
        if self.single() {
            return "submit";
        }
        "confirm"
    }

    fn completed(&self, field: &FormField) -> bool {
        let draft = self.draft.borrow();
        let Some(value) = draft.answers.get(key(field)) else {
            return false;
        };
        if matches!(field, FormField::External(_)) {
            return *value == FormValue::Bool(true);
        }
        validate(field, Some(value)).is_none()
    }

    fn editor_text(&self) -> Option<String> {
        self.editor.borrow().as_ref().map(|(_, textarea)| textarea.text())
    }

    // Actions (the TS functions).

    fn answer(&self, key: &str, value: Option<FormValue>) {
        let optional_multiselect = self
            .fields()
            .iter()
            .any(|field| matches!(field, FormField::Multiselect(_)) && self::key(field) == key && !required(field));
        let value = value.filter(|value| !(optional_multiselect && *value == FormValue::Array(Vec::new())));
        let mut draft = self.draft.borrow_mut();
        match value {
            Some(value) => {
                draft.answers.insert(key.to_owned(), value);
            }
            None => {
                draft.answers.shift_remove(key);
            }
        }
        draft.error.clear();
    }

    fn set_error(&self, error: impl Into<String>) {
        self.draft.borrow_mut().error = error.into();
    }

    fn reply(self: &Rc<Self>, answer: IndexMap<String, FormValue>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let data = tui.data.clone();
        let location = self.form.location.clone();
        let input = SessionFormReplyInput {
            session_id: self.form.info.session_id.clone(),
            form_id: self.form.info.id.clone(),
            answer,
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(async move { data.form_reply(input, location.as_ref()).await }, move |_, result| {
            if let (Err(error), Some(inner)) = (result, weak.upgrade()) {
                inner.set_error(error.to_string());
                inner.render();
            }
        });
    }

    fn cancel(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let data = tui.data.clone();
        let location = self.form.location.clone();
        let input = SessionFormCancelInput {
            session_id: self.form.info.session_id.clone(),
            form_id: self.form.info.id.clone(),
            message: None,
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(async move { data.form_cancel(input, location.as_ref()).await }, move |_, result| {
            if let (Err(error), Some(inner)) = (result, weak.upgrade()) {
                inner.set_error(error.to_string());
                inner.render();
            }
        });
    }

    fn pick(self: &Rc<Self>, value: FormValue) {
        let Some(field) = self.answer_field() else {
            return;
        };
        if let Some(invalid) = validate(&field, Some(&value)) {
            self.set_error(invalid);
            return;
        }
        self.answer(key(&field), Some(value.clone()));
        if self.single() {
            self.reply(IndexMap::from([(key(&field).to_owned(), value)]));
            return;
        }
        let tab = self.draft.borrow().tab;
        self.select_tab(tab + 1);
    }

    fn toggle(&self, value: &str) {
        let Some(field) = self.answer_field() else {
            return;
        };
        let next = toggle_multiselect(self.draft.borrow().answers.get(key(&field)), value);
        self.answer(key(&field), Some(FormValue::Array(next)));
    }

    fn update_custom(&self, field: &FormField, value: &str) {
        let key = key(field);
        let previous = self.draft.borrow().custom.get(key).cloned();
        if previous.as_deref() == Some(value) {
            return;
        }
        self.draft.borrow_mut().custom.insert(key.to_owned(), value.to_owned());
        let next = if matches!(field, FormField::Multiselect(_)) {
            let answers = self.draft.borrow().answers.get(key).cloned();
            Some(FormValue::Array(set_multiselect_custom(answers.as_ref(), previous.as_deref(), value)))
        } else {
            (!value.is_empty()).then(|| FormValue::String(value.to_owned()))
        };
        self.answer(key, next);
    }

    fn select_tab(&self, index: usize) {
        let next = self.fields().into_iter().nth(index).filter(is_answer);
        let mut draft = self.draft.borrow_mut();
        let selected = next.as_ref().map_or(0, |field| selected_row(Some(field), draft.answers.get(key(field))));
        draft.tab = index;
        draft.selected = selected;
        draft.editing = false;
        draft.error.clear();
    }

    fn move_tab(&self, by: isize) {
        let tabs = self.tabs() as isize;
        let tab = self.draft.borrow().tab as isize;
        self.select_tab((tab + by).rem_euclid(tabs) as usize);
    }

    fn move_selection(&self, by: isize) {
        let total = (self.rows().len() + usize::from(self.has_custom())) as isize;
        if total == 0 {
            return;
        }
        let mut draft = self.draft.borrow_mut();
        draft.selected = (draft.selected as isize + by).rem_euclid(total) as usize;
    }

    fn select_option(self: &Rc<Self>) {
        if self.other() {
            if !self.multi() {
                self.draft.borrow_mut().editing = true;
                return;
            }
            let value = self.input();
            if !value.is_empty() && self.custom_picked() {
                self.toggle(&value);
                return;
            }
            self.draft.borrow_mut().editing = true;
            return;
        }
        let selected = self.draft.borrow().selected;
        let Some(row) = self.rows().into_iter().nth(selected) else {
            return;
        };
        if self.multi() {
            self.toggle(&value_text(&row.value));
            return;
        }
        self.pick(row.value);
    }

    fn paste_custom(&self, value: &str) -> bool {
        let Some(field) = self.answer_field() else {
            return false;
        };
        if self.is_textual() || !self.has_custom() || self.confirm() {
            return false;
        }
        self.draft.borrow_mut().selected = self.rows().len();
        self.update_custom(&field, &(self.input() + value));
        self.draft.borrow_mut().editing = true;
        true
    }

    fn commit_input(&self, text: &str) -> bool {
        let Some(field) = self.answer_field() else {
            return false;
        };
        let key = key(&field);
        let is_textual = self.is_textual();
        let is_multi = self.multi();
        if text.is_empty() {
            let value = (!is_textual && is_multi).then(|| {
                let draft = self.draft.borrow();
                FormValue::Array(set_multiselect_custom(
                    draft.answers.get(key),
                    draft.custom.get(key).map(String::as_str),
                    "",
                ))
            });
            if (is_textual || !is_multi)
                && let Some(invalid) = validate(&field, value.as_ref())
            {
                self.set_error(invalid);
                return false;
            }
            self.answer(key, value);
            let mut draft = self.draft.borrow_mut();
            draft.custom.insert(key.to_owned(), String::new());
            draft.editing = false;
            return true;
        }
        let value = match (&field, is_textual, is_multi) {
            (FormField::Number(_) | FormField::Integer(_), true, _) => {
                // `Number(text)`: anything that does not parse is NaN, which fails as "Expected a number".
                Some(FormValue::Number(text.parse().unwrap_or(f64::NAN)))
            }
            (FormField::String(_), true, _) | (_, false, false) => Some(FormValue::String(text.to_owned())),
            (_, false, true) => {
                let draft = self.draft.borrow();
                let next =
                    set_multiselect_custom(draft.answers.get(key), draft.custom.get(key).map(String::as_str), text);
                drop(draft);
                self.answer(key, Some(FormValue::Array(next)));
                None
            }
            _ => None,
        };
        if let Some(value) = value {
            if let Some(invalid) = validate(&field, Some(&value)) {
                self.set_error(invalid);
                return false;
            }
            self.answer(key, Some(value));
        }
        let configured = matches!(&field, FormField::String(field)
            if field.options.as_ref().is_some_and(|options| options.iter().any(|option| option.value == text)));
        let mut draft = self.draft.borrow_mut();
        draft.custom.insert(key.to_owned(), if configured { String::new() } else { text.to_owned() });
        draft.editing = false;
        true
    }

    fn submit_input(&self, text: &str, direction: isize) {
        if !self.commit_input(text) {
            if direction == -1 {
                self.move_tab(direction);
            }
            return;
        }
        if !self.single() {
            self.move_tab(direction);
        }
    }

    fn select_tab_from_mouse(self: &Rc<Self>, target: Option<usize>) {
        let target = target.unwrap_or(self.fields().len());
        if !self.is_textual() && !self.draft.borrow().editing {
            self.select_tab(target);
            return;
        }
        let text = self.editor_text().unwrap_or_default();
        if !self.commit_input(text.trim()) {
            if target < self.draft.borrow().tab {
                self.select_tab(target);
            }
            return;
        }
        self.select_tab(target);
    }

    fn open_external(self: &Rc<Self>) {
        let Some(FormField::External(field)) = self.field() else {
            return;
        };
        self.set_error("");
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let url = field.url.clone();
        tui.app.spawn(
            async move { tokio::task::spawn_blocking(move || open_url(&url)).await.unwrap_or(false) },
            bind!(self, |inner, _, opened| {
                if opened {
                    inner.draft.borrow_mut().external_ready.insert(field.key.clone());
                } else {
                    inner.set_error("Could not open the browser. Copy the URL and continue manually.");
                }
                inner.changed();
            }),
        );
    }

    fn copy_external(self: &Rc<Self>) {
        let (Some(FormField::External(field)), Some(tui)) = (self.field(), self.tui.upgrade()) else {
            return;
        };
        if !tui.app.copy_to_clipboard(&field.url) {
            tui.toasts.error("Failed to copy to clipboard");
            return;
        }
        self.draft.borrow_mut().external_ready.insert(field.key.clone());
        tui.toasts.show(ToastOptions::new(Variant::Info, "Copied URL to clipboard"));
    }

    fn acknowledge_external(self: &Rc<Self>) {
        let Some(key) = self.external_key() else {
            return;
        };
        let tab = self.draft.borrow().tab;
        if self.draft.borrow().answers.get(&key) == Some(&FormValue::Bool(true)) {
            self.select_tab(tab + 1);
            return;
        }
        if !self.draft.borrow().external_ready.contains(&key) {
            self.open_external();
            return;
        }
        self.answer(&key, Some(FormValue::Bool(true)));
        self.select_tab(tab + 1);
    }

    fn submit(self: &Rc<Self>) {
        let fields = self.fields();
        let draft = self.draft.borrow().clone();
        if let Some(field) = fields.iter().find(|field| {
            matches!(field, FormField::External(_)) && draft.answers.get(key(field)) != Some(&FormValue::Bool(true))
        }) {
            self.set_error(format!("External action must be acknowledged: {}", label(field)));
            return;
        }
        if let Some(invalid) = fields
            .iter()
            .filter(|field| is_answer(field))
            .find_map(|field| validate(field, draft.answers.get(key(field))))
        {
            self.set_error(invalid);
            return;
        }
        self.reply(
            fields
                .iter()
                .filter_map(|field| Some((key(field).to_owned(), draft.answers.get(key(field))?.clone())))
                .collect(),
        );
    }

    fn paste_clipboard(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let weak = Rc::downgrade(self);
        tui.app.read_clipboard(move |_, content| {
            let (Some(inner), Some(content)) = (weak.upgrade(), content) else {
                return;
            };
            let value = content.replace("\r\n", "\n").replace('\r', "\n");
            if inner.draft.borrow().editing || inner.is_textual() {
                if let Some((_, textarea)) = inner.editor.borrow().as_ref() {
                    textarea.insert(&value);
                }
                return;
            }
            if inner.paste_custom(&value) {
                inner.changed();
            }
        });
    }

    // Keys, mode, paste.

    fn install(self: &Rc<Self>, tui: &Tui) {
        // Typing on the custom row opens its editor with the key (`keymap.intercept`).
        *self.intercept.borrow_mut() = Some(tui.keymap.keymap().intercept_key(
            0,
            false,
            bind!(self, |inner, context| {
                if !inner.is_live() || inner.is_textual() || !inner.other() {
                    return;
                }
                let editing = inner.draft.borrow().editing;
                if editing && inner.editor_focused() {
                    return;
                }
                let event = &context.event;
                let modified = [Modifiers::CTRL, Modifiers::ALT, Modifiers::SUPER, Modifiers::HYPER, Modifiers::META]
                    .iter()
                    .any(|modifier| event.modifiers.contains(*modifier));
                let KeyCode::Char(c) = event.code else { return };
                if modified || (!editing && c == ' ') || c.is_control() || matches!(c, '\u{2028}' | '\u{2029}') {
                    return;
                }
                let Some(field) = inner.answer_field() else {
                    return;
                };
                inner.update_custom(&field, &format!("{}{c}", inner.input()));
                inner.draft.borrow_mut().editing = true;
                context.consume();
                inner.changed();
            }),
        ));
        let paste = tui.app.on_paste(bind!(self, |inner, _, text| {
            if !inner.is_live() {
                return;
            }
            let value = text.replace("\r\n", "\n").replace('\r', "\n");
            if inner.paste_custom(&value) {
                inner.changed();
            }
        }));
        let resize = tui.app.on_resize(bind!(self, |inner, _, _, _| inner.render()));
        self.handlers.borrow_mut().extend([paste, resize]);
    }

    /// Whether the prompt takes input: no dialog is open and the form mode is current.
    fn is_live(&self) -> bool {
        self.tui.upgrade().is_some_and(|tui| !tui.dialogs.is_open() && tui.keymap.mode() == FORM_MODE)
    }

    fn editor_focused(&self) -> bool {
        let Some(tui) = self.tui.upgrade() else {
            return false;
        };
        let focused = tui.app.focused().map(|widget| widget.id());
        self.editor.borrow().as_ref().is_some_and(|(_, textarea)| Some(textarea.id()) == focused)
    }

    /// State changed: redraw and rebuild the layers.
    fn changed(self: &Rc<Self>) {
        self.render();
    }

    fn command(self: &Rc<Self>, bind: &str, title: &str, action: Action) -> TuiCommand {
        TuiCommand::inline(
            bind,
            bind!(self, |inner, _, _| {
                action(&inner);
                inner.changed();
            }),
        )
        .title(title)
        .group("Form")
    }

    fn layers(self: &Rc<Self>) -> Vec<KeymapLayer<u32>> {
        let confirm = self.confirm();
        let textual = self.is_textual();
        let editing = self.draft.borrow().editing;
        let mut layers = Vec::new();
        let layer = |priority: i32, commands: Vec<TuiCommand>| KeymapLayer {
            mode: Some(FORM_MODE.to_owned()),
            priority,
            commands,
            ..KeymapLayer::default()
        };
        if !confirm && self.answer_field().is_some() {
            layers.push(layer(
                0,
                vec![
                    TuiCommand::new("prompt.paste", bind!(self, |inner, _, _| inner.paste_clipboard()))
                        .title("Paste from clipboard")
                        .group("Form"),
                ],
            ));
        }
        if (editing || textual) && !confirm {
            let dismiss = if textual { "Dismiss form" } else { "Close answer edit" };
            layers.push(layer(
                1,
                vec![
                    TuiCommand::new(
                        "prompt.clear",
                        bind!(self, |inner, _, _| {
                            let text = inner.editor_text().unwrap_or_default();
                            if !text.is_empty() {
                                if let Some((_, textarea)) = inner.editor.borrow().as_ref() {
                                    textarea.set_text("");
                                }
                                return;
                            }
                            if inner.is_textual() {
                                inner.cancel();
                                return;
                            }
                            inner.draft.borrow_mut().editing = false;
                            inner.changed();
                        }),
                    )
                    .title("Clear answer edit")
                    .group("Form"),
                    self.command("escape", dismiss, |inner| {
                        if inner.is_textual() {
                            inner.cancel();
                            return;
                        }
                        inner.draft.borrow_mut().editing = false;
                    }),
                    self.command("tab", "Next field", |inner| {
                        let text = inner.editor_text().unwrap_or_default();
                        inner.submit_input(text.trim(), 1);
                    }),
                    self.command("shift+tab", "Previous field", |inner| {
                        let text = inner.editor_text().unwrap_or_default();
                        inner.submit_input(text.trim(), -1);
                    }),
                    TuiCommand::inline(
                        "up",
                        bind!(self, |inner, _, _| {
                            let top =
                                inner.editor.borrow().as_ref().is_some_and(|(_, textarea)| textarea.cursor().0 == 0);
                            if inner.is_textual() || !top || inner.draft.borrow().selected == 0 {
                                return false;
                            }
                            let mut draft = inner.draft.borrow_mut();
                            draft.editing = false;
                            draft.selected -= 1;
                            drop(draft);
                            inner.changed();
                            true
                        }),
                    )
                    .title("Leave answer edit")
                    .group("Form"),
                    self.command("return", "Submit answer edit", |inner| {
                        let text = inner.editor_text().unwrap_or_default();
                        let text = text.trim();
                        let Some(field) = inner.answer_field() else {
                            return;
                        };
                        if inner.is_textual() {
                            inner.submit_input(text, 1);
                            return;
                        }
                        let was_multi = inner.multi();
                        if !inner.commit_input(text) || was_multi || text.is_empty() {
                            return;
                        }
                        if inner.single() {
                            inner.reply(IndexMap::from([(key(&field).to_owned(), FormValue::String(text.to_owned()))]));
                            return;
                        }
                        let tab = inner.draft.borrow().tab;
                        inner.select_tab(tab + 1);
                    }),
                ],
            ));
        }
        if !editing && !textual {
            let mut commands = vec![
                TuiCommand::new("app.exit", bind!(self, |inner, _, _| inner.cancel()))
                    .title("Dismiss form")
                    .group("Form"),
                self.command("left,h", "Previous field", |inner| inner.move_tab(-1)),
                self.command("right,l", "Next field", |inner| inner.move_tab(1)),
                self.command("tab", "Next field", |inner| inner.move_tab(1)),
                self.command("shift+tab", "Previous field", |inner| inner.move_tab(-1)),
            ];
            if let Some(key) = self.external_key() {
                let draft = self.draft.borrow();
                let title = if draft.answers.get(&key) == Some(&FormValue::Bool(true)) {
                    "Continue"
                } else if draft.external_ready.contains(&key) {
                    "Confirm completion"
                } else {
                    "Open link"
                };
                drop(draft);
                commands.extend([
                    self.command("return", title, Inner::acknowledge_external),
                    self.command("c", "Copy link", Inner::copy_external),
                    self.command("escape", "Dismiss form", Inner::cancel),
                ]);
            } else if confirm {
                commands.extend([
                    self.command("return", "Submit form", Inner::submit),
                    self.command("escape", "Dismiss form", Inner::cancel),
                    self.command("up,k", "Scroll review", |inner| inner.scroll_review(-1.0)),
                    self.command("down,j", "Scroll review", |inner| inner.scroll_review(1.0)),
                ]);
            } else {
                let total = self.rows().len() + usize::from(self.has_custom());
                for index in 0..total.min(9) {
                    commands.push(
                        TuiCommand::inline(
                            (index + 1).to_string(),
                            bind!(self, |inner, _, _| {
                                inner.draft.borrow_mut().selected = index;
                                inner.select_option();
                                inner.changed();
                            }),
                        )
                        .title(format!("Select answer {}", index + 1))
                        .group("Form"),
                    );
                }
                commands.extend([
                    self.command("up,k", "Previous answer", |inner| inner.move_selection(-1)),
                    self.command("down,j", "Next answer", |inner| inner.move_selection(1)),
                    self.command("return", "Select answer", Inner::select_option),
                ]);
                if self.multi() {
                    commands.push(self.command("space", "Toggle answer", Inner::select_option));
                }
                commands.push(self.command("escape", "Dismiss form", Inner::cancel));
            }
            layers.push(layer(0, commands));
        }
        layers
    }

    fn scroll_review(&self, by: f64) {
        if let Some(review) = self.review.borrow().as_ref() {
            review.scroll_by(0.0, by);
        }
    }

    // Drawing.

    /// Redraws on the next turn; for changes that arrive inside a widget's own handler.
    fn render_soon(self: &Rc<Self>) {
        if self.render_queued.replace(true) {
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        tui.app.defer(bind!(self, |inner, _| {
            inner.render_queued.set(false);
            inner.render();
        }));
    }

    fn render(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        // Keys follow the state.
        dispose_later(&tui.app, self.layers.take());
        for layer in self.layers() {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("form keymap layer: {error}"),
            }
        }
        let theme = tui.page();
        self.root.clear();
        self.review.take();
        let editor = self.wanted_editor();
        let keep = self.editor.borrow().as_ref().is_some_and(|(current, _)| Some(current) == editor.as_ref());
        if !keep {
            self.editor.take();
        }
        let view = self.view(&tui, &theme);
        self.root.add(&view);
        // The editor takes the keys while the form is live; otherwise nothing behind the form may.
        let live = !tui.dialogs.is_open();
        match self.editor.borrow().as_ref() {
            Some((_, textarea)) if live => tui.app.focus(textarea),
            _ if live => tui.app.blur(),
            _ => {}
        }
        tui.app.request_redraw();
    }

    fn wanted_editor(&self) -> Option<Editor> {
        let field = self.answer_field()?;
        if self.confirm() {
            return None;
        }
        if self.is_textual() {
            return Some(Editor::Answer(key(&field).to_owned()));
        }
        (self.has_custom() && self.draft.borrow().editing).then(|| Editor::Custom(key(&field).to_owned()))
    }

    /// The editor for `kind`, kept across redraws.
    fn textarea(self: &Rc<Self>, tui: &Tui, theme: &Theme, kind: Editor) -> Textarea {
        if let Some((current, textarea)) = self.editor.borrow().as_ref()
            && *current == kind
        {
            return textarea.clone();
        }
        let app = &tui.app;
        let field = self.answer_field();
        let (initial, placeholder, color) = match &kind {
            Editor::Answer(key) => {
                let input = self.input();
                let initial = if input.is_empty() {
                    field.as_ref().map_or_else(String::new, |field| {
                        display_value(field, self.draft.borrow().answers.get(key), "(none)")
                    })
                } else {
                    input
                };
                (initial, self.placeholder(), theme.text.base)
            }
            Editor::Custom(_) => (self.input(), "Type your own answer".to_owned(), theme.text.formfield.focused),
        };
        let textarea = Textarea::new(app)
            .mouse_pointer(MousePointer::DEFAULT)
            .min_height(1)
            .max_height(6)
            .placeholder(placeholder)
            .placeholder_color(theme.text.muted)
            .colors(color, Color::TRANSPARENT)
            .focused_colors(color, Color::TRANSPARENT)
            .cursor_color(color);
        textarea.set_text(&initial);
        textarea.perform(EditorAction::BufferEnd);
        if matches!(kind, Editor::Custom(_)) {
            textarea.on_change(bind!(self, |inner, _, text| {
                let Some(field) = inner.answer_field() else {
                    return;
                };
                inner.update_custom(&field, text);
                inner.render_soon();
            }));
        }
        *self.editor.borrow_mut() = Some((kind, textarea.clone()));
        textarea
    }

    fn view(self: &Rc<Self>, tui: &Tui, theme: &Theme) -> View {
        let app = &tui.app;
        let fields = self.fields();
        let single = self.single();
        let confirm = self.confirm();
        let draft = self.draft.borrow().clone();
        let (width, height) = tui.app.size();

        let body = View::new(app)
            .column()
            .gap(1)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 3)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&pad(app, 1).child(&Text::new(app, self.form.info.title.clone()).fg(theme.text.muted)));
        let message = self.form.info.metadata.as_ref().and_then(|metadata| metadata.get("message"));
        if let Some(message) = message.and_then(serde_json::Value::as_str) {
            body.add(&pad(app, 1).child(&Text::new(app, message.to_owned()).fg(theme.text.base)));
        }
        let tabbed = fields.iter().map(|field| truncate(&label(field), 24).chars().count() + 3).sum::<usize>()
            + "Submit".len()
            + 3
            <= usize::from(width).saturating_sub(8);
        if !single && !tabbed {
            let progress = View::new(app).row().gap(3).padding_edge(Edge::Left, 1);
            let position = if confirm {
                "Review".to_owned()
            } else {
                format!("Field {} of {}", draft.tab.min(fields.len().saturating_sub(1)) + 1, fields.len())
            };
            progress.add(&Text::new(app, position).fg(theme.text.muted));
            if !fields.is_empty() {
                let answered = fields.iter().filter(|field| self.completed(field)).count();
                progress.add(&Text::new(app, format!("· {answered}/{} completed", fields.len())).fg(theme.text.muted));
            }
            body.add(&progress);
        }
        if !single && tabbed {
            body.add(&self.tabs_view(app, theme, &fields, draft.tab, confirm));
        }
        if !confirm && let Some(FormField::External(field)) = fields.get(draft.tab) {
            let view = View::new(app).column().gap(1).padding_edge(Edge::Left, 1);
            if let Some(title) = &field.title {
                view.add(&Text::new(app, title.clone()).fg(theme.text.base));
            }
            if let Some(description) = &field.description {
                view.add(&Text::new(app, description.clone()).fg(theme.text.muted));
            }
            let link = Text::new(app, field.url.clone()).fg(theme.text.action.primary.base);
            link.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| inner.open_external()));
            view.add(&link);
            let acknowledged = draft.answers.get(&field.key) == Some(&FormValue::Bool(true));
            let status = if acknowledged {
                "✓ Acknowledged"
            } else if draft.external_ready.contains(&field.key) {
                "Complete the external action, then press enter to confirm."
            } else {
                "Open or copy the URL, complete the external action, then confirm."
            };
            view.add(&Text::new(app, status).fg(if acknowledged {
                theme.text.feedback.success.base
            } else {
                theme.text.muted
            }));
            body.add(&view);
        }
        if !confirm && let Some(field) = self.answer_field() {
            body.add(&self.field_view(tui, theme, &field, &draft));
        }
        if confirm {
            body.add(&self.review_view(app, theme, &fields, &draft, width, height));
        }

        View::new(app)
            .column()
            .bg(theme.background.raised.base)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.background.action.primary.focused)
            .child(&body)
            .child(&self.footer(app, theme, &draft, single, confirm, height))
    }

    fn tabs_view(self: &Rc<Self>, app: &App, theme: &Theme, fields: &[FormField], tab: usize, confirm: bool) -> View {
        let row = View::new(app).row().padding_edge(Edge::Left, 1);
        let hover = self.tab_hover.get();
        let entries = fields
            .iter()
            .map(|field| truncate(&label(field), 24))
            .chain(std::iter::once("Submit".to_owned()))
            .enumerate();
        for (index, text) in entries {
            let current = index == tab || (confirm && index == fields.len());
            let color = if current {
                theme.text.base
            } else if hover == Some(index) {
                theme.text.formfield.focused
            } else {
                theme.text.muted
            };
            let text = Text::new(app, text).fg(color);
            let text = if current { text.bold() } else { text };
            let item = View::new(app).bg(theme.background.raised.base).child(&text);
            if index < fields.len() {
                item.padding_edge(Edge::Right, 2);
            }
            item.on_hover(bind!(self, |inner, _, over| {
                let next = over.then_some(index);
                if inner.tab_hover.replace(next) != next {
                    inner.render_soon();
                }
            }));
            let target = (index < fields.len()).then_some(index);
            item.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| {
                inner.select_tab_from_mouse(target);
                inner.render_soon();
            }));
            row.add(&item);
        }
        row
    }

    fn field_view(self: &Rc<Self>, tui: &Tui, theme: &Theme, field: &FormField, draft: &Draft) -> View {
        let app = &tui.app;
        let view = View::new(app).column().gap(1).padding_edge(Edge::Left, 1);
        let question = description(field).map_or_else(|| label(field), str::to_owned);
        view.add(&View::new(app).child(&Text::new(app, question).fg(theme.text.base)));
        if self.is_textual() {
            let textarea = self.textarea(tui, theme, Editor::Answer(key(field).to_owned()));
            textarea.detach();
            view.add(&pad(app, 1).child(&textarea));
            return view;
        }
        let multi = self.multi();
        let rows = self.rows();
        let list = View::new(app).column();
        let picked = |value: &FormValue| match (draft.answers.get(key(field)), value) {
            (Some(FormValue::Array(items)), value) => items.contains(&value_text(value)),
            (Some(answer), value) => answer == value,
            (None, _) => false,
        };
        for (index, row) in rows.iter().enumerate() {
            let active = index == draft.selected;
            let picked = picked(&row.value);
            let line = View::new(app).row().child(&number_cell(app, theme, index + 1, active));
            let choice = View::new(app).row().bg(theme.background.raised.base);
            if multi {
                choice.add(&checkbox(app, theme, picked, active));
            }
            choice.add(&Text::new(app, row.label.clone()).fg(if active {
                theme.text.formfield.focused
            } else {
                theme.text.formfield.base
            }));
            line.add(&choice);
            if !multi && picked {
                line.add(&Text::new(app, " ✓").fg(theme.text.formfield.selected));
            }
            let item = View::new(app).column().child(&line);
            if let Some(description) = &row.description {
                item.add(
                    &pad(app, if multi { 7 } else { 3 })
                        .child(&Text::new(app, description.clone()).fg(theme.text.muted)),
                );
            }
            self.option_mouse(&item, index);
            list.add(&item);
        }
        if self.has_custom() {
            let other = self.other();
            let checked = self.custom_picked() || (multi && other && draft.editing);
            let line = View::new(app).row().child(&number_cell(app, theme, rows.len() + 1, other));
            let choice = View::new(app).row().grow(1.0).bg(theme.background.raised.base);
            if multi {
                choice.add(&checkbox(app, theme, checked, other));
            }
            if draft.editing {
                let textarea = self.textarea(tui, theme, Editor::Custom(key(field).to_owned()));
                textarea.detach();
                choice.add(&textarea.grow(1.0));
            } else {
                let input = self.input();
                let text = if input.is_empty() { "Type your own answer".to_owned() } else { input };
                choice.add(&Text::new(app, text).fg(if other {
                    theme.text.formfield.focused
                } else {
                    theme.text.formfield.base
                }));
                if !multi && self.custom_picked() {
                    choice.add(&Text::new(app, "✓").fg(theme.text.formfield.selected));
                }
            }
            line.add(&choice);
            let item = View::new(app).column().child(&line);
            self.option_mouse(&item, rows.len());
            list.add(&item);
        }
        view.add(&list);
        view
    }

    /// Hover selects a row; a click answers with it.
    fn option_mouse(self: &Rc<Self>, item: &View, index: usize) {
        item.on_hover(bind!(self, |inner, _, over| {
            if over && inner.draft.borrow().selected != index {
                inner.draft.borrow_mut().selected = index;
                inner.render_soon();
            }
        }));
        item.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| {
            inner.draft.borrow_mut().selected = index;
            inner.select_option();
            inner.render_soon();
        }));
    }

    fn review_view(
        self: &Rc<Self>,
        app: &App,
        theme: &Theme,
        fields: &[FormField],
        draft: &Draft,
        width: u16,
        height: u16,
    ) -> ScrollBox {
        let content = View::new(app).column();
        // The panel is the screen less the host's padding (2 + 2), the border, and the body's (1 + 3) and line's
        // padding (1).
        let available = usize::from(width).saturating_sub(12).max(1);
        let mut lines = 0;
        for field in fields {
            let name = format!("{}:", truncate(&label(field), 40));
            let (value, color) = if let FormField::External(_) = field {
                let acknowledged = draft.answers.get(key(field)) == Some(&FormValue::Bool(true));
                if acknowledged {
                    ("Acknowledged".to_owned(), theme.text.feedback.success.base)
                } else {
                    ("(acknowledgement required)".to_owned(), theme.text.feedback.error.base)
                }
            } else {
                let answer = draft.answers.get(key(field));
                let missing = answer.is_none() && required(field);
                match (validate(field, answer), answer) {
                    (Some(invalid), _) => (invalid, theme.text.feedback.error.base),
                    (None, Some(answer)) => (display_value(field, Some(answer), "(none)"), theme.text.base),
                    (None, None) if missing => ("(required)".to_owned(), theme.text.feedback.error.base),
                    (None, None) => ("(not answered)".to_owned(), theme.text.muted),
                }
            };
            lines += (name.chars().count() + 1 + value.chars().count()).div_ceil(available).max(1);
            let text = Text::new(
                app,
                vec![
                    Span::styled(name, Style::new().fg(theme.text.muted)),
                    // Unstyled in TS, which draws it in OpenTUI's default white.
                    Span::styled(" ", Style::new().fg(Color::rgb(255, 255, 255))),
                    Span::styled(value, Style::new().fg(color)),
                ],
            );
            content.add(&pad(app, 1).child(&text));
        }
        let max = review_max_height(height);
        let review = ScrollBox::new(app)
            .scrollbars(false)
            .shrink(0.0)
            .height(Length::Cells(lines.min(max) as f32))
            .child(&content);
        *self.review.borrow_mut() = Some(review.clone());
        self.review_lines.set(lines);
        review
    }

    fn footer(
        self: &Rc<Self>,
        app: &App,
        theme: &Theme,
        draft: &Draft,
        single: bool,
        confirm: bool,
        height: u16,
    ) -> View {
        let hints = View::new(app).row().gap(2);
        let hint = |key: &str, label: &str| {
            Text::new(
                app,
                vec![
                    Span::styled(format!("{key} "), Style::new().fg(theme.text.base)),
                    Span::styled(label.to_owned(), Style::new().fg(theme.text.muted)),
                ],
            )
        };
        let textual = self.is_textual();
        let external = self.external_key().is_some();
        if !single {
            hints.add(&hint("⇆", "tab"));
        }
        if !confirm && !textual && !external && !draft.editing {
            hints.add(&hint("↑↓", "select"));
        }
        if confirm && self.review_lines.get() > review_max_height(height) {
            hints.add(&hint("↑↓", "scroll"));
        }
        let enter = hint("enter", self.action_label());
        enter.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| {
            if inner.confirm() {
                inner.submit();
            }
            if inner.external_key().is_some() {
                inner.acknowledge_external();
            }
            inner.render_soon();
        }));
        hints.add(&enter);
        if external {
            let copy = hint("c", "copy");
            copy.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| {
                inner.copy_external();
                inner.render_soon();
            }));
            hints.add(&copy);
        }
        let dismiss = hint("esc", if draft.editing && !textual { "close" } else { "dismiss" });
        dismiss.mouse_pointer(MousePointer::POINTER).on_click(bind!(self, |inner, _, _| inner.cancel()));
        hints.add(&dismiss);
        let footer = View::new(app)
            .row()
            .shrink(0.0)
            .gap(1)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 3)
            .padding_edge(Edge::Bottom, 1)
            .justify(Justify::SpaceBetween)
            .child(&hints);
        if !draft.error.is_empty() {
            footer.add(&Text::new(app, draft.error.clone()).fg(theme.text.feedback.error.base));
        }
        footer
    }
}

/// Removes key registrations once the current event is done: a command may cause this while the keymap runs it.
pub(crate) fn dispose_later(app: &App, disposers: Vec<Disposer>) {
    if disposers.is_empty() {
        return;
    }
    app.defer(move |_| drop(disposers));
}

fn review_max_height(height: u16) -> usize {
    usize::from(height).saturating_sub(14).max(3)
}

fn pad(app: &App, left: u32) -> View {
    View::new(app).padding_edge(Edge::Left, left)
}

fn number_cell(app: &App, theme: &Theme, number: usize, active: bool) -> View {
    View::new(app).bg(theme.background.raised.base).padding_edge(Edge::Right, 1).child(
        &Text::new(app, format!("{number}.")).fg(if active { theme.text.formfield.focused } else { theme.text.muted }),
    )
}

fn checkbox(app: &App, theme: &Theme, checked: bool, active: bool) -> Text {
    Text::new(app, if checked { "[✓]" } else { "[ ]" }).width(4).shrink(0.0).fg(if active {
        theme.text.formfield.focused
    } else if checked {
        theme.text.formfield.selected
    } else {
        theme.text.muted
    })
}

/// Replaces the browser launch; for tests, which must not open one.
static OPENER: std::sync::OnceLock<fn(&str) -> bool> = std::sync::OnceLock::new();

#[doc(hidden)]
pub fn set_url_opener(opener: fn(&str) -> bool) {
    let _ = OPENER.set(opener);
}

/// `openUrl`: http and https links only, in the system browser.
fn open_url(input: &str) -> bool {
    if let Some(opener) = OPENER.get() {
        return opener(input);
    }
    let Ok(url) = url::Url::parse(input) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut command = std::process::Command::new("cmd");
        command.args(["/c", "start", ""]);
        command
    } else {
        std::process::Command::new("xdg-open")
    };
    command
        .arg(url.as_str())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}
