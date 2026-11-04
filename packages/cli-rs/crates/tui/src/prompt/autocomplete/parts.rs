//! Mentions as prompt parts: each `@file`, `@agent`, and `@skill` in the text is an atomic extmark,
//! highlighted and deleted as one unit, tied to its entry in the `PromptInfo`'s `files`, `agents`, or
//! `skills` (`component/prompt/index.tsx:765-880`, `insertPart` in `autocomplete.tsx`).
//!
//! The `PromptInfo` keeps each part's `mention` (`start`, `end`, `text`). Every edit moves the marks;
//! [`sync`] then copies their ranges into the parts and drops the parts whose marks went.

use std::cell::RefCell;

use opencode_api::generated::{
    PromptAgentAttachment, PromptInputFileAttachment, PromptInputSkillAttachment,
};
use opentui::native::SelectionColors;
use opentui::prelude::*;
use opentui::widget::{ExtmarkId, ExtmarkOptions};
use serde_json::{Value, json};

use super::parse::measure;
use crate::prompt::editor::Inner;

/// Which part list a mention belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    File,
    Agent,
    Skill,
}

impl Kind {
    const ALL: [Kind; 3] = [Kind::File, Kind::Agent, Kind::Skill];

    fn key(self) -> &'static str {
        match self {
            Kind::File => "files",
            Kind::Agent => "agents",
            Kind::Skill => "skills",
        }
    }

    fn scope(self) -> &'static str {
        match self {
            Kind::File => "extmark.file",
            Kind::Agent => "extmark.agent",
            Kind::Skill => "extmark.skill",
        }
    }
}

/// The prompt's marks and the parts they stand for (`extmarkToPart`).
#[derive(Default)]
pub struct Parts(RefCell<Vec<(ExtmarkId, Kind, usize)>>);

impl Parts {
    pub fn clear(&self) {
        self.0.borrow_mut().clear();
    }
}

/// Replaces the text from offset `start` to the cursor with `@text`, plus a space unless one follows,
/// marks `@text`, and records `part` under its mention (`insertPart`). A file already attached by
/// URI keeps its entry; a skill already attached is not inserted again.
pub fn insert(prompt: &Inner, start: u32, text: &str, kind: Kind, part: Value) {
    if kind == Kind::Skill && has(prompt, Kind::Skill, "id", &part["id"]) {
        return;
    }
    let textarea = &prompt.textarea;
    let cursor = textarea.cursor_offset();
    let next = textarea
        .buffer()
        .range(cursor, cursor + 1)
        .unwrap_or_default();
    let mention = format!("@{text}");
    let inserted = if next == " " {
        mention.clone()
    } else {
        format!("{mention} ")
    };
    replace(textarea, start, cursor, &inserted);
    let end = start + measure(&mention);
    let id = textarea.add_extmark(start..end, options(prompt, kind));
    let mut parts = prompt.prompt.borrow_mut();
    let list = parts
        .as_object_mut()
        .map(|prompt| prompt.entry(kind.key()).or_insert_with(|| json!([])));
    let Some(Value::Array(list)) = list else {
        return;
    };
    let range = json!({ "start": start, "end": end, "text": mention });
    if kind == Kind::File
        && let Some(existing) = list.iter_mut().find(|file| file["uri"] == part["uri"])
    {
        if existing.get("mention").is_some_and(Value::is_object) {
            existing["mention"] = range;
        }
        return;
    }
    let mut part = part;
    part["mention"] = range;
    list.push(part);
    prompt
        .parts
        .0
        .borrow_mut()
        .push((id, kind, list.len() - 1));
}

/// The skills dialog's pick: `@id ` at the cursor, unless the prompt has the skill
/// (`prompt.skills` in `component/prompt/index.tsx`).
pub fn insert_skill(prompt: &Inner, id: &str) {
    if has(prompt, Kind::Skill, "id", &json!(id)) {
        return;
    }
    let mention = format!("@{id}");
    let start = prompt.textarea.cursor_offset();
    prompt.textarea.insert(format!("{mention} "));
    let end = start + measure(&mention);
    let mark = prompt
        .textarea
        .add_extmark(start..end, options(prompt, Kind::Skill));
    let mut info = prompt.prompt.borrow_mut();
    info["text"] = Value::String(prompt.textarea.text());
    if !info["skills"].is_array() {
        info["skills"] = json!([]);
    }
    let Some(skills) = info["skills"].as_array_mut() else {
        return;
    };
    skills.push(json!({ "id": id, "mention": { "start": start, "end": end, "text": mention } }));
    prompt
        .parts
        .0
        .borrow_mut()
        .push((mark, Kind::Skill, skills.len() - 1));
}

/// Marks the mentions of the `PromptInfo` the textarea now shows (`restoreExtmarksFromPrompt`).
pub fn restore(prompt: &Inner) {
    prompt.textarea.clear_extmarks();
    prompt.parts.clear();
    let info = prompt.prompt.borrow().clone();
    for kind in Kind::ALL {
        let list = info
            .get(kind.key())
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, part) in list.iter().enumerate() {
            let mention = &part["mention"];
            if mention["text"].as_str().is_none_or(str::is_empty) {
                continue;
            }
            let offset = |key: &str| mention[key].as_f64().unwrap_or_default() as u32;
            let id = prompt
                .textarea
                .add_extmark(offset("start")..offset("end"), options(prompt, kind));
            prompt.parts.0.borrow_mut().push((id, kind, index));
        }
    }
}

/// Copies the marks' ranges into their parts and drops parts whose marks an edit removed
/// (`syncExtmarksWithPromptParts`). Files without a mention stay.
pub fn sync(prompt: &Inner) {
    let mut marks = prompt.textarea.extmarks();
    // Marks in creation order, as TS lists them.
    marks.sort_by_key(|mark| mark.id);
    let mapped = prompt.parts.0.borrow().clone();
    let mut info = prompt.prompt.borrow_mut();
    let mut lists: [Vec<(Option<ExtmarkId>, Value)>; 3] = Default::default();
    for mark in &marks {
        let Some(&(_, kind, index)) = mapped.iter().find(|(id, _, _)| *id == mark.id) else {
            continue;
        };
        let Some(mut part) = info[kind.key()].get(index).cloned() else {
            continue;
        };
        if !part.get("mention").is_some_and(Value::is_object) {
            continue;
        }
        part["mention"]["start"] = json!(mark.start);
        part["mention"]["end"] = json!(mark.end);
        lists[kind as usize].push((Some(mark.id), part));
    }
    // `preserveMentionlessPromptAttachments`: mentionless files keep their places, and mentioned
    // ones are filled in order from the marks.
    let [files, agents, skills] = lists;
    let files = match info.get("files").and_then(Value::as_array) {
        None => files,
        Some(current) => {
            let mut tracked = files.into_iter();
            current
                .iter()
                .filter_map(|file| {
                    if file["mention"]["text"].as_str().is_none_or(str::is_empty) {
                        return Some((None, file.clone()));
                    }
                    tracked.next()
                })
                .collect()
        }
    };
    let mut next = Vec::new();
    for (kind, list) in Kind::ALL.into_iter().zip([files, agents, skills]) {
        let had = info.get(kind.key()).is_some();
        for (index, (id, _)) in list.iter().enumerate() {
            if let Some(id) = id {
                next.push((*id, kind, index));
            }
        }
        if had || !list.is_empty() {
            info[kind.key()] = Value::Array(list.into_iter().map(|(_, part)| part).collect());
        }
    }
    *prompt.parts.0.borrow_mut() = next;
}

/// Whether the prompt has a `kind` part whose `field` is `value` (`hasSkill`).
pub fn has(prompt: &Inner, kind: Kind, field: &str, value: &Value) -> bool {
    prompt.prompt.borrow()[kind.key()]
        .as_array()
        .is_some_and(|list| list.iter().any(|part| &part[field] == value))
}

/// The parts a submit sends, from a `PromptInfo` snapshot.
pub fn files(entry: &Value) -> Option<Vec<PromptInputFileAttachment>> {
    serde_json::from_value(entry.get(Kind::File.key())?.clone()).ok()
}

pub fn agents(entry: &Value) -> Option<Vec<PromptAgentAttachment>> {
    serde_json::from_value(entry.get(Kind::Agent.key())?.clone()).ok()
}

/// Skills, or `None` when there are none (`skills?.length ? skills : undefined`).
pub fn skills(entry: &Value) -> Option<Vec<PromptInputSkillAttachment>> {
    serde_json::from_value::<Vec<_>>(entry.get(Kind::Skill.key())?.clone())
        .ok()
        .filter(|skills| !skills.is_empty())
}

/// Replaces offsets `start..end` with `text` as one edit through the widget, so marks move.
pub fn replace(textarea: &Textarea, start: u32, end: u32, text: &str) {
    if start < end {
        let _ = textarea
            .view()
            .select_range(start, end, SelectionColors::default());
        if text.is_empty() {
            textarea.perform(EditorAction::Backspace);
            return;
        }
    }
    if !text.is_empty() {
        textarea.insert(text);
    }
}

/// An atomic mark in the kind's `extmark.*` style.
fn options(prompt: &Inner, kind: Kind) -> ExtmarkOptions {
    let options = ExtmarkOptions::default().atomic();
    let Some(tui) = prompt.tui.upgrade() else {
        return options;
    };
    match opencode_ui::code::syntax_theme(&tui.page()).get(kind.scope()) {
        Some(style) => options.style(style),
        None => options,
    }
}
