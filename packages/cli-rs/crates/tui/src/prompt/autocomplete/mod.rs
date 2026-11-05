//! Prompt autocomplete (E.3, rows P05, P11, K04; `component/prompt/autocomplete.tsx`).
//!
//! `/` at the start of the prompt lists slash commands: the keymap's and the server's. `@` at a word
//! start lists skills, references, subagents, and files from `/api/fs/find`. The argument of `/cd`
//! lists directories from `/api/fs/list`, with recent directories first. A pick becomes a prompt part
//! ([`parts`]); a command without arguments runs.
//!
//! While the popup shows, the keymap is in the `autocomplete` mode, so the prompt's own layers
//! (submit, history, shell mode) are off and this module's layer takes the keys.

pub mod cd;
pub use opencode_ui::prompt_input::parse;
pub mod parts;

use std::cell::{Cell, OnceCell, RefCell};
use std::cmp::Ordering;
use std::rc::{Rc, Weak};
use std::sync::{Arc, Mutex};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    AgentInfoMode, FileFindInput, FileListInput, FileSystemEntryType, LocationQueryInput,
    ReferenceSource,
};
use opencode_local::jsonl::{self, Frecency};
use opencode_local::storage::Storage;
use opencode_store::location::{Catalog, Location};
use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
use opencode_ui::select::{fuzzy, move_wrap, truncate, truncate_middle};
use opentui::input::{MouseButton, MouseEventKind};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde_json::{Value, json};
use unicode_width::UnicodeWidthStr;

use self::parse::{DirectorySearch, measure};
use self::parts::Kind;
use crate::app::Tui;
use crate::prompt::editor::Inner;

/// The most rows the popup shows, and the most fuzzy matches it keeps.
const ROWS: usize = 10;
/// The keymap mode the popup pushes while it shows.
const MODE: &str = "autocomplete";
const RECENTS_KEY: &str = "directory-recents";

/// What the popup lists (`AutocompleteRef["visible"]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Reference,
    Command,
    Directory,
}

/// State every prompt shares: `frecency.jsonl` and directory recents.
#[derive(Clone, Default)]
pub struct Shared {
    frecency: Arc<Mutex<Option<Frecency>>>,
    recents: Arc<Mutex<Option<Value>>>,
    loaded: Rc<Cell<bool>>,
}

impl Shared {
    /// Loads both files on a blocking thread, once.
    fn load(&self, tui: &Tui) {
        if self.loaded.replace(true) {
            return;
        }
        let Some(state) = tui.state_dir() else {
            return;
        };
        let (frecency, recents, storage) =
            (self.frecency.clone(), self.recents.clone(), tui.storage());
        // `paths.cwd`: the directory the TUI started in.
        let cwd = std::path::PathBuf::from(&tui.directory);
        tui.app.runtime().spawn_blocking(move || {
            if let Ok(mut slot) = frecency.lock() {
                slot.get_or_insert_with(|| Frecency::load(&state, &cwd));
            }
            let stored =
                storage.and_then(|storage| storage.load(RECENTS_KEY, &recents_initial()).ok());
            if let Ok(mut slot) = recents.lock() {
                *slot = stored;
            }
        });
    }

    /// `getFrecency(path)`.
    fn score(&self, path: &str) -> f64 {
        self.frecency
            .lock()
            .ok()
            .and_then(|slot| {
                slot.as_ref()
                    .map(|frecency| frecency.score(path, jsonl::now_ms()))
            })
            .unwrap_or(0.0)
    }

    /// `updateFrecency(path)`, written on a blocking thread. A pick can run before the load does, so
    /// whichever runs first loads the file.
    fn visit(&self, tui: &Tui, path: String) {
        let Some(state) = tui.state_dir() else {
            return;
        };
        let frecency = self.frecency.clone();
        let cwd = std::path::PathBuf::from(&tui.directory);
        tui.app.runtime().spawn_blocking(move || {
            if let Ok(mut slot) = frecency.lock() {
                slot.get_or_insert_with(|| Frecency::load(&state, &cwd))
                    .update(&path, jsonl::now_ms());
            }
        });
    }

    /// The recent directories of a project, newest first (`useDirectoryRecents().list`).
    pub fn recents(&self, project: &str) -> Vec<String> {
        let recents = self.recents.lock().ok().and_then(|slot| slot.clone());
        let mut items: Vec<(String, f64)> = recents
            .as_ref()
            .and_then(|recents| recents["projects"][project].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|item| {
                Some((
                    item["directory"].as_str()?.to_owned(),
                    item["usedAt"].as_f64().unwrap_or_default(),
                ))
            })
            .collect();
        items.sort_by(|a, b| b.1.total_cmp(&a.1));
        items.into_iter().map(|(directory, _)| directory).collect()
    }

    /// `touch`: puts `directory` first, keeping ten.
    pub fn touch(&self, tui: &Tui, project: &str, directory: &str) {
        let directory = directory.to_owned();
        self.update_recents(tui, project, move |list| {
            list.retain(|item| item["directory"].as_str() != Some(&directory));
            list.insert(
                0,
                json!({ "directory": directory, "usedAt": jsonl::now_ms() }),
            );
            list.truncate(10);
        });
    }

    fn remove(&self, tui: &Tui, project: &str, directory: &str) {
        let directory = directory.to_owned();
        self.update_recents(tui, project, move |list| {
            list.retain(|item| item["directory"].as_str() != Some(&directory));
        });
    }

    /// Changes the project's list in memory now and in storage on a blocking thread.
    fn update_recents(
        &self,
        tui: &Tui,
        project: &str,
        change: impl Fn(&mut Vec<Value>) + Send + Clone + 'static,
    ) {
        let project = project.to_owned();
        let apply = move |value: &mut Value, change: &dyn Fn(&mut Vec<Value>)| {
            if !value["projects"].is_object() {
                value["projects"] = json!({});
            }
            let mut list = value["projects"][&project]
                .as_array()
                .cloned()
                .unwrap_or_default();
            change(&mut list);
            value["projects"][&project] = Value::Array(list);
        };
        if let Ok(mut slot) = self.recents.lock() {
            let value = slot.get_or_insert_with(recents_initial);
            apply(value, &change);
        }
        let Some(storage): Option<Storage> = tui.storage() else {
            return;
        };
        let recents = self.recents.clone();
        tui.app.runtime().spawn_blocking(move || {
            let written = storage.update(RECENTS_KEY, &recents_initial(), |value| {
                apply(value, &change);
            });
            match written {
                Ok(value) => {
                    if let Ok(mut slot) = recents.lock() {
                        *slot = Some(value);
                    }
                }
                Err(error) => log::error!("Failed to persist directory recents: {error}"),
            }
        });
    }
}

fn recents_initial() -> Value {
    json!({ "projects": {} })
}

/// What picking an option does.
#[derive(Clone, Debug)]
enum Action {
    /// `insertPart`: a mention of `text`, and the path frecency counts, if any.
    Part {
        text: String,
        kind: Kind,
        part: Value,
        visit: Option<String>,
    },
    /// A keymap command without arguments runs.
    Run(String),
    /// `insertSlash`: `/name ` replaces the prompt up to the cursor.
    Slash(String),
    /// `insertDirectory`.
    Directory(String),
}

/// A recent directory that Ctrl+D removes after a confirmation.
#[derive(Clone, Debug)]
struct Destructive {
    id: String,
    project: String,
}

#[derive(Clone, Debug)]
struct Item {
    display: String,
    value: Option<String>,
    description: Option<String>,
    is_directory: bool,
    path: Option<String>,
    absolute: Option<String>,
    label: Option<&'static str>,
    queueable: bool,
    destructive: Option<Destructive>,
    action: Action,
}

impl Item {
    fn new(display: impl Into<String>, action: Action) -> Self {
        Self {
            display: display.into(),
            value: None,
            description: None,
            is_directory: false,
            path: None,
            absolute: None,
            label: None,
            queueable: false,
            destructive: None,
            action,
        }
    }
}

/// The last file or directory search that finished, for the mode it ran in.
#[derive(Clone, Debug, Default)]
struct Results {
    items: Vec<Item>,
    failed: bool,
    mode: Option<Mode>,
    query: String,
    resolved: bool,
}

/// A mounted prompt's autocomplete. Dropping it removes its layers and its popup.
pub struct Autocomplete(Rc<State>);

struct State {
    tui: Weak<Tui>,
    prompt: Weak<Inner>,
    visible: Cell<Option<Mode>>,
    /// The trigger's offset: the `/` or `@`, or the start of a directory argument.
    index: Cell<u32>,
    selected: Cell<usize>,
    /// The first row shown.
    offset: Cell<usize>,
    search: RefCell<String>,
    dismissed: RefCell<Option<String>>,
    confirming: RefCell<Option<String>>,
    results: RefCell<Results>,
    /// The search the last request was for, since the popup opened.
    requested: RefCell<Option<(Mode, String, String)>>,
    loading: Cell<bool>,
    generation: Cell<u64>,
    /// Set while a pick edits the prompt; its input is handled once the pick is done.
    editing: Cell<bool>,
    options: RefCell<Vec<Item>>,
    /// The prompt's root, which the popup sits on.
    anchor: View,
    popup: View,
    list: View,
    mode: RefCell<Option<Disposer>>,
    layer: OnceCell<Disposer>,
}

impl Drop for State {
    fn drop(&mut self) {
        self.popup.detach();
        let mode = self.mode.take();
        let layer = self.layer.take();
        if let Some(tui) = self.tui.upgrade() {
            tui.app.defer(move |_| drop((mode, layer)));
        }
    }
}

/// Mounts the autocomplete of `prompt`, its popup over `anchor` (the prompt's root).
pub fn mount(tui: &Tui, prompt: &Rc<Inner>, anchor: &View) -> Autocomplete {
    tui.prompt.complete.load(tui);
    let app = &tui.app;
    let list = View::new(app).column();
    let popup = View::new(app)
        .absolute()
        .position(Edge::Left, 0)
        .width(Length::percent(100.0))
        .z_index(100)
        .visible(false)
        .child(&list);
    anchor.child(&popup);
    let state = Rc::new(State {
        tui: tui.weak(),
        prompt: Rc::downgrade(prompt),
        visible: Cell::new(None),
        index: Cell::new(0),
        selected: Cell::new(0),
        offset: Cell::new(0),
        search: RefCell::default(),
        dismissed: RefCell::default(),
        confirming: RefCell::default(),
        results: RefCell::default(),
        requested: RefCell::default(),
        loading: Cell::new(false),
        generation: Cell::new(0),
        editing: Cell::new(false),
        options: RefCell::default(),
        anchor: anchor.clone(),
        popup,
        list,
        mode: RefCell::default(),
        layer: OnceCell::new(),
    });
    install(tui, &state, prompt.textarea.id());
    Autocomplete(state)
}

impl Autocomplete {
    pub fn visible(&self) -> Option<Mode> {
        self.0.visible.get()
    }

    /// The prompt's text changed (`onInput`).
    pub fn on_input(&self, value: &str) {
        self.0.on_input(value);
    }

    /// Where an inserted mention starts: the open `@` query, which it replaces, else the cursor. Hides the
    /// popup (`insertFileMention`).
    pub fn mention_start(&self, cursor: u32) -> u32 {
        let state = &self.0;
        let start = match state.visible.get() {
            Some(Mode::Reference) => state.index.get(),
            _ => cursor,
        };
        state.hide(false);
        start
    }

    /// The store changed: catalogs may have arrived.
    pub fn sync(&self) {
        if self.0.visible.get().is_some() {
            self.0.refresh();
        }
    }

    /// `prompt.queue` while the popup shows: a server command is completed first, so it can be
    /// queued (`completeQueueableCommand`).
    pub fn complete_queueable(&self) -> bool {
        let state = &self.0;
        let queueable = state.visible.get() == Some(Mode::Command)
            && state
                .options
                .borrow()
                .get(state.selected.get())
                .is_some_and(|item| item.queueable);
        if queueable {
            state.select();
        }
        queueable
    }
}

impl State {
    fn on_input(&self, value: &str) {
        if self.editing.get() {
            return;
        }
        if self.dismissed.borrow().as_deref() == Some(value) {
            return;
        }
        self.dismissed.replace(None);
        let (Some(tui), Some(prompt)) = (self.tui.upgrade(), self.prompt.upgrade()) else {
            return;
        };
        let offset = prompt.textarea.cursor_offset();
        let before = &value[..parse::index_at(value, offset)];
        if let Some(index) = directory_argument(&tui, before) {
            self.show(Mode::Directory, index);
            return;
        }
        if self.visible.get().is_some() {
            let index = self.index.get();
            let typed = prompt
                .textarea
                .buffer()
                .range(index, offset)
                .unwrap_or_default();
            if offset <= index || typed.contains(char::is_whitespace) {
                self.hide(false);
                return;
            }
            self.refresh();
            return;
        }
        if offset == 0 {
            return;
        }
        if parse::slash_trigger(before) == Some(0) {
            self.show(Mode::Command, 0);
            return;
        }
        if let Some(index) = parse::mention_trigger(before) {
            self.show(Mode::Reference, index);
        }
    }

    fn show(&self, mode: Mode, index: u32) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        self.visible.set(Some(mode));
        self.index.set(index);
        if self.mode.borrow().is_none() {
            *self.mode.borrow_mut() = Some(tui.keymap.push_mode(MODE, Condition::Always));
        }
        if mode == Mode::Reference
            && let Some(prompt) = self.prompt.upgrade()
        {
            // The `@` sources TS reads from the location store.
            let location = prompt.location(&tui);
            for catalog in [Catalog::Agent, Catalog::Skill, Catalog::Reference] {
                let task = tui.data.catalog_sync(catalog, Some(&location));
                let weak = self.prompt.clone();
                tui.app.spawn(task, move |_, _| {
                    if let Some(prompt) = weak.upgrade()
                        && let Some(complete) = prompt.autocomplete.get()
                    {
                        complete.sync();
                    }
                });
            }
        }
        self.refresh();
    }

    /// `hide`: with `remove_token`, a slash command's typed text goes too.
    fn hide(&self, remove_token: bool) {
        if remove_token
            && self.visible.get() == Some(Mode::Command)
            && let Some(prompt) = self.prompt.upgrade()
        {
            let cursor = prompt.textarea.cursor_offset();
            parts::replace(&prompt.textarea, self.index.get(), cursor, "");
        }
        self.confirming.replace(None);
        self.requested.replace(None);
        self.visible.set(None);
        self.mode.take();
        if let Some(tui) = self.tui.upgrade() {
            tui.keymap.sync_mode();
        }
        self.popup.visible(false);
        self.request_redraw();
    }

    fn request_redraw(&self) {
        if let Some(tui) = self.tui.upgrade() {
            tui.app.request_redraw();
        }
    }

    /// Recomputes the search, starts a file or directory search if it changed, and redraws.
    fn refresh(&self) {
        let (Some(tui), Some(prompt), Some(mode)) = (
            self.tui.upgrade(),
            self.prompt.upgrade(),
            self.visible.get(),
        ) else {
            return;
        };
        let start = match mode {
            Mode::Directory => self.index.get(),
            _ => self.index.get() + 1,
        };
        let cursor = prompt.textarea.cursor_offset();
        let search = if cursor >= start {
            prompt
                .textarea
                .buffer()
                .range(start, cursor)
                .unwrap_or_default()
        } else {
            String::new()
        };
        if *self.search.borrow() != search {
            self.search.replace(search.clone());
            self.selected.set(0);
            self.offset.set(0);
            self.confirming.replace(None);
        }
        let location = prompt.location(&tui);
        if mode != Mode::Command && self.reference_match(&tui, &location, mode).is_none() {
            self.fetch(&tui, mode, &search, &location);
        }
        let options = self.compute(&tui, &prompt, &location, mode, &search);
        self.selected
            .set(self.selected.get().min(options.len().saturating_sub(1)));
        *self.options.borrow_mut() = options;
        self.render(&tui);
    }

    /// The visible reference whose name the search starts with, as `name` or `name/…`.
    fn reference_match(&self, tui: &Tui, location: &Location, mode: Mode) -> Option<String> {
        if mode != Mode::Reference {
            return None;
        }
        let search = self.search.borrow().clone();
        let base = parse::file_line_range(&search).0;
        let alias = base.split('/').next().unwrap_or_default().to_owned();
        tui.data.read(|state| {
            state
                .location(Some(location))?
                .reference
                .as_ref()?
                .iter()
                .find(|reference| reference.hidden != Some(true) && reference.name == alias)
                .map(|reference| reference.name.clone())
        })
    }

    /// Runs the file (`/api/fs/find`) or directory (`/api/fs/list`) search for `search`, unless the
    /// last one since the popup opened was for the same search (TS refetches when its source
    /// changes).
    fn fetch(&self, tui: &Tui, mode: Mode, search: &str, location: &Location) {
        let key = (mode, search.to_owned(), location.directory.clone());
        if self.requested.borrow().as_ref() == Some(&key) {
            return;
        }
        self.requested.replace(Some(key));
        self.loading.set(true);
        let generation = self.generation.get() + 1;
        self.generation.set(generation);
        let client = tui.data.client().clone();
        let base = parse::file_line_range(search).0.to_owned();
        let range = parse::file_line_range(search).1;
        let query = search.to_owned();
        let directory = location.directory.clone();
        let home = home();
        let width = self.content_width(tui);
        let weak = self.prompt.clone();
        let finish = move |results: Option<Results>| {
            let Some(prompt) = weak.upgrade() else { return };
            let Some(complete) = prompt.autocomplete.get() else {
                return;
            };
            let state = &complete.0;
            if state.generation.get() != generation {
                return;
            }
            state.loading.set(false);
            let next = match results {
                Some(results) => results,
                None => {
                    let previous = state.results.borrow().clone();
                    if previous.mode == Some(mode) {
                        Results {
                            failed: true,
                            ..previous
                        }
                    } else {
                        Results {
                            failed: true,
                            mode: Some(mode),
                            query: query.clone(),
                            ..Results::default()
                        }
                    }
                }
            };
            state.results.replace(next);
            state.refresh();
        };
        let request_location = Some(LocationQueryInput {
            directory: Some(directory.clone()),
        });
        let query_for_results = search.to_owned();
        if mode == Mode::Directory {
            let search = parse::directory_search(&base, &directory, &home);
            let input = FileListInput {
                location: request_location,
                path: Some(search.directory.clone()),
            };
            tui.app.spawn(
                async move { client.file_list(&input, &RequestOptions::default()).await },
                move |_, result| {
                    finish(result.ok().map(|output| Results {
                        items: directory_items(&base, &search, output, width),
                        failed: false,
                        mode: Some(Mode::Directory),
                        query: query_for_results,
                        resolved: true,
                    }))
                },
            );
            return;
        }
        let input = FileFindInput {
            location: request_location,
            query: base,
            limit: Some(20),
            ..FileFindInput::default()
        };
        tui.app.spawn(
            async move { client.file_find(&input, &RequestOptions::default()).await },
            move |_, result| {
                finish(result.ok().map(|output| {
                    let root = output.location.directory.0.clone();
                    Results {
                        items: output
                            .data
                            .iter()
                            .map(|entry| {
                                file_item(&root, &entry.path.0, &entry.r#type, range, width)
                            })
                            .collect(),
                        failed: false,
                        mode: Some(Mode::Reference),
                        query: query_for_results,
                        resolved: true,
                    }
                }))
            },
        );
    }

    /// The options to show (`options` memo).
    fn compute(
        &self,
        tui: &Tui,
        prompt: &Inner,
        location: &Location,
        mode: Mode,
        search: &str,
    ) -> Vec<Item> {
        let results = {
            let results = self.results.borrow();
            if results.mode == Some(mode) {
                results.clone()
            } else {
                Results::default()
            }
        };
        let width = self.content_width(tui);
        if mode == Mode::Directory {
            let supplemental: Vec<Item> = if results.resolved && results.query.is_empty() {
                recent_items(tui, prompt, width)
            } else {
                Vec::new()
            };
            let seen: Vec<Option<String>> = supplemental
                .iter()
                .map(|item| item.absolute.clone())
                .collect();
            return supplemental
                .into_iter()
                .chain(
                    results
                        .items
                        .into_iter()
                        .filter(|item| !seen.contains(&item.absolute)),
                )
                .collect();
        }
        let references = reference_items(tui, location);
        if let Some(name) = self.reference_match(tui, location, mode) {
            return references
                .into_iter()
                .filter(|item| item.display == format!("@{name}"))
                .collect();
        }
        let files = if mode == Mode::Reference {
            results.items
        } else {
            Vec::new()
        };
        let others: Vec<Item> = match mode {
            Mode::Reference => skill_items(tui, location)
                .into_iter()
                .chain(references)
                .chain(agent_items(tui, location))
                .collect(),
            _ if self.index.get() == 0 => command_items(tui, location),
            _ => Vec::new(),
        };
        if search.is_empty() {
            return others.into_iter().chain(files).collect();
        }
        let complete = &tui.prompt.complete;
        let targets: Vec<(&str, Option<&str>)> = others
            .iter()
            .map(|item| {
                (
                    item.value.as_deref().unwrap_or(&item.display),
                    item.description.as_deref(),
                )
            })
            .collect();
        rank(mode, search, &targets, |index| {
            others[index]
                .path
                .as_deref()
                .map_or(0.0, |path| complete.score(path))
        })
        .into_iter()
        .map(|index| others[index].clone())
        .chain(files)
        .take(ROWS)
        .collect()
    }

    /// The anchor's width less the borders and padding (`anchor.width - 4`).
    fn content_width(&self, tui: &Tui) -> usize {
        let width = match self.anchor.rect().width as u32 {
            0 => u32::from(tui.app.size().0),
            width => width,
        };
        (width as usize).saturating_sub(4)
    }

    fn height(&self) -> usize {
        let count = self.options.borrow().len().max(1);
        let anchor = self.anchor.rect().screen_y.max(0.0) as usize;
        ROWS.min(count).min(anchor.max(1))
    }

    fn move_by(&self, delta: i64) {
        let count = self.options.borrow().len();
        if self.visible.get().is_none() || count == 0 {
            return;
        }
        self.move_to(move_wrap(self.selected.get(), count, delta));
    }

    fn move_to(&self, next: usize) {
        if next != self.selected.get() {
            self.confirming.replace(None);
        }
        self.selected.set(next);
        let count = self.options.borrow().len();
        let limit = self.height().min(count);
        let max = count.saturating_sub(limit);
        let offset = self.offset.get();
        let offset = if next < offset {
            next.min(max)
        } else if next >= offset + limit {
            (next + 1 - limit).min(max)
        } else {
            offset.min(max)
        };
        self.offset.set(offset);
        if let Some(tui) = self.tui.upgrade() {
            self.render(&tui);
        }
    }

    /// Mouse wheel: scrolls, and keeps the selection in view (`reconcileSelectionWindow`).
    fn scroll(&self, delta: i64) {
        let count = self.options.borrow().len();
        let limit = self.height().min(count);
        let max = count.saturating_sub(limit) as i64;
        let offset = (self.offset.get() as i64 + delta).clamp(0, max) as usize;
        self.offset.set(offset);
        let last = (count.saturating_sub(1)).min(offset + limit.max(1) - 1);
        let selected = self
            .selected
            .get()
            .clamp(offset.min(count.saturating_sub(1)), last);
        if selected != self.selected.get() {
            self.confirming.replace(None);
            self.selected.set(selected);
        }
        if let Some(tui) = self.tui.upgrade() {
            self.render(&tui);
        }
    }

    /// `select`: hides, then runs the pick.
    fn select(&self) {
        let Some(item) = self.options.borrow().get(self.selected.get()).cloned() else {
            return;
        };
        let Some(prompt) = self.prompt.upgrade() else {
            return;
        };
        let mode = self.visible.get();
        self.editing.set(true);
        if mode != Some(Mode::Directory) {
            self.hide(true);
            self.run(&prompt, &item.action);
        } else {
            self.run(&prompt, &item.action);
            self.dismissed.replace(Some(prompt.textarea.text()));
            self.hide(true);
        }
        self.editing.set(false);
        // TS handles the pick's own edit after it; a reopened trigger shows again.
        self.on_input(&prompt.textarea.text());
    }

    fn run(&self, prompt: &Inner, action: &Action) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let textarea = &prompt.textarea;
        match action {
            Action::Part {
                text,
                kind,
                part,
                visit,
            } => {
                parts::insert(prompt, self.index.get(), text, *kind, part.clone());
                if let Some(path) = visit {
                    tui.prompt.complete.visit(&tui, path.clone());
                }
            }
            Action::Run(id) => {
                tui.keymap.dispatch(id, None);
            }
            Action::Slash(name) => {
                let text = format!("/{name} ");
                parts::replace(textarea, 0, textarea.cursor_offset(), &text);
                textarea.set_cursor_offset(measure(&text));
            }
            Action::Directory(value) => {
                parts::replace(textarea, self.index.get(), textarea.cursor_offset(), value);
            }
        }
    }

    /// `prompt.autocomplete.complete` (Tab): a directory opens; anything else is picked.
    fn complete(&self) {
        let Some(item) = self.options.borrow().get(self.selected.get()).cloned() else {
            return;
        };
        if !item.is_directory {
            self.select();
            return;
        }
        let Some(prompt) = self.prompt.upgrade() else {
            return;
        };
        let textarea = &prompt.textarea;
        let shown = item.value.as_deref().unwrap_or(&item.display).trim_end();
        let path = shown.strip_prefix('@').unwrap_or(shown);
        let cursor = textarea.cursor_offset();
        let text = if self.visible.get() == Some(Mode::Directory) {
            if path.ends_with('/') {
                path.to_owned()
            } else {
                format!("{path}/")
            }
        } else {
            format!("@{path}/")
        };
        parts::replace(textarea, self.index.get(), cursor, &text);
        self.selected.set(0);
        self.offset.set(0);
        if let Some(tui) = self.tui.upgrade() {
            self.render(&tui);
        }
    }

    /// `prompt.autocomplete.destructive` (Ctrl+D): the first press asks, the second removes.
    fn destructive(&self) {
        let Some(action) = self
            .options
            .borrow()
            .get(self.selected.get())
            .and_then(|item| item.destructive.clone())
        else {
            return;
        };
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if self.confirming.borrow().as_deref() != Some(action.id.as_str()) {
            self.confirming.replace(Some(action.id));
            self.render(&tui);
            return;
        }
        tui.prompt
            .complete
            .remove(&tui, &action.project, &action.id);
        let count = self.options.borrow().len();
        self.selected
            .set(self.selected.get().min(count.saturating_sub(2)));
        self.confirming.replace(None);
        self.refresh();
    }

    /// Draws the popup: up to ten rows above the prompt, or the empty message.
    fn render(&self, tui: &Tui) {
        let Some(mode) = self.visible.get() else {
            self.popup.visible(false);
            return;
        };
        let app = &tui.app;
        let theme = tui.page();
        let height = self.height();
        let width = self.content_width(tui) + 4;
        self.popup
            .visible(true)
            .position(Edge::Top, Length::Cells(-(height as f32)))
            .border_sides(Sides::RIGHT)
            .border_chars(Some(split_border()))
            .border_color(theme.border.base);
        self.list.height(height as u32).bg(Color::TRANSPARENT);
        for child in self.list.children() {
            child.detach();
        }
        let row_bg = theme.background.raised.high;
        let options = self.options.borrow();
        if options.is_empty() {
            let results = self.results.borrow();
            let failed = results.mode == Some(mode) && results.failed;
            let loading = self.loading.get();
            let message = match mode {
                Mode::Command => "No matching commands",
                Mode::Directory if loading => "Searching…",
                Mode::Directory if failed => {
                    "Could not search directories. Keep typing to try again."
                }
                Mode::Directory => "No matching directories",
                _ if loading => "Searching…",
                _ if failed => "Could not search files. Keep typing to try again.",
                _ => "No matching files, agents, or references",
            };
            let error = mode == Mode::Reference && !loading && failed;
            let label = Text::new(app, truncate(message, width.saturating_sub(4).max(1)))
                .fg(if error {
                    theme.text.feedback.error.base
                } else {
                    theme.text.muted
                })
                .wrap(WrapMode::None);
            let row = View::new(app)
                .row()
                .grow(1.0)
                .bg(row_bg)
                .padding_edge(Edge::Left, 1)
                .padding_edge(Edge::Right, 1)
                .child(&label);
            self.list.child(&rail(app, &theme, None, &row));
            self.request_redraw();
            return;
        }
        let selected = self.selected.get();
        let confirming = self.confirming.borrow().clone();
        let offset = self.offset.get().min(options.len().saturating_sub(height));
        for (index, item) in options.iter().enumerate().skip(offset).take(height) {
            let active = index == selected;
            let confirm = item
                .destructive
                .as_ref()
                .is_some_and(|action| Some(&action.id) == confirming.as_ref());
            let (bg, fg, muted) = if confirm {
                (
                    theme.background.action.destructive.focused,
                    theme.text.action.destructive.focused,
                    theme.text.muted,
                )
            } else if active {
                (
                    theme.background.action.primary.focused,
                    theme.text.action.primary.focused,
                    theme.text.action.primary.focused,
                )
            } else {
                (row_bg, theme.text.base, theme.text.muted)
            };
            let label_width = item
                .label
                .filter(|_| !confirm)
                .map_or(0, |label| label.width() + 2);
            let content = width.saturating_sub(4 + label_width).max(1);
            let shown = if confirm {
                "Press ctrl+d to confirm"
            } else {
                item.display.as_str()
            };
            let row = View::new(app)
                .row()
                .grow(1.0)
                .bg(bg)
                .padding_edge(Edge::Left, 1)
                .padding_edge(Edge::Right, 1)
                .child(
                    &Text::new(app, truncate_middle(shown, content))
                        .fg(fg)
                        .shrink(0.0)
                        .wrap(WrapMode::None),
                );
            if !confirm {
                if let Some(description) = &item.description {
                    let description = description.split_whitespace().collect::<Vec<_>>().join(" ");
                    row.child(
                        &Text::new(app, format!(" {description}"))
                            .fg(muted)
                            .wrap(WrapMode::None)
                            .shrink(1.0)
                            .min_width(0),
                    );
                }
                if let Some(label) = item.label {
                    row.child(&View::new(app).grow(1.0).min_width(2));
                    row.child(&Text::new(app, label).fg(muted).shrink(0.0));
                }
            }
            let weak = self.prompt.clone();
            row.on_mouse(move |_, event| {
                let Some(prompt) = weak.upgrade() else { return };
                let Some(complete) = prompt.autocomplete.get() else {
                    return;
                };
                match event.kind {
                    MouseEventKind::Down(_) | MouseEventKind::Moved => {
                        if complete.0.selected.get() != index {
                            complete.0.move_to(index);
                        }
                    }
                    MouseEventKind::Up(MouseButton::Left) => complete.0.select(),
                    MouseEventKind::ScrollUp => complete.0.scroll(-1),
                    MouseEventKind::ScrollDown => complete.0.scroll(1),
                    _ => {}
                }
            });
            let color = if confirm {
                Some(theme.text.feedback.error.base)
            } else if active {
                Some(theme.text.formfield.focused)
            } else {
                None
            };
            self.list.child(&rail(app, &theme, color, &row));
        }
        self.request_redraw();
    }
}

/// The fuzzy order of options shown as `targets` (their value or display, and description) for `search`,
/// at most ten (`fuzzysort.go` in the `options` memo). Prefix matches score double, and frecency raises a
/// path's score.
fn rank(
    mode: Mode,
    search: &str,
    targets: &[(&str, Option<&str>)],
    frecency: impl Fn(usize) -> f64,
) -> Vec<usize> {
    let prefix = match mode {
        Mode::Reference => "@",
        Mode::Command => "/",
        Mode::Directory => "",
    };
    let starts = format!("{prefix}{search}");
    let keys: Vec<&str> = targets
        .iter()
        .map(|(key, _)| parse::file_line_range(key.trim_end()).0)
        .collect();
    // Descriptions count for slash commands only; for `@` they surfaced unrelated items.
    let fields: Vec<[Option<&str>; 2]> = targets
        .iter()
        .zip(&keys)
        .map(|((_, description), key)| [Some(*key), description.filter(|_| mode == Mode::Command)])
        .collect();
    fuzzy::go_scored(
        parse::file_line_range(search).0,
        &fields,
        |fields| *fields,
        |_, score, index| {
            let bonus = if keys[index].starts_with(&starts) {
                2.0
            } else {
                1.0
            };
            score * bonus * (1.0 + frecency(index))
        },
        if mode == Mode::Reference { 0.5 } else { 0.0 },
        ROWS,
    )
}

/// `SplitBorder`'s `┃` sides.
fn split_border() -> [char; 11] {
    [' ', ' ', ' ', ' ', ' ', '┃', ' ', ' ', ' ', ' ', ' ']
}

/// `AutocompleteRail`: each row draws its own left rail.
fn rail(app: &App, theme: &opencode_ui::theme::Theme, color: Option<Color>, row: &View) -> View {
    View::new(app)
        .row()
        .child(
            &Text::new(app, "┃")
                .width(1)
                .shrink(0.0)
                .fg(color.unwrap_or(theme.border.base)),
        )
        .child(row)
}

/// The autocomplete's key layer (`autocomplete.tsx:684-752`).
fn install(tui: &Tui, state: &Rc<State>, target: FocusId) {
    let weak = Rc::downgrade(state);
    let command = |id: &str, title: &str, action: fn(&State)| {
        let weak = weak.clone();
        TuiCommand::new(id, move |_: Option<&str>, _: Option<&KeyEvent>| {
            if let Some(state) = weak.upgrade() {
                action(&state);
            }
            true
        })
        .title(title)
        .group("Autocomplete")
    };
    let visible = {
        let weak = weak.clone();
        Condition::when(move || {
            weak.upgrade()
                .is_some_and(|state| state.visible.get().is_some())
        })
    };
    let layer = KeymapLayer {
        mode: Some(MODE.to_owned()),
        target: Some(target),
        enabled: visible,
        bindings: vec!["prompt.queue".to_owned()],
        commands: vec![
            command(
                "prompt.autocomplete.prev",
                "Previous autocomplete item",
                |state| state.move_by(-1),
            ),
            command(
                "prompt.autocomplete.next",
                "Next autocomplete item",
                |state| state.move_by(1),
            ),
            command("prompt.autocomplete.hide", "Hide autocomplete", |state| {
                state.hide(false)
            }),
            command("prompt.clear", "Dismiss autocomplete", |state| {
                state.hide(true)
            }),
            command(
                "prompt.autocomplete.select",
                "Select autocomplete item",
                State::select,
            ),
            command(
                "prompt.autocomplete.complete",
                "Complete autocomplete item",
                State::complete,
            ),
            command(
                "prompt.autocomplete.destructive",
                "Confirm autocomplete action",
                State::destructive,
            )
            .bind(Bind::Key("ctrl+d".to_owned())),
        ],
        ..KeymapLayer::default()
    };
    match tui.keymap.layer(layer) {
        Ok(disposer) => {
            let _ = state.layer.set(disposer);
        }
        Err(error) => log::error!("autocomplete keymap layer: {error}"),
    }
}

/// `slashArgumentAutocomplete`: the offset where a `/cd` argument starts, once its space is typed.
fn directory_argument(tui: &Tui, before: &str) -> Option<u32> {
    let (name, _, end) = parse::slash_head(before)?;
    if end == before.len() {
        return None;
    }
    let command = tui.keymap.commands().into_iter().find(|command| {
        command.slash.as_ref().is_some_and(|slash| {
            slash.arguments
                && (slash.name == name || slash.aliases.iter().any(|alias| alias == name))
        })
    })?;
    if command.id != cd::COMMAND {
        return None;
    }
    let separator = before[end..].chars().next().map_or(1, char::len_utf8);
    Some(measure(&before[..end + separator]))
}

/// Keymap slash commands, then server commands, sorted and padded (`commands` memo).
fn command_items(tui: &Tui, location: &Location) -> Vec<Item> {
    let mut items: Vec<Item> = tui
        .keymap
        .commands()
        .into_iter()
        .flat_map(|command| {
            let Some(slash) = command.slash.clone() else {
                return Vec::new();
            };
            let description = command.description.clone().or(command.title.clone());
            std::iter::once(slash.name.clone())
                .chain(slash.aliases.clone())
                .map(|name| {
                    let action = if slash.arguments {
                        Action::Slash(name.clone())
                    } else {
                        Action::Run(command.id.clone())
                    };
                    Item {
                        description: description.clone(),
                        ..Item::new(format!("/{name}"), action)
                    }
                })
                .collect()
        })
        .collect();
    let server = tui.data.read(|state| {
        state
            .location(Some(location))
            .and_then(|data| data.command.clone())
            .unwrap_or_default()
    });
    items.extend(server.into_iter().map(|command| Item {
        description: command.description.clone(),
        queueable: true,
        ..Item::new(format!("/{}", command.name), Action::Slash(command.name))
    }));
    items.sort_by(|a, b| locale_compare(&a.display, &b.display));
    let max = items
        .iter()
        .map(|item| item.display.encode_utf16().count())
        .max()
        .unwrap_or(0);
    if max == 0 {
        return items;
    }
    for item in &mut items {
        let pad = max + 2 - item.display.encode_utf16().count();
        item.display.push_str(&" ".repeat(pad));
    }
    items
}

/// An approximation of `localeCompare` under the root collation: letters compare without case
/// first, punctuation sorts before digits and digits before letters, and lowercase wins a tie.
fn locale_compare(a: &str, b: &str) -> Ordering {
    let key = |text: &str| -> Vec<(u8, char)> {
        text.chars()
            .flat_map(char::to_lowercase)
            .map(|c| {
                let class = if c.is_alphabetic() {
                    2
                } else if c.is_numeric() {
                    1
                } else {
                    0
                };
                (class, c)
            })
            .collect()
    };
    key(a).cmp(&key(b)).then_with(|| b.cmp(a))
}

/// Visible subagents (`agents` memo).
fn agent_items(tui: &Tui, location: &Location) -> Vec<Item> {
    let agents = tui.data.read(|state| {
        state
            .location(Some(location))
            .and_then(|data| data.agent.clone())
            .unwrap_or_default()
    });
    agents
        .into_iter()
        .filter(|agent| !agent.hidden && agent.mode != AgentInfoMode::Primary)
        .map(|agent| Item {
            label: Some("agent"),
            ..Item::new(
                format!("@{}", agent.id.0),
                Action::Part {
                    text: agent.id.0.clone(),
                    kind: Kind::Agent,
                    part: json!({ "name": agent.id.0 }),
                    visit: None,
                },
            )
        })
        .collect()
}

/// The location's skills (`skillOptions` memo).
fn skill_items(tui: &Tui, location: &Location) -> Vec<Item> {
    let skills = tui.data.read(|state| {
        state
            .location(Some(location))
            .and_then(|data| data.skill.clone())
            .unwrap_or_default()
    });
    skills
        .into_iter()
        .map(|skill| Item {
            description: skill.description.clone(),
            label: Some("skill"),
            ..Item::new(
                format!("@{}", skill.id.0),
                Action::Part {
                    text: skill.id.0.clone(),
                    kind: Kind::Skill,
                    part: json!({ "id": skill.id.0 }),
                    visit: None,
                },
            )
        })
        .collect()
}

/// Visible references, as file mentions of their directories (`referenceAliases` memo).
fn reference_items(tui: &Tui, location: &Location) -> Vec<Item> {
    let references = tui.data.read(|state| {
        state
            .location(Some(location))
            .and_then(|data| data.reference.clone())
            .unwrap_or_default()
    });
    references
        .into_iter()
        .filter(|reference| reference.hidden != Some(true))
        .map(|reference| {
            let source = match &reference.source {
                ReferenceSource::Git(git) => git.repository.clone(),
                ReferenceSource::Local(local) => local.path.0.clone(),
                ReferenceSource::Unknown(value) => {
                    value["path"].as_str().unwrap_or_default().to_owned()
                }
            };
            Item {
                description: Some(format!(" {source}")),
                label: Some("reference"),
                ..Item::new(
                    format!("@{}", reference.name),
                    Action::Part {
                        text: reference.name.clone(),
                        kind: Kind::File,
                        part: json!({
                            "uri": parse::file_url(&reference.path.0),
                            "name": reference.name,
                        }),
                        visit: Some(reference.name.clone()),
                    },
                )
            }
        })
        .collect()
}

/// A file search result (`createFilePart`), with its line range when it is a file.
fn file_item(
    root: &str,
    path: &str,
    kind: &FileSystemEntryType,
    range: Option<parse::LineRange>,
    width: usize,
) -> Item {
    let is_directory = *kind == FileSystemEntryType::Directory;
    let range = range.filter(|_| !is_directory);
    let mut uri = parse::file_url(&parse::resolve(root, path));
    let filename = match range {
        Some(range) => {
            uri.push_str(&format!("?start={}", range.start));
            if let Some(end) = range.end {
                uri.push_str(&format!("&end={end}"));
            }
            match range.end {
                Some(end) => format!("{path}#{}-{end}", range.start),
                None => format!("{path}#{}", range.start),
            }
        }
        None => path.to_owned(),
    };
    Item {
        value: Some(filename.clone()),
        is_directory,
        path: Some(path.to_owned()),
        ..Item::new(
            truncate_middle(&filename, width),
            Action::Part {
                text: filename.clone(),
                kind: Kind::File,
                part: json!({ "uri": uri, "name": filename }),
                visit: Some(path.to_owned()),
            },
        )
    }
}

/// `directoryAutocomplete`: the query itself when it names a directory, then the listed
/// directories whose names match.
fn directory_items(
    query: &str,
    search: &DirectorySearch,
    output: opencode_api::generated::FileListOutput,
    width: usize,
) -> Vec<Item> {
    let exact =
        parse::directory_exact(query, search).map(|value| (value, search.directory.clone()));
    let root = output.location.directory.0.clone();
    let listed = output
        .data
        .into_iter()
        .filter(|entry| entry.r#type == FileSystemEntryType::Directory)
        .map(|entry| parse::resolve(&root, &entry.path.0))
        .filter(|absolute| parse::directory_matches(parse::basename(absolute), &search.query))
        .map(|absolute| {
            let value = parse::directory_value(&format!("{}/", parse::basename(&absolute)), search);
            (value, absolute)
        });
    exact
        .into_iter()
        .chain(listed)
        .map(|(value, absolute)| Item {
            value: Some(value.clone()),
            is_directory: true,
            path: Some(value.clone()),
            absolute: Some(absolute),
            ..Item::new(truncate_middle(&value, width), Action::Directory(value))
        })
        .collect()
}

/// The project's recent directories, for an empty `/cd` argument (`directoryOptions`).
fn recent_items(tui: &Tui, prompt: &Inner, width: usize) -> Vec<Item> {
    let Some(project) = cd::project(tui, prompt) else {
        return Vec::new();
    };
    let home = home();
    tui.prompt
        .complete
        .recents(&project)
        .into_iter()
        .map(|directory| {
            let value = parse::directory_recent_value(&directory, &home);
            Item {
                value: Some(value.clone()),
                description: Some("recent".to_owned()),
                is_directory: true,
                path: Some(value.clone()),
                absolute: Some(directory.clone()),
                destructive: Some(Destructive {
                    id: directory,
                    project: project.clone(),
                }),
                ..Item::new(truncate_middle(&value, width), Action::Directory(value))
            }
        })
        .collect()
}

/// The user's home directory (`paths.home`).
fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// P-ORACLE: `parity/oracle/E.3-fuzzy.ts` ran fuzzysort as the `options` memo does; the order must be the
    /// same, ties and the limit of ten included.
    #[test]
    fn rank_matches_fuzzysort() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/fixtures/E.3/fuzzy.json"
        );
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 28);
        for case in cases {
            let (mode, key) = match case["mode"].as_str().unwrap() {
                "command" => (Mode::Command, "command"),
                _ => (Mode::Reference, "reference"),
            };
            let targets: Vec<(&str, Option<&str>)> = fixture["corpus"][key]
                .as_array()
                .unwrap()
                .iter()
                .map(|option| {
                    (
                        option["display"].as_str().unwrap(),
                        option["description"].as_str(),
                    )
                })
                .collect();
            let query = case["query"].as_str().unwrap();
            let expected: Vec<usize> = serde_json::from_value(case["results"].clone()).unwrap();
            assert_eq!(
                rank(mode, query, &targets, |_| 0.0),
                expected,
                "{key} {query:?}"
            );
        }
    }

    #[test]
    fn commands_sort_as_locale_compare_does() {
        let mut names = vec!["/b", "/A", "/a", "/1", "/-x", "/ab"];
        names.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(names, ["/-x", "/1", "/a", "/A", "/ab", "/b"]);
    }
}
