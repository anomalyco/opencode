//! Atomic prompt extmarks for file, agent, and skill mentions.

use opencode_api::generated::{PromptAgentAttachment, PromptInputSkillAttachment};
use opentui::widget::{ExtmarkId, ExtmarkOptions};

use opencode_ui::prompt_input;

use crate::prelude::*;
use crate::prompt::editor::Inner;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    File,
    Agent,
    Skill,
    Pasted,
}

impl Kind {
    const ALL: [Kind; 4] = [Kind::File, Kind::Agent, Kind::Skill, Kind::Pasted];

    pub(crate) fn key(self) -> &'static str {
        match self {
            Kind::File => "files",
            Kind::Agent => "agents",
            Kind::Skill => "skills",
            Kind::Pasted => "pasted",
        }
    }

    fn scope(self) -> &'static str {
        match self {
            Kind::File => "extmark.file",
            Kind::Agent => "extmark.agent",
            Kind::Skill => "extmark.skill",
            Kind::Pasted => "extmark.paste",
        }
    }

    fn range(self) -> &'static str {
        match self {
            Kind::Pasted => "source",
            _ => "mention",
        }
    }
}

#[derive(Default)]
pub struct Parts {
    marks: RefCell<Vec<(ExtmarkId, Kind, usize)>>,
    /// Keep removed paste data by mark ID so undo and redo can restore it.
    dropped: RefCell<Vec<Dropped>>,
}

struct Dropped {
    id: ExtmarkId,
    label: String,
    text: String,
}

impl Parts {
    pub fn clear(&self) {
        self.marks.borrow_mut().clear();
        self.dropped.borrow_mut().clear();
    }

    pub fn track(&self, mark: ExtmarkId, kind: Kind, index: usize) {
        self.marks.borrow_mut().push((mark, kind, index));
    }

    pub fn get(&self, mark: ExtmarkId) -> Option<(Kind, usize)> {
        self.marks.borrow().iter().find(|(id, _, _)| *id == mark).map(|&(_, kind, index)| (kind, index))
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
    let next = textarea.buffer().range(cursor, cursor + 1).unwrap_or_default();
    let mention = format!("@{text}");
    let inserted = if next == " " { mention.clone() } else { format!("{mention} ") };
    replace(textarea, start, cursor, &inserted);
    let end = prompt_input::after(textarea, start, &mention);
    let id = textarea.add_extmark(start..end, options(prompt, kind));
    let mut parts = prompt.prompt.borrow_mut();
    let list = parts.as_object_mut().map(|prompt| prompt.entry(kind.key()).or_insert_with(|| json!([])));
    let Some(Value::Array(list)) = list else { return };
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
    prompt.parts.marks.borrow_mut().push((id, kind, list.len() - 1));
}

/// Insert the selected skill at the cursor unless the prompt already includes it.
pub fn insert_skill(prompt: &Inner, id: &str) {
    if has(prompt, Kind::Skill, "id", &json!(id)) {
        return;
    }
    let mention = format!("@{id}");
    let start = prompt.textarea.cursor_offset();
    prompt.textarea.insert(format!("{mention} "));
    let end = prompt_input::after(&prompt.textarea, start, &mention);
    let mark = prompt.textarea.add_extmark(start..end, options(prompt, Kind::Skill));
    let mut info = prompt.prompt.borrow_mut();
    info["text"] = Value::String(prompt.textarea.text());
    if !info["skills"].is_array() {
        info["skills"] = json!([]);
    }
    let Some(skills) = info["skills"].as_array_mut() else { return };
    skills.push(json!({ "id": id, "mention": { "start": start, "end": end, "text": mention } }));
    prompt.parts.marks.borrow_mut().push((mark, Kind::Skill, skills.len() - 1));
}

/// Restore mention extmarks for the displayed prompt.
pub fn restore(prompt: &Inner) {
    prompt.textarea.clear_extmarks();
    prompt.parts.clear();
    let info = prompt.prompt.borrow().clone();
    for kind in Kind::ALL {
        let list = info.get(kind.key()).and_then(Value::as_array).cloned().unwrap_or_default();
        for (index, part) in list.iter().enumerate() {
            let mention = &part[kind.range()];
            if mention["text"].as_str().is_none_or(str::is_empty) {
                continue;
            }
            let offset = |key: &str| mention[key].as_f64().unwrap_or_default() as u32;
            let id = prompt.textarea.add_extmark(offset("start")..offset("end"), options(prompt, kind));
            prompt.parts.marks.borrow_mut().push((id, kind, index));
        }
    }
}

/// Reapply mention styles without changing text, selection, or edit history.
pub fn restyle(prompt: &Inner, old: &Theme, new: &Theme) {
    const SCOPES: [&str; 4] = ["extmark.file", "extmark.agent", "extmark.skill", "extmark.paste"];
    let (old, new) = (opencode_ui::code::syntax_theme(old), opencode_ui::code::syntax_theme(new));
    let mut marks = prompt.textarea.extmarks();
    marks.sort_by_key(|mark| mark.id);
    let mut tracked = prompt.parts.marks.borrow_mut();
    for mark in marks {
        let Some(scope) =
            SCOPES.iter().find(|scope| mark.options.style.is_some() && old.get(scope) == mark.options.style)
        else {
            continue;
        };
        let mut options = mark.options;
        options.style = new.get(scope);
        prompt.textarea.remove_extmark(mark.id);
        let id = prompt.textarea.add_extmark(mark.range(), options);
        if let Some(entry) = tracked.iter_mut().find(|(tracked, _, _)| *tracked == mark.id) {
            entry.0 = id;
        }
    }
}

/// Copies the marks' ranges into their parts and drops parts whose marks an edit removed
/// (`syncExtmarksWithPromptParts`). Files without a mention stay.
pub fn sync(prompt: &Inner) {
    let mut marks = prompt.textarea.extmarks();
    marks.sort_by_key(|mark| mark.id);
    let mut mapped = prompt.parts.marks.borrow().clone();
    let mut info = prompt.prompt.borrow_mut();
    let mut dropped = prompt.parts.dropped.borrow_mut();
    let gone = mapped.iter().filter(|(id, kind, _)| *kind == Kind::Pasted && !marks.iter().any(|mark| mark.id == *id));
    dropped.extend(gone.filter_map(|&(id, _, index)| {
        let paste = &info[Kind::Pasted.key()][index];
        Some(Dropped {
            id,
            label: paste["source"]["text"].as_str()?.to_owned(),
            text: paste["text"].as_str()?.to_owned(),
        })
    }));
    // Undo and redo bring back a removed paste's mark with its id; it is the paste again while its label is there.
    for mark in &marks {
        let Some(at) = dropped.iter().position(|paste| paste.id == mark.id) else { continue };
        if prompt.textarea.buffer().range(mark.start, mark.end).unwrap_or_default() != dropped[at].label {
            continue;
        }
        let paste = dropped.remove(at);
        if !info[Kind::Pasted.key()].is_array() {
            info[Kind::Pasted.key()] = json!([]);
        }
        let Some(pasted) = info[Kind::Pasted.key()].as_array_mut() else { continue };
        pasted.push(
            json!({ "text": paste.text, "source": { "start": mark.start, "end": mark.end, "text": paste.label } }),
        );
        mapped.push((mark.id, Kind::Pasted, pasted.len() - 1));
    }
    drop(dropped);
    let mut lists: [Vec<(Option<ExtmarkId>, Value)>; 4] = Default::default();
    for mark in &marks {
        let Some(&(_, kind, index)) = mapped.iter().find(|(id, _, _)| *id == mark.id) else { continue };
        let Some(mut part) = info[kind.key()].get(index).cloned() else { continue };
        if !part.get(kind.range()).is_some_and(Value::is_object) {
            continue;
        }
        part[kind.range()]["start"] = json!(mark.start);
        part[kind.range()]["end"] = json!(mark.end);
        lists[kind as usize].push((Some(mark.id), part));
    }
    // `preserveMentionlessPromptAttachments`: mentionless files keep their places, and mentioned
    // ones are filled in order from the marks.
    let [files, agents, skills, pasted] = lists;
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
    for (kind, list) in Kind::ALL.into_iter().zip([files, agents, skills, pasted]) {
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
    *prompt.parts.marks.borrow_mut() = next;
}

pub fn has(prompt: &Inner, kind: Kind, field: &str, value: &Value) -> bool {
    prompt.prompt.borrow()[kind.key()].as_array().is_some_and(|list| list.iter().any(|part| &part[field] == value))
}

pub fn agents(entry: &Value) -> Option<Vec<PromptAgentAttachment>> {
    serde_json::from_value(entry.get(Kind::Agent.key())?.clone()).ok()
}

pub fn skills(entry: &Value) -> Option<Vec<PromptInputSkillAttachment>> {
    serde_json::from_value::<Vec<_>>(entry.get(Kind::Skill.key())?.clone()).ok().filter(|skills| !skills.is_empty())
}

pub use opencode_ui::prompt_input::replace;

/// An atomic mark in the kind's `extmark.*` style.
fn options(prompt: &Inner, kind: Kind) -> ExtmarkOptions {
    styled(prompt, kind.scope())
}

/// An atomic mark in the style of `scope`: pasted attachments are files in the `extmark.paste` style.
pub(crate) fn styled(prompt: &Inner, scope: &str) -> ExtmarkOptions {
    let options = ExtmarkOptions::default().atomic();
    let Some(tui) = prompt.tui.upgrade() else { return options };
    match opencode_ui::code::syntax_theme(&tui.page()).get(scope) {
        Some(style) => options.style(style),
        None => options,
    }
}
