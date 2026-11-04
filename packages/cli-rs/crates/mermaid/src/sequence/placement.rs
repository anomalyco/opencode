//! Sequence diagram placement (`sequence/placement.ts`).

use std::collections::HashMap;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use super::{Diagram, Fragment, FragmentKind, Group, Message, Note, NoteSide, Step};
use crate::core::text::width;

const NOTE_HORIZONTAL_PADDING: i32 = 2;
const GROUP_HORIZONTAL_PADDING: i32 = 2;
const FRAGMENT_HORIZONTAL_OVERHANG: i32 = 3;
pub const DEFAULT_MIN_PARTICIPANT_GAP: i32 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HBounds {
    pub left: i32,
    pub right: i32,
}

impl HBounds {
    fn expand(&mut self, left: i32, right: i32) {
        self.left = self.left.min(left);
        self.right = self.right.max(right);
    }
}

pub struct ParticipantPlacement {
    pub center: i32,
    pub header_left: i32,
    pub header_right: i32,
    pub label_lines: Vec<String>,
}

pub struct GroupPlacement {
    pub label: String,
    pub left: i32,
    pub right: i32,
}

pub struct Walls {
    pub bounds: HBounds,
    pub start: i32,
    pub end: i32,
}

pub struct Activation {
    pub center: i32,
    pub start: i32,
    pub end: i32,
}

pub enum StepPlacement<'a> {
    Note { lines: Vec<String>, x: i32, y: i32 },
    Fragment { fragment: &'a Fragment, label: String, bounds: HBounds, y: i32, walls_before: Option<Walls> },
    Message {
        message: &'a Message,
        label_lines: Vec<String>,
        label_x: i32,
        label_y: i32,
        arrow_y: i32,
        from_x: i32,
        left: i32,
        right: i32,
        head_x: i32,
        direction: i32,
        inline_label: Option<String>,
    },
    SelfMessage { message: &'a Message, label_lines: Vec<String>, center: i32, right: i32, top: i32, bottom: i32 },
}

pub struct Rows {
    pub header_y: i32,
    pub rule_y: i32,
    pub lifeline_start: i32,
    pub lifeline_end: i32,
}

pub struct Plan<'a> {
    pub width: i32,
    pub height: i32,
    pub rows: Rows,
    pub participants: Vec<ParticipantPlacement>,
    pub groups: Vec<GroupPlacement>,
    pub activations: Vec<Activation>,
    pub steps: Vec<StepPlacement<'a>>,
}

static LABEL_BREAK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:<br\s*/?\s*>|\\n)").expect("label break pattern"));

fn label_lines(label: &str) -> Vec<String> {
    LABEL_BREAK.split(label).map(|line| line.trim_end().to_string()).collect()
}

fn lines_width(lines: &[String]) -> i32 {
    lines.iter().map(|line| width(line)).max().unwrap_or(0).max(0)
}

fn note_lines(label: &str) -> Vec<String> {
    let lines = label_lines(label);
    let total = lines_width(&lines);
    let padding = " ".repeat(NOTE_HORIZONTAL_PADDING as usize);
    lines
        .iter()
        .map(|line| format!("{padding}{line}{}{padding}", " ".repeat((total - width(line)).max(0) as usize)))
        .collect()
}

fn message_text(message: &Message) -> String {
    match message.number {
        Some(number) => format!("{number}. {}", message.label),
        None => message.label.clone(),
    }
}

fn header_width(label: &str, compact: bool) -> i32 {
    let width = lines_width(&label_lines(label));
    if compact { width } else { width.max(3) }
}

fn fragment_label(fragment: &Fragment) -> String {
    let prefix = match fragment.kind {
        FragmentKind::End => return String::new(),
        FragmentKind::Loop => "↻ loop",
        FragmentKind::Alt => "alt",
        FragmentKind::Else => "else",
    };
    format!(" {prefix}: {} ", fragment.label)
}

fn message_width(message: &Message) -> i32 {
    lines_width(&label_lines(&message_text(message)))
}

fn self_loop_width_for(lines: &[String]) -> i32 {
    10.max(lines_width(lines) + 4)
}

fn self_loop_width(message: &Message) -> i32 {
    self_loop_width_for(&label_lines(&message_text(message)))
}

fn inline_label(message: &Message, lines: &[String], from_x: i32, to_x: i32, compact: bool) -> Option<String> {
    if !compact || message.from == message.to || lines.len() != 1 {
        return None;
    }
    let label = format!(" {} ", lines[0]);
    (width(&label) <= (to_x - from_x).abs() - 3).then_some(label)
}

struct Context<'a> {
    diagram: &'a Diagram,
    indexes: HashMap<&'a str, usize>,
    compact: bool,
}

impl Context<'_> {
    fn index(&self, id: &str) -> Option<usize> {
        self.indexes.get(id).copied()
    }

    fn indexes_of<'b>(&self, ids: impl IntoIterator<Item = &'b String>) -> Vec<usize> {
        ids.into_iter().filter_map(|id| self.index(id)).collect()
    }

    fn step_height(&self, step: &Step, centers: &[i32]) -> i32 {
        match step {
            Step::Note(note) => note_lines(&note.label).len() as i32 + 2,
            Step::Activation { .. } => 0,
            Step::Fragment(_) => 2,
            Step::Message(message) => {
                let lines = label_lines(&message_text(message));
                if let (Some(from), Some(to)) = (self.index(&message.from), self.index(&message.to))
                    && inline_label(message, &lines, centers[from], centers[to], self.compact).is_some()
                {
                    return 2;
                }
                lines.len() as i32 + if message.from == message.to { 3 } else { 2 }
            }
        }
    }

    fn step_indexes(&self, step: &Step) -> Vec<usize> {
        match step {
            Step::Message(message) => self.indexes_of([&message.from, &message.to]),
            Step::Note(note) => self.indexes_of(&note.over),
            _ => Vec::new(),
        }
    }

    fn note_x(&self, note: &Note, indexes: &[usize], centers: &[i32], note_width: i32) -> i32 {
        let low = *indexes.iter().min().unwrap_or(&0);
        let high = *indexes.iter().max().unwrap_or(&0);
        let center = (centers[low] + centers[high]).div_euclid(2);
        match note.side {
            Some(NoteSide::Left) => center - note_width - 2,
            Some(NoteSide::Right) => center + 2,
            None => center - note_width.div_euclid(2),
        }
    }

    fn step_content(&self, step: &Step, centers: &[i32]) -> Option<HBounds> {
        match step {
            Step::Message(message) => {
                let from = self.index(&message.from)?;
                let to = self.index(&message.to)?;
                let (from_x, to_x) = (centers[from], centers[to]);
                if from == to {
                    return Some(HBounds { left: from_x, right: from_x + self_loop_width(message) });
                }
                let left = from_x.min(to_x);
                let right = from_x.max(to_x);
                let label_left = left + 2;
                Some(HBounds { left: left.min(label_left), right: right.max(label_left + message_width(message) - 1) })
            }
            Step::Note(note) => {
                let indexes = self.indexes_of(&note.over);
                if indexes.is_empty() {
                    return None;
                }
                let note_width = lines_width(&note_lines(&note.label));
                let left = self.note_x(note, &indexes, centers, note_width);
                Some(HBounds { left, right: left + note_width - 1 })
            }
            _ => None,
        }
    }
}

struct Range<'a> {
    group: &'a Group,
    start: usize,
    end: usize,
}

fn group_ranges<'a>(context: &Context<'a>) -> Vec<Range<'a>> {
    context
        .diagram
        .groups
        .iter()
        .filter_map(|group| {
            let indexes = context.indexes_of(&group.participant_ids);
            Some(Range { group, start: *indexes.iter().min()?, end: *indexes.iter().max()? })
        })
        .collect()
}

fn group_bounds(context: &Context, centers: &[i32], ranges: &[Range]) -> Vec<GroupPlacement> {
    ranges
        .iter()
        .map(|range| {
            let mut left = centers[range.start];
            let mut right = centers[range.end];
            let participants = &context.diagram.participants[range.start..=range.end];
            for (participant, center) in participants.iter().zip(&centers[range.start..=range.end]) {
                let header = header_width(&participant.label, context.compact);
                let start = center - header.div_euclid(2);
                left = left.min(start);
                right = right.max(start + header - 1);
            }
            for step in &context.diagram.steps {
                let indexes = context.step_indexes(step);
                if indexes.is_empty() || !indexes.iter().all(|&index| index >= range.start && index <= range.end) {
                    continue;
                }
                if let Some(bounds) = context.step_content(step, centers) {
                    left = left.min(bounds.left);
                    right = right.max(bounds.right);
                }
            }
            let label = if range.group.label.is_empty() { String::new() } else { format!(" {} ", range.group.label) };
            let mut left = left - GROUP_HORIZONTAL_PADDING;
            let mut right = right + GROUP_HORIZONTAL_PADDING;
            let extra = 0.max(width(&label) + 4 - (right - left + 1));
            left -= extra.div_euclid(2);
            right += extra - extra.div_euclid(2);
            GroupPlacement { label, left, right }
        })
        .collect()
}

fn content_bounds(context: &Context, centers: &[i32]) -> HBounds {
    let mut bounds = HBounds { left: 0, right: 0 };
    for (index, participant) in context.diagram.participants.iter().enumerate() {
        let header = header_width(&participant.label, context.compact);
        let start = centers[index] - header.div_euclid(2);
        bounds.expand(start, start + header - 1);
    }
    for step in &context.diagram.steps {
        if let Some(content) = context.step_content(step, centers) {
            bounds.expand(content.left, content.right);
        }
    }
    bounds
}

fn fragment_frame(centers: &[i32], fragment: &Fragment, depth: i32) -> Option<HBounds> {
    let first = *centers.first()?;
    let last = *centers.last()?;
    let left = first - FRAGMENT_HORIZONTAL_OVERHANG + depth;
    let participant_right = last + FRAGMENT_HORIZONTAL_OVERHANG - depth;
    Some(HBounds { left, right: participant_right.max(left + 2 + width(&fragment_label(fragment)) + 1) })
}

fn fragment_frames(context: &Context, centers: &[i32]) -> IndexMap<usize, HBounds> {
    let mut by_step: IndexMap<usize, HBounds> = IndexMap::new();
    let mut active: Vec<(usize, HBounds)> = Vec::new();
    for (index, step) in context.diagram.steps.iter().enumerate() {
        let Step::Fragment(fragment) = step else {
            if let Some(content) = context.step_content(step, centers) {
                for frame in &mut active {
                    frame.1.expand(content.left - 1, content.right + 1);
                }
            }
            continue;
        };
        let Some(bounds) = fragment_frame(centers, fragment, active.len() as i32) else {
            continue;
        };
        if matches!(fragment.kind, FragmentKind::Alt | FragmentKind::Loop) {
            active.push((index, bounds));
            continue;
        }
        let Some(frame) = active.last_mut() else {
            continue;
        };
        frame.1.expand(bounds.left, bounds.right);
        if fragment.kind != FragmentKind::End {
            continue;
        }
        let Some((start, bounds)) = active.pop() else {
            continue;
        };
        by_step.insert(start, bounds);
        if let Some(parent) = active.last_mut() {
            parent.1.expand(bounds.left - 1, bounds.right + 1);
        }
    }
    for (start, bounds) in active {
        by_step.insert(start, bounds);
    }
    by_step
}

fn participant_centers(context: &Context, min_gap: i32) -> Vec<i32> {
    let participants = &context.diagram.participants;
    let compact = context.compact;
    let mut gaps: Vec<i32> = participants
        .windows(2)
        .map(|pair| {
            let half = |label: &str| {
                let width = header_width(label, compact);
                width - width.div_euclid(2)
            };
            min_gap.max(half(&pair[0].label) + half(&pair[1].label) + 6)
        })
        .collect();
    for message in context.diagram.messages() {
        let from = context.index(&message.from);
        let to = context.index(&message.to);
        if let (Some(from), Some(to)) = (from, to)
            && from == to
        {
            if from < participants.len() - 1 {
                let next = lines_width(&label_lines(&participants[from + 1].label));
                gaps[from] = gaps[from].max(self_loop_width(message) + (next - next.div_euclid(2)) + 2);
            }
            continue;
        }
        let (Some(from), Some(to)) = (from, to) else {
            continue;
        };
        if from.abs_diff(to) != 1 {
            continue;
        }
        let gap = from.min(to);
        gaps[gap] = gaps[gap].max(message_width(message) + 6);
    }
    for step in &context.diagram.steps {
        let Step::Note(note) = step else {
            continue;
        };
        let indexes = context.indexes_of(&note.over);
        let need = lines_width(&note_lines(&note.label)) + 4;
        if indexes.len() == 1
            && let Some(side) = note.side
        {
            let gap = if side == NoteSide::Left { indexes[0] as i64 - 1 } else { indexes[0] as i64 };
            if gap >= 0 && (gap as usize) < gaps.len() {
                gaps[gap as usize] = gaps[gap as usize].max(need);
            }
            continue;
        }
        if indexes.len() != 2 || indexes[0].abs_diff(indexes[1]) != 1 {
            continue;
        }
        let gap = indexes[0].min(indexes[1]);
        gaps[gap] = gaps[gap].max(need);
    }
    let first = participants.first().map_or("", |participant| participant.label.as_str());
    let mut centers = vec![1.max(header_width(first, compact).div_euclid(2))];
    for gap in gaps {
        centers.push(centers[centers.len() - 1] + gap);
    }
    centers
}

fn separate_groups(context: &Context, centers: &[i32], ranges: &[Range]) -> Vec<i32> {
    let mut adjusted = centers.to_vec();
    let participants = &context.diagram.participants;
    for boundary in 0..adjusted.len().saturating_sub(1) {
        let groups = group_bounds(context, &adjusted, ranges);
        let left_width = header_width(&participants[boundary].label, context.compact);
        let right_width = header_width(&participants[boundary + 1].label, context.compact);
        let mut left_right = adjusted[boundary] - left_width.div_euclid(2) + left_width - 1;
        let mut right_left = adjusted[boundary + 1] - right_width.div_euclid(2);
        let mut borders = false;
        for (index, range) in ranges.iter().enumerate() {
            if range.end == boundary {
                left_right = left_right.max(groups[index].right);
                borders = true;
            }
            if range.start == boundary + 1 {
                right_left = right_left.min(groups[index].left);
                borders = true;
            }
        }
        if !borders {
            continue;
        }
        let shift = left_right + GROUP_HORIZONTAL_PADDING + 1 - right_left;
        if shift <= 0 {
            continue;
        }
        for center in &mut adjusted[boundary + 1..] {
            *center += shift;
        }
    }
    adjusted
}

pub fn plan(diagram: &Diagram, compact: bool) -> Plan<'_> {
    if diagram.participants.is_empty() {
        return Plan {
            width: 0,
            height: 0,
            rows: Rows { header_y: 0, rule_y: 0, lifeline_start: 0, lifeline_end: 0 },
            participants: Vec::new(),
            groups: Vec::new(),
            activations: Vec::new(),
            steps: Vec::new(),
        };
    }
    let context = Context {
        diagram,
        indexes: diagram.participants.iter().enumerate().map(|(index, p)| (p.id.as_str(), index)).collect(),
        compact,
    };
    let ranges = group_ranges(&context);
    let mut centers = participant_centers(&context, DEFAULT_MIN_PARTICIPANT_GAP);
    centers = separate_groups(&context, &centers, &ranges);
    let fragments_of = |frames: &IndexMap<usize, HBounds>| {
        let mut result = HBounds { left: 0, right: 0 };
        for bounds in frames.values() {
            result.expand(bounds.left, bounds.right);
        }
        result
    };
    let mut groups = group_bounds(&context, &centers, &ranges);
    let mut content = content_bounds(&context, &centers);
    let mut frames = fragment_frames(&context, &centers);
    let mut fragments = fragments_of(&frames);
    let overflow = groups.iter().map(|group| group.left).fold(0, i32::min).min(content.left).min(fragments.left).min(0);
    if overflow < 0 {
        centers = centers.iter().map(|center| center - overflow).collect();
        groups = group_bounds(&context, &centers, &ranges);
        content = content_bounds(&context, &centers);
        frames = fragment_frames(&context, &centers);
        fragments = fragments_of(&frames);
    }
    let has_groups = !groups.is_empty();
    let label_height =
        diagram.participants.iter().map(|p| label_lines(&p.label).len() as i32).max().unwrap_or(1).max(1);
    let header_y = i32::from(has_groups);
    let rule_y = header_y + if compact { label_height - 1 } else { label_height };
    let lifeline_start = rule_y + 1;
    let step_start = lifeline_start + 1;
    let width = (content.right + 1)
        .max(groups.iter().map(|group| group.right + 1).max().unwrap_or(i32::MIN))
        .max(fragments.right + 1);
    let base_height = step_start + diagram.steps.iter().map(|step| context.step_height(step, &centers)).sum::<i32>();
    let height = if has_groups { 5.max(base_height + 1) } else { 3.max(base_height) };
    let lifeline_end = if has_groups { height - 2 } else { height - 1 };
    let participants = diagram
        .participants
        .iter()
        .enumerate()
        .map(|(index, participant)| {
            let center = centers[index];
            let header = header_width(&participant.label, compact);
            let header_left = center - header.div_euclid(2);
            ParticipantPlacement {
                center,
                header_left,
                header_right: header_left + header - 1,
                label_lines: label_lines(&participant.label),
            }
        })
        .collect();

    let mut steps: Vec<StepPlacement> = Vec::new();
    let mut activations: Vec<Activation> = Vec::new();
    let mut active_by: IndexMap<String, Vec<i32>> = IndexMap::new();
    let mut last_event: HashMap<String, i32> = HashMap::new();
    let open = |active_by: &mut IndexMap<String, Vec<i32>>, participant: &str, y: i32| {
        active_by.entry(participant.to_string()).or_default().push(y);
    };
    let close = |active_by: &mut IndexMap<String, Vec<i32>>, activations: &mut Vec<Activation>, participant: &str, y: i32| {
        let opened = active_by.get_mut(participant).and_then(Vec::pop);
        let (Some(start), Some(index)) = (opened, context.index(participant)) else {
            return;
        };
        activations.push(Activation { center: centers[index], start, end: y });
    };
    let mut step_y = step_start;
    let mut active_frames: Vec<(HBounds, i32)> = Vec::new();
    for (step_index, step) in diagram.steps.iter().enumerate() {
        if let Step::Activation { participant, active } = step {
            let event = last_event.get(participant).copied().unwrap_or(step_y).min(lifeline_end);
            if *active {
                open(&mut active_by, participant, event);
            } else {
                close(&mut active_by, &mut activations, participant, event);
            }
            continue;
        }
        let step_height = context.step_height(step, &centers);
        match step {
            Step::Note(note) => {
                let indexes = context.indexes_of(&note.over);
                if !indexes.is_empty() {
                    let lines = note_lines(&note.label);
                    let x = context.note_x(note, &indexes, &centers, lines_width(&lines));
                    steps.push(StepPlacement::Note { lines, x, y: step_y + 1 });
                }
                step_y += step_height;
                continue;
            }
            Step::Fragment(fragment) => {
                let mut bounds =
                    frames.get(&step_index).copied().or_else(|| fragment_frame(&centers, fragment, 0));
                let mut walls_before = None;
                if matches!(fragment.kind, FragmentKind::Alt | FragmentKind::Loop) {
                    if let Some(bounds) = bounds {
                        active_frames.push((bounds, step_y));
                    }
                } else if let Some(frame) = active_frames.last_mut() {
                    bounds = Some(frame.0);
                    walls_before = Some(Walls { bounds: frame.0, start: frame.1 + 1, end: step_y - 1 });
                    if fragment.kind == FragmentKind::End {
                        active_frames.pop();
                    } else {
                        frame.1 = step_y;
                    }
                }
                if let Some(bounds) = bounds {
                    steps.push(StepPlacement::Fragment {
                        fragment,
                        label: fragment_label(fragment),
                        bounds,
                        y: step_y,
                        walls_before,
                    });
                }
                step_y += step_height;
                continue;
            }
            Step::Activation { .. } => continue,
            Step::Message(_) => {}
        }
        let Step::Message(message) = step else {
            continue;
        };
        let (Some(from), Some(to)) = (context.index(&message.from), context.index(&message.to)) else {
            continue;
        };
        let lines = label_lines(&message_text(message));
        if from == to {
            let center = centers[from];
            let bottom = step_y + lines.len() as i32 + 1;
            let right = center + self_loop_width_for(&lines);
            steps.push(StepPlacement::SelfMessage {
                message,
                label_lines: lines,
                center,
                right,
                top: step_y,
                bottom,
            });
            if let Some(participant) = &message.activate {
                open(&mut active_by, participant, bottom);
            }
            if let Some(participant) = &message.deactivate {
                close(&mut active_by, &mut activations, participant, bottom);
            }
            last_event.insert(message.from.clone(), bottom);
        } else {
            let (from_x, to_x) = (centers[from], centers[to]);
            let direction = if to_x > from_x { 1 } else { -1 };
            let left = from_x.min(to_x);
            let right = from_x.max(to_x);
            let inline = inline_label(message, &lines, from_x, to_x, compact);
            let arrow_y = if inline.is_some() { step_y } else { step_y + lines.len() as i32 };
            let label_width = inline.as_deref().map_or_else(|| lines_width(&lines), crate::core::text::width);
            let label_x = if inline.is_some() { (left + right - label_width).div_euclid(2) } else { left + 2 };
            steps.push(StepPlacement::Message {
                message,
                label_lines: lines,
                label_x,
                label_y: step_y,
                arrow_y,
                from_x,
                left,
                right,
                head_x: if message.head.is_none() { to_x } else { to_x - direction },
                direction,
                inline_label: inline,
            });
            if let Some(participant) = &message.activate {
                open(&mut active_by, participant, arrow_y);
            }
            if let Some(participant) = &message.deactivate {
                close(&mut active_by, &mut activations, participant, arrow_y);
            }
            last_event.insert(message.from.clone(), arrow_y);
            last_event.insert(message.to.clone(), arrow_y);
        }
        step_y += step_height;
    }
    let participants_open: Vec<String> = active_by.keys().cloned().collect();
    for participant in participants_open {
        while active_by.get(&participant).is_some_and(|active| !active.is_empty()) {
            close(&mut active_by, &mut activations, &participant, lifeline_end);
        }
    }
    Plan {
        width,
        height,
        rows: Rows { header_y, rule_y, lifeline_start, lifeline_end },
        participants,
        groups,
        activations,
        steps,
    }
}
