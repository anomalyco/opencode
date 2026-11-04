//! Sequence diagram parser (`sequence/parser.ts`).

use std::sync::LazyLock;

use regex::Regex;

use super::{Diagram, Fragment, FragmentKind, Group, Head, Message, Note, NoteSide, Participant, Step};
use crate::core::text::{first_meaningful_line, js_trim, meaningful_lines, strip_quotes};
use crate::{Kind, SyntaxError};

fn pattern(source: &str) -> Regex {
    Regex::new(source).expect("sequence pattern")
}

static MESSAGE: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"^(.+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)([+-]?)\s*(.+?)\s*:\s*(.*)$"));
static NOTE: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^note\s+(over|left\s+of|right\s+of)\s+(.+?)\s*:\s*(.*)$"));
static PARTICIPANT: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$"));
static ACTIVATION: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^(activate|deactivate)\s+(.+)$"));
static BOX: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^box(?:\s+(.+))?$"));
static ALT: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^alt\s+(.+)$"));
static ELSE: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^else(?:\s+(.+))?$"));
static LOOP: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^loop\s+(.+)$"));
static AUTONUMBER: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^autonumber(?:\s+(\d+)(?:\s+(\d+))?)?$"));
static BIDIRECTIONAL: LazyLock<Regex> = LazyLock::new(|| pattern(r"<<-{1,2}>>"));
static OPERATOR: LazyLock<Regex> = LazyLock::new(|| pattern(r"-->>|->>|--x|-x|--\)|-\)|-->|->"));
static HEX_COLOR: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^#[0-9a-f]{3,8}$"));
static RGB_COLOR: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^rgba?\(.+\)$"));
static RGB_START: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^rgba?\("));

const CSS_COLOR_NAMES: [&str; 28] = [
    "black",
    "white",
    "red",
    "green",
    "blue",
    "yellow",
    "cyan",
    "magenta",
    "silver",
    "gray",
    "grey",
    "maroon",
    "olive",
    "lime",
    "aqua",
    "teal",
    "navy",
    "fuchsia",
    "purple",
    "orange",
    "brightblack",
    "brightred",
    "brightgreen",
    "brightblue",
    "brightyellow",
    "brightcyan",
    "brightmagenta",
    "brightwhite",
];

pub fn is_sequence(content: &str) -> bool {
    first_meaningful_line(content).is_some_and(|line| line.to_lowercase() == "sequencediagram")
}

fn arrow_head(arrow: &str) -> Option<Head> {
    if arrow.ends_with('x') {
        return Some(Head::Cross);
    }
    if arrow.ends_with(')') {
        return Some(Head::Async);
    }
    if arrow.ends_with('>') && !arrow.ends_with(">>") {
        return Some(Head::Open);
    }
    None
}

fn is_box_color(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower == "transparent"
        || CSS_COLOR_NAMES.contains(&lower.as_str())
        || HEX_COLOR.is_match(value)
        || RGB_COLOR.is_match(value)
}

fn split_leading_box_token(value: &str) -> (&str, &str) {
    if RGB_START.is_match(value)
        && let Some(close) = value.find(')')
    {
        return (&value[..=close], js_trim(&value[close + 1..]));
    }
    match value.char_indices().find(|(_, ch)| ch.is_whitespace()) {
        None => (value, ""),
        Some((index, ch)) => (&value[..index], js_trim(&value[index + ch.len_utf8()..])),
    }
}

fn box_label(value: Option<&str>) -> String {
    let raw = js_trim(value.unwrap_or(""));
    if (raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\'')) {
        return strip_quotes(raw);
    }
    let label = strip_quotes(raw);
    if label.is_empty() {
        return String::new();
    }
    let (token, rest) = split_leading_box_token(&label);
    if is_box_color(token) { strip_quotes(rest) } else { label.clone() }
}

fn ensure_participant(participants: &mut Vec<Participant>, id: &str, label: Option<&str>, replace: bool) {
    if let Some(existing) = participants.iter_mut().find(|participant| participant.id == id) {
        if replace {
            existing.label = label.unwrap_or(id).to_string();
        }
        return;
    }
    participants.push(Participant { id: id.to_string(), label: label.unwrap_or(id).to_string() });
}

fn add_to_group(groups: &mut [Group], open: Option<usize>, id: &str) {
    if let Some(group) = open.map(|index| &mut groups[index])
        && !group.participant_ids.iter().any(|existing| existing == id)
    {
        group.participant_ids.push(id.to_string());
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Block {
    Box,
    Alt,
    Loop,
}

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let mut diagram = Diagram::default();
    let mut blocks: Vec<(Block, usize, String)> = Vec::new();
    let mut open_groups: Vec<usize> = Vec::new();
    let mut next_number: Option<i64> = None;
    let mut increment: i64 = 1;
    let error = |line: usize, source: &str| SyntaxError::unsupported(Kind::Sequence, line, source);

    for source in meaningful_lines(content) {
        let line = source.text;
        if line.to_lowercase() == "sequencediagram" {
            continue;
        }
        if BIDIRECTIONAL.is_match(line) {
            return Err(error(source.number, line));
        }
        if let Some(captures) = AUTONUMBER.captures(line) {
            next_number = Some(captures.get(1).map_or(1, |m| m.as_str().parse().unwrap_or(1)));
            increment = captures.get(2).map_or(1, |m| m.as_str().parse().unwrap_or(1));
            continue;
        }
        if let Some(captures) = BOX.captures(line) {
            diagram
                .groups
                .push(Group { label: box_label(captures.get(1).map(|m| m.as_str())), participant_ids: Vec::new() });
            open_groups.push(diagram.groups.len() - 1);
            blocks.push((Block::Box, source.number, line.to_string()));
            continue;
        }
        if let Some(captures) = PARTICIPANT.captures(line) {
            let id = strip_quotes(&captures[1]);
            let label = strip_quotes(captures.get(2).map_or(id.as_str(), |m| m.as_str()));
            ensure_participant(&mut diagram.participants, &id, Some(&label), true);
            add_to_group(&mut diagram.groups, open_groups.last().copied(), &id);
            continue;
        }
        if let Some(captures) = NOTE.captures(line) {
            let position = captures[1].to_lowercase();
            let side = if position.starts_with("left") {
                Some(NoteSide::Left)
            } else if position.starts_with("right") {
                Some(NoteSide::Right)
            } else {
                None
            };
            let over: Vec<String> =
                captures[2].split(',').map(strip_quotes).filter(|participant| !participant.is_empty()).collect();
            for participant in &over {
                ensure_participant(&mut diagram.participants, participant, None, false);
            }
            diagram.steps.push(Step::Note(Note { over, label: strip_quotes(&captures[3]), side }));
            continue;
        }
        if let Some(captures) = ACTIVATION.captures(line) {
            let participant = strip_quotes(&captures[2]);
            ensure_participant(&mut diagram.participants, &participant, None, false);
            diagram
                .steps
                .push(Step::Activation { participant, active: captures[1].to_lowercase() == "activate" });
            continue;
        }
        if let Some(captures) = ALT.captures(line) {
            blocks.push((Block::Alt, source.number, line.to_string()));
            diagram
                .steps
                .push(Step::Fragment(Fragment { kind: FragmentKind::Alt, label: strip_quotes(&captures[1]) }));
            continue;
        }
        if let Some(captures) = LOOP.captures(line) {
            blocks.push((Block::Loop, source.number, line.to_string()));
            diagram
                .steps
                .push(Step::Fragment(Fragment { kind: FragmentKind::Loop, label: strip_quotes(&captures[1]) }));
            continue;
        }
        if let Some(captures) = ELSE.captures(line) {
            if blocks.last().map(|block| block.0) != Some(Block::Alt) {
                return Err(SyntaxError::new(
                    Kind::Sequence,
                    source.number,
                    line,
                    "Unexpected \"else\" without an open \"alt\" block",
                ));
            }
            let label = strip_quotes(captures.get(1).map_or("", |m| m.as_str()));
            diagram.steps.push(Step::Fragment(Fragment { kind: FragmentKind::Else, label }));
            continue;
        }
        if line.to_lowercase() == "end" {
            let Some((block, _, _)) = blocks.pop() else {
                return Err(SyntaxError::new(
                    Kind::Sequence,
                    source.number,
                    line,
                    "Unexpected \"end\" without an open block",
                ));
            };
            let label = match block {
                Block::Box => {
                    open_groups.pop();
                    continue;
                }
                Block::Alt => "alt",
                Block::Loop => "loop",
            };
            diagram.steps.push(Step::Fragment(Fragment { kind: FragmentKind::End, label: label.to_string() }));
            continue;
        }
        if let Some(captures) = MESSAGE.captures(line) {
            let from = strip_quotes(&captures[1]);
            let arrow = &captures[2];
            let marker = &captures[3];
            let to = strip_quotes(&captures[4]);
            if OPERATOR.is_match(&from) || OPERATOR.is_match(&to) {
                return Err(error(source.number, line));
            }
            ensure_participant(&mut diagram.participants, &from, None, false);
            ensure_participant(&mut diagram.participants, &to, None, false);
            let group = open_groups.last().copied();
            add_to_group(&mut diagram.groups, group, &from);
            add_to_group(&mut diagram.groups, group, &to);
            let number = next_number;
            if let Some(current) = next_number {
                next_number = Some(current + increment);
            }
            diagram.steps.push(Step::Message(Message {
                label: strip_quotes(&captures[5]),
                dashed: arrow.starts_with("--"),
                head: arrow_head(arrow),
                number,
                activate: (marker == "+").then(|| to.clone()),
                deactivate: (marker == "-").then(|| from.clone()),
                from,
                to,
            }));
            continue;
        }
        return Err(error(source.number, line));
    }
    if let Some((block, number, line)) = blocks.last() {
        let name = match block {
            Block::Box => "box",
            Block::Alt => "alt",
            Block::Loop => "loop",
        };
        return Err(SyntaxError::new(
            Kind::Sequence,
            *number,
            line,
            &format!("Unclosed {name} block; expected \"end\""),
        ));
    }
    Ok(diagram)
}
