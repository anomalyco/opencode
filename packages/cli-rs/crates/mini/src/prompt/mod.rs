//! The footer prompt (`footer.prompt.tsx`, M.2; rows M04, M09, M13): a composer that grows with its text up to
//! six rows, its autocomplete menu, and the keys that drive it.
//!
//! - `/` at a word start lists mini's built-ins (`/editor`, `/settings`, `/new`, `/compact`, the exit words) and
//!   the server's commands; `@` lists subagents, the file search's results (with `#12-20` line ranges), and
//!   references. A pick becomes an atomic mention part.
//! - `!` at the start enters shell mode; Escape, or Backspace at the start, leaves it.
//! - Up at the start and Down at the end step through the session's prompts ([`history`]).
//! - `prompt.editor` and `/editor` compose in `$VISUAL` or `$EDITOR`; pastes and `prompt.paste` attach images,
//!   PDFs, and SVGs.
//! - Enter sends with `steer`, `prompt.queue` with `queue`; an empty Enter steers the first queued prompt. The
//!   shell runs the turns through [`queue`].
//!
//! The prompt owns the footer's keymap, so M.3's views add their layers to [`Prompt::keymap`].

pub mod api;
pub mod complete;
pub mod history;
pub mod images;
pub mod menu;
pub mod parts;
pub mod queue;
pub mod status;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use opencode_api::client::Client;
use opencode_api::generated::{SessionInboxDelivery, SessionInboxItem, V2Event};
use opencode_local::cli_config::Info;
use opencode_ui::dialog::{DialogKeymap, route_keys};
use opencode_ui::keymap::{Keybinds, KeymapLayer, TuiCommand};
use opencode_ui::prompt_input::editor::{Mention, normalize, realign_mentions};
use opencode_ui::prompt_input::parse::{self, measure};
use opencode_ui::prompt_input::paste::{Content, content, strip_ansi};
use opencode_ui::prompt_input::{attach, replace};
use opentui::input::KeyEvent;
use opentui::keymap::{Condition, Disposer};
use opentui::native::{ClipboardOutcome, EditorQuery};
use opentui::prelude::*;
use opentui::widget::{ExtmarkId, ExtmarkOptions};
use serde_json::{Value, json};

use self::complete::{Action, Catalog, Choice};
use self::history::History;
use self::menu::{MENU_ROWS, Menu, Selection};
pub use self::parts::{Command, Delivery, File, Part, RunPrompt, is_exit};
use crate::theme::RunTheme;

/// `TEXTAREA_MIN_ROWS`.
pub const MIN_ROWS: u16 = 1;
/// `TEXTAREA_MAX_ROWS`.
const MAX_ROWS: u16 = 6;
/// `PROMPT_MAX_ROWS`: a terminal at least this plus four rows tall pads the prompt.
pub const PROMPT_MAX_ROWS: u16 = MAX_ROWS + MENU_ROWS;

/// `footerPromptLayout`: the rows of the padding, the textarea, the menu, and the image previews.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Layout {
    pub padding: u16,
    pub textarea: u16,
    pub menu: u16,
    pub images: u16,
    /// The textarea's shown rows plus the menu and previews.
    pub rows: u16,
}

pub fn layout(height: u16, lines: u16, options: u16, status_rows: u16, images: bool) -> Layout {
    let padding = u16::from(height >= PROMPT_MAX_ROWS + 4);
    let available = height.saturating_sub(1 + status_rows + padding * 2).max(1);
    let preview = if images && options == 0 { 4.min(available.saturating_sub(MAX_ROWS.min(lines.max(1)))) } else { 0 };
    let images = if preview >= 3 { preview } else { 0 };
    let textarea = available.saturating_sub(images + u16::from(options > 0)).clamp(1, MAX_ROWS);
    let rows = textarea.min(lines.max(1));
    let menu = if options > 0 { MENU_ROWS.min(options).min(available.saturating_sub(rows)).max(1) } else { 0 };
    Layout { padding, textarea, menu, images, rows: rows + menu + images }
}

/// `MenuMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Mention,
    Slash,
}

/// A prompt waiting in the server's inbox (`FooterQueuedPrompt`).
#[derive(Clone, Debug, PartialEq)]
pub struct Queued {
    pub id: String,
    pub delivery: Delivery,
    pub prompt: RunPrompt,
}

type Notice = Box<dyn Fn(&str)>;

/// What the prompt asks of the footer around it. Each returns at once; a hook that needs the event context
/// defers.
#[derive(Default)]
pub struct Hooks {
    /// `onSubmit` (`footer.handlePrompt`): a prompt to send. False keeps it in the composer.
    pub submit: Option<Box<dyn Fn(RunPrompt) -> bool>>,
    /// `onExitRequest`: Ctrl+C on an empty prompt (the two-press exit).
    pub exit_request: Option<Box<dyn Fn()>>,
    /// `onExit`: an exit word.
    pub exit: Option<Box<dyn Fn()>>,
    /// `onInterrupt`: Escape; false when nothing runs.
    pub interrupt: Option<Box<dyn Fn() -> bool>>,
    /// `onInputClear`: typing disarms the two-press gestures.
    pub input_clear: Option<Box<dyn Fn()>>,
    /// `onStatus`: a notice in the status row.
    pub status: Option<Notice>,
    /// The composer's rows or the menu changed; the footer resizes.
    pub layout: Option<Box<dyn Fn()>>,
    /// `app.clear` (Ctrl+L).
    pub clear_screen: Option<Box<dyn Fn()>>,
    /// `/settings` (M.4's view).
    pub settings: Option<Box<dyn Fn()>>,
}

/// The session the prompt completes and steers in.
#[derive(Clone)]
struct Target {
    client: Client,
    session: String,
    directory: String,
}

#[derive(Default)]
struct State {
    shell: bool,
    first: bool,
    running: bool,
    history: History,
    /// The draft saved when history browsing starts.
    stash: RunPrompt,
    parts: Vec<Part>,
    /// Each mark and the part it stands for.
    marks: Vec<(ExtmarkId, usize)>,
    /// A server command a restored prompt named (`draft.command`).
    command: Option<Command>,
    mode: Option<Mode>,
    /// Where the open trigger starts.
    at: u32,
    query: String,
    selection: Selection,
    /// The file search's results for the current query.
    files: Vec<String>,
    /// Bumped per search, so a stale answer is dropped.
    search: u64,
    catalog: Catalog,
    agent: String,
    queued: Vec<Queued>,
    /// Pending prompts with an action in flight.
    flights: std::collections::HashSet<String>,
    submitting: bool,
    /// A paste in flight: a submit waits for it.
    pasting: bool,
    terminal: (u16, u16),
    layout: Layout,
}

struct Inner {
    app: App,
    textarea: Textarea,
    body: View,
    rail: View,
    menu: Menu,
    previews: images::Previews,
    /// `prompt.image_preview`.
    image_preview: bool,
    keymap: Rc<DialogKeymap>,
    theme: RefCell<RunTheme>,
    mono: bool,
    state: RefCell<State>,
    hooks: RefCell<Rc<Hooks>>,
    target: RefCell<Option<Target>>,
    /// Programmatic edits sync the draft themselves.
    quiet: Cell<bool>,
    layers: RefCell<Vec<Disposer>>,
    /// The footer view around the prompt (`input.view()`): `prompt` while the composer shows.
    view: Cell<&'static str>,
}

/// The composer in the footer. Cloning is cheap.
#[derive(Clone)]
pub struct Prompt(Rc<Inner>);

impl Prompt {
    pub fn new(app: &App, theme: &RunTheme, mono: bool, config: &Info) -> Self {
        let textarea = Textarea::new(app)
            .set_keymap(opentui::input::Keymap::new())
            .wrap(WrapMode::Word)
            .colors(theme.footer.text, theme.background)
            .focused_colors(theme.footer.text, theme.background)
            .placeholder_color(theme.footer.muted)
            .cursor_color(theme.footer.text)
            .width(Length::percent(100.0))
            .height(u32::from(MIN_ROWS));
        let vertical = if mono { '|' } else { '┃' };
        let previews = images::Previews::new(app);
        let rail = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .border_sides(Sides::LEFT)
            .border_chars(Some([' ', ' ', ' ', ' ', ' ', vertical, ' ', ' ', ' ', ' ', ' ']))
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 2)
            .child(previews.root())
            .child(&textarea);
        let body = View::new(app).column().width(Length::percent(100.0)).shrink(0.0).child(&rail);
        let keymap = Rc::new(keymap(app, config, &textarea));
        let terminal = opentui::term::size().unwrap_or((app.size().0, 0));
        let inner = Rc::new(Inner {
            app: app.clone(),
            textarea,
            body,
            rail,
            menu: Menu::new(app),
            previews,
            image_preview: config.prompt.as_ref().and_then(|prompt| prompt.image_preview) == Some(true),
            keymap,
            theme: RefCell::new(theme.clone()),
            mono,
            state: RefCell::new(State { first: true, terminal, ..State::default() }),
            hooks: RefCell::default(),
            target: RefCell::default(),
            quiet: Cell::new(false),
            layers: RefCell::default(),
            view: Cell::new("prompt"),
        });
        connect(&inner);
        install_layers(&inner);
        let prompt = Self(inner);
        prompt.paint();
        prompt
    }

    /// The composer, padded by the footer.
    pub fn root(&self) -> &View {
        &self.0.body
    }

    /// The autocomplete menu, shown below the composer in place of the status row.
    pub fn menu_root(&self) -> &View {
        self.0.menu.root()
    }

    /// The footer's keymap, for M.3's views.
    pub fn keymap(&self) -> &Rc<DialogKeymap> {
        &self.0.keymap
    }

    /// Routes the app's keys through the keymap and expires the leader sequence.
    pub fn install(&self) {
        let app = &self.0.app;
        route_keys(app, self.0.keymap.clone());
        let keymap = Rc::downgrade(&self.0.keymap);
        let timer = Rc::new(Cell::new(None::<TimerId>));
        app.on_key(move |cx, _| {
            let Some(keys) = keymap.upgrade() else { return };
            if let Some(previous) = timer.take() {
                cx.cancel_timer(previous);
            }
            let Some(deadline) = keys.leader_deadline() else {
                return;
            };
            let keymap = Rc::downgrade(&keys);
            timer.set(Some(cx.set_timeout(deadline.saturating_duration_since(cx.now()), move |cx| {
                if let Some(keys) = keymap.upgrade() {
                    keys.expire_leader(cx.now());
                }
            })));
        });
    }

    pub fn set_hooks(&self, hooks: Hooks) {
        *self.0.hooks.borrow_mut() = Rc::new(hooks);
    }

    pub fn focus(&self) {
        self.0.textarea.focus();
    }

    pub fn value(&self) -> String {
        self.0.textarea.text()
    }

    /// Whether the composer is in shell mode.
    pub fn shell(&self) -> bool {
        self.0.state.borrow().shell
    }

    /// Whether the autocomplete menu shows.
    pub fn menu_visible(&self) -> bool {
        self.0.state.borrow().mode.is_some()
    }

    /// The footer's rows for the composer at this terminal size (`applyHeight`'s `rows`): the shown textarea
    /// rows and the menu, less one when the menu replaces the status row. Sizes the textarea and the menu.
    pub fn rows(&self, terminal: (u16, u16)) -> u16 {
        self.0.state.borrow_mut().terminal = terminal;
        self.0.measure();
        let layout = self.0.state.borrow().layout;
        (layout.rows - u16::from(layout.menu > 0)).max(MIN_ROWS)
    }

    /// The padding rows the composer has at this height.
    pub fn padding(&self) -> u16 {
        self.0.state.borrow().layout.padding
    }

    pub fn set_theme(&self, theme: &RunTheme) {
        *self.0.theme.borrow_mut() = theme.clone();
        self.0
            .textarea
            .colors(theme.footer.text, theme.background)
            .focused_colors(theme.footer.text, theme.background)
            .placeholder_color(theme.footer.muted)
            .cursor_color(theme.footer.text);
        self.paint();
    }

    /// A session without prompts shows the composer's hint (`first`).
    pub fn set_first(&self, first: bool) {
        self.0.state.borrow_mut().first = first;
        self.paint();
    }

    /// The session's earlier prompts, for history (`history` event).
    pub fn set_history(&self, history: Vec<RunPrompt>) {
        self.0.state.borrow_mut().history = History::new(&history);
    }

    /// The session's agent, which colors the rail.
    pub fn set_agent(&self, agent: &str) {
        self.0.state.borrow_mut().agent = agent.to_owned();
        self.paint();
    }

    /// The session's agent ID.
    pub fn agent_id(&self) -> String {
        self.0.state.borrow().agent.clone()
    }

    /// The agent's name from the catalog, once it arrived.
    pub fn agent_name(&self, id: &str) -> Option<String> {
        let state = self.0.state.borrow();
        state.catalog.agents.iter().find(|agent| agent.id == id).map(|agent| agent.name.clone())
    }

    /// The color of the session's agent (`agentColor`).
    pub fn agent_color(&self) -> Color {
        self.0.agent_color()
    }

    /// `state.phase === "running"`.
    pub fn set_running(&self, running: bool) {
        let was = std::mem::replace(&mut self.0.state.borrow_mut().running, running);
        if was && !running {
            self.focus();
        }
    }

    /// Opens the session: reads the catalogs, the prompt history, and the inbox.
    pub fn open(&self, client: &Client, session: &str, directory: &str, resume: bool) {
        *self.0.target.borrow_mut() =
            Some(Target { client: client.clone(), session: session.to_owned(), directory: directory.to_owned() });
        {
            let mut state = self.0.state.borrow_mut();
            state.queued.clear();
            if !resume {
                state.history = History::default();
            }
        }
        let weak = Rc::downgrade(&self.0);
        let (client, directory) = (client.clone(), directory.to_owned());
        self.0.app.spawn(async move { api::catalog(&client, &directory).await }, move |_, catalog| {
            if let Some(inner) = weak.upgrade() {
                inner.state.borrow_mut().catalog = catalog;
                inner.paint();
                inner.refresh();
            }
        });
        let Some(target) = self.0.target.borrow().clone() else {
            return;
        };
        let weak = Rc::downgrade(&self.0);
        let client = target.client.clone();
        let session = target.session.clone();
        self.0.app.spawn(async move { inbox(&client, &session).await }, move |_, queued| {
            if let Some(inner) = weak.upgrade() {
                inner.state.borrow_mut().queued = queued;
            }
        });
        if !resume {
            return;
        }
        let weak = Rc::downgrade(&self.0);
        self.0.app.spawn(async move { api::history(&target.client, &target.session).await }, move |_, history| {
            if let Some(inner) = weak.upgrade() {
                let mut state = inner.state.borrow_mut();
                state.history = History::new(&history);
                state.first = history.is_empty();
                drop(state);
                inner.paint();
            }
        });
    }

    /// An inbox event of the session (`syncPending`): the queued and steering prompts.
    pub fn inbox_event(&self, event: &V2Event) {
        let mut state = self.0.state.borrow_mut();
        match event {
            V2Event::SessionInboxEnqueued(enqueued) => {
                let SessionInboxItem::User(item) = &enqueued.data.item else { return };
                let id = enqueued.data.inbox_id.as_str();
                if !state.queued.iter().any(|queued| queued.id == id) {
                    state.queued.push(Queued {
                        id: id.to_owned(),
                        delivery: delivery(&item.delivery),
                        prompt: RunPrompt::from_message(&serde_json::to_value(&item.payload).unwrap_or_default()),
                    });
                }
            }
            V2Event::SessionInboxDeliveryChanged(changed) => {
                let id = changed.data.inbox_id.as_str();
                if let Some(queued) = state.queued.iter_mut().find(|queued| queued.id == id) {
                    queued.delivery = delivery(&changed.data.delivery);
                }
            }
            V2Event::SessionInboxDelivered(done) => {
                state.queued.retain(|queued| queued.id != done.data.inbox_id.as_str())
            }
            V2Event::SessionInboxCancelled(done) => {
                state.queued.retain(|queued| queued.id != done.data.inbox_id.as_str())
            }
            _ => {}
        }
    }

    /// A prompt this client admitted (`mergePending`).
    pub fn admitted(&self, id: &str, delivery: Delivery, prompt: &RunPrompt) {
        let mut state = self.0.state.borrow_mut();
        if !state.queued.iter().any(|queued| queued.id == id) {
            state.queued.push(Queued { id: id.to_owned(), delivery, prompt: prompt.copy() });
        }
    }

    /// The session's pending prompts, oldest first.
    pub fn queued(&self) -> Vec<Queued> {
        self.0.state.borrow().queued.clone()
    }

    /// `queuedPromptAction` for M.3's pending-prompts panel: moves the prompt to `delivery`, or cancels it with
    /// `None` (`queued_prompt.delete`). Calls `done` with whether it worked; a failure shows in the status row.
    pub fn queued_action(&self, id: &str, delivery: Option<Delivery>, done: impl FnOnce(bool) + 'static) {
        self.0.queued_action(id, delivery, None, Box::new(done));
    }

    /// `queued_prompt.undo`: cancels the pending prompt and appends it to the composer's draft.
    pub fn undo(&self, id: &str, done: impl FnOnce(bool) + 'static) {
        let inner = &self.0;
        let current = inner.current();
        if current.shell && !current.text.is_empty() {
            inner.status("leave shell mode before undoing a queued prompt");
            return done(false);
        }
        let weak = Rc::downgrade(inner);
        let id = id.to_owned();
        let queued =
            inner.state.borrow().queued.iter().find(|queued| queued.id == id).map(|queued| queued.prompt.clone());
        let Some(prompt) = queued else {
            return done(false);
        };
        inner.queued_action(
            &id,
            None,
            Some("undo"),
            Box::new(move |ok| {
                if let Some(inner) = weak.upgrade().filter(|_| ok) {
                    let next = inner.current().append(&prompt);
                    inner.restore(&next, None);
                }
                done(ok);
            }),
        );
    }

    /// Clears the draft (`requestExit`'s first press). False when there was nothing to clear.
    pub fn clear(&self) -> bool {
        self.0.clear_draft()
    }

    /// Whether the session has prompts, earlier or sent now (`state.shown`).
    pub fn shown(&self) -> bool {
        !self.0.state.borrow().history.items.is_empty()
    }

    /// The first prompt with text, for the exit banner's title (`splashTitle`).
    pub fn first_text(&self) -> Option<String> {
        let state = self.0.state.borrow();
        state.history.items.iter().find(|item| !item.text.trim().is_empty()).map(|item| item.text.clone())
    }

    /// A sent prompt joins the history (`push`).
    pub fn push_history(&self, prompt: &RunPrompt) {
        let mut state = self.0.state.borrow_mut();
        state.history = state.history.push(prompt);
    }

    /// The footer view around the prompt (`promptView`): `prompt` for the composer, else the name of the request
    /// or panel that replaces it. The prompt's keys follow it.
    pub fn set_view(&self, view: &'static str) {
        self.0.view.set(view);
        if view == "prompt" {
            self.focus();
        }
    }

    /// `submitText`: sends `text` as if typed, as the command menu does for `/new` and server commands.
    pub fn submit_text(&self, text: &str) {
        self.0.submit_prompt(RunPrompt::text(text.to_owned()), Delivery::Steer);
    }

    /// `openEditor`: composes the draft in the external editor.
    pub fn open_editor(&self) {
        self.0.open_editor(None);
    }

    /// The location's agents, once the catalog arrived.
    pub fn agents(&self) -> Vec<complete::Agent> {
        self.0.state.borrow().catalog.agents.clone()
    }

    fn paint(&self) {
        self.0.paint();
    }
}

impl Inner {
    fn hooks(&self) -> Rc<Hooks> {
        self.hooks.borrow().clone()
    }

    fn status(&self, text: &str) {
        if let Some(status) = &self.hooks().status {
            status(text);
        }
    }

    fn input_clear(&self) {
        if let Some(clear) = &self.hooks().input_clear {
            clear();
        }
    }

    fn agent_color(&self) -> Color {
        let theme = self.theme.borrow();
        let state = self.state.borrow();
        let colors = &theme.footer.categorical;
        let index = state
            .catalog
            .agents
            .iter()
            .filter(|agent| !agent.hidden)
            .position(|agent| agent.id == state.agent)
            .unwrap_or(0);
        colors.get(index % colors.len().max(1)).copied().unwrap_or(theme.footer.border)
    }

    /// The placeholder and the rail's color.
    fn paint(&self) {
        let (shell, first) = {
            let state = self.state.borrow();
            (state.shell, state.first)
        };
        let placeholder = if shell {
            "Run a command… \"git status\""
        } else if !first {
            ""
        } else if self.mono {
            "Ask anything, / for commands, @ for context..."
        } else {
            "Ask anything, / for commands, @ for context…"
        };
        self.textarea.placeholder(placeholder);
        let rail = if shell { self.theme.borrow().footer.formfield_focused_text } else { self.agent_color() };
        self.rail.border_color(rail);
    }

    fn edit(&self, edit: impl FnOnce()) {
        let quiet = self.quiet.replace(true);
        edit();
        self.quiet.set(quiet);
    }

    fn cursor(&self) -> u32 {
        self.textarea.cursor_offset()
    }

    fn range(&self, start: u32, end: u32) -> String {
        self.textarea.buffer().range(start, end).unwrap_or_default()
    }

    /// The width the menu and the file paths have (`width` memo).
    fn width(&self) -> usize {
        let width = self.state.borrow().terminal.0;
        usize::from(width.saturating_sub(if width < menu::COMPACT_WIDTH { 2 } else { 4 }))
    }

    /// The options for the open trigger.
    fn options(&self) -> Vec<Choice> {
        let state = self.state.borrow();
        let Some(mode) = state.mode else {
            return Vec::new();
        };
        let directory = self.target.borrow().as_ref().map(|target| target.directory.clone()).unwrap_or_default();
        let files = if mode == Mode::Mention {
            complete::files(&state.files, parse::file_line_range(&state.query).1, &directory, self.width())
        } else {
            Vec::new()
        };
        complete::filter(mode == Mode::Slash, &state.query, &state.catalog, files)
    }

    /// The textarea's lines, the layout, and the menu (`syncRows`), then tells the footer.
    fn measure(&self) {
        let terminal = self.state.borrow().terminal;
        let width = u32::from(terminal.0.saturating_sub(4)).max(1);
        let lines = self
            .textarea
            .view()
            // `measure` rejects `u32::MAX` rows.
            .measure(width, 1000)
            .map_or(1, |(rows, _)| rows)
            .max(1);
        let options = self.options();
        let (visible, uris) = {
            let state = self.state.borrow();
            let uris = if self.image_preview && !self.mono && !state.shell {
                images::images(&state.parts)
            } else {
                Vec::new()
            };
            (state.mode.is_some(), uris)
        };
        let count = if visible { options.len().max(1) as u16 } else { 0 };
        let next =
            layout(terminal.1, lines.min(u32::from(u16::MAX)) as u16, count, u16::from(!visible), !uris.is_empty());
        let selection = {
            let mut state = self.state.borrow_mut();
            state.layout = next;
            state.selection = state.selection.reconcile(options.len(), usize::from(next.menu.max(1)));
            state.selection
        };
        self.textarea.height(u32::from(next.rows - next.menu - next.images));
        self.previews.show(&uris, next.images, self.theme.borrow().footer.muted);
        self.body.padding_y(u32::from(next.padding));
        if visible {
            let items: Vec<menu::Item> = options.iter().map(Choice::item).collect();
            self.menu.show(
                &items,
                selection,
                usize::from(next.menu),
                terminal.0,
                &self.theme.borrow().footer,
                self.mono,
            );
        } else {
            self.menu.hide();
        }
    }

    /// Re-measures and asks the footer to resize.
    fn rows(&self) {
        self.measure();
        if let Some(layout) = &self.hooks().layout {
            layout();
        }
    }

    /// Closes the menu. The file results go too: a mention opened with an empty query shows none until a query
    /// is typed (the resource only refetches when its query changes).
    fn hide(&self) {
        let mut state = self.state.borrow_mut();
        state.mode = None;
        state.query.clear();
        state.selection = Selection::default();
        state.files.clear();
        state.search += 1;
    }

    fn set_shell(&self, shell: bool) {
        self.state.borrow_mut().shell = shell;
        self.paint();
        self.rows();
    }

    /// `syncParts`: marks' ranges into their parts; a part whose mark or text went is dropped.
    fn sync_parts(&self) {
        let (parts, marks) = {
            let state = self.state.borrow();
            (state.parts.clone(), state.marks.clone())
        };
        let mut next: Vec<Option<Part>> = parts
            .iter()
            .map(|part| match part {
                Part::File(file) if file.mention.is_none() => Some(part.clone()),
                _ => None,
            })
            .collect();
        let mut tracked = 0;
        let mut current = self.textarea.extmarks();
        current.sort_by_key(|mark| mark.id);
        for mark in current {
            let Some(&(_, index)) = marks.iter().find(|(id, _)| *id == mark.id) else {
                continue;
            };
            let Some(part) = parts.get(index) else {
                continue;
            };
            let text = self.range(mark.start, mark.end);
            if part.mention().map(|mention| mention.text.as_str()) != Some(text.as_str()) {
                continue;
            }
            let mut copy = part.clone();
            copy.set_mention(Mention { start: mark.start, end: mark.end, text });
            tracked += 1;
            next[index] = Some(copy);
        }
        let retained: Vec<Part> = next.into_iter().flatten().collect();
        let stale = tracked != marks.len() || retained.len() != parts.len();
        if stale {
            self.restore_parts(retained);
            return;
        }
        self.state.borrow_mut().parts = retained;
    }

    /// `restoreParts`: marks for every part with a mention.
    fn restore_parts(&self, parts: Vec<Part>) {
        self.textarea.clear_extmarks();
        let marks = parts
            .iter()
            .enumerate()
            .filter_map(|(index, part)| {
                let mention = part.mention()?;
                let id = self.textarea.add_extmark(mention.start..mention.end, ExtmarkOptions::default().atomic());
                Some((id, index))
            })
            .collect();
        let mut state = self.state.borrow_mut();
        state.parts = parts;
        state.marks = marks;
    }

    /// The draft (`syncDraft` then `promptCopy(draft)`).
    fn current(&self) -> RunPrompt {
        self.sync_parts();
        let text = self.textarea.text();
        let state = self.state.borrow();
        let command = if state.shell { None } else { selected_command(&text, state.command.as_ref()) };
        RunPrompt { text, parts: state.parts.clone(), shell: state.shell, command, ..RunPrompt::default() }
    }

    /// `restore`: shows `prompt` with its marks, the cursor at `cursor` (the end by default).
    fn restore(&self, prompt: &RunPrompt, cursor: Option<u32>) {
        {
            let mut state = self.state.borrow_mut();
            state.shell = prompt.shell;
            state.command = prompt.command.clone();
        }
        self.hide();
        self.edit(|| {
            self.textarea.set_text(&prompt.text);
        });
        self.restore_parts(prompt.parts.clone());
        let end = measure(&prompt.text);
        self.textarea.set_cursor_offset(cursor.unwrap_or(end).min(end));
        self.paint();
        self.rows();
        self.textarea.focus();
    }

    /// `resetDraft`: an empty composer, in the same mode.
    fn reset(&self) {
        self.edit(|| {
            self.textarea.set_text("");
        });
        self.textarea.clear_extmarks();
        {
            let mut state = self.state.borrow_mut();
            state.parts.clear();
            state.marks.clear();
            state.command = None;
        }
        self.hide();
        self.rows();
        self.textarea.focus();
    }

    fn clear_draft(&self) -> bool {
        let has = !self.textarea.text().is_empty()
            || self.state.borrow().parts.iter().any(|part| matches!(part, Part::File(_)));
        if has {
            self.input_clear();
            self.reset();
        }
        has
    }

    /// `requestExit`: clears a draft, else asks the footer to exit.
    fn request_exit(&self) {
        if self.clear_draft() {
            return;
        }
        if let Some(exit) = &self.hooks().exit_request {
            exit();
        }
    }

    /// `refresh`: opens, follows, or closes the trigger under the cursor.
    fn refresh(self: &Rc<Self>) {
        let cursor = self.cursor();
        let before = self.range(0, cursor);
        let slash = parse::slash_trigger(&before);
        let (mode, at) = {
            let state = self.state.borrow();
            (state.mode, state.at)
        };
        if mode == Some(Mode::Slash) {
            match slash {
                None => self.hide(),
                Some(at) => {
                    let query = self.range(at + 1, cursor);
                    let mut state = self.state.borrow_mut();
                    state.at = at;
                    if state.query != query {
                        state.query = query;
                        state.selection = Selection::default();
                    }
                }
            }
            return;
        }
        if let Some(at) = slash {
            let query = self.range(at + 1, cursor);
            let mut state = self.state.borrow_mut();
            state.at = at;
            state.mode = Some(Mode::Slash);
            state.query = query;
            state.selection = Selection::default();
            return;
        }
        if mode == Some(Mode::Mention) {
            let text = self.range(at, cursor);
            if cursor <= at || text.contains(char::is_whitespace) {
                self.hide();
                return;
            }
            self.set_query(self.range(at + 1, cursor));
            return;
        }
        if cursor == 0 {
            return;
        }
        if let Some(at) = parse::mention_trigger(&before) {
            {
                let mut state = self.state.borrow_mut();
                state.at = at;
                state.mode = Some(Mode::Mention);
                state.selection = Selection::default();
                state.query.clear();
            }
            self.set_query(self.range(at + 1, cursor));
        }
    }

    /// A new mention query: resets the selection and searches files once the current input settles.
    fn set_query(self: &Rc<Self>, query: String) {
        let search = {
            let mut state = self.state.borrow_mut();
            if state.query == query {
                return;
            }
            state.query = query;
            state.selection = Selection::default();
            state.search += 1;
            if state.query.is_empty() {
                state.files.clear();
                return;
            }
            state.search
        };
        // Keys that arrive together search once, for the last query (`createResource` on the settled query).
        let weak = Rc::downgrade(self);
        self.app.set_timeout(Duration::ZERO, move |_| {
            if let Some(inner) = weak.upgrade() {
                inner.search(search);
            }
        });
    }

    fn search(self: &Rc<Self>, search: u64) {
        let query = {
            let state = self.state.borrow();
            if state.search != search || state.mode != Some(Mode::Mention) {
                return;
            }
            state.query.clone()
        };
        let Some(target) = self.target.borrow().clone() else {
            return;
        };
        let base = parse::file_line_range(&query).0.to_owned();
        let weak = Rc::downgrade(self);
        self.app.spawn(
            async move { api::find_files(&target.client, &target.directory, &base).await },
            move |_, files| {
                let Some(inner) = weak.upgrade() else { return };
                {
                    let mut state = inner.state.borrow_mut();
                    if state.search != search {
                        return;
                    }
                    state.files = files;
                }
                inner.rows();
            },
        );
    }

    /// `onContentChange`.
    fn changed(self: &Rc<Self>) {
        if self.quiet.get() {
            return;
        }
        self.input_clear();
        self.sync_parts();
        self.refresh();
        self.rows();
    }

    /// `cancelAutocomplete`: removes the typed trigger and hides the menu.
    fn cancel(&self) {
        let (at, cursor) = (self.state.borrow().at, self.cursor());
        self.edit(|| replace(&self.textarea, at, cursor, ""));
        self.textarea.set_cursor_offset(at);
        self.hide();
        self.sync_parts();
        self.rows();
    }

    fn move_selection(&self, down: bool) {
        let count = self.options().len();
        {
            let mut state = self.state.borrow_mut();
            let limit = usize::from(state.layout.menu.max(1));
            state.selection = state.selection.step(count, limit, down);
        }
        self.rows();
    }

    /// `select`: runs a slash pick, or inserts a mention.
    fn select(self: &Rc<Self>, delivery: Delivery) {
        let options = self.options();
        let selected = self.state.borrow().selection.selected;
        let Some(choice) = options.get(selected).cloned() else {
            return;
        };
        let shell = self.state.borrow().shell;
        match choice {
            Choice::Slash { action: Some(Action::Editor), .. } => {
                let text = self.textarea.text();
                let value = match parse::slash_head(&text) {
                    Some((name, arguments, _)) if name.eq_ignore_ascii_case("editor") => arguments.to_owned(),
                    _ => text,
                };
                self.open_editor(Some(value));
            }
            Choice::Slash { action: Some(Action::Settings), .. } if !shell => {
                self.cancel();
                if let Some(settings) = &self.hooks().settings {
                    settings();
                }
            }
            Choice::Slash { name, .. } => {
                let text = self.textarea.text();
                let cursor = self.cursor();
                let head = parse::slash_head(&text);
                let local = !shell && (name == "new" || is_exit(&format!("/{name}")));
                let spaced = head.is_some_and(|(_, _, end)| text[end..].starts_with(char::is_whitespace));
                let separator = if !shell && !local && spaced { "" } else { " " };
                let inserted = format!("/{name}{separator}");
                let end = match head {
                    Some(_) if shell => cursor,
                    None => cursor,
                    Some(_) if local => measure(&text),
                    Some((_, _, end)) => measure(&text[..end]),
                };
                self.edit(|| replace(&self.textarea, 0, end, &inserted));
                self.textarea.set_cursor_offset(measure(&inserted));
                self.hide();
                if !shell {
                    let prompt = self.current();
                    self.submit_prompt(prompt, delivery);
                    return;
                }
                self.rows();
            }
            Choice::Mention { value, part, .. } => {
                let (at, cursor) = (self.state.borrow().at, self.cursor());
                let next = self.range(cursor, cursor + 1);
                let mention = format!("@{value}");
                let inserted = if next == " " { mention.clone() } else { format!("{mention} ") };
                self.edit(|| replace(&self.textarea, at, cursor, &inserted));
                let end = at + measure(&mention);
                let mut part = part;
                part.set_mention(Mention { start: at, end, text: mention });
                if let Part::File(file) = &part {
                    let previous = self
                        .state
                        .borrow()
                        .parts
                        .iter()
                        .position(|item| matches!(item, Part::File(other) if other.url == file.url));
                    if let Some(previous) = previous {
                        let mut state = self.state.borrow_mut();
                        if let Some(position) = state.marks.iter().position(|(_, index)| *index == previous) {
                            let (mark, _) = state.marks.remove(position);
                            self.textarea.remove_extmark(mark);
                        }
                        state.parts.remove(previous);
                        for (_, index) in &mut state.marks {
                            if *index > previous {
                                *index -= 1;
                            }
                        }
                    }
                }
                let mark = self.textarea.add_extmark(at..end, ExtmarkOptions::default().atomic());
                {
                    let mut state = self.state.borrow_mut();
                    let index = state.parts.len();
                    state.marks.push((mark, index));
                    state.parts.push(part);
                }
                self.hide();
                self.sync_parts();
                self.rows();
            }
        }
    }

    /// `expand`: Tab on a directory completes it and keeps listing.
    fn expand(self: &Rc<Self>) {
        let options = self.options();
        let selected = self.state.borrow().selection.selected;
        let Some(Choice::Mention { value, directory: true, .. }) = options.get(selected) else {
            return;
        };
        let (at, cursor) = (self.state.borrow().at, self.cursor());
        self.edit(|| replace(&self.textarea, at, cursor, &format!("@{value}")));
        self.sync_parts();
        self.refresh();
        self.rows();
    }

    /// `onSubmit`: waits for a paste in flight, then submits the draft.
    fn submit(self: &Rc<Self>, delivery: Delivery) {
        if self.state.borrow().pasting {
            return;
        }
        let prompt = self.current();
        self.submit_prompt(prompt, delivery);
    }

    /// `submitPrompt`.
    fn submit_prompt(self: &Rc<Self>, next: RunPrompt, delivery: Delivery) {
        if self.state.borrow().mode.is_some() {
            let slash = self.state.borrow().mode == Some(Mode::Slash);
            if !slash || !self.options().is_empty() {
                self.select(delivery);
                return;
            }
            self.hide();
            self.rows();
        }
        if self.state.borrow().submitting {
            return;
        }
        if !next.has_content() {
            let queued = (delivery == Delivery::Steer)
                .then(|| self.state.borrow().queued.iter().find(|queued| queued.delivery == Delivery::Queue).cloned())
                .flatten();
            if let Some(queued) = queued {
                self.steer(queued.id);
                return;
            }
            let running = self.state.borrow().running;
            self.status(if running { "waiting for current response" } else { "empty prompt ignored" });
            return;
        }
        let command = if next.shell { None } else { selected_command(&next.text, next.command.as_ref()) };
        let local = parts::is_new(&next.text)
            || parts::is_compact(&next.text)
            || is_exit(&next.text)
            || parts::is_settings(&next.text);
        if delivery == Delivery::Queue && (next.shell || local) {
            self.status("this prompt cannot be queued");
            return;
        }
        if command.is_none() && !next.shell && is_exit(&next.text) {
            if let Some(exit) = &self.hooks().exit {
                exit();
            }
            return;
        }
        if command.is_none() && !next.shell && parts::is_settings(&next.text) {
            self.reset();
            if let Some(settings) = &self.hooks().settings {
                settings();
            }
            return;
        }
        let skill = next.parts.iter().any(|part| matches!(part, Part::Skill { .. }));
        let command = if command.is_some() || skill || next.shell || parts::is_new(&next.text) {
            command
        } else {
            match parse_slash_command(&next.text, self.state.borrow().catalog.commands.as_deref()) {
                Slash::Pending => {
                    self.status("loading commands");
                    return;
                }
                Slash::None => None,
                Slash::Command(command) => Some(command),
            }
        };
        let submit = RunPrompt { command, delivery: Some(delivery), ..next.clone() };
        self.state.borrow_mut().submitting = true;
        self.reset();
        let accepted = self.hooks().submit.as_ref().is_some_and(|submit_hook| submit_hook(submit));
        self.state.borrow_mut().submitting = false;
        if !accepted {
            self.restore(&next, None);
            return;
        }
        {
            let mut state = self.state.borrow_mut();
            state.history = state.history.push(&next);
            state.first = false;
        }
        if next.shell {
            self.set_shell(false);
        }
        self.paint();
    }

    /// `onQueuedPromptSteer`: steers a queued prompt.
    fn steer(self: &Rc<Self>, id: String) {
        self.state.borrow_mut().submitting = true;
        let weak = Rc::downgrade(self);
        self.queued_action(
            &id,
            Some(Delivery::Steer),
            None,
            Box::new(move |_| {
                if let Some(inner) = weak.upgrade() {
                    inner.state.borrow_mut().submitting = false;
                }
            }),
        );
    }

    /// `queuedPromptAction`: one request per pending prompt at a time; a second one while it runs reports
    /// failure without a request (`createSingleFlight`).
    fn queued_action(
        self: &Rc<Self>,
        id: &str,
        delivery: Option<Delivery>,
        label: Option<&str>,
        done: Box<dyn FnOnce(bool)>,
    ) {
        let Some(target) = self.target.borrow().clone() else {
            return done(false);
        };
        if !self.state.borrow_mut().flights.insert(id.to_owned()) {
            return done(false);
        }
        let label = label
            .unwrap_or(match delivery {
                None => "delete",
                Some(delivery) => delivery.as_str(),
            })
            .to_owned();
        let weak = Rc::downgrade(self);
        let id = id.to_owned();
        self.app.spawn(
            {
                let id = id.clone();
                async move { api::queued_action(&target.client, &target.session, &id, delivery).await }
            },
            move |_, result| {
                let Some(inner) = weak.upgrade() else { return };
                inner.state.borrow_mut().flights.remove(&id);
                if let Err(error) = &result {
                    inner.status(&format!("failed to {label} pending prompt: {error}"));
                }
                done(result.is_ok());
            },
        );
    }

    /// `move`/`historyCommand`: Up and Down move by line, then to the start or end, then through history.
    fn history(&self, up: bool) -> bool {
        let text = self.textarea.text();
        let cursor = self.cursor();
        let step = {
            let state = self.state.borrow();
            state.history.step(up, &text, cursor)
        };
        if let Some((_, cursor)) = step.apply {
            if up && self.state.borrow().history.index.is_none() {
                let draft = self.current();
                self.state.borrow_mut().stash = draft;
            }
            let value = {
                let mut state = self.state.borrow_mut();
                state.history = step.state;
                match state.history.index {
                    None => state.stash.clone(),
                    Some(index) => state.history.items[index].clone(),
                }
            };
            self.restore(&value, Some(cursor));
            return true;
        }
        let end = measure(&text);
        let view = self.textarea.view();
        let row = view.viewport().map_or(0, |viewport| viewport.y)
            + view.position(EditorQuery::Cursor).map_or(0, |position| position.visual_row);
        if up {
            if cursor == 0 {
                return false;
            }
            if row == 0 {
                self.textarea.set_cursor_offset(0);
            } else {
                self.textarea.perform(EditorAction::MoveUp);
            }
            return true;
        }
        if cursor == end {
            return false;
        }
        let last = view.info(false).map_or(0, |info| info.total_virtual_line_count.saturating_sub(1));
        if row >= last {
            self.textarea.set_cursor_offset(end);
        } else {
            self.textarea.perform(EditorAction::MoveDown);
        }
        true
    }

    /// `openEditor`: composes the draft in `$VISUAL` or `$EDITOR`.
    fn open_editor(self: &Rc<Self>, value: Option<String>) {
        self.input_clear();
        let current = self.current();
        self.hide();
        self.rows();
        let value = value.unwrap_or_else(|| current.text.clone());
        let directory =
            self.target.borrow().as_ref().map(|target| target.directory.clone()).unwrap_or_else(|| ".".to_owned());
        let command =
            ["VISUAL", "EDITOR"].iter().find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()));
        let weak = Rc::downgrade(self);
        let task = move |_: &mut Cx<'_>| {
            let Some(inner) = weak.upgrade() else { return };
            let result = command
                .ok_or_else(|| "Set $VISUAL or $EDITOR to open an external editor".to_owned())
                .and_then(|command| {
                    opencode_ui::prompt_input::editor::edit(&command, &value, std::path::Path::new(&directory))
                });
            match result {
                Ok(None) => {}
                Ok(Some(content)) => {
                    let text = normalize(&content);
                    let mentions: Vec<Option<Mention>> =
                        current.parts.iter().map(|part| part.mention().cloned()).collect();
                    let aligned = realign_mentions(&text, &mentions);
                    let parts = current
                        .parts
                        .iter()
                        .zip(aligned)
                        .filter_map(|(part, aligned)| match (part.mention(), aligned) {
                            (None, _) => Some(part.clone()),
                            (Some(_), None) => None,
                            (Some(_), Some(mention)) => {
                                let mut part = part.clone();
                                part.set_mention(mention);
                                Some(part)
                            }
                        })
                        .collect();
                    inner.restore(&RunPrompt { text, parts, ..current }, None);
                }
                Err(_) => {
                    inner.restore(&current, None);
                    inner.status("failed to open editor");
                }
            }
            inner.app.request_redraw();
        };
        self.app.release_terminal(task);
    }

    /// `paste`: a terminal paste (`Some`), or the clipboard (`None`).
    fn paste(self: &Rc<Self>, text: Option<String>) {
        let weak = Rc::downgrade(self);
        let Some(text) = text else {
            self.state.borrow_mut().pasting = true;
            self.app.read_clipboard_as(&["image/png", "text/plain"], move |_, outcome: ClipboardOutcome| {
                let Some(inner) = weak.upgrade() else { return };
                match content(outcome) {
                    Err(error) => {
                        inner.state.borrow_mut().pasting = false;
                        inner.status(&error);
                    }
                    Ok(None) => inner.state.borrow_mut().pasting = false,
                    Ok(Some(Content::Image { mime, data })) => {
                        inner.state.borrow_mut().pasting = false;
                        if inner.state.borrow().shell {
                            inner.status("image attachments are unavailable in shell mode");
                            return;
                        }
                        inner.attachment(&format!("data:{mime};base64,{data}"), Some("clipboard"));
                        inner.pasted();
                    }
                    Ok(Some(Content::Text(text))) => inner.paste_text(text),
                }
            });
            return;
        };
        self.state.borrow_mut().pasting = true;
        self.paste_text(text);
    }

    fn paste_text(self: &Rc<Self>, text: String) {
        let normalized = strip_ansi(&text).replace("\r\n", "\n").replace('\r', "\n");
        let windows = cfg!(windows);
        if self.state.borrow().shell || !attach::may_attach(normalized.trim(), windows) {
            self.state.borrow_mut().pasting = false;
            self.textarea.insert(&normalized);
            self.pasted();
            return;
        }
        let weak = Rc::downgrade(self);
        let input = normalized.clone();
        let before = self.textarea.text();
        self.app.spawn(
            async move { tokio::task::spawn_blocking(move || attach::resolve(&input, windows)).await.ok().flatten() },
            move |_, resolved| {
                let Some(inner) = weak.upgrade() else { return };
                inner.state.borrow_mut().pasting = false;
                if inner.textarea.text() != before {
                    return;
                }
                match resolved {
                    None => {
                        inner.textarea.insert(&normalized);
                    }
                    Some(files) => {
                        for file in files {
                            match file {
                                attach::Resolved::Text { content, .. } => {
                                    inner.textarea.insert(&content);
                                }
                                attach::Resolved::File { uri, filename, .. } => {
                                    inner.attachment(&uri, Some(&filename));
                                }
                            }
                        }
                    }
                }
                inner.pasted();
            },
        );
    }

    /// `pasteAttachment`: `[Image N]` or `[PDF N]` at the cursor, marked as a file part.
    fn attachment(&self, uri: &str, filename: Option<&str>) {
        self.sync_parts();
        let files: Vec<Value> = self
            .state
            .borrow()
            .parts
            .iter()
            .filter_map(|part| match part {
                Part::File(file) => Some(json!({
                    "uri": file.url,
                    "name": file.filename,
                    "description": file.description,
                    "mention": file.mention.as_ref().map(|mention| json!({ "text": mention.text })),
                })),
                _ => None,
            })
            .collect();
        let label = match attach::label(&files, uri, filename) {
            Ok(label) => label,
            Err(error) => {
                self.status(&error);
                return;
            }
        };
        self.edit(|| {
            self.textarea.insert(format!("{label} "));
        });
        let end = self.cursor().saturating_sub(1);
        let start = end.saturating_sub(measure(&label));
        let mark = self.textarea.add_extmark(start..end, ExtmarkOptions::default().atomic());
        let mime = uri.strip_prefix("data:").and_then(|rest| rest.split(';').next()).map(str::to_owned);
        let mut state = self.state.borrow_mut();
        let index = state.parts.len();
        state.marks.push((mark, index));
        state.parts.push(Part::File(File {
            url: uri.to_owned(),
            mime,
            filename: filename.map(str::to_owned),
            description: None,
            mention: Some(Mention { start, end, text: label }),
        }));
    }

    fn pasted(&self) {
        self.hide();
        self.sync_parts();
        self.rows();
    }
}

/// The text change, submit, and paste handlers.
fn connect(inner: &Rc<Inner>) {
    let weak = Rc::downgrade(inner);
    inner.textarea.on_change(move |_, _| {
        if let Some(inner) = weak.upgrade() {
            inner.changed();
        }
    });
    let weak = Rc::downgrade(inner);
    inner.textarea.on_submit(move |_, _| {
        if let Some(inner) = weak.upgrade() {
            inner.submit(Delivery::Steer);
        }
    });
    let weak = Rc::downgrade(inner);
    inner.textarea.on_paste(move |cx, text| {
        let Some(inner) = weak.upgrade() else { return };
        cx.prevent_default();
        cx.stop_propagation();
        inner.paste((!text.is_empty()).then(|| text.to_owned()));
    });
}

/// The footer's keymap with `cli.json`'s keybinds; the managed textarea layer edits the prompt.
fn keymap(app: &App, config: &Info, textarea: &Textarea) -> DialogKeymap {
    let overrides = config.keybinds.clone().unwrap_or_default().0;
    let keybinds = Keybinds::resolve(&overrides, !cfg!(windows)).unwrap_or_else(|error| {
        log::warn!("invalid keybinds config: {error}");
        Keybinds::defaults()
    });
    let leader_timeout = Duration::from_millis(
        config.leader.as_ref().and_then(|leader| leader.timeout).map_or(2000, |timeout| timeout.0),
    );
    let focused = {
        let (app, textarea) = (app.clone(), textarea.clone());
        Condition::when(move || app.focused().is_some_and(|widget| widget.id() == textarea.id()))
    };
    let run = {
        let textarea = textarea.clone();
        Rc::new(move |action| {
            textarea.perform(action);
            true
        })
    };
    DialogKeymap::new(
        keybinds,
        opencode_ui::keymap::Options { leader_timeout, textarea_enabled: focused, textarea_run: run },
    )
}

/// The prompt's layers (`footer.prompt.tsx:1162-1344`, `footer.view.tsx:549-558`). The newest layer runs first,
/// as in TS, where the later `createLayer` wins.
fn install_layers(inner: &Rc<Inner>) {
    // `input.prompt()`: the composer shows.
    let when = |check: fn(&Inner) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || weak.upgrade().is_some_and(|inner| inner.view.get() == "prompt" && check(&inner)))
    };
    // `baseBindingsEnabled`: everywhere but the panels.
    let base = {
        let weak = Rc::downgrade(inner);
        Condition::when(move || {
            weak.upgrade().is_some_and(|inner| {
                !matches!(
                    inner.view.get(),
                    "command" | "skill" | "model" | "variant" | "settings" | "queued-menu" | "subagent-menu"
                )
            })
        })
    };
    let run = |action: fn(&Rc<Inner>) -> bool| {
        let weak = Rc::downgrade(inner);
        move |_: Option<&str>, _: Option<&KeyEvent>| weak.upgrade().is_some_and(|inner| action(&inner))
    };
    let command = |id: &str, title: &str, group: &str, action: fn(&Rc<Inner>) -> bool| {
        TuiCommand::new(id, run(action)).title(title).group(group)
    };
    let inline = |key: &str, title: &str, action: fn(&Rc<Inner>) -> bool| {
        TuiCommand::inline(key, run(action)).title(title).group("Prompt")
    };
    let layers = vec![
        KeymapLayer::new(vec![command("app.clear", "Clear screen", "System", |inner| {
            if let Some(clear) = &inner.hooks().clear_screen {
                clear();
            }
            true
        })]),
        KeymapLayer::new(vec![command("prompt.clear", "Clear prompt or exit", "Prompt", |inner| {
            inner.request_exit();
            true
        })])
        .enabled(base),
        KeymapLayer::new(vec![
            command("prompt.paste", "Paste", "Prompt", |inner| {
                inner.paste(None);
                true
            }),
            command("session.interrupt", "Interrupt session", "Session", |inner| {
                if inner.hooks().interrupt.as_ref().is_some_and(|interrupt| interrupt()) {
                    return true;
                }
                // `onKeyDown`: Escape while idle disarms the two-press gestures.
                if !inner.state.borrow().running {
                    inner.input_clear();
                }
                false
            }),
        ])
        .enabled(when(|_| true)),
        KeymapLayer::new(vec![
            command("prompt.queue", "Queue prompt", "Prompt", |inner| {
                inner.submit(Delivery::Queue);
                true
            })
            .palette(),
        ])
        .enabled(when(|inner| inner.state.borrow().mode != Some(Mode::Mention)))
        .priority(1),
        KeymapLayer::new(vec![command("prompt.editor", "Open editor", "Prompt", |inner| {
            inner.open_editor(None);
            true
        })])
        .enabled(when(|inner| !visible(inner)))
        .priority(1),
        KeymapLayer::new(vec![
            command("prompt.history.previous", "Previous prompt history", "Prompt", |inner| inner.history(true)),
            command("prompt.history.next", "Next prompt history", "Prompt", |inner| inner.history(false)),
        ])
        .enabled(when(|inner| !visible(inner)))
        .priority(1),
        KeymapLayer::new(vec![inline("!", "Shell mode", |inner| {
            if inner.state.borrow().shell || inner.cursor() != 0 {
                return false;
            }
            inner.set_shell(true);
            true
        })])
        .enabled(when(|inner| !visible(inner))),
        KeymapLayer::new(vec![
            inline("escape", "Exit shell mode", |inner| {
                inner.set_shell(false);
                true
            }),
            inline("backspace", "Exit shell mode", |inner| {
                if inner.cursor() != 0 {
                    return false;
                }
                inner.set_shell(false);
                true
            }),
        ])
        .enabled(when(|inner| inner.state.borrow().shell && !visible(inner))),
        KeymapLayer::new(vec![
            command("prompt.autocomplete.prev", "Previous autocomplete item", "Autocomplete", |inner| {
                inner.move_selection(false);
                true
            }),
            command("prompt.autocomplete.next", "Next autocomplete item", "Autocomplete", |inner| {
                inner.move_selection(true);
                true
            }),
            command("prompt.autocomplete.hide", "Hide autocomplete", "Autocomplete", |inner| {
                inner.cancel();
                true
            }),
            command("prompt.autocomplete.select", "Select autocomplete item", "Autocomplete", |inner| {
                if inner.state.borrow().mode == Some(Mode::Slash) && inner.options().is_empty() {
                    inner.hide();
                    inner.rows();
                    return true;
                }
                inner.select(Delivery::Steer);
                true
            }),
            command("prompt.autocomplete.complete", "Complete autocomplete item", "Autocomplete", |inner| {
                let options = inner.options();
                if inner.state.borrow().mode == Some(Mode::Slash) && options.is_empty() {
                    inner.hide();
                    inner.rows();
                    return true;
                }
                let selected = inner.state.borrow().selection.selected;
                if matches!(options.get(selected), Some(Choice::Mention { directory: true, .. })) {
                    inner.expand();
                    return true;
                }
                inner.select(Delivery::Steer);
                true
            }),
        ])
        .enabled(when(visible)),
    ];
    for layer in layers {
        match inner.keymap.layer(layer) {
            Ok(disposer) => inner.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("mini prompt keymap layer: {error}"),
        }
    }
}

fn visible(inner: &Inner) -> bool {
    inner.state.borrow().mode.is_some()
}

/// `selectedCommand`: a restored prompt's command while its text still names it.
fn selected_command(text: &str, command: Option<&Command>) -> Option<Command> {
    let command = command?;
    let (name, arguments, _) = parse::slash_head(text)?;
    (name == command.name).then(|| Command {
        name: command.name.clone(),
        arguments: arguments.to_owned(),
        source: command.source.clone(),
    })
}

enum Slash {
    None,
    Pending,
    Command(Command),
}

/// `parseSlashCommand`: `/name args` for a server command.
fn parse_slash_command(text: &str, commands: Option<&[complete::Command]>) -> Slash {
    let Some((name, arguments, _)) = parse::slash_head(text).filter(|(name, _, _)| !name.is_empty()) else {
        return Slash::None;
    };
    let Some(commands) = commands else {
        return Slash::Pending;
    };
    match commands.iter().find(|command| command.name == name) {
        Some(command) => Slash::Command(Command {
            name: name.to_owned(),
            arguments: arguments.to_owned(),
            source: command.source.clone(),
        }),
        None => Slash::None,
    }
}

fn delivery(value: &SessionInboxDelivery) -> Delivery {
    match value {
        SessionInboxDelivery::Queue => Delivery::Queue,
        _ => Delivery::Steer,
    }
}

/// `session.inbox.list`: the session's pending user prompts.
async fn inbox(client: &Client, session: &str) -> Vec<Queued> {
    let input = opencode_api::generated::SessionInboxListInput { session_id: session.into() };
    let Ok(call) = Client::session_inbox_list_call(&input) else {
        return Vec::new();
    };
    client
        .json::<Value>(call)
        .await
        .map(|value| {
            value["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|item| item["type"] == "user")
                .map(|item| Queued {
                    id: item["id"].as_str().unwrap_or_default().to_owned(),
                    delivery: delivery(&item["delivery"].as_str().unwrap_or_default().into()),
                    prompt: RunPrompt::from_message(&item["payload"]),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_follows_footer_prompt_layout() {
        // 20 rows: padded, one row, no menu.
        assert_eq!(layout(20, 1, 0, 1, false), Layout { padding: 1, textarea: 6, menu: 0, images: 0, rows: 1 });
        // Nine slash options in 20 rows: eight menu rows.
        assert_eq!(layout(20, 1, 9, 0, false).menu, 8);
        assert_eq!(layout(20, 1, 9, 0, false).rows, 9);
        // Ten lines grow to six.
        assert_eq!(layout(20, 10, 0, 1, false).rows, 6);
        // A short terminal: no padding, the menu takes what is left.
        let short = layout(8, 2, 9, 0, false);
        assert_eq!((short.padding, short.rows, short.menu), (0, 7, 5));
        // Previews take four rows when they fit.
        assert_eq!(layout(30, 1, 0, 1, true).images, 4);
        assert_eq!(layout(5, 1, 0, 1, true).images, 0);
    }

    #[test]
    fn slash_commands_parse_against_the_catalog() {
        let commands = [complete::Command { name: "review".into(), description: None, source: None }];
        assert!(
            matches!(parse_slash_command("/review src", Some(&commands)), Slash::Command(command) if command.arguments == "src")
        );
        assert!(matches!(parse_slash_command("/nope", Some(&commands)), Slash::None));
        assert!(matches!(parse_slash_command("/review", None), Slash::Pending));
        assert!(matches!(parse_slash_command("plain", None), Slash::None));
        let restored = Command { name: "review".into(), arguments: String::new(), source: Some("command".into()) };
        assert_eq!(
            selected_command("/review now", Some(&restored)).map(|command| command.arguments),
            Some("now".into())
        );
        assert_eq!(selected_command("/other", Some(&restored)), None);
    }
}
