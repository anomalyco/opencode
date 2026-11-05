//! External editor (E.5, row P09): `prompt.editor` (`<leader>e`, `/editor`) opens the prompt in `$VISUAL` or
//! `$EDITOR` and reads it back (`openEditor` in `editor.ts`, `prompt.editor` in `component/prompt/index.tsx`).
//!
//! The prompt goes to a temporary `.md` file. The terminal is released to the editor while it runs and taken
//! back when it exits; the UI waits meanwhile, as TS's suspended renderer does. Mentions that survive the edit
//! keep their parts, moved to where their text now is.

use std::path::PathBuf;
use std::rc::Rc;

use opencode_ui::prompt_input::editor::{Mention, edit, normalize, realign_mentions};
use opencode_ui::prompt_input::parse::measure;
use opencode_ui::toast::{ToastOptions, Variant};
use serde_json::{Value, json};

use super::editor::Inner;
use crate::app::Tui;

/// `prompt.editor`.
pub fn open(tui: &Tui, prompt: &Rc<Inner>) {
    tui.dialogs.clear();
    let Some(command) = ["VISUAL", "EDITOR"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
    else {
        failed(tui, "Set $VISUAL or $EDITOR to open an external editor");
        return;
    };
    // The editor gets the pasted text, not the `[Pasted ~N lines]` labels (`expandPromptInputPastedText`).
    let snapshot = super::paste::expand_prompt(&prompt.snapshot());
    let cwd = working_directory(tui, prompt);
    let weak = Rc::downgrade(prompt);
    tui.app.release_terminal(move |_| {
        let result = edit(
            &command,
            snapshot["text"].as_str().unwrap_or_default(),
            &cwd,
        );
        let Some(prompt) = weak.upgrade() else { return };
        let Some(tui) = prompt.tui.upgrade() else {
            return;
        };
        match result {
            Err(message) => failed(&tui, &message),
            Ok(None) => {}
            Ok(Some(content)) => {
                let text = normalize(&content);
                let mut next = realign(&text, &snapshot);
                next["pasted"] = json!([]);
                next["mode"] = Value::String(prompt.mode.get().as_str().to_owned());
                prompt.restore(next);
                prompt.textarea.set_cursor_offset(measure(&text));
            }
        }
        tui.app.request_redraw();
    });
}

fn failed(tui: &Tui, message: &str) {
    tui.toasts
        .show(ToastOptions::new(Variant::Error, message.to_owned()).title("Failed to open editor"));
}

/// The project's directory unless it is `/`, else the location's, else the TUI's.
fn working_directory(tui: &Tui, prompt: &Inner) -> PathBuf {
    let location = prompt.location(tui);
    let project = tui.data.read(|state| {
        state
            .location(Some(&location))
            .or_else(|| state.location(None))
            .and_then(|data| data.info.as_ref())
            .map(|info| info.project.directory.0.clone())
    });
    let directory = project
        .filter(|directory| directory != "/")
        .unwrap_or(location.directory);
    PathBuf::from(if directory.is_empty() {
        tui.directory.clone()
    } else {
        directory
    })
}

/// The `PromptInfo` for `content`: each mention with text moves to an occurrence of that text, the one
/// nearest its old offset, and a part whose text is gone is dropped (`realignPromptInputMentions`).
pub fn realign(content: &str, prompt: &Value) -> Value {
    const KEYS: [&str; 3] = ["files", "agents", "skills"];
    let lists: Vec<Option<&Vec<Value>>> = KEYS
        .iter()
        .map(|key| prompt.get(*key).and_then(Value::as_array))
        .collect();
    let parts: Vec<&Value> = lists
        .iter()
        .flatten()
        .flat_map(|list| list.iter())
        .collect();
    let mentions: Vec<Option<Mention>> = parts.iter().map(|part| mention(part)).collect();
    let aligned = realign_mentions(content, &mentions);

    let mut next = json!({ "text": content });
    let mut index = 0;
    for (key, list) in KEYS.iter().zip(lists) {
        let Some(list) = list else { continue };
        let kept: Vec<Value> = list
            .iter()
            .filter_map(|part| {
                let at = index;
                index += 1;
                if mention(part).is_none() {
                    return Some(part.clone());
                }
                let mention = aligned[at].as_ref()?;
                let mut part = part.clone();
                part["mention"] =
                    json!({ "text": mention.text, "start": mention.start, "end": mention.end });
                Some(part)
            })
            .collect();
        next[*key] = Value::Array(kept);
    }
    next
}

/// A part's mention with text.
fn mention(part: &Value) -> Option<Mention> {
    let mention = part.get("mention")?;
    let text = mention
        .get("text")?
        .as_str()
        .filter(|text| !text.is_empty())?;
    let offset = |key: &str| mention.get(key).and_then(Value::as_f64).unwrap_or_default() as u32;
    Some(Mention {
        start: offset("start"),
        end: offset("end"),
        text: text.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_follow_their_text_and_vanish_with_it() {
        let prompt = json!({
            "text": "fix @a.ts and @general",
            "files": [
                { "uri": "file:///w/a.ts", "name": "a.ts", "mention": { "start": 4, "end": 9, "text": "@a.ts" } },
                { "uri": "file:///w/b.ts", "name": "b.ts" },
            ],
            "agents": [{ "name": "general", "mention": { "start": 14, "end": 22, "text": "@general" } }],
            "pasted": [],
        });
        let next = realign("日本 @general then @a.ts", &prompt);
        assert_eq!(next["text"], "日本 @general then @a.ts");
        assert_eq!(
            next["files"][0]["mention"],
            json!({ "text": "@a.ts", "start": 19, "end": 24 })
        );
        assert_eq!(
            next["files"][1],
            json!({ "uri": "file:///w/b.ts", "name": "b.ts" })
        );
        assert_eq!(
            next["agents"][0]["mention"],
            json!({ "text": "@general", "start": 5, "end": 13 })
        );
        assert!(next.get("skills").is_none());

        let gone = realign("nothing left", &prompt);
        assert_eq!(
            gone["files"],
            json!([{ "uri": "file:///w/b.ts", "name": "b.ts" }])
        );
        assert_eq!(gone["agents"], json!([]));
    }

    #[test]
    fn repeated_mentions_take_the_nearest_occurrences_and_longer_texts_go_first() {
        let part = |start: u32, text: &str| json!({ "uri": "file:///x", "name": "x", "mention": { "start": start, "end": start + measure(text), "text": text } });
        let prompt = json!({ "files": [part(0, "@x"), part(20, "@x"), part(30, "@x.ts")] });
        // Three "@x" candidates, one inside "@x.ts", which the longer mention protects.
        let next = realign("@x @x.ts                @x", &prompt);
        let starts: Vec<u64> = next["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["mention"]["start"].as_u64().unwrap())
            .collect();
        assert_eq!(starts, [0, 24, 3]);
    }
}
