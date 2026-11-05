//! The prompt editor (E.2, rows P01, P02, P13, P14): the textarea, its keymap layers, and the
//! composer state (`component/prompt/index.tsx`).
//!
//! The textarea has no key bindings of its own. While it is focused, the keymap's managed textarea
//! layer runs the 36 `input.*` commands on it through `Tui::textarea` (U.2), and the layers here add
//! submit, queue, clear, history, shell mode, interrupt, and background.

use std::cell::{Cell, OnceCell, RefCell};
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    SessionBackgroundInput, SessionID, SessionInboxDelivery, SessionInfo, SessionInterruptInput,
};
use opencode_local::cli_config::Permissions;
use opencode_local::jsonl::empty_prompt;
use opencode_store::location::Location;
use opencode_store::{Changes, SessionStatus};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::motion::{
    ScannerOptions, ScannerStyle, Spinner, SpinnerColor, scanner_colors, scanner_frames,
};
use opencode_ui::theme::Theme;
use opentui::input::Keymap;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde_json::Value;
use unicode_width::UnicodeWidthStr;

use super::autocomplete::{self, Autocomplete, parts};
use super::draft::{Draft, Drafts};
use super::editor_context::{self, LabelState, Selection};
use super::history::{self, History};
use super::metadata::{self, Catalog, Display, Preferences, Row};
use crate::app::Tui;

/// How long an armed interrupt waits for the second Escape.
const INTERRUPT_WINDOW: Duration = Duration::from_secs(5);
/// Clearing a prompt keeps it in history from this many characters on (`DRAFT_RETENTION_MIN_CHARS`).
const CLEAR_RETENTION_CHARS: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Shell,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Shell => "shell",
        }
    }
}

/// Prompt state the whole app shares: history, drafts, and model preferences.
pub struct Shared {
    pub history: History,
    pub drafts: Drafts,
    pub preferences: Preferences,
    /// Frecency, directory recents, and the home `/cd` location (E.3).
    pub complete: autocomplete::Shared,
    /// The IDE's file and selection (E.5).
    pub editor: editor_context::Context,
    /// Stashed prompts (E.4).
    pub stash: super::stash::Stash,
    /// The prompt last mounted, whose pastes a copy expands (E.4).
    pub(crate) current: RefCell<Weak<Inner>>,
}

impl Shared {
    pub fn new(app: &App, state: Option<PathBuf>) -> Self {
        Self {
            history: History::load(app, state.clone()),
            drafts: Drafts::default(),
            stash: super::stash::Stash::load(app, state.clone()),
            current: RefCell::new(Weak::new()),
            preferences: Preferences::load(app, state),
            complete: autocomplete::Shared::default(),
            editor: editor_context::Context::default(),
        }
    }
}

/// A mounted prompt. Dropping it saves its draft and removes its key layers.
pub struct Prompt {
    inner: Rc<Inner>,
}

pub(crate) type OnSubmit = Rc<dyn Fn(&Tui)>;

pub struct Inner {
    pub(crate) tui: Weak<Tui>,
    pub(crate) app: App,
    /// `None` on home: submitting creates the session.
    pub(crate) session: Option<SessionID>,
    pub(crate) textarea: Textarea,
    root: View,
    frame: View,
    bottom: View,
    metadata: Row,
    footer: Text,
    /// The editor context's file, on the footer's right (`prompt.footer.file`, E.5).
    editor_file: Text,
    /// The editor selection this prompt dismissed (`prompt.editor_context.clear`).
    dismissed: RefCell<Option<String>>,
    /// The editor context follows this session's directory.
    followed: Cell<bool>,
    /// The footer row: the location, then the `prompt.footer` slots (E.14).
    footer_row: View,
    location_box: View,
    /// The location box's width, which the location label shortens to (`truncateFilePath`, E.14).
    location_width: Cell<u16>,
    footer_slots: RefCell<(
        Option<opencode_plugin::SlotInput>,
        Vec<opencode_plugin::SlotMount<Tui>>,
    )>,
    /// The pointer is over the footer's location (E.20).
    hovered: Cell<bool>,
    /// The running indicator: the spinner, one cell in from the footer's edge.
    running: View,
    /// The session ran at the last refresh; the keymap conditions read it, as they must not lock the store.
    busy: Cell<bool>,
    spinner: Spinner,
    pub(crate) mode: Cell<Mode>,
    /// The `PromptInfo` being edited; `text` follows the textarea.
    pub(crate) prompt: RefCell<Value>,
    interrupt: Cell<u32>,
    interrupt_timer: Cell<Option<TimerId>>,
    pub(crate) submitting: Cell<bool>,
    /// Runs when a prompt with text is sent and the composer clears (`onSubmit`).
    pub(crate) on_submit: RefCell<Option<OnSubmit>>,
    pub(crate) catalog: RefCell<Option<Rc<Catalog>>>,
    layers: RefCell<Vec<Disposer>>,
    /// The mentions' extmarks and the parts they stand for (E.3).
    pub(crate) parts: parts::Parts,
    pub(crate) autocomplete: OnceCell<Autocomplete>,
    /// Pastes waiting for files or the clipboard (E.4).
    pub(crate) paste: super::paste::Queue,
    /// The image previews above the textarea (E.4).
    previews: super::attach::Previews,
    /// `--prompt`, until it is submitted (`home.tsx:68-79`, `session/index.tsx:623-630`).
    startup: RefCell<Option<String>>,
    /// The worktree staged from `/worktrees` and its progress row (E.11b).
    pub(crate) staging: super::r#move::Move,
    pub(crate) this: Weak<Inner>,
}

impl Prompt {
    pub fn root(&self) -> &View {
        &self.inner.root
    }

    pub fn textarea(&self) -> &Textarea {
        &self.inner.textarea
    }

    pub fn mode(&self) -> Mode {
        self.inner.mode.get()
    }

    /// The prompt's state, for views beside it that read its mode and focus it (E.10b's queued undo).
    pub(crate) fn weak(&self) -> Weak<Inner> {
        Rc::downgrade(&self.inner)
    }

    pub fn sync(&self, tui: &Tui, changes: &Changes) {
        if changes.location(&self.inner.location(tui)) {
            self.inner.read_catalog(tui);
            if let Some(complete) = self.inner.autocomplete.get() {
                complete.sync();
            }
        }
        for slot in &self.inner.footer_slots.borrow().1 {
            slot.sync(tui, changes);
        }
        let Some(session) = &self.inner.session else {
            return;
        };
        if changes.session(session) {
            self.inner.follow_directory(tui);
        }
        if changes.session(session) || changes.status(session) {
            if changes.status(session) && !self.inner.running(tui) {
                self.inner.interrupt.set(0);
            }
            self.inner.refresh(tui);
            self.inner.submit_startup(tui);
        }
    }

    pub fn focus(&self, tui: &Tui) {
        tui.app.focus(&self.inner.textarea);
    }

    /// Sets what runs when a prompt with text is sent (`onSubmit`).
    pub fn on_submit(&self, run: impl Fn(&Tui) + 'static) {
        *self.inner.on_submit.borrow_mut() = Some(Rc::new(run));
    }
}

impl Drop for Prompt {
    fn drop(&mut self) {
        let inner = &self.inner;
        let Some(tui) = inner.tui.upgrade() else {
            return;
        };
        let text = inner.textarea.text();
        if !text.is_empty() {
            let mut prompt = inner.prompt.borrow().clone();
            prompt["text"] = Value::String(text);
            tui.prompt.drafts.save(
                inner.session.as_ref(),
                Draft {
                    prompt,
                    cursor: inner.textarea.cursor_offset(),
                },
            );
        }
        let mut slot = tui.textarea.borrow_mut();
        if slot
            .as_ref()
            .is_some_and(|textarea| textarea.id() == inner.textarea.id())
        {
            *slot = None;
        }
        // A command may drop the prompt while the keymap runs it, so the layers go afterwards.
        let layers = std::mem::take(&mut *inner.layers.borrow_mut());
        tui.app.defer(move |_| drop(layers));
    }
}

/// Mounts a prompt for `session`, or for a new session on home.
pub fn mount(tui: &Tui, session: Option<&SessionID>) -> Prompt {
    let app = &tui.app;
    let theme = tui.page();
    let background = prompt_background(&theme);
    let (width, height) = app.size();
    let padding = if width < 44 { 1 } else { 2 };
    let cursor = crate::features::system_commands::cursor(&tui.config());
    let textarea = Textarea::new(app)
        .set_keymap(Keymap::new())
        .colors(theme.text.base, background)
        .focused_colors(theme.text.base, background)
        .placeholder_color(theme.text.muted)
        .cursor_color(theme.text.base)
        // `useCursorStyle` (E.20).
        .cursor_style(cursor.0, cursor.1)
        .min_height(1)
        .max_height((height / 3).max(6))
        .grow(1.0)
        .basis(Length::Auto);
    let previews = super::attach::Previews::new(app);
    let metadata = Row::new(app);
    let meta = View::new(app)
        .row()
        .shrink(0.0)
        .padding_edge(Edge::Top, 1)
        .child(metadata.root());
    let body = View::new(app)
        .column()
        .grow(1.0)
        .basis(Length::Auto)
        .shrink(0.0)
        .padding_edge(Edge::Left, padding)
        .padding_edge(Edge::Right, padding)
        .padding_edge(Edge::Top, 1)
        .bg(background)
        .child(previews.root())
        .child(&textarea)
        .child(&meta);
    // `border={["left"]}` with `SplitBorder`'s `┃` and a `╹` corner.
    let frame = View::new(app)
        .column()
        .shrink(0.0)
        .border_sides(Sides::LEFT)
        .border_chars(Some(border_chars('┃', '╹', ' ')))
        .child(&body);
    // The half-line under the prompt: `╹` on the left, then `▀` in the prompt color.
    let edge = View::new(app)
        .height(1)
        .grow(1.0)
        .basis(Length::Auto)
        .border_sides(Sides::BOTTOM)
        .border_chars(Some(border_chars(' ', ' ', '▀')))
        .border_color(background);
    let bottom = View::new(app)
        .row()
        .height(1)
        .shrink(0.0)
        .border_sides(Sides::LEFT)
        .border_chars(Some(border_chars('╹', ' ', ' ')))
        .child(&edge);
    // The scanner in the agent's color; `[⋯]` with animations off (`component/prompt/index.tsx:1913-1919`).
    let spinner = Spinner::new(app)
        .frames(&scanner_frames(&scanner(theme.border.base)))
        .interval(Duration::from_millis(40))
        .still("[⋯]")
        .animations(opencode_ui::motion::enabled(tui.config().info.animations));
    let running = View::new(app)
        .margin_edge(Edge::Left, 1)
        .shrink(0.0)
        .child(&spinner)
        .visible(false);
    let footer = Text::new(app, "").truncate(true).wrap(WrapMode::None);
    let staging = super::r#move::Move::new(
        app,
        opencode_ui::motion::enabled(tui.config().info.animations),
    );
    let editor_file = Text::new(app, "")
        .truncate(true)
        .wrap(WrapMode::None)
        .shrink(1.0);
    let location_box = View::new(app)
        .row()
        .grow(1.0)
        .shrink(1.0)
        .min_width(0)
        .gap(1)
        .child(&running)
        .child(staging.root())
        .child(&footer);
    // `prompt/index.tsx:1900-1983`: the location inside `prompt.footer.status`, then `prompt.footer.file`, both
    // inside `prompt.footer`, whose plugins append their hints.
    let footer_row = View::new(app)
        .row()
        .width(Length::percent(100.0))
        .shrink(0.0)
        .justify(Justify::SpaceBetween)
        .gap(2);
    let root = View::new(app)
        .column()
        .shrink(0.0)
        .child(&frame)
        .child(&bottom)
        .child(&footer_row);

    let inner = Rc::new_cyclic(|this| Inner {
        tui: tui.weak(),
        app: app.clone(),
        session: session.cloned(),
        textarea,
        root,
        frame,
        bottom,
        metadata,
        footer,
        editor_file,
        dismissed: RefCell::new(None),
        followed: Cell::new(false),
        footer_row,
        location_box,
        location_width: Cell::new(app.size().0),
        footer_slots: RefCell::default(),
        hovered: Cell::new(false),
        running,
        busy: Cell::new(false),
        spinner,
        mode: Cell::new(Mode::Normal),
        prompt: RefCell::new(empty_prompt()),
        interrupt: Cell::new(0),
        interrupt_timer: Cell::new(None),
        submitting: Cell::new(false),
        on_submit: RefCell::new(None),
        catalog: RefCell::new(None),
        layers: RefCell::new(Vec::new()),
        parts: parts::Parts::default(),
        autocomplete: OnceCell::new(),
        paste: super::paste::Queue::default(),
        previews,
        startup: RefCell::new(None),
        staging,
        this: this.clone(),
    });
    connect(&inner);
    connect_location(&inner);
    install_layers(tui, &inner);
    // After the prompt's layers, as TS renders it after them: the newer layer runs first, so its
    // `prompt.clear` wins while the popup shows.
    let _ = inner
        .autocomplete
        .set(autocomplete::mount(tui, &inner, &inner.root));
    *tui.textarea.borrow_mut() = Some(inner.textarea.clone());
    *tui.prompt.current.borrow_mut() = Rc::downgrade(&inner);
    if let Some(draft) = tui.prompt.drafts.take(session) {
        let cursor = draft.cursor;
        inner.restore(draft.prompt);
        inner
            .textarea
            .set_cursor_offset(cursor.min(inner.text_end()));
    }
    if let Some(text) = tui.startup.take_prompt(session) {
        let mut prompt = empty_prompt();
        prompt["text"] = Value::String(text.clone());
        inner.restore(prompt);
        inner.textarea.set_cursor_offset(inner.text_end());
        *inner.startup.borrow_mut() = Some(text);
    }
    load_catalog(tui, &inner);
    // A model, agent, or variant choice (E.16) changes the metadata row.
    let weak = Rc::downgrade(&inner);
    let local = tui.local.subscribe(move || {
        if let Some(inner) = weak.upgrade()
            && let Some(tui) = inner.tui.upgrade()
        {
            inner.refresh(&tui);
            inner.submit_startup(&tui);
        }
    });
    inner.layers.borrow_mut().push(local);
    let weak = Rc::downgrade(&inner);
    let editor = tui.prompt.editor.subscribe(move || {
        if let Some(inner) = weak.upgrade()
            && let Some(tui) = inner.tui.upgrade()
        {
            inner.refresh(&tui);
        }
    });
    inner.layers.borrow_mut().push(editor);
    let weak = Rc::downgrade(&inner);
    let mentions = tui.prompt.editor.on_mention(move |mention| {
        if let Some(inner) = weak.upgrade()
            && let Some(tui) = inner.tui.upgrade()
        {
            editor_context::insert_mention(&inner, &tui, mention);
        }
    });
    inner.layers.borrow_mut().push(mentions);
    // `useCursorStyle` and the animations follow the config, as the metadata row's auto-accept mark does.
    let weak = Rc::downgrade(&inner);
    tui.settings.on_change(move |tui| {
        let Some(inner) = weak.upgrade() else { return };
        let cursor = crate::features::system_commands::cursor(&tui.config());
        inner.textarea.cursor_style(cursor.0, cursor.1);
        let animations = opencode_ui::motion::enabled(tui.config().info.animations);
        inner.spinner.set_animations(animations);
        inner.staging.set_animations(animations);
        inner.refresh(tui);
    });
    // Home drops the last session's selection; a session follows its directory (`editor.reconnect`).
    match session {
        None => tui.prompt.editor.clear_selection(),
        Some(_) => inner.follow_directory(tui),
    }
    inner.refresh(tui);
    inner.submit_startup(tui);
    Prompt { inner }
}

impl Inner {
    pub(crate) fn rc(&self) -> Option<Rc<Inner>> {
        self.this.upgrade()
    }

    /// Shows `prompt` (a `PromptInfo`), with its mode, as `ref.set` and history do.
    pub(crate) fn restore(&self, prompt: Value) {
        let text = prompt
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mode = match prompt.get("mode").and_then(Value::as_str) {
            Some("shell") => Mode::Shell,
            _ => Mode::Normal,
        };
        self.textarea.set_text(&text);
        *self.prompt.borrow_mut() = prompt;
        parts::restore(self);
        self.set_mode(mode);
        self.parts_changed();
    }

    /// `resetComposer`.
    pub(crate) fn reset(&self) {
        *self.prompt.borrow_mut() = empty_prompt();
        self.parts.clear();
        self.textarea.set_text("");
        self.parts_changed();
    }

    /// Shows the attachments the prompt now has (E.4).
    pub(crate) fn parts_changed(&self) {
        if let Some(tui) = self.tui.upgrade() {
            self.previews.update(&tui, self);
        }
    }

    /// `clearPrompt`: long or rich prompts go to history first.
    pub(crate) fn clear(&self, tui: &Tui) {
        let prompt = self.snapshot();
        let rich = ["pasted", "files", "agents"].iter().any(|key| {
            prompt
                .get(*key)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
        });
        let text = prompt
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if text.trim().chars().count() >= CLEAR_RETENTION_CHARS || rich {
            tui.prompt.history.append(&tui.app, prompt);
        }
        self.reset();
    }

    /// The prompt as history stores it: the `PromptInfo` with the current text and `mode`.
    pub(crate) fn snapshot(&self) -> Value {
        let mut prompt = self.prompt.borrow().clone();
        prompt["text"] = Value::String(self.textarea.text());
        prompt["mode"] = Value::String(self.mode.get().as_str().to_owned());
        prompt
    }

    pub(crate) fn set_mode(&self, mode: Mode) {
        self.mode.set(mode);
        if let Some(tui) = self.tui.upgrade() {
            self.refresh(&tui);
        }
    }

    /// The cursor offset at the end of the text.
    pub(crate) fn text_end(&self) -> u32 {
        let text = self.textarea.text();
        let lines: Vec<&str> = text.split('\n').collect();
        (lines.iter().map(|line| line.width()).sum::<usize>() + lines.len() - 1) as u32
    }

    pub(crate) fn focused(&self) -> bool {
        self.app
            .focused()
            .is_some_and(|widget| widget.id() == self.textarea.id())
    }

    pub(crate) fn session_info(&self, tui: &Tui) -> Option<SessionInfo> {
        let session = self.session.as_ref()?;
        tui.data.read(|state| state.session(session).cloned())
    }

    /// Points the editor context at the session's directory once the session is known.
    fn follow_directory(&self, tui: &Tui) {
        if self.followed.get() {
            return;
        }
        if let Some(info) = self.session_info(tui) {
            self.followed.set(true);
            tui.prompt
                .editor
                .reconnect(tui, Some(&info.location.directory.0));
        }
    }

    /// The editor selection the prompt shows and sends: none when `prompt.editor` is off or this prompt
    /// dismissed it (`editorContext`).
    pub(crate) fn editor_context(&self, tui: &Tui) -> Option<Selection> {
        let enabled = tui
            .config()
            .info
            .prompt
            .as_ref()
            .and_then(|prompt| prompt.editor)
            .unwrap_or(true);
        let selection = tui.prompt.editor.selection().filter(|_| enabled)?;
        (self.dismissed.borrow().as_deref() != Some(&selection.key())).then_some(selection)
    }

    /// `prompt.editor_context.clear`.
    fn dismiss_editor_context(&self, tui: &Tui) {
        *self.dismissed.borrow_mut() = self.editor_context(tui).map(|selection| selection.key());
        tui.prompt.editor.clear_selection();
    }

    fn running(&self, tui: &Tui) -> bool {
        self.session.as_ref().is_some_and(|session| {
            tui.data.read(|state| state.status(session)) == SessionStatus::Running
        })
    }

    /// The session's location; on home, the current one (`location.ref`: where home was opened, or where
    /// `/cd` moved), else the default one.
    pub(crate) fn location(&self, tui: &Tui) -> Location {
        Location::new(self.session_info(tui).map_or_else(
            || {
                crate::features::location::current(tui)
                    .map_or_else(|| tui.directory.clone(), |location| location.directory)
            },
            |session| session.location.directory.0,
        ))
    }

    /// Reads the catalogs again after a home `/cd`.
    pub(crate) fn relocate(&self, tui: &Tui) {
        if let Some(inner) = self.rc() {
            load_catalog(tui, &inner);
        }
        self.refresh(tui);
    }

    /// Rebuilds the catalog from the store and repaints.
    fn read_catalog(&self, tui: &Tui) {
        let location = self.location(tui);
        let catalog = tui
            .data
            .read(|state| Catalog::read(state, &location, &tui.prompt.preferences));
        if let Some(catalog) = catalog {
            *self.catalog.borrow_mut() = Some(Rc::new(catalog));
            self.refresh(tui);
            self.submit_startup(tui);
        }
    }

    /// Submits `--prompt` once everything a submit needs has loaded, if it is still the prompt's text.
    fn submit_startup(&self, tui: &Tui) {
        let ready = self.startup.borrow().is_some()
            && self.catalog.borrow().is_some()
            && (self.session.is_none() || self.session_info(tui).is_some())
            && tui.local.ready()
            && tui.local.catalog_ready()
            && tui.local.agent().is_some()
            && tui.local.current().is_some();
        if !ready {
            return;
        }
        let Some(text) = self.startup.take() else {
            return;
        };
        if self.textarea.text() != text {
            return;
        }
        // After the change that made it ready: a submit can navigate, which drops this prompt.
        let weak = self.this.clone();
        tui.app.defer(move |_| {
            if let Some(prompt) = weak.upgrade() {
                super::submit::submit(&prompt, SessionInboxDelivery::Steer);
            }
        });
    }

    /// Repaints the border, the metadata row, and the footer from the current state.
    pub(crate) fn refresh(&self, tui: &Tui) {
        let theme = tui.page();
        let catalog = self.catalog.borrow().clone();
        let session = self.session_info(tui);
        let selection = catalog.as_ref().and_then(|catalog| {
            crate::dialogs::model::prompt_selection(tui, catalog, session.as_ref())
        });
        let agent_color = selection
            .as_ref()
            .and_then(|selection| catalog.as_ref()?.color(&theme, selection.agent.id.as_str()));
        let mode = self.mode.get();
        let highlight = match mode {
            Mode::Shell => theme.text.action.primary.selected,
            Mode::Normal => agent_color.unwrap_or(theme.border.base),
        };
        self.frame.border_color(highlight);
        self.bottom.border_color(highlight);
        self.spinner.set_color(
            if opencode_ui::motion::enabled(tui.config().info.animations) {
                scanner_colors(&scanner(agent_color.unwrap_or(theme.border.base)))
            } else {
                SpinnerColor::from(theme.text.muted)
            },
        );

        let display = match (&catalog, &selection) {
            (Some(catalog), Some(selection)) => {
                let (model, provider) = catalog.labels(selection.model.as_ref());
                Display {
                    agent: Some(metadata::titlecase(selection.agent.id.as_str())),
                    auto: tui.config().permissions == Permissions::Autoaccept,
                    model,
                    provider,
                    variant: selection
                        .model
                        .as_ref()
                        .and_then(|model| model.variant.clone()),
                    limit: tui.local.limit_label(),
                }
            }
            _ => Display::default(),
        };
        let display = match mode {
            Mode::Shell => Display {
                agent: Some("Shell".into()),
                ..display
            },
            Mode::Normal => display,
        };
        self.metadata
            .set(&theme, mode, &display, highlight, self.app.size().0);

        let running = self.running(tui);
        self.busy.set(running);
        self.running.visible(running);
        let staged = !running && self.staging.render(&theme);
        self.footer.visible(!staged);
        let footer: Vec<Span> = if running {
            let armed = self.interrupt.get() > 0;
            let (key, label) = if armed {
                (
                    theme.text.feedback.warning.base,
                    theme.text.feedback.warning.base,
                )
            } else {
                (theme.text.base, theme.text.muted)
            };
            vec![
                "esc ".fg(key),
                (if armed {
                    "again to interrupt"
                } else {
                    "interrupt"
                })
                .fg(label),
            ]
        } else {
            let home = std::env::var("HOME").unwrap_or_default();
            let directory =
                opencode_ui::path::abbreviate_home(&self.location(tui).directory, &home);
            let branch = catalog.as_ref().and_then(|catalog| catalog.branch.as_ref());
            let label = match branch {
                Some(branch) => format!("{directory}:{branch}"),
                None => directory,
            };
            let color = if self.hovered.get() {
                theme.text.base
            } else {
                theme.text.muted
            };
            let label = crate::dialogs::open::truncate_file_path(
                &label,
                i64::from(self.location_width.get()),
            );
            vec![label.fg(color)]
        };
        self.footer.set_text(footer);
        // The file label, highlighted until the selection is sent.
        let state = tui.prompt.editor.label_state();
        let file = self
            .editor_context(tui)
            .filter(|_| state != LabelState::None)
            .map(|selection| {
                let width = (self.app.size().0 / 3).clamp(12, 48) as usize;
                opencode_ui::select::truncate_middle(&selection.label(), width)
            })
            .unwrap_or_default();
        let color = if state == LabelState::Pending {
            theme.accent().step(500)
        } else {
            theme.text.muted
        };
        // `<Show>`: no file, no child, so the row keeps no gap for it.
        self.editor_file.visible(!file.is_empty());
        self.editor_file.set_text(vec![file.fg(color)]);
        self.mount_footer(tui);
        self.app.request_redraw();
    }

    /// Mounts the `prompt.footer` slots again when their input changed (E.14).
    fn mount_footer(&self, tui: &Tui) {
        let input = opencode_plugin::SlotInput {
            session_id: self.session.as_ref().map(|session| session.0.clone()),
            prompt: Some(opencode_plugin::slot::PromptFooter {
                shell: self.mode.get() == Mode::Shell,
                show_details: self.interrupt.get() == 0 || self.app.size().0 >= 80,
            }),
            ..opencode_plugin::SlotInput::default()
        };
        let mut slots = self.footer_slots.borrow_mut();
        if slots.0.as_ref() == Some(&input) {
            return;
        }
        self.location_box.detach();
        self.editor_file.detach();
        self.footer_row.clear();
        let row = &self.footer_row;
        let mut mounts = Vec::new();
        let footer = crate::plugins::host::slot(
            tui,
            row,
            opencode_plugin::slot::PROMPT_FOOTER,
            &input,
            |row| {
                let status = crate::plugins::host::slot(
                    tui,
                    row,
                    opencode_plugin::slot::PROMPT_FOOTER_STATUS,
                    &input,
                    |row| {
                        row.add(&self.location_box);
                    },
                );
                let file = crate::plugins::host::slot(
                    tui,
                    row,
                    opencode_plugin::slot::PROMPT_FOOTER_FILE,
                    &input,
                    |row| {
                        row.add(&self.editor_file);
                    },
                );
                mounts.push(status);
                mounts.push(file);
            },
        );
        mounts.push(footer);
        *slots = (Some(input), mounts);
    }

    /// `session.interrupt`: Escape leaves shell mode, else arms, and a second Escape interrupts.
    fn interrupt(&self, tui: &Tui) {
        if self.mode.get() == Mode::Shell {
            self.set_mode(Mode::Normal);
            return;
        }
        let Some(session) = self.session.clone() else {
            return;
        };
        self.interrupt.set(self.interrupt.get() + 1);
        if let Some(timer) = self.interrupt_timer.take() {
            self.app.cancel_timer(timer);
        }
        let weak = self.this.clone();
        self.interrupt_timer
            .set(Some(self.app.set_timeout(INTERRUPT_WINDOW, move |_| {
                if let (Some(prompt), Some(tui)) =
                    (weak.upgrade(), weak.upgrade().and_then(|p| p.tui.upgrade()))
                {
                    prompt.interrupt.set(0);
                    prompt.refresh(&tui);
                }
            })));
        if self.interrupt.get() >= 2 {
            let client = tui.data.client().clone();
            tui.app.runtime().spawn(async move {
                let input = SessionInterruptInput {
                    session_id: session,
                    resume: Some(true),
                };
                if let Err(error) = client
                    .session_interrupt(&input, &RequestOptions::default())
                    .await
                {
                    log::warn!("interrupt failed: {error}");
                }
            });
            self.interrupt.set(0);
        }
        tui.dialogs.clear();
        self.refresh(tui);
    }

    /// `session.background`.
    fn background(&self, tui: &Tui) {
        let Some(session) = self.session.clone() else {
            return;
        };
        let client = tui.data.client().clone();
        tui.app.runtime().spawn(async move {
            let input = SessionBackgroundInput {
                session_id: session,
            };
            if let Err(error) = client
                .session_background(&input, &RequestOptions::default())
                .await
            {
                log::warn!("background failed: {error}");
            }
        });
        tui.dialogs.clear();
    }
}

/// The prompt's background (`theme.decrease(theme.background.raised.base)`).
fn prompt_background(theme: &Theme) -> Color {
    theme.decrease(&theme.background.raised.base, 1)
}

/// Eleven border glyphs (`BorderStyle::chars` order) with the given vertical, bottom-left corner,
/// and horizontal.
fn border_chars(vertical: char, bottom_left: char, horizontal: char) -> [char; 11] {
    [
        ' ',
        ' ',
        bottom_left,
        ' ',
        horizontal,
        vertical,
        ' ',
        ' ',
        ' ',
        ' ',
        ' ',
    ]
}

/// Text changes update the prompt; Submit (from `input.submit`) submits.
fn connect(inner: &Rc<Inner>) {
    let weak = Rc::downgrade(inner);
    inner.textarea.on_change(move |_, text| {
        if let Some(prompt) = weak.upgrade() {
            prompt.prompt.borrow_mut()["text"] = Value::String(text.to_owned());
            parts::sync(&prompt);
            prompt.parts_changed();
            if let Some(complete) = prompt.autocomplete.get() {
                complete.on_input(text);
            }
        }
    });
    super::paste::connect(inner);
    let weak = Rc::downgrade(inner);
    inner.textarea.on_submit(move |_, _| {
        if let Some(prompt) = weak.upgrade() {
            super::submit::submit(&prompt, SessionInboxDelivery::Steer);
        }
    });
}

/// The footer's location brightens under the pointer, and a click opens the working directory dialog (E.20,
/// `useWorkingDirectoryActions`). While a reply runs the footer shows the interrupt hint instead.
fn connect_location(inner: &Rc<Inner>) {
    // `onSizeChange` of the status box: the label shortens to the room the footer plugins leave.
    let weak = Rc::downgrade(inner);
    inner.location_box.on_resize(move |_, rect| {
        let Some(prompt) = weak.upgrade() else { return };
        let width = rect.width.max(0.0) as u16;
        if prompt.location_width.replace(width) != width
            && let Some(tui) = prompt.tui.upgrade()
        {
            prompt.refresh(&tui);
        }
    });
    let weak = Rc::downgrade(inner);
    inner.footer.on_hover(move |_, hovered| {
        let Some(prompt) = weak.upgrade() else { return };
        prompt.hovered.set(hovered);
        if let Some(tui) = prompt.tui.upgrade() {
            prompt.refresh(&tui);
        }
    });
    let weak = Rc::downgrade(inner);
    inner.footer.on_mouse(move |_, event| {
        if event.kind != MouseEventKind::Up(MouseButton::Left) {
            return;
        }
        let Some(prompt) = weak.upgrade() else { return };
        let Some(tui) = prompt.tui.upgrade() else {
            return;
        };
        if !prompt.running(&tui) {
            crate::dialogs::working_directory::show(&tui, &prompt.location(&tui).directory);
        }
    });
}

/// Reads the location's catalogs through the store; the prompt repaints as each arrives.
pub(crate) fn load_catalog(tui: &Tui, inner: &Rc<Inner>) {
    inner.read_catalog(tui);
    for task in metadata::sync(&tui.data, &inner.location(tui)) {
        let weak = Rc::downgrade(inner);
        tui.app.spawn(task, move |_, result| {
            let Some(prompt) = weak.upgrade() else { return };
            let Some(tui) = prompt.tui.upgrade() else {
                return;
            };
            match result {
                Ok(()) => prompt.read_catalog(&tui),
                Err(error) => log::warn!("prompt catalog: {error}"),
            }
        });
    }
}

/// The skills dialog's pick: an `@skill` mention at the cursor (`prompt.skills`).
fn insert_skill(prompt: Weak<Inner>) -> crate::dialogs::skill::OnSelect {
    Rc::new(move |_, id| {
        if let Some(prompt) = prompt.upgrade() {
            parts::insert_skill(&prompt, &id.0);
        }
    })
}

/// The prompt's layers (`component/prompt/index.tsx:644-1096`).
fn install_layers(tui: &Tui, inner: &Rc<Inner>) {
    let target = inner.textarea.id();
    let when = |check: fn(&Inner, &Tui) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || {
            weak.upgrade()
                .is_some_and(|prompt| prompt.tui.upgrade().is_some_and(|tui| check(&prompt, &tui)))
        })
    };
    let run = |action: fn(&Inner, &Tui) -> bool| {
        let weak = Rc::downgrade(inner);
        move |_: Option<&str>, _: Option<&KeyEvent>| {
            weak.upgrade().is_some_and(|prompt| {
                prompt
                    .tui
                    .upgrade()
                    .is_some_and(|tui| action(&prompt, &tui))
            })
        }
    };
    let command = |id: &str, title: &str, group: &str, action: fn(&Inner, &Tui) -> bool| {
        TuiCommand::new(id, run(action))
            .title(title)
            .group(group)
            .bind(Bind::Off)
    };
    let bindings = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect();

    let layers = vec![
        // The prompt's commands (`promptCommands`); only `prompt.queue` is in the palette.
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![
                command("prompt.clear", "Clear prompt", "Prompt", |prompt, tui| {
                    prompt.clear(tui);
                    tui.dialogs.clear();
                    true
                }),
                command("prompt.submit", "Submit prompt", "Prompt", |prompt, tui| {
                    if prompt.focused()
                        && prompt.rc().is_some_and(|rc| {
                            super::submit::submit(&rc, SessionInboxDelivery::Steer)
                        })
                    {
                        tui.dialogs.clear();
                    }
                    true
                }),
                command("prompt.queue", "Queue prompt", "Prompt", |prompt, tui| {
                    // An open popup first completes a server command, else keeps the key.
                    if prompt.focused()
                        && !prompt.autocomplete.get().is_some_and(|complete| {
                            complete.visible().is_some() && !complete.complete_queueable()
                        })
                        && prompt.rc().is_some_and(|rc| {
                            super::submit::submit(&rc, SessionInboxDelivery::Queue)
                        })
                    {
                        tui.dialogs.clear();
                    }
                    true
                })
                .palette(),
                command(
                    "session.interrupt",
                    "Interrupt session",
                    "Session",
                    |prompt, tui| {
                        if prompt.focused() {
                            prompt.interrupt(tui);
                        }
                        true
                    },
                )
                .enabled(when(|prompt, _| prompt.busy.get())),
                command(
                    "session.background",
                    "Background blocking tools",
                    "Session",
                    |prompt, tui| {
                        if prompt.focused() {
                            prompt.background(tui);
                        }
                        true
                    },
                )
                .enabled(when(|prompt, _| prompt.busy.get())),
                command("prompt.skills", "Skills", "Prompt", |prompt, tui| {
                    crate::dialogs::skill::show(
                        tui,
                        Some(prompt.location(tui)),
                        insert_skill(prompt.this.clone()),
                    );
                    true
                })
                .palette()
                .slash(Slash {
                    name: "skills".to_owned(),
                    aliases: Vec::new(),
                    arguments: false,
                }),
                autocomplete::cd::command(inner.this.clone()),
                super::r#move::command(inner.this.clone()),
                command(
                    "prompt.editor_context.clear",
                    "Remove editor context",
                    "Prompt",
                    |prompt, tui| {
                        prompt.dismiss_editor_context(tui);
                        tui.dialogs.clear();
                        true
                    },
                )
                .palette()
                .enabled(when(|prompt, tui| prompt.editor_context(tui).is_some())),
                command("prompt.editor", "Open editor", "Session", |prompt, tui| {
                    if let Some(prompt) = prompt.rc() {
                        super::external_editor::open(tui, &prompt);
                    }
                    true
                })
                .palette()
                .slash(Slash {
                    name: "editor".to_owned(),
                    aliases: Vec::new(),
                    arguments: false,
                }),
                command("prompt.paste", "Paste", "Prompt", |prompt, _| {
                    if let Some(prompt) = prompt.rc() {
                        super::paste::from_clipboard(&prompt);
                    }
                    true
                }),
                command(
                    "prompt.images.view",
                    "View image attachments",
                    "Prompt",
                    |prompt, tui| {
                        super::attach::view(tui, prompt);
                        true
                    },
                )
                .palette()
                .enabled(when(|prompt, _| super::attach::has_images(prompt))),
            ],
            ..KeymapLayer::default()
        },
        super::stash::layer(inner),
        KeymapLayer {
            priority: 1,
            bindings: bindings(&["prompt.queue"]),
            ..KeymapLayer::default()
        },
        KeymapLayer {
            bindings: bindings(&[
                "prompt.submit",
                "prompt.editor",
                "prompt.editor_context.clear",
                "prompt.images.view",
                "prompt.stash",
                "prompt.stash.pop",
                "prompt.stash.list",
                "prompt.skills",
                "session.interrupt",
                "session.background",
                super::r#move::COMMAND,
            ]),
            ..KeymapLayer::default()
        },
        KeymapLayer {
            target: Some(target),
            bindings: bindings(&["prompt.paste"]),
            ..KeymapLayer::default()
        },
        // Ctrl+C clears a prompt with text; on an empty one it reaches `app.exit`.
        KeymapLayer {
            target: Some(target),
            enabled: when(|prompt, _| !prompt.textarea.text().is_empty()),
            bindings: bindings(&["prompt.clear"]),
            ..KeymapLayer::default()
        },
        // History moves the cursor first, then steps (`prompt.history.*`).
        KeymapLayer {
            priority: 1,
            target: Some(target),
            commands: vec![
                TuiCommand::new(
                    "prompt.history.previous",
                    run(|prompt, tui| history::previous(prompt, &tui.prompt.history)),
                )
                .title("Previous prompt history")
                .group("Prompt"),
                TuiCommand::new(
                    "prompt.history.next",
                    run(|prompt, tui| history::next(prompt, &tui.prompt.history)),
                )
                .title("Next prompt history")
                .group("Prompt"),
            ],
            ..KeymapLayer::default()
        },
    ]
    .into_iter()
    .chain(super::shell::layers(inner, target));
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => inner.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("prompt keymap layer: {error}"),
        }
    }
}

/// The prompt's scanner (`spinnerDef`, `component/prompt/index.tsx:1657-1676`).
fn scanner(color: Color) -> ScannerOptions {
    ScannerOptions {
        style: ScannerStyle::Blocks,
        inactive_factor: 0.6,
        min_alpha: 0.3,
        ..ScannerOptions::new(color)
    }
}
