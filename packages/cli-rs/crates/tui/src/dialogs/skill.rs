//! Skills dialog (E.17b, row DLG19): `packages/tui/src/component/dialog-skill.tsx`.
//!
//! "Skills": the location's skills, read once if the store has none, with the description after
//! the padded name. Choosing one hands its ID to the caller and closes the dialog; the prompt
//! inserts an `@skill` mention ([`mention`]) and sends it as a skill attachment ([`attachments`]).

use std::cell::Cell;
use std::rc::Rc;

use opencode_api::generated::{PromptInputSkillAttachment, PromptMention, SkillID, SkillInfo};
use opencode_store::{Catalog, Location};
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions, DialogSize};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opentui::prelude::*;
use serde_json::{Value, json};
use unicode_width::UnicodeWidthStr;

use crate::app::Tui;

/// What choosing a skill does.
pub type OnSelect = Rc<dyn Fn(&Tui, &SkillID)>;

/// Opens the dialog for `location` (the default one for `None`).
pub fn show(tui: &Tui, location: Option<Location>, on_select: OnSelect) {
    let location =
        location.unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()));
    let cached = tui.data.read(|state| {
        state
            .location(Some(&location))
            .and_then(|data| data.skill.clone())
    });
    if let Some(skills) = cached {
        open(tui, Load::Loaded(skills), on_select);
        return;
    }
    let open_now = open(tui, Load::Loading, on_select.clone());
    let weak = tui.weak();
    let read = location.clone();
    tui.app.spawn(
        tui.data.catalog_sync(Catalog::Skill, Some(&location)),
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            // Closed meanwhile: reopening it would surprise.
            if !open_now.get() {
                return;
            }
            let load = match result {
                Ok(()) => Load::Loaded(tui.data.read(|state| {
                    state
                        .location(Some(&read))
                        .and_then(|data| data.skill.clone())
                        .unwrap_or_default()
                })),
                Err(error) => Load::Failed(error.to_string()),
            };
            open(&tui, load, on_select);
        },
    );
}

enum Load {
    Loading,
    Loaded(Vec<SkillInfo>),
    Failed(String),
}

/// Shows the dialog in `load`'s state. The returned flag clears when this dialog closes.
fn open(tui: &Tui, load: Load, on_select: OnSelect) -> Rc<Cell<bool>> {
    let alive = Rc::new(Cell::new(true));
    let flag = alive.clone();
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let loaded = matches!(load, Load::Loaded(_));
            let options = match &load {
                Load::Loaded(skills) => options(skills),
                _ => Vec::new(),
            };
            let mut props = SelectProps::new("Skills", options);
            props.render_filter = loaded;
            props.locked = !loaded;
            props.on_select = Some(Rc::new(move |option: &SelectOption<SkillID>| {
                let Some(tui) = weak.upgrade() else { return };
                let (id, on_select, weak) = (option.value.clone(), on_select.clone(), tui.weak());
                tui.app.defer(move |_| {
                    let Some(tui) = weak.upgrade() else { return };
                    on_select(&tui, &id);
                    tui.dialogs.clear();
                });
            }));
            let (app, theme) = (cx.app.clone(), cx.theme.clone());
            let inset = |children: Vec<AnyWidget>| {
                let view = View::new(&app).padding_x(DIALOG_LIST_INSET);
                for child in children {
                    view.add(&child);
                }
                view.as_any()
            };
            let empty = match &load {
                Load::Failed(error) => inset(vec![
                    Text::new(&app, "Could not load skills")
                        .fg(theme.text.feedback.error.base)
                        .bold()
                        .as_any(),
                    Text::new(&app, error.clone()).fg(theme.text.muted).as_any(),
                    Text::new(&app, "Close and reopen Skills to try again.")
                        .fg(theme.text.muted)
                        .as_any(),
                ]),
                Load::Loading => inset(vec![
                    Text::new(&app, "Loading skills…")
                        .fg(theme.text.muted)
                        .as_any(),
                ]),
                Load::Loaded(_) => inset(vec![
                    Text::new(&app, "No skills available")
                        .fg(theme.text.muted)
                        .as_any(),
                ]),
            };
            props.empty_view = Some(Rc::new(move || empty.clone()));
            let no_match = inset(vec![
                Text::new(&app, "No skills found")
                    .fg(theme.text.muted)
                    .as_any(),
            ]);
            props.no_match_view = Some(Rc::new(move || no_match.clone()));
            let (view, _) = select::select(cx, props);
            cx.on_close(opentui::keymap::Disposer::new(move || flag.set(false)));
            view
        },
        None,
        DialogOptions {
            size: DialogSize::Large,
            key: None,
        },
    );
    alive
}

/// The rows: names padded to the longest, descriptions on one line.
fn options(skills: &[SkillInfo]) -> Vec<SelectOption<SkillID>> {
    // `padEnd` counts UTF-16 units; skill names are ASCII identifiers.
    let width = skills
        .iter()
        .map(|skill| skill.name.0.chars().count())
        .max()
        .unwrap_or(0);
    skills
        .iter()
        .map(|skill| {
            let mut option =
                SelectOption::new(format!("{:<width$}", skill.name.0), skill.id.clone());
            option.description = skill
                .description
                .as_deref()
                .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|text| !text.is_empty());
            option
        })
        .collect()
}

/// The prompt's `prompt.skills` pick: inserts `@id ` at `cursor` and records the part in
/// `prompt` (a `PromptInfo`), unless the prompt already mentions the skill. Returns the text to
/// insert, or `None`.
pub fn mention(prompt: &mut Value, text: &str, cursor: u32, id: &SkillID) -> Option<String> {
    if attachments(prompt, text)
        .iter()
        .any(|attachment| &attachment.id == id)
    {
        return None;
    }
    let mention = format!("@{}", id.0);
    let part = json!({
        "id": id.0,
        "mention": { "start": cursor, "end": cursor + mention.width() as u32, "text": mention },
    });
    let skills = prompt
        .as_object_mut()?
        .entry("skills")
        .or_insert_with(|| Value::Array(Vec::new()));
    if let Value::Array(skills) = skills {
        // Parts whose mention was edited away go, as their extmarks do in TS.
        skills.retain(|part| mention_text(part).is_some_and(|mentioned| text.contains(mentioned)));
        skills.push(part);
    }
    Some(format!("{mention} "))
}

/// The skill parts of `prompt` that `text` still mentions, with offsets where the text has them
/// now (TS keeps them on extmarks).
pub fn attachments(prompt: &Value, text: &str) -> Vec<PromptInputSkillAttachment> {
    let parts = prompt
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    parts
        .iter()
        .filter_map(|part| {
            let id = SkillID(part.get("id")?.as_str()?.to_owned());
            let mention = mention_text(part)?;
            let at = text.find(mention)?;
            let start = offset(&text[..at]);
            Some(PromptInputSkillAttachment {
                id,
                mention: Some(PromptMention {
                    start: f64::from(start),
                    end: f64::from(start + mention.width() as u32),
                    text: mention.to_owned(),
                }),
            })
        })
        .collect()
}

fn mention_text(part: &Value) -> Option<&str> {
    part.get("mention")?.get("text")?.as_str()
}

/// The textarea's cursor offset at the end of `text`: display width, a newline counting one.
fn offset(text: &str) -> u32 {
    let lines: Vec<&str> = text.split('\n').collect();
    (lines.iter().map(|line| line.width()).sum::<usize>() + lines.len() - 1) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mention_records_the_part_and_attachments_follow_the_text() {
        let mut prompt = json!({ "text": "" });
        let id = SkillID("review".into());
        assert_eq!(
            mention(&mut prompt, "fix ", 4, &id).as_deref(),
            Some("@review ")
        );
        // A second pick of the same skill while it is mentioned inserts nothing.
        assert_eq!(mention(&mut prompt, "fix @review ", 12, &id), None);
        let sent = attachments(&prompt, "please fix @review now");
        assert_eq!(sent.len(), 1);
        let mention = sent[0].mention.as_ref().unwrap();
        assert_eq!((mention.start, mention.end), (11.0, 18.0));
        assert_eq!(mention.text, "@review");
        assert!(attachments(&prompt, "please fix now").is_empty());
    }
}
