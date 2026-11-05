//! The prompt stash (E.4, row P04): `prompt.stash`, `prompt.stash.pop`, and `prompt.stash.list` over
//! `<state>/prompt-stash.jsonl`, shared by every prompt of the app (`prompt/stash.tsx`,
//! `component/prompt/index.tsx:882-946`).
//!
//! F.5's `jsonl` owns the format and writes the file. The UI keeps its own copy of the entries, so
//! commands answer at once, as TS's store does. The file is touched on one worker thread in order: the
//! load first, then each change under the file's lock, against what the file holds then, so entries
//! another TUI stashed meanwhile stay.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::{Rc, Weak};

use opencode_local::jsonl::{self, MAX_STASH_ENTRIES};
use opencode_local::lock;
use opencode_local::serial::Serial;
use opencode_ui::bind;
use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opentui::keymap::Condition;
use opentui::prelude::*;
use serde_json::Value;
use tokio::sync::oneshot;

use super::autocomplete::parts;
use super::editor::Inner;
use crate::app::Tui;

/// The app's stash: `{prompt, timestamp}` entries, oldest first. Without a state directory it lives in
/// memory only.
#[derive(Clone, Default)]
pub struct Stash {
    entries: Rc<RefCell<Vec<Value>>>,
    file: Option<(PathBuf, Serial)>,
}

impl Stash {
    /// Loads `<state>/prompt-stash.jsonl` on the worker; until then the stash holds what was stashed
    /// meanwhile, which then goes after the file's entries.
    pub fn load(app: &App, state: Option<PathBuf>) -> Self {
        let Some(state) = state else {
            return Self::default();
        };
        let writer = Serial::new("prompt-stash.jsonl");
        let (send, receive) = oneshot::channel();
        let file = state.clone();
        writer.run(move || {
            let _ = send.send(jsonl::Stash::load(&file).list().to_vec());
        });
        let stash = Self { entries: Rc::default(), file: Some((state, writer)) };
        let entries = stash.entries.clone();
        app.spawn(async move { receive.await.ok() }, move |_, loaded| {
            let Some(loaded) = loaded else { return };
            // Their writes are queued after the load, so the file gets them in the same order.
            let mut entries = entries.borrow_mut();
            let early = std::mem::replace(&mut *entries, loaded);
            entries.extend(early);
            let excess = entries.len().saturating_sub(MAX_STASH_ENTRIES);
            entries.drain(..excess);
        });
        stash
    }

    pub fn list(&self) -> Vec<Value> {
        self.entries.borrow().clone()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.borrow().is_empty()
    }

    /// `push({prompt})`, stamped now; the oldest entries past the limit go.
    pub fn push(&self, _app: &App, prompt: Value) {
        let entry = jsonl::stash_entry(prompt, jsonl::now_ms());
        {
            let mut entries = self.entries.borrow_mut();
            entries.push(entry.clone());
            let excess = entries.len().saturating_sub(MAX_STASH_ENTRIES);
            entries.drain(..excess);
        }
        self.write(move |state| jsonl::save_stash(state, &entry));
    }

    /// `pop()`: the newest entry.
    pub fn pop(&self, _app: &App) -> Option<Value> {
        let entry = self.entries.borrow_mut().pop()?;
        let deleted = entry.clone();
        self.write(move |state| jsonl::delete_stash(state, &deleted));
        Some(entry)
    }

    /// `remove(index)`.
    pub fn remove(&self, _app: &App, index: usize) {
        if index >= self.entries.borrow().len() {
            return;
        }
        let entry = self.entries.borrow_mut().remove(index);
        self.write(move |state| jsonl::delete_stash(state, &entry));
    }

    /// Queues a write after the load and every earlier write.
    fn write(&self, write: impl FnOnce(&Path) -> Result<(), lock::Error> + Send + 'static) {
        let Some((state, writer)) = self.file.clone() else {
            return;
        };
        writer.run(move || {
            if let Err(error) = write(&state) {
                log::warn!("prompt-stash.jsonl: {error}");
            }
        });
    }
}

/// The stash commands, in the palette (`stashCommands`).
pub fn layer(inner: &Rc<Inner>) -> KeymapLayer<FocusId> {
    let when = |check: fn(&Inner, &Tui) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || {
            weak.upgrade().is_some_and(|prompt| prompt.tui.upgrade().is_some_and(|tui| check(&prompt, &tui)))
        })
    };
    let run = |action: fn(&Rc<Inner>, &Tui)| {
        let weak = Rc::downgrade(inner);
        move |_: Option<&str>, _: Option<&KeyEvent>| {
            if let Some(prompt) = weak.upgrade()
                && let Some(tui) = prompt.tui.upgrade()
            {
                action(&prompt, &tui);
            }
            true
        }
    };
    let command = |id: &str, title: &str, action: fn(&Rc<Inner>, &Tui)| {
        TuiCommand::new(id, run(action)).title(title).group("Prompt").bind(Bind::Off).palette()
    };
    KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        commands: vec![
            command("prompt.stash", "Stash prompt", |prompt, tui| {
                if prompt.textarea.text().is_empty() {
                    return;
                }
                let mut entry = prompt.prompt.borrow().clone();
                entry["text"] = Value::String(prompt.textarea.text());
                tui.prompt.stash.push(&tui.app, entry);
                prompt.reset();
                tui.dialogs.clear();
            })
            .enabled(when(|prompt, _| !prompt.textarea.text().is_empty())),
            command("prompt.stash.pop", "Stash pop", |prompt, tui| {
                if let Some(entry) = tui.prompt.stash.pop(&tui.app) {
                    show(prompt, entry["prompt"].clone());
                }
                tui.dialogs.clear();
            })
            .enabled(when(|_, tui| !tui.prompt.stash.is_empty())),
            command("prompt.stash.list", "Stash list", |prompt, tui| {
                let weak: Weak<Inner> = Rc::downgrade(prompt);
                crate::dialogs::stash::show(
                    tui,
                    Rc::new(bind!(weak, |prompt, entry: &Value| show(&prompt, entry["prompt"].clone()))),
                );
            })
            .enabled(when(|_, tui| !tui.prompt.stash.is_empty())),
        ],
        ..KeymapLayer::default()
    }
}

/// Puts a stashed prompt in the composer with its parts, the cursor at the end; the mode stays
/// (`input.setText`, `setStore("prompt")`, `restoreExtmarksFromPrompt`, `gotoBufferEnd`).
fn show(prompt: &Inner, entry: Value) {
    let text = entry["text"].as_str().unwrap_or_default().to_owned();
    prompt.textarea.set_text(&text);
    *prompt.prompt.borrow_mut() = entry;
    parts::restore(prompt);
    prompt.textarea.set_cursor_offset(prompt.text_end());
    prompt.parts_changed();
}
