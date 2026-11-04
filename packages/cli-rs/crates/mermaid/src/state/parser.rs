//! State diagram parser (`state/parser.ts`).

use std::collections::HashSet;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use super::{
    Composite, Diagram, Note, NoteSide, State, StateDirection, StateKind, Transition,
    end_marker_id, start_marker_id,
};
use crate::core::text::{decode, first_meaningful_line, js_trim, numbered_lines, split_lines};
use crate::{Kind, SyntaxError};

fn pattern(source: &str) -> Regex {
    Regex::new(source).expect("state pattern")
}

static STATE: LazyLock<Regex> =
    LazyLock::new(|| pattern(r#"(?i)^state\s+"([^"]+)"\s+as\s+(\S+)$"#));
static COMPOSITE: LazyLock<Regex> =
    LazyLock::new(|| pattern(r#"(?i)^state\s+(?:"([^"]+)"\s+as\s+)?(\S+)\s*\{$"#));
static CHOICE: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^state\s+(\S+)\s+<<choice>>$"));
static TRANSITION: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)(?:\s*:\s*(.*))?$"));
static DIRECTION: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"(?i)^direction\s+(TB|TD|BT|LR|RL)$"));
static NOTE_INLINE: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"(?i)^note\s+(left|right)\s+of\s+(\S+)\s*:\s*(.*)$"));
static NOTE_START: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"(?i)^note\s+(left|right)\s+of\s+(\S+)\s*$"));
static NOTE_END: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^end\s+note$"));

fn is_header(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower == "statediagram-v2" || lower == "statediagram"
}

pub fn is_state(content: &str) -> bool {
    is_header(first_meaningful_line(content).unwrap_or(""))
}

fn side(value: &str) -> NoteSide {
    if value.eq_ignore_ascii_case("left") {
        NoteSide::Left
    } else {
        NoteSide::Right
    }
}

fn ensure(
    states: &mut IndexMap<String, State>,
    id: &str,
    label: &str,
    kind: StateKind,
    parent: Option<&str>,
) {
    if let Some(existing) = states.get_mut(id) {
        if existing.label == existing.id && label != id {
            existing.label = label.to_string();
        }
        if parent.is_some() && existing.parent_id.is_none() {
            existing.parent_id = parent.map(str::to_string);
        }
        if kind != StateKind::State {
            existing.kind = kind;
            existing.label = label.to_string();
        }
        return;
    }
    states.insert(
        id.to_string(),
        State {
            id: id.to_string(),
            label: label.to_string(),
            kind,
            parent_id: parent.map(str::to_string),
        },
    );
}

struct PendingNote {
    target: String,
    side: NoteSide,
    lines: Vec<String>,
    number: usize,
    source: String,
}

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let mut states: IndexMap<String, State> = IndexMap::new();
    let mut transitions: Vec<Transition> = Vec::new();
    let mut composites: Vec<Composite> = Vec::new();
    let mut notes: Vec<Note> = Vec::new();
    let mut parents: Vec<(String, usize, String)> = Vec::new();
    let mut pending: Option<PendingNote> = None;
    let mut direction = StateDirection::LR;
    let error = |number: usize, line: &str, reason: &str| {
        SyntaxError::new(Kind::State, number, line, reason)
    };

    for source in numbered_lines(content) {
        let line = source.text;
        if let Some(note) = &mut pending {
            if NOTE_END.is_match(line) {
                let note = pending.take().expect("pending note");
                notes.push(Note {
                    target: note.target,
                    side: note.side,
                    lines: note.lines.iter().map(|line| decode(line)).collect(),
                });
            } else if !line.is_empty() || !note.lines.is_empty() {
                note.lines.push(line.to_string());
            }
            continue;
        }
        if line.is_empty() || line.starts_with("%%") || is_header(line) {
            continue;
        }
        if line == "}" {
            if parents.pop().is_none() {
                return Err(error(
                    source.number,
                    line,
                    "Unexpected \"}\" without an open composite state",
                ));
            }
            continue;
        }
        let parent = parents.last().map(|open| open.0.clone());
        let parent = parent.as_deref();
        if let Some(captures) = DIRECTION.captures(line) {
            if !parents.is_empty() {
                return Err(error(
                    source.number,
                    line,
                    "Composite-local direction is not supported",
                ));
            }
            direction = StateDirection::parse(&captures[1]).unwrap_or(StateDirection::LR);
            continue;
        }
        if let Some(captures) = NOTE_INLINE.captures(line) {
            notes.push(Note {
                side: side(&captures[1]),
                target: captures[2].to_string(),
                lines: split_lines(&decode(js_trim(&captures[3]))),
            });
            continue;
        }
        if let Some(captures) = NOTE_START.captures(line) {
            pending = Some(PendingNote {
                side: side(&captures[1]),
                target: captures[2].to_string(),
                lines: Vec::new(),
                number: source.number,
                source: line.to_string(),
            });
            continue;
        }
        if let Some(captures) = COMPOSITE.captures(line) {
            let id = captures[2].to_string();
            composites.push(Composite {
                label: decode(captures.get(1).map_or(id.as_str(), |m| m.as_str())),
                id: id.clone(),
                parent_id: parent.map(str::to_string),
            });
            parents.push((id, source.number, line.to_string()));
            continue;
        }
        if let Some(captures) = STATE.captures(line) {
            ensure(
                &mut states,
                &captures[2],
                &decode(&captures[1]),
                StateKind::State,
                parent,
            );
            continue;
        }
        if let Some(captures) = CHOICE.captures(line) {
            ensure(&mut states, &captures[1], "", StateKind::Choice, parent);
            continue;
        }
        if let Some(captures) = TRANSITION.captures(line) {
            let raw_from = &captures[1];
            let raw_to = &captures[2];
            if raw_from.contains("-->") || raw_to.contains("-->") {
                return Err(SyntaxError::unsupported(Kind::State, source.number, line));
            }
            let from = if raw_from == "[*]" {
                start_marker_id(parent)
            } else {
                raw_from.to_string()
            };
            let to = if raw_to == "[*]" {
                end_marker_id(parent)
            } else {
                raw_to.to_string()
            };
            let (from_label, from_kind) = if raw_from == "[*]" {
                ("●", StateKind::Start)
            } else {
                (from.as_str(), StateKind::State)
            };
            ensure(&mut states, &from, from_label, from_kind, parent);
            let (to_label, to_kind) = if raw_to == "[*]" {
                ("◎", StateKind::End)
            } else {
                (to.as_str(), StateKind::State)
            };
            ensure(&mut states, &to, to_label, to_kind, parent);
            let label = decode(captures.get(3).map_or("", |m| js_trim(m.as_str())));
            transitions.push(Transition { from, to, label });
            continue;
        }
        return Err(SyntaxError::unsupported(Kind::State, source.number, line));
    }
    if let Some(note) = pending {
        return Err(error(
            note.number,
            &note.source,
            "Unclosed note; expected \"end note\"",
        ));
    }
    if let Some((_, number, line)) = parents.last() {
        return Err(error(
            *number,
            line,
            "Unclosed composite state; expected \"}\"",
        ));
    }
    if composites.is_empty() {
        return Ok(Diagram {
            direction,
            states: states.into_values().collect(),
            transitions,
            composites,
            notes,
        });
    }
    let ids: HashSet<&str> = composites
        .iter()
        .map(|composite| composite.id.as_str())
        .collect();
    let resolve = |id: &str, marker: fn(Option<&str>) -> String| {
        if !ids.contains(id) {
            return id.to_string();
        }
        let marker = marker(Some(id));
        if states.contains_key(&marker) {
            marker
        } else {
            id.to_string()
        }
    };
    let transitions = transitions
        .iter()
        .map(|transition| Transition {
            from: resolve(&transition.from, end_marker_id),
            to: resolve(&transition.to, start_marker_id),
            label: transition.label.clone(),
        })
        .collect();
    let states = states
        .values()
        .filter(|state| !ids.contains(state.id.as_str()))
        .cloned()
        .collect();
    Ok(Diagram {
        direction,
        states,
        transitions,
        composites,
        notes,
    })
}
