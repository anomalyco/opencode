//! Pastes (E.4, rows P06 and CB02): terminal pastes and `prompt.paste` (Ctrl+V) in the prompt
//! (`component/prompt/index.tsx:373-394,470-493,1407-1522,1798-1851`, `clipboard.ts:24-52`).
//!
//! - A paste of three or more lines, or of more than 150 characters, becomes `[Pasted ~N lines]`: an atomic
//!   mark tied to a `pasted` part that keeps the text. Submitting sends the text; clicking the mark, or
//!   pasting the same text again right after it, expands it in place. `prompt.paste: "full"` turns this off.
//! - A paste that names image, PDF, or SVG files attaches them ([`super::attach`]).
//! - `prompt.paste` reads the clipboard as `image/png`, else `text/plain`: an image attaches as
//!   `[Image N]`, text pastes as above. An empty terminal paste does the same, for terminals that paste an
//!   image clipboard as nothing.
//!
//! Pastes run one after another. A paste whose file or clipboard read finishes after the prompt changed
//! (its text or mode, or the prompt went) is dropped, as in TS.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;

use opencode_local::cli_config::PromptPaste;
use opencode_ui::bind;
use opencode_ui::prompt_input::paste::{Content, content, strip_ansi};
use opentui::native::ClipboardOutcome;
use opentui::prelude::*;
use serde_json::{Map, Value, json};

use super::attach::{self, Resolved};
use super::autocomplete::parse::{index_at, measure};
use super::autocomplete::parts::{self, Kind};
use super::editor::{Inner, Mode};

/// Pastes waiting while one reads files or the clipboard.
const MAX_QUEUED: usize = 16;

/// The prompt's pastes, in order.
#[derive(Default)]
pub struct Queue {
    jobs: RefCell<VecDeque<Job>>,
    busy: Cell<bool>,
}

enum Job {
    Text(String),
    Clipboard,
}

/// What the prompt looked like when a paste started (`enqueuePaste`'s `before`).
struct Before {
    mode: Mode,
    text: String,
}

impl Before {
    fn of(prompt: &Inner) -> Self {
        Self { mode: prompt.mode.get(), text: prompt.textarea.text() }
    }

    fn changed(&self, prompt: &Inner) -> bool {
        prompt.mode.get() != self.mode || prompt.textarea.text() != self.text
    }
}

/// Routes the textarea's pastes here and expands a pasted mark on click.
pub fn connect(inner: &Rc<Inner>) {
    let weak = Rc::downgrade(inner);
    inner.textarea.on_paste(bind!(weak, |prompt, cx, text| {
        // Inserted here, after the file check, not by the textarea.
        cx.prevent_default();
        cx.stop_propagation();
        if text.is_empty() {
            from_clipboard(&prompt);
            return;
        }
        enqueue(&prompt, Job::Text(text.replace("\r\n", "\n").replace('\r', "\n")));
    }));
    let weak = Rc::downgrade(inner);
    inner.textarea.on_mouse(move |cx, event| {
        if event.kind != MouseEventKind::Down(MouseButton::Left) {
            return;
        }
        // After the textarea moved its cursor to the click.
        cx.app().defer(bind!(weak, |prompt, _| {
            let cursor = prompt.textarea.cursor_offset();
            let mark = prompt
                .textarea
                .extmarks_at(cursor)
                .into_iter()
                .find(|mark| matches!(prompt.parts.get(mark.id), Some((Kind::Pasted, _))));
            if let Some(mark) = mark {
                expand(&prompt, mark.id);
            }
        }));
    });
}

/// `prompt.paste`: reads the clipboard into the prompt.
pub fn from_clipboard(prompt: &Rc<Inner>) {
    enqueue(prompt, Job::Clipboard);
}

fn enqueue(prompt: &Rc<Inner>, job: Job) {
    {
        let mut jobs = prompt.paste.jobs.borrow_mut();
        if jobs.len() >= MAX_QUEUED {
            log::warn!("paste dropped: {MAX_QUEUED} pastes are waiting");
            return;
        }
        jobs.push_back(job);
    }
    next(prompt);
}

fn next(prompt: &Rc<Inner>) {
    if prompt.paste.busy.get() {
        return;
    }
    let Some(job) = prompt.paste.jobs.borrow_mut().pop_front() else {
        return;
    };
    prompt.paste.busy.set(true);
    let before = Before::of(prompt);
    match job {
        Job::Text(text) => paste_input_text(prompt, text, before),
        Job::Clipboard => {
            read_clipboard(
                &prompt.app,
                bind!(prompt, |prompt, outcome| {
                    match content(outcome) {
                        Err(message) => {
                            error(&prompt, &message);
                            finish(&prompt);
                        }
                        Ok(_) if before.changed(&prompt) => finish(&prompt),
                        Ok(Some(Content::Image { mime, data })) => {
                            let uri = format!("data:{mime};base64,{data}");
                            if let Err(message) = attachment(&prompt, &uri, Some("clipboard"), None) {
                                error(&prompt, &message);
                            }
                            finish(&prompt);
                        }
                        Ok(Some(Content::Text(text))) => paste_input_text(&prompt, text, before),
                        Ok(None) => finish(&prompt),
                    }
                }),
            );
        }
    }
}

fn finish(prompt: &Rc<Inner>) {
    prompt.paste.busy.set(false);
    next(prompt);
}

fn error(prompt: &Inner, message: &str) {
    if let Some(tui) = prompt.tui.upgrade() {
        tui.toasts.error(message.to_owned());
    }
}

/// Reads the clipboard, or a test sink's queued outcome while one is capturing.
fn read_clipboard(app: &App, done: impl FnOnce(ClipboardOutcome) + 'static) {
    if let Some(sink) = crate::features::links::testing::sink() {
        let outcome = sink.clipboard.borrow_mut().pop_front().unwrap_or(ClipboardOutcome::Empty);
        app.defer(move |_| done(outcome));
        return;
    }
    app.read_clipboard_as(&["image/png", "text/plain"], move |_, outcome| done(outcome));
}

/// `pasteInputText`: files attach; long text collapses into a part; anything else is inserted.
fn paste_input_text(prompt: &Rc<Inner>, text: String, before: Before) {
    let normalized = strip_ansi(&text).replace("\r\n", "\n").replace('\r', "\n");
    let pasted = normalized.trim().to_owned();
    let windows = cfg!(windows);
    if !attach::may_attach(&pasted, windows) {
        insert(prompt, &normalized, &pasted);
        finish(prompt);
        return;
    }
    let input = pasted.clone();
    prompt.app.spawn(
        async move { tokio::task::spawn_blocking(move || attach::resolve(&input, windows)).await.ok().flatten() },
        bind!(prompt, |prompt, _, resolved| {
            if before.changed(&prompt) {
                finish(&prompt);
                return;
            }
            match resolved {
                Some(resolved) => {
                    for file in resolved {
                        let result = match file {
                            Resolved::Text { content, filename } => {
                                let name = if filename.is_empty() { "image" } else { &filename };
                                paste_text(&prompt, &content, &format!("[SVG: {name}]"));
                                Ok(())
                            }
                            Resolved::File { uri, filename, path } => {
                                attachment(&prompt, &uri, Some(&filename), Some(&path))
                            }
                        };
                        if let Err(message) = result {
                            error(&prompt, &message);
                        }
                    }
                }
                None => insert(&prompt, &normalized, &pasted),
            }
            finish(&prompt);
        }),
    );
}

/// The text part of `pasteInputText`.
fn insert(prompt: &Inner, normalized: &str, pasted: &str) {
    let lines = pasted.matches('\n').count() + 1;
    let compact = prompt
        .tui
        .upgrade()
        .is_none_or(|tui| tui.settings.info().prompt.and_then(|prompt| prompt.paste) != Some(PromptPaste::Full));
    // `pastedContent.length` counts UTF-16 units.
    if (lines >= 3 || pasted.encode_utf16().count() > 150) && compact {
        // The same text pasted right after its mark expands it.
        let cursor = prompt.textarea.cursor_offset();
        let repeat = prompt.textarea.extmarks().into_iter().find(|mark| {
            (mark.end == cursor || mark.end + 1 == cursor)
                && prompt.parts.get(mark.id).is_some_and(|(kind, index)| {
                    kind == Kind::Pasted && prompt.prompt.borrow()["pasted"][index]["text"].as_str() == Some(pasted)
                })
        });
        if let Some(mark) = repeat
            && expand(prompt, mark.id)
        {
            return;
        }
        paste_text(prompt, pasted, &format!("[Pasted ~{lines} lines]"));
        return;
    }
    prompt.textarea.insert(normalized);
}

/// `pasteText`: `label` at the cursor, marked, standing for `text`.
fn paste_text(prompt: &Inner, text: &str, label: &str) {
    let textarea = &prompt.textarea;
    let start = textarea.cursor_offset();
    let end = start + measure(label);
    textarea.insert(format!("{label} "));
    let mark = textarea.add_extmark(start..end, parts::styled(prompt, "extmark.paste"));
    let mut info = prompt.prompt.borrow_mut();
    info["text"] = Value::String(textarea.text());
    if !info["pasted"].is_array() {
        info["pasted"] = json!([]);
    }
    let Some(pasted) = info["pasted"].as_array_mut() else {
        return;
    };
    pasted.push(json!({ "text": text, "source": { "start": start, "end": end, "text": label } }));
    prompt.parts.track(mark, Kind::Pasted, pasted.len() - 1);
}

/// `pasteAttachment`: `[Image N]` or `[PDF N]` at the cursor, marked as a file part with the data URI.
fn attachment(prompt: &Inner, uri: &str, filename: Option<&str>, path: Option<&str>) -> Result<(), String> {
    let files = prompt.prompt.borrow()["files"].as_array().cloned().unwrap_or_default();
    let label = attach::label(&files, uri, filename)?;
    let textarea = &prompt.textarea;
    let start = textarea.cursor_offset();
    // `virtualText.length`: labels are ASCII.
    let end = start + label.len() as u32;
    textarea.insert(format!("{label} "));
    let mark = textarea.add_extmark(start..end, parts::styled(prompt, "extmark.paste"));
    let mut part = Map::new();
    part.insert("uri".into(), uri.into());
    if let Some(name) = filename {
        part.insert("name".into(), name.into());
    }
    if let Some(path) = path {
        part.insert("path".into(), path.into());
    }
    part.insert("mention".into(), json!({ "start": start, "end": end, "text": label }));
    {
        let mut info = prompt.prompt.borrow_mut();
        info["text"] = Value::String(textarea.text());
        if !info["files"].is_array() {
            info["files"] = json!([]);
        }
        if let Some(files) = info["files"].as_array_mut() {
            files.push(Value::Object(part));
            prompt.parts.track(mark, Kind::File, files.len() - 1);
        }
    }
    prompt.parts_changed();
    Ok(())
}

/// `expandPastedText`: replaces a paste's mark with its text. Returns whether `mark` was one.
fn expand(prompt: &Inner, mark: opentui::widget::ExtmarkId) -> bool {
    let textarea = &prompt.textarea;
    let Some(extmark) = textarea.extmark(mark) else {
        return false;
    };
    let Some((Kind::Pasted, index)) = prompt.parts.get(mark) else {
        return false;
    };
    let Some(text) = prompt.prompt.borrow()["pasted"][index]["text"].as_str().map(str::to_owned) else {
        return false;
    };
    textarea.remove_extmark(mark);
    parts::replace(textarea, extmark.start, extmark.end, &text);
    true
}

/// The text a submit sends: each paste's mark replaced by its text (`expandTrackedPastedText`).
pub fn expanded_text(prompt: &Inner) -> String {
    let text = prompt.textarea.text();
    let info = prompt.prompt.borrow();
    let ranges = prompt
        .textarea
        .extmarks()
        .into_iter()
        .filter_map(|mark| match prompt.parts.get(mark.id)? {
            (Kind::Pasted, index) => Some((mark.start, mark.end, info["pasted"][index]["text"].as_str()?.to_owned())),
            _ => None,
        })
        .collect();
    expand_tracked(&text, ranges)
}

/// The text a copy of the mouse selection puts on the clipboard: with the prompt focused, its paste labels
/// become their text (the prompt textarea's `getClipboardText`).
pub fn clipboard_text(tui: &crate::app::Tui, text: &str) -> String {
    let Some(prompt) = tui.prompt.current.borrow().upgrade() else {
        return text.to_owned();
    };
    if !prompt.focused() {
        return text.to_owned();
    }
    let info = prompt.prompt.borrow();
    expand_placeholders(text, info["pasted"].as_array().map(Vec::as_slice).unwrap_or_default())
}

/// `expandPastedTextPlaceholders`: each paste's label, found in order of where the paste sits, becomes its
/// text.
fn expand_placeholders(text: &str, pasted: &[Value]) -> String {
    let mut parts: Vec<&Value> = pasted.iter().collect();
    parts.sort_by(|a, b| {
        let start = |part: &Value| part["source"]["start"].as_f64().unwrap_or(0.0);
        start(a).total_cmp(&start(b))
    });
    let mut cursor = 0;
    let mut result = String::new();
    for part in parts {
        let (Some(label), Some(content)) = (part["source"]["text"].as_str(), part["text"].as_str()) else {
            continue;
        };
        let Some(index) = text[cursor..].find(label).map(|index| index + cursor) else {
            continue;
        };
        result.push_str(&text[cursor..index]);
        result.push_str(content);
        cursor = index + label.len();
    }
    result + &text[cursor..]
}

/// `expandPromptInputPastedText`: the prompt with its pastes' text in place, and the mentions after
/// each paste moved by the length it gained, for the external editor.
pub fn expand_prompt(prompt: &Value) -> Value {
    let ranges: Vec<(u32, u32, String)> = prompt["pasted"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|part| {
            let offset = |key: &str| part["source"][key].as_f64().map(|value| value as u32);
            Some((offset("start")?, offset("end")?, part["text"].as_str()?.to_owned()))
        })
        .collect();
    let mut next = prompt.clone();
    for key in ["files", "agents", "skills"] {
        let Some(list) = next[key].as_array_mut() else {
            continue;
        };
        for part in list {
            let Some(start) = part["mention"]["start"].as_f64() else {
                continue;
            };
            let shift: i64 = ranges
                .iter()
                .filter(|(_, end, _)| f64::from(*end) <= start)
                .map(|(start, end, text)| i64::from(measure(text)) - i64::from(end - start))
                .sum();
            for edge in ["start", "end"] {
                if let Some(value) = part["mention"][edge].as_f64() {
                    part["mention"][edge] = json!(value as i64 + shift);
                }
            }
        }
    }
    let text = prompt["text"].as_str().unwrap_or_default();
    next["text"] = Value::String(expand_tracked(text, ranges));
    next
}

/// Replaces each `(start, end)` offset range of `text` with its text, right to left so earlier offsets
/// stay valid.
fn expand_tracked(text: &str, mut ranges: Vec<(u32, u32, String)>) -> String {
    ranges.sort_by_key(|range| std::cmp::Reverse(range.0));
    ranges.into_iter().fold(text.to_owned(), |result, (start, end, part)| {
        let (start, end) = (index_at(text, start), index_at(text, end));
        format!("{}{part}{}", &result[..start], &result[end..])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pastes_expand_right_to_left_by_offset() {
        // Offsets are display columns: the wide character before the second paste counts twice.
        let text = "[A] 世 [B] end";
        let ranges = vec![(0, 3, "one\ntwo".to_owned()), (7, 10, "three".to_owned())];
        assert_eq!(expand_tracked(text, ranges), "one\ntwo 世 three end");
    }

    #[test]
    fn copied_labels_become_their_text_in_paste_order() {
        let pasted = [
            json!({ "text": "B", "source": { "start": 20, "text": "[Pasted ~3 lines]" } }),
            json!({ "text": "A", "source": { "start": 0, "text": "[Pasted ~3 lines]" } }),
            json!({ "text": "gone", "source": { "start": 40, "text": "[Pasted ~9 lines]" } }),
        ];
        assert_eq!(expand_placeholders("[Pasted ~3 lines] and [Pasted ~3 lines]!", &pasted), "A and B!");
        assert_eq!(expand_placeholders("plain", &pasted), "plain");
    }

    #[test]
    fn the_editor_sees_pastes_expanded_and_mentions_moved() {
        let prompt = json!({
            "text": "[Pasted ~3 lines] see @a.ts",
            "pasted": [{ "text": "x\ny\nz", "source": { "start": 0, "end": 17, "text": "[Pasted ~3 lines]" } }],
            "files": [{ "uri": "file:///a.ts", "mention": { "start": 22, "end": 27, "text": "@a.ts" } }],
            "agents": [],
        });
        let expanded = expand_prompt(&prompt);
        assert_eq!(expanded["text"], "x\ny\nz see @a.ts");
        // "x\ny\nz" measures 5, the label 17: the mention moves 12 to the left.
        assert_eq!(expanded["files"][0]["mention"]["start"], 10);
        assert_eq!(expanded["files"][0]["mention"]["end"], 15);
    }
}
