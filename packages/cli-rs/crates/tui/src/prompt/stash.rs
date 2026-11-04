//! The prompt stash (E.4, row P04): `prompt.stash`, `prompt.stash.pop`, and `prompt.stash.list` over
//! `<state>/prompt-stash.jsonl`, shared by every prompt of the app (`prompt/stash.tsx`,
//! `component/prompt/index.tsx:882-946`).
//!
//! F.5's `jsonl::Stash` owns the format and writes the file. The UI keeps its own copy of the entries, so
//! commands answer at once, as TS's store does, and the file operations run in order on blocking threads.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::rc::{Rc, Weak};
use std::sync::{Arc, Mutex};

use opencode_local::jsonl::{self, MAX_STASH_ENTRIES};
use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opentui::keymap::Condition;
use opentui::prelude::*;
use serde_json::{Value, json};

use super::autocomplete::parts;
use super::editor::Inner;
use crate::app::Tui;

/// The app's stash: `{prompt, timestamp}` entries, oldest first.
#[derive(Clone, Default)]
pub struct Stash {
    entries: Rc<RefCell<Vec<Value>>>,
    /// `None` until loaded; never loaded without a state directory, which keeps the stash in memory.
    file: Arc<Mutex<Option<jsonl::Stash>>>,
    ops: Arc<Mutex<VecDeque<Op>>>,
    persist: bool,
}

enum Op {
    Push(Value, i64),
    Pop,
    Remove(usize),
}

impl Stash {
    /// Loads `<state>/prompt-stash.jsonl` on a blocking thread; until then the stash is empty.
    pub fn load(app: &App, state: Option<PathBuf>) -> Self {
        let stash = Self {
            persist: state.is_some(),
            ..Self::default()
        };
        let Some(state) = state else {
            return stash;
        };
        let (file, ops, entries) = (stash.file.clone(), stash.ops.clone(), stash.entries.clone());
        app.spawn(
            async move {
                tokio::task::spawn_blocking(move || {
                    let mut slot = file.lock().ok()?;
                    let loaded = slot.insert(jsonl::Stash::load(&state));
                    // Operations from before the load go after it.
                    drain(loaded, &ops);
                    Some(loaded.list().to_vec())
                })
                .await
                .ok()
                .flatten()
            },
            move |_, loaded| {
                if let Some(loaded) = loaded {
                    *entries.borrow_mut() = loaded;
                }
            },
        );
        stash
    }

    pub fn list(&self) -> Vec<Value> {
        self.entries.borrow().clone()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.borrow().is_empty()
    }

    /// `push({prompt})`, stamped now; the oldest entries past the limit go.
    pub fn push(&self, app: &App, prompt: Value) {
        let now = jsonl::now_ms();
        {
            let mut entries = self.entries.borrow_mut();
            entries.push(json!({ "prompt": prompt, "timestamp": now }));
            let excess = entries.len().saturating_sub(MAX_STASH_ENTRIES);
            entries.drain(..excess);
        }
        self.run(app, Op::Push(prompt, now));
    }

    /// `pop()`: the newest entry.
    pub fn pop(&self, app: &App) -> Option<Value> {
        let entry = self.entries.borrow_mut().pop()?;
        self.run(app, Op::Pop);
        Some(entry)
    }

    /// `remove(index)`.
    pub fn remove(&self, app: &App, index: usize) {
        if index >= self.entries.borrow().len() {
            return;
        }
        self.entries.borrow_mut().remove(index);
        self.run(app, Op::Remove(index));
    }

    /// Queues `op` for the file. Each task applies every queued operation while it holds the file, so
    /// they land in order whichever task runs first.
    fn run(&self, app: &App, op: Op) {
        if !self.persist {
            return;
        }
        if let Ok(mut ops) = self.ops.lock() {
            ops.push_back(op);
        }
        let (file, ops) = (self.file.clone(), self.ops.clone());
        app.runtime().spawn_blocking(move || {
            if let Some(stash) = file.lock().ok().as_mut().and_then(|slot| slot.as_mut()) {
                drain(stash, &ops);
            }
        });
    }
}

fn drain(stash: &mut jsonl::Stash, ops: &Mutex<VecDeque<Op>>) {
    while let Some(op) = ops.lock().ok().and_then(|mut ops| ops.pop_front()) {
        match op {
            Op::Push(prompt, now) => stash.push(prompt, now),
            Op::Pop => drop(stash.pop()),
            Op::Remove(index) => stash.remove(index),
        }
    }
}

/// The stash commands, in the palette (`stashCommands`).
pub fn layer(inner: &Rc<Inner>) -> KeymapLayer<FocusId> {
    let when = |check: fn(&Inner, &Tui) -> bool| {
        let weak = Rc::downgrade(inner);
        Condition::when(move || {
            weak.upgrade()
                .is_some_and(|prompt| prompt.tui.upgrade().is_some_and(|tui| check(&prompt, &tui)))
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
        TuiCommand::new(id, run(action))
            .title(title)
            .group("Prompt")
            .bind(Bind::Off)
            .palette()
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
                    Rc::new(move |entry: &Value| {
                        if let Some(prompt) = weak.upgrade() {
                            show(&prompt, entry["prompt"].clone());
                        }
                    }),
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
