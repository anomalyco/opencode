//! State diagram layout (`state/layout.ts`). TS shares one bounds object between `bounds` and
//! `compositeBounds`; here both maps index one arena of boxes, so a move shows through either.

use std::collections::{HashMap, HashSet, VecDeque};

use indexmap::IndexMap;

use super::routing::{Boxes, RenderOptions, RenderPlan, is_horizontal_feedback, measure_label, render_plans};
use super::{
    Composite, Diagram, Note, NoteConnector, NoteSide, Rect, SearchBounds, SearchSpace, State, StateKind, Transition,
    manhattan_path, note_connector, search_space,
};
use crate::core::geometry::{Bounds, Point, orthogonal_path_points};
use crate::core::spatial::{Clearance, ClearancePolicy, Policy, Role, SpatialIndex, path_claim, rect_claim};
use crate::core::text::{js_trim, measure_text_box, split_lines, width};

const MAX_STRICT_NOTE_PLACEMENTS: usize = 24;

#[derive(Clone, Debug)]
pub struct Size {
    pub width: i32,
    pub height: i32,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct NoteBox {
    pub id: String,
    pub bounds: Bounds,
    pub note: Note,
    pub lines: Vec<String>,
    pub connector: Option<NoteConnector>,
}

/// `stateDiagramNoteConnector`: the placed connector, else the straight one.
pub fn note_connector_of(note: &NoteBox, target: &Bounds) -> NoteConnector {
    if let Some(connector) = &note.connector {
        return connector.clone();
    }
    note_connector(&rect(&note.bounds), note.note.side, &rect(target))
}

fn rect(b: &Bounds) -> Rect {
    Rect { left: b.left, top: b.top, width: b.width, height: b.height, center_y: b.center_y }
}

pub struct Layout {
    pub arena: Vec<Bounds>,
    pub bounds: IndexMap<String, usize>,
    pub sizes: IndexMap<String, Size>,
    pub composites: IndexMap<String, usize>,
    pub notes: Vec<NoteBox>,
}

impl Layout {
    pub fn get(&self, id: &str) -> Option<Bounds> {
        self.bounds.get(id).map(|&index| self.arena[index])
    }

    pub fn composite(&self, id: &str) -> Option<Bounds> {
        self.composites.get(id).map(|&index| self.arena[index])
    }

    /// The bounds map routing reads.
    pub fn boxes(&self) -> Boxes {
        self.bounds.iter().map(|(id, &index)| (id.clone(), self.arena[index])).collect()
    }

    fn referenced(&self) -> Vec<usize> {
        let mut seen = HashSet::new();
        self.bounds.values().chain(self.composites.values()).copied().filter(|index| seen.insert(*index)).collect()
    }

    fn shift(&mut self, boxes: &[usize], notes: &[usize], dx: i32, dy: i32) {
        for &index in boxes {
            self.arena[index].translate(dx, dy);
        }
        for &index in notes {
            let note = &mut self.notes[index];
            note.bounds.translate(dx, dy);
            if let Some(connector) = &mut note.connector {
                connector.connector_y += dy;
                for point in &mut connector.points {
                    point.x += dx;
                    point.y += dy;
                }
            }
        }
    }

    pub fn translate(&mut self, dx: i32, dy: i32) {
        let boxes = self.referenced();
        let notes: Vec<usize> = (0..self.notes.len()).collect();
        self.shift(&boxes, &notes, dx, dy);
    }

    fn normalize(&mut self) {
        let boxes = self.referenced();
        if boxes.is_empty() && self.notes.is_empty() {
            return;
        }
        let connectors = self.notes.iter().flat_map(|n| n.connector.iter().flat_map(|c| c.points.iter().copied()));
        let min_x = boxes
            .iter()
            .map(|&i| self.arena[i].left)
            .chain(self.notes.iter().map(|n| n.bounds.left))
            .chain(connectors.clone().map(|p| p.x))
            .fold(0, i32::min);
        let min_y = boxes
            .iter()
            .map(|&i| self.arena[i].top)
            .chain(self.notes.iter().map(|n| n.bounds.top))
            .chain(connectors.map(|p| p.y))
            .fold(0, i32::min);
        if min_x == 0 && min_y == 0 {
            return;
        }
        self.translate(-min_x, -min_y);
    }
}

struct Lookup<'a> {
    states: HashMap<&'a str, &'a State>,
    composites: HashMap<&'a str, &'a Composite>,
}

impl<'a> Lookup<'a> {
    fn new(diagram: &'a Diagram) -> Self {
        Self {
            states: diagram.states.iter().map(|s| (s.id.as_str(), s)).collect(),
            composites: diagram.composites.iter().map(|c| (c.id.as_str(), c)).collect(),
        }
    }

    fn parent(&self, id: &str) -> Option<&'a str> {
        self.states
            .get(id)
            .and_then(|s| s.parent_id.as_deref())
            .or_else(|| self.composites.get(id).and_then(|c| c.parent_id.as_deref()))
    }

    fn belongs(&self, id: &str, composite: &str) -> bool {
        let mut parent = self.parent(id);
        while let Some(current) = parent {
            if current == composite {
                return true;
            }
            parent = self.composites.get(current).and_then(|c| c.parent_id.as_deref());
        }
        false
    }

    fn containers(&self, id: &str) -> Vec<&'a str> {
        let mut ids = Vec::new();
        let mut parent = self.parent(id);
        while let Some(current) = parent {
            ids.push(current);
            parent = self.composites.get(current).and_then(|c| c.parent_id.as_deref());
        }
        ids
    }
}

fn compute_ranks(diagram: &Diagram) -> IndexMap<String, i32> {
    let mut ranks: IndexMap<String, i32> = IndexMap::new();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for t in &diagram.transitions {
        outgoing.entry(&t.from).or_default().push(&t.to);
    }
    let first =
        diagram.states.iter().find(|s| s.kind == StateKind::Start).or(diagram.states.first()).map(|s| s.id.clone());
    let Some(first) = first else {
        return ranks;
    };
    ranks.insert(first.clone(), 0);
    let mut queue = VecDeque::from([first]);
    while let Some(id) = queue.pop_front() {
        let rank = ranks.get(&id).copied().unwrap_or(0);
        for &to in outgoing.get(id.as_str()).map(Vec::as_slice).unwrap_or_default() {
            if ranks.get(to).is_some_and(|&existing| existing <= rank + 1) {
                continue;
            }
            ranks.insert(to.to_string(), rank + 1);
            queue.push_back(to.to_string());
        }
    }
    for state in &diagram.states {
        if !ranks.contains_key(&state.id) {
            let size = ranks.len() as i32;
            ranks.insert(state.id.clone(), size);
        }
    }
    ranks
}

fn reaches(outgoing: &HashMap<&str, Vec<&Transition>>, from: &str, target: &str) -> bool {
    let mut visited = HashSet::new();
    let mut stack = vec![from.to_string()];
    while let Some(id) = stack.pop() {
        if id == target {
            return true;
        }
        if !visited.insert(id.clone()) {
            continue;
        }
        for t in outgoing.get(id.as_str()).map(Vec::as_slice).unwrap_or_default() {
            stack.push(t.to.clone());
        }
    }
    false
}

fn main_path(diagram: &Diagram) -> Vec<String> {
    let mut outgoing: HashMap<&str, Vec<&Transition>> = HashMap::new();
    for t in &diagram.transitions {
        outgoing.entry(&t.from).or_default().push(t);
    }
    let lookup = Lookup::new(diagram);
    let Some(start) = diagram.states.iter().find(|s| s.kind == StateKind::Start).or(diagram.states.first()) else {
        return Vec::new();
    };
    let mut path = vec![start.id.clone()];
    let mut visited: HashSet<String> = HashSet::from([start.id.clone()]);
    let mut current = start.id.clone();
    loop {
        let candidates: Vec<&Transition> = outgoing
            .get(current.as_str())
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .copied()
            .filter(|t| !visited.contains(&t.to))
            .collect();
        if candidates.is_empty() {
            break;
        }
        let parent = |id: &str| lookup.states.get(id).and_then(|s| s.parent_id.as_deref());
        let next = candidates
            .iter()
            .find(|t| lookup.states.get(t.to.as_str()).is_some_and(|s| s.kind == StateKind::End))
            .or_else(|| candidates.iter().find(|t| !reaches(&outgoing, &t.to, &current)))
            .or_else(|| candidates.iter().find(|t| !super::routing::has_reverse(diagram, t)))
            .or_else(|| {
                candidates.iter().find(|t| matches!((parent(&current), parent(&t.to)), (Some(a), Some(b)) if a != b))
            })
            .or(if candidates.len() == 1 { candidates.first() } else { None });
        let Some(next) = next else {
            break;
        };
        let to = next.to.clone();
        path.push(to.clone());
        visited.insert(to.clone());
        current = to;
    }
    path
}

fn state_size(state: &State) -> Size {
    if state.kind != StateKind::State {
        return Size { width: 1, height: 1, lines: vec![state.label.clone()] };
    }
    let text = measure_text_box(&state.label, 2, 1, 1);
    Size { width: text.width, height: text.height, lines: text.lines }
}

fn note_size(note: &Note) -> Size {
    let mut lines: Vec<String> =
        note.lines.iter().flat_map(|line| split_lines(line)).map(|line| js_trim(&line).to_string()).collect();
    if lines.is_empty() {
        lines.push(String::new());
    }
    let inner = lines.iter().map(|line| width(line)).max().unwrap_or(0).max(1);
    Size { width: inner + 4, height: lines.len() as i32 + 2, lines }
}

fn intersects(left: i32, top: i32, w: i32, h: i32, b: &Bounds, padding: i32) -> bool {
    left < b.left + b.width + padding
        && left + w + padding > b.left
        && top < b.top + b.height + padding
        && top + h + padding > b.top
}

fn place(arena: &mut Vec<Bounds>, map: &mut IndexMap<String, usize>, id: &str, bounds: Bounds) {
    arena.push(bounds);
    map.insert(id.to_string(), arena.len() - 1);
}

pub fn create(diagram: &Diagram, min_gap: i32, budget: &mut i64) -> Result<Layout, String> {
    let layout = if diagram.direction.horizontal() { horizontal(diagram, min_gap) } else { vertical(diagram, min_gap) };
    finalize(diagram, layout, budget)
}

fn vertical(diagram: &Diagram, min_gap: i32) -> Layout {
    let ranks = compute_ranks(diagram);
    let max_rank = ranks.values().copied().fold(0, i32::max);
    let mut by_rank: IndexMap<i32, Vec<&State>> = IndexMap::new();
    for state in &diagram.states {
        let rank = ranks.get(&state.id).copied().unwrap_or(0);
        let rank = if diagram.direction == super::StateDirection::BT { max_rank - rank } else { rank };
        by_rank.entry(rank).or_default().push(state);
    }
    let mut keys: Vec<i32> = by_rank.keys().copied().collect();
    keys.sort_unstable();
    let sizes: IndexMap<String, Size> = diagram.states.iter().map(|s| (s.id.clone(), state_size(s))).collect();
    let mut label_rows: HashMap<&str, i32> = HashMap::new();
    let mut self_counts: HashMap<&str, i32> = HashMap::new();
    for t in &diagram.transitions {
        let rows = measure_label(&t.label).height;
        let entry = label_rows.entry(&t.from).or_insert(0);
        *entry = (*entry).max(rows);
        if t.from == t.to {
            *self_counts.entry(&t.from).or_insert(0) += 1;
        }
    }
    let single_center = keys
        .iter()
        .filter_map(|rank| {
            let states = &by_rank[rank];
            (states.len() == 1).then(|| sizes[&states[0].id].width.div_euclid(2))
        })
        .fold(0, i32::max);
    let mut arena = Vec::new();
    let mut bounds = IndexMap::new();
    let mut y = 0;
    for rank in keys {
        let states = &by_rank[&rank];
        let row_height = states.iter().map(|s| sizes[&s.id].height).max().unwrap_or(0);
        let mut x = 0;
        for state in states {
            let size = &sizes[&state.id];
            let top = y + (row_height - size.height).div_euclid(2);
            let left = if states.len() == 1 { single_center - size.width.div_euclid(2) } else { x };
            place(&mut arena, &mut bounds, &state.id, Bounds::rect(left, top, size.width, size.height));
            x += size.width + min_gap + 8;
        }
        let rows = states.iter().map(|s| label_rows.get(s.id.as_str()).copied().unwrap_or(0)).fold(0, i32::max);
        let self_rows =
            states.iter().map(|s| self_counts.get(s.id.as_str()).copied().unwrap_or(0) * 3 + 1).fold(0, i32::max);
        let choice = if states.iter().any(|s| s.kind == StateKind::Choice) { 2 } else { 0 };
        y += row_height + 4.max(rows + 3).max(self_rows) + choice;
    }
    Layout { arena, bounds, sizes, composites: IndexMap::new(), notes: Vec::new() }
}

fn horizontal(diagram: &Diagram, min_gap: i32) -> Layout {
    let sizes: IndexMap<String, Size> = diagram.states.iter().map(|s| (s.id.clone(), state_size(s))).collect();
    let lookup = Lookup::new(diagram);
    let path = main_path(diagram);
    let main: HashSet<&str> = path.iter().map(String::as_str).collect();
    let main_index: HashMap<&str, usize> = path.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    let baseline = diagram.transitions.iter().map(|t| measure_label(&t.label).height).fold(1, i32::max);
    let gap = min_gap + 8;
    let mut arena: Vec<Bounds> = Vec::new();
    let mut bounds: IndexMap<String, usize> = IndexMap::new();
    let mut x = 0;
    for (index, id) in path.iter().enumerate() {
        let (Some(state), Some(size)) = (lookup.states.get(id.as_str()), sizes.get(id)) else {
            continue;
        };
        let top = if state.kind == StateKind::State { baseline - size.height.div_euclid(2) } else { baseline };
        place(&mut arena, &mut bounds, id, Bounds::rect(x, top, size.width, size.height));
        let next = path.get(index + 1);
        let adjacent = diagram
            .transitions
            .iter()
            .filter(|t| t.from == *id && Some(&t.to) == next)
            .map(|t| measure_label(&t.label).width)
            .fold(0, i32::max);
        let crosses = next.is_some_and(|next| {
            lookup.states.get(id.as_str()).and_then(|s| s.parent_id.as_deref())
                != lookup.states.get(next.as_str()).and_then(|s| s.parent_id.as_deref())
        });
        x += size.width + gap.max(adjacent + if crosses { 6 } else { 2 });
    }
    let mut branches: IndexMap<&str, Vec<&str>> = IndexMap::new();
    for t in &diagram.transitions {
        if !main.contains(t.from.as_str()) || main.contains(t.to.as_str()) {
            continue;
        }
        let list = branches.entry(&t.from).or_default();
        if !list.contains(&t.to.as_str()) {
            list.push(&t.to);
        }
    }
    for (parent_id, branch_ids) in &branches {
        let Some(parent) = bounds.get(*parent_id).map(|&i| arena[i]) else {
            continue;
        };
        let branch_sizes: Vec<&Size> = branch_ids.iter().filter_map(|id| sizes.get(*id)).collect();
        let total = branch_sizes.iter().map(|s| s.width).sum::<i32>() + 0.max(branch_sizes.len() as i32 - 1) * gap;
        let parent_index = main_index.get(parent_id).copied();
        let joins: Vec<Option<&str>> = branch_ids
            .iter()
            .map(|id| {
                diagram
                    .transitions
                    .iter()
                    .find(|t| {
                        t.from == *id
                            && main.contains(t.to.as_str())
                            && parent_index.is_some_and(|p| main_index.get(t.to.as_str()).is_some_and(|&j| j > p + 1))
                    })
                    .map(|t| t.to.as_str())
            })
            .collect();
        let common = joins.first().copied().flatten().filter(|first| joins.iter().all(|j| *j == Some(first)));
        let lane = match (common, parent_index) {
            (Some(_), Some(p)) => path.get(p + 1).and_then(|id| bounds.get(id)).map(|&i| arena[i]),
            _ => None,
        };
        let mut left = lane.map_or(parent.center_x, |l| l.center_x) - total.div_euclid(2);
        for id in branch_ids {
            if bounds.contains_key(*id) {
                continue;
            }
            let Some(size) = sizes.get(*id) else {
                continue;
            };
            let existing: Vec<Bounds> = bounds.values().map(|&i| arena[i]).collect();
            let mut top = baseline + if lane.is_some() { 6 } else { 5 };
            while let Some(collision) = existing.iter().find(|b| intersects(left, top, size.width, size.height, b, 0)) {
                top = collision.top + collision.height + 3;
            }
            place(&mut arena, &mut bounds, id, Bounds::rect(left, top, size.width, size.height));
            left += size.width + gap;
        }
    }
    let ranks = compute_ranks(diagram);
    let mut fallback: Vec<&State> = diagram.states.iter().filter(|s| !bounds.contains_key(&s.id)).collect();
    fallback.sort_by_key(|s| ranks.get(&s.id).copied().unwrap_or(0));
    for state in fallback {
        let size = &sizes[&state.id];
        let top = baseline + 5;
        let rank = ranks.get(&state.id).copied().unwrap_or(bounds.len() as i32);
        let mut left = rank * (size.width + gap);
        loop {
            let collision = bounds.values().map(|&i| arena[i]).find(|b| {
                left < b.left + b.width + gap
                    && left + size.width + gap > b.left
                    && top < b.top + b.height
                    && top + size.height > b.top
            });
            let Some(collision) = collision else {
                break;
            };
            left = collision.left + collision.width + gap;
        }
        place(&mut arena, &mut bounds, &state.id, Bounds::rect(left, top, size.width, size.height));
    }
    let min_x = bounds.values().map(|&i| arena[i].left).fold(0, i32::min);
    if min_x < 0 {
        for &i in bounds.values() {
            arena[i].left -= min_x;
            arena[i].center_x -= min_x;
        }
    }
    if diagram.direction == super::StateDirection::RL {
        let right = bounds.values().map(|&i| arena[i].left + arena[i].width).fold(0, i32::max);
        for &i in bounds.values() {
            let b = &mut arena[i];
            b.left = right - b.left - b.width;
            b.center_x = b.left + b.width.div_euclid(2);
        }
        let gutter = diagram
            .transitions
            .iter()
            .filter_map(|t| {
                let from = arena[*bounds.get(&t.from)?];
                let to = arena[*bounds.get(&t.to)?];
                (from.center_y != to.center_y).then(|| measure_label(&t.label).width + 2)
            })
            .fold(0, i32::max);
        if gutter > 0 {
            for &i in bounds.values() {
                arena[i].translate(gutter, 0);
            }
        }
    }
    Layout { arena, bounds, sizes, composites: IndexMap::new(), notes: Vec::new() }
}

fn add_composite_bounds(diagram: &Diagram, layout: &mut Layout) {
    fn add(diagram: &Diagram, layout: &mut Layout, composite: &Composite) -> Option<Bounds> {
        if let Some(existing) = layout.composite(&composite.id) {
            return Some(existing);
        }
        for child in diagram.composites.iter().filter(|c| c.parent_id.as_deref() == Some(&composite.id)) {
            add(diagram, layout, child);
        }
        let ids = diagram
            .states
            .iter()
            .filter(|s| s.parent_id.as_deref() == Some(&composite.id))
            .map(|s| s.id.as_str())
            .chain(
                diagram
                    .composites
                    .iter()
                    .filter(|c| c.parent_id.as_deref() == Some(&composite.id))
                    .map(|c| c.id.as_str()),
            );
        let children: Vec<Bounds> = ids.filter_map(|id| layout.get(id)).collect();
        if children.is_empty() {
            return None;
        }
        let left = children.iter().map(|b| b.left).min()? - 2;
        let top = children.iter().map(|b| b.top).min()? - 2;
        let right = children.iter().map(|b| b.left + b.width).max()? + 2;
        let bottom = children.iter().map(|b| b.top + b.height).max()? + 2;
        let w = (right - left).max(width(&composite.label) + 5);
        let bound = Bounds {
            left,
            top,
            width: w,
            height: bottom - top,
            center_x: left + w.div_euclid(2),
            center_y: top + (bottom - top).div_euclid(2),
        };
        layout.arena.push(bound);
        let index = layout.arena.len() - 1;
        layout.composites.insert(composite.id.clone(), index);
        layout.bounds.insert(composite.id.clone(), index);
        Some(bound)
    }
    for composite in &diagram.composites {
        add(diagram, layout, composite);
    }
}

fn set_box(b: &mut Bounds, left: i32, top: i32, w: i32, h: i32) {
    *b = Bounds { left, top, width: w, height: h, center_x: left + w.div_euclid(2), center_y: top + h.div_euclid(2) };
}

fn expand_for_notes(diagram: &Diagram, layout: &mut Layout) {
    let lookup = Lookup::new(diagram);
    for composite in diagram.composites.iter().rev() {
        let Some(&index) = layout.composites.get(&composite.id) else {
            continue;
        };
        let notes: Vec<&NoteBox> =
            layout.notes.iter().filter(|n| lookup.belongs(&n.note.target, &composite.id)).collect();
        if notes.is_empty() {
            continue;
        }
        let points: Vec<Point> =
            notes.iter().flat_map(|n| n.connector.iter().flat_map(|c| c.points.iter().copied())).collect();
        let b = layout.arena[index];
        let left = notes.iter().map(|n| n.bounds.left - 2).chain(points.iter().map(|p| p.x - 1)).fold(b.left, i32::min);
        let top = notes.iter().map(|n| n.bounds.top - 1).chain(points.iter().map(|p| p.y - 1)).fold(b.top, i32::min);
        let right = notes
            .iter()
            .map(|n| n.bounds.left + n.bounds.width + 2)
            .chain(points.iter().map(|p| p.x + 2))
            .fold(b.left + b.width, i32::max);
        let bottom = notes
            .iter()
            .map(|n| n.bounds.top + n.bounds.height + 1)
            .chain(points.iter().map(|p| p.y + 2))
            .fold(b.top + b.height, i32::max);
        let w = (right - left).max(width(&composite.label) + 5);
        set_box(&mut layout.arena[index], left, top, w, bottom - top);
    }
}

fn expand_for_internal_routing(diagram: &Diagram, layout: &mut Layout) {
    if diagram.direction.horizontal() {
        return;
    }
    let lookup = Lookup::new(diagram);
    for composite in diagram.composites.iter().rev() {
        let Some(&index) = layout.composites.get(&composite.id) else {
            continue;
        };
        let b = layout.arena[index];
        let internal = diagram.transitions.iter().filter(|t| {
            if t.from == t.to {
                return false;
            }
            let target: HashSet<&str> = lookup.containers(&t.to).into_iter().collect();
            lookup.containers(&t.from).into_iter().find(|id| target.contains(id)) == Some(composite.id.as_str())
        });
        let nested = diagram.composites.iter().any(|c| c.parent_id.as_deref() == Some(&composite.id));
        let mut occurrences: HashMap<(&str, &str), i32> = HashMap::new();
        let side_routes: Vec<&Transition> = internal
            .filter(|t| {
                let (Some(from), Some(to)) = (layout.get(&t.from), layout.get(&t.to)) else {
                    return false;
                };
                let occurrence = occurrences.entry((&t.from, &t.to)).or_insert(0);
                let previous = *occurrence;
                *occurrence += 1;
                let from_state = lookup.states.get(t.from.as_str());
                let to_state = lookup.states.get(t.to.as_str());
                let from_parent = from_state.and_then(|s| s.parent_id.as_deref());
                let to_parent = to_state.and_then(|s| s.parent_id.as_deref());
                previous > 0
                    || (from.center_y > to.center_y && (!nested || from.left - 1 <= b.left))
                    || (from_parent != to_parent
                        && (from.center_x != to.center_x
                            || from_state.is_none_or(|s| s.kind != StateKind::State)
                            || to_state.is_none_or(|s| s.kind != StateKind::State)))
            })
            .collect();
        if side_routes.is_empty() {
            continue;
        }
        let child_right = diagram
            .states
            .iter()
            .filter(|s| lookup.belongs(&s.id, &composite.id))
            .filter_map(|s| layout.get(&s.id).map(|c| c.left + c.width))
            .chain(
                diagram
                    .composites
                    .iter()
                    .filter(|c| c.parent_id.as_deref() == Some(&composite.id))
                    .filter_map(|c| layout.composite(&c.id).map(|c| c.left + c.width)),
            )
            .fold(i32::MIN, i32::max);
        let label_width = side_routes.iter().map(|t| measure_label(&t.label).width).fold(i32::MIN, i32::max);
        let right = child_right + label_width + side_routes.len() as i32 * 3 + 6;
        if right <= b.left + b.width {
            continue;
        }
        let bound = &mut layout.arena[index];
        bound.width = right - bound.left;
        bound.center_x = bound.left + bound.width.div_euclid(2);
    }
    enforce_margins(diagram, layout);
}

fn enforce_margins(diagram: &Diagram, layout: &mut Layout) {
    fn expand(diagram: &Diagram, layout: &mut Layout, composite: &Composite) -> Option<Bounds> {
        let index = *layout.composites.get(&composite.id)?;
        let children: Vec<Bounds> = diagram
            .composites
            .iter()
            .filter(|c| c.parent_id.as_deref() == Some(&composite.id))
            .filter_map(|c| expand(diagram, layout, c))
            .collect();
        let b = layout.arena[index];
        if children.is_empty() {
            return Some(b);
        }
        let left = children.iter().map(|c| c.left - 2).fold(b.left, i32::min);
        let top = children.iter().map(|c| c.top - 2).fold(b.top, i32::min);
        let right = children.iter().map(|c| c.left + c.width + 2).fold(b.left + b.width, i32::max);
        let bottom = children.iter().map(|c| c.top + c.height + 2).fold(b.top + b.height, i32::max);
        set_box(&mut layout.arena[index], left, top, right - left, bottom - top);
        Some(layout.arena[index])
    }
    for composite in diagram.composites.iter().filter(|c| c.parent_id.is_none()) {
        expand(diagram, layout, composite);
    }
}

pub fn separate_external(diagram: &Diagram, layout: &mut Layout) -> bool {
    let lookup = Lookup::new(diagram);
    let mut shifted = false;
    for composite in &diagram.composites {
        for state in &diagram.states {
            let Some(composite_bound) = layout.composite(&composite.id) else {
                break;
            };
            if lookup.belongs(&state.id, &composite.id) {
                continue;
            }
            let Some(bound) = layout.get(&state.id) else {
                continue;
            };
            if !intersects(bound.left, bound.top, bound.width, bound.height, &composite_bound, 0) {
                continue;
            }
            let dx = composite_bound.left + composite_bound.width + 4 - bound.left;
            if dx <= 0 {
                continue;
            }
            let threshold = bound.left;
            let mut boxes: Vec<usize> = Vec::new();
            for candidate in &diagram.states {
                if lookup.belongs(&candidate.id, &composite.id) {
                    continue;
                }
                if let Some(&index) = layout.bounds.get(&candidate.id)
                    && layout.arena[index].left >= threshold
                {
                    boxes.push(index);
                }
            }
            for candidate in &diagram.composites {
                if candidate.id == composite.id || lookup.belongs(&candidate.id, &composite.id) {
                    continue;
                }
                if let Some(&index) = layout.composites.get(&candidate.id)
                    && layout.arena[index].left >= threshold
                {
                    boxes.push(index);
                }
            }
            let notes: Vec<usize> = (0..layout.notes.len())
                .filter(|&i| layout.bounds.get(&layout.notes[i].note.target).is_some_and(|t| boxes.contains(t)))
                .collect();
            let mut seen = HashSet::new();
            boxes.retain(|i| seen.insert(*i));
            layout.shift(&boxes, &notes, dx, 0);
            shifted = true;
        }
    }
    shifted
}

pub fn expand_for_feedback(diagram: &Diagram, layout: &mut Layout, lane_y: i32) {
    if !diagram.direction.horizontal() {
        return;
    }
    let lookup = Lookup::new(diagram);
    for composite in &diagram.composites {
        let Some(&index) = layout.composites.get(&composite.id) else {
            continue;
        };
        let internal = diagram.transitions.iter().any(|t| {
            lookup.belongs(&t.from, &composite.id)
                && lookup.belongs(&t.to, &composite.id)
                && matches!((layout.get(&t.from), layout.get(&t.to)), (Some(f), Some(to)) if is_horizontal_feedback(diagram, &f, &to))
        });
        if !internal {
            continue;
        }
        let b = &mut layout.arena[index];
        let bottom = (b.top + b.height).max(lane_y + 2);
        b.height = bottom - b.top;
        b.center_y = b.top + b.height.div_euclid(2);
    }
}

pub fn expand_for_internal_transitions(diagram: &Diagram, layout: &mut Layout, plans: &[RenderPlan]) {
    let lookup = Lookup::new(diagram);
    for composite in &diagram.composites {
        let Some(&index) = layout.composites.get(&composite.id) else {
            continue;
        };
        let mut occupied: Vec<(i32, i32)> = Vec::new();
        for plan in plans {
            if !lookup.belongs(&plan.route.from_id, &composite.id) || !lookup.belongs(&plan.route.to_id, &composite.id)
            {
                continue;
            }
            occupied.extend(plan.cells.iter().map(|c| (c.x, c.y)));
            if let Some(label) = &plan.label {
                for (row, line) in label.lines.iter().enumerate() {
                    occupied.extend((0..width(line)).map(|column| (label.x + column, label.y + row as i32)));
                }
            }
        }
        if occupied.is_empty() {
            continue;
        }
        let b = layout.arena[index];
        let left = b.left.min(occupied.iter().map(|p| p.0).min().unwrap_or(0) - 1);
        let top = b.top.min(occupied.iter().map(|p| p.1).min().unwrap_or(0) - 1);
        let right = (b.left + b.width).max(occupied.iter().map(|p| p.0).max().unwrap_or(0) + 2);
        let bottom = (b.top + b.height).max(occupied.iter().map(|p| p.1).max().unwrap_or(0) + 2);
        set_box(&mut layout.arena[index], left, top, right - left, bottom - top);
    }
    enforce_margins(diagram, layout);
}

fn finalize(diagram: &Diagram, mut layout: Layout, budget: &mut i64) -> Result<Layout, String> {
    if diagram.composites.is_empty() && diagram.notes.is_empty() {
        return Ok(layout);
    }
    add_composite_bounds(diagram, &mut layout);
    layout.normalize();
    expand_for_internal_routing(diagram, &mut layout);
    if !diagram.notes.is_empty() {
        let boxes = layout.boxes();
        let bottom = boxes.values().map(|b| b.top + b.height).fold(0, i32::max) + 3;
        let top = boxes.values().map(|b| b.top).fold(0, i32::min) - 3;
        let plans = render_plans(
            diagram,
            &boxes,
            bottom,
            &RenderOptions { feedback_top_y: Some(top), notes: &[], repair: false },
            budget,
        )?;
        place_notes(diagram, &mut layout, &plans, budget)?;
    }
    expand_for_notes(diagram, &mut layout);
    expand_for_internal_routing(diagram, &mut layout);
    separate_external(diagram, &mut layout);
    layout.normalize();
    Ok(layout)
}

fn note_box(note: &Note, index: usize, left: i32, top: i32, size: &Size) -> NoteBox {
    NoteBox {
        id: format!("{}-note-{index}", note.target),
        bounds: Bounds::rect(left, top, size.width, size.height),
        note: note.clone(),
        lines: size.lines.clone(),
        connector: None,
    }
}

fn find_connector(search: &SearchSpace, note: &NoteBox, target: &Bounds, budget: &mut i64) -> Option<NoteConnector> {
    let b = &note.bounds;
    let right = note.note.side == NoteSide::Right;
    let connector_y = (b.top + 1).max(target.center_y.min(b.top + b.height - 2));
    let end = Point { x: if right { b.left - 1 } else { b.left + b.width }, y: connector_y };
    let goal = Point { x: end.x + if right { -1 } else { 1 }, y: end.y };
    let target_x = if right { target.left + target.width } else { target.left - 1 };
    let mut starts = vec![
        Point { x: target_x, y: target.center_y },
        Point { x: target_x, y: target.top - 1 },
        Point { x: target_x, y: target.top + target.height },
    ];
    starts.extend((0..target.height).map(|o| Point { x: target.left - 1, y: target.top + o }));
    starts.extend((0..target.height).map(|o| Point { x: target.left + target.width, y: target.top + o }));
    starts.extend((0..target.width).map(|o| Point { x: target.left + o, y: target.top - 1 }));
    starts.extend((0..target.width).map(|o| Point { x: target.left + o, y: target.top + target.height }));
    let is_free = |p: Point| {
        p.x >= 0
            && !search.blocked.contains(&p)
            && !(p.x >= b.left && p.x < b.left + b.width && p.y >= b.top && p.y < b.top + b.height)
    };
    if !is_free(end) || !is_free(goal) {
        return None;
    }
    for &start in starts.iter().filter(|&&p| is_free(p)) {
        for points in [
            vec![start, Point { x: start.x, y: goal.y }, goal, end],
            vec![start, Point { x: goal.x, y: start.y }, goal, end],
        ] {
            if orthogonal_path_points(&points).into_iter().all(is_free) {
                return Some(NoteConnector { connector_y, points });
            }
        }
    }
    let margin = 8;
    let area = SearchBounds {
        min_x: 0,
        min_y: target.top.min(b.top).min(search.min_y) - margin,
        max_x: (target.left + target.width).max(b.left + b.width).max(search.max_x) + margin,
        max_y: (target.top + target.height).max(b.top + b.height).max(search.max_y) + margin,
    };
    let mut path = manhattan_path(&starts, goal, &area, budget, is_free)?;
    path.push(end);
    Some(NoteConnector { connector_y, points: path })
}

fn place_notes(diagram: &Diagram, layout: &mut Layout, plans: &[RenderPlan], budget: &mut i64) -> Result<(), String> {
    let composite_ids: HashSet<&str> = diagram.composites.iter().map(|c| c.id.as_str()).collect();
    let boxes = layout.boxes();
    let mut note_space = SpatialIndex::default().add(
        boxes
            .iter()
            .filter(|(id, _)| !composite_ids.contains(id.as_str()))
            .map(|(id, b)| rect_claim(format!("state:{id}"), format!("state:{id}"), Role::Body, b)),
    );
    let points = |path: &[(i32, i32)]| path.iter().map(|&(x, y)| Point { x, y }).collect::<Vec<_>>();
    let mut reserved = note_space.add(plans.iter().enumerate().flat_map(|(i, plan)| {
        let n = plan.path.len();
        [
            path_claim(
                format!("transition-terminal:{i}:source"),
                format!("transition-terminal:{i}:source"),
                Role::Route,
                &points(&plan.path[..2.min(n)]),
            ),
            path_claim(
                format!("transition-terminal:{i}:target"),
                format!("transition-terminal:{i}:target"),
                Role::Route,
                &points(&plan.path[n.saturating_sub(2)..]),
            ),
        ]
    }));
    let mut space = reserved.add(plans.iter().enumerate().flat_map(|(i, plan)| {
        let mut claims =
            vec![path_claim(format!("transition:{i}"), format!("transition:{i}"), Role::Route, &points(&plan.path))];
        if let Some(label) = &plan.label {
            let w = label.lines.iter().map(|l| width(l)).max().unwrap_or(0);
            claims.push(rect_claim(
                format!("transition-label:{i}"),
                format!("transition-label:{i}"),
                Role::Label,
                &Bounds::rect(label.x, label.y, w, label.lines.len() as i32),
            ));
        }
        claims
    }));
    let body_policy = Policy { contacts: Vec::new(), clearance: ClearancePolicy::All(Clearance { x: 1, y: 1 }) };
    let mut placed: Vec<NoteBox> = Vec::new();
    for (index, note) in diagram.notes.iter().enumerate() {
        let Some(target) = boxes.get(&note.target).copied() else {
            continue;
        };
        let size = note_size(note);
        let right = note.side == NoteSide::Right;
        let base_left = if right { target.left + target.width + 4 } else { target.left - size.width - 4 };
        let base_top = target.center_y - size.height.div_euclid(2);
        let mut tops = vec![base_top, target.top - size.height - 2, target.top + target.height + 2];
        for distance in 0..12 {
            tops.extend([base_top - distance - 1, base_top + distance + 1]);
        }
        let candidates: Vec<NoteBox> = (0..5)
            .flat_map(|outward| {
                let left = base_left + if right { 1 } else { -1 } * outward * (size.width + 2);
                tops.iter().map(move |&top| (left, top)).collect::<Vec<_>>()
            })
            .map(|(left, top)| note_box(note, index, left, top, &size))
            .collect();
        let owner = format!("note:{index}");
        let find = |candidate_space: &SpatialIndex, limit: usize, budget: &mut i64| -> Option<NoteBox> {
            let search = search_space(candidate_space, |role| if role == Role::Label { 1 } else { 0 });
            for bound in candidates.iter().take(limit) {
                if bound.bounds.left < 0 {
                    continue;
                }
                if !candidate_space.is_free(
                    &rect_claim(format!("{owner}:body"), owner.clone(), Role::Body, &bound.bounds),
                    &body_policy,
                ) {
                    continue;
                }
                if let Some(connector) = find_connector(&search, bound, &target, budget) {
                    return Some(NoteBox { connector: Some(connector), ..bound.clone() });
                }
            }
            None
        };
        let placement = match find(&space, 1, budget)
            .or_else(|| find(&note_space, 1, budget))
            .or_else(|| find(&space, MAX_STRICT_NOTE_PLACEMENTS, budget))
            .or_else(|| find(&reserved, candidates.len(), budget))
        {
            Some(placement) => placement,
            None => outside_placement(&note_space, note, index, &target, &size)?,
        };
        let claims = [
            rect_claim(format!("{owner}:body"), owner.clone(), Role::Body, &placement.bounds),
            path_claim(
                format!("{owner}:connector"),
                owner.clone(),
                Role::Boundary,
                &placement.connector.as_ref().map(|c| c.points.clone()).unwrap_or_default(),
            ),
        ];
        note_space = note_space.add(claims.clone());
        reserved = reserved.add(claims.clone());
        space = space.add(claims);
        placed.push(placement);
    }
    layout.notes = placed;
    Ok(())
}

fn outside_placement(
    space: &SpatialIndex,
    note: &Note,
    index: usize,
    target: &Bounds,
    size: &Size,
) -> Result<NoteBox, String> {
    let search = search_space(space, |_| 0);
    let top = search.max_y + 4;
    let owner = format!("note:{index}:outside");
    let body_policy = Policy { contacts: Vec::new(), clearance: ClearancePolicy::All(Clearance { x: 1, y: 1 }) };
    let fits = |bound: &NoteBox, points: &[Point]| {
        space.is_free(&rect_claim(format!("{owner}:body"), owner.clone(), Role::Body, &bound.bounds), &body_policy)
            && space.is_free(
                &path_claim(format!("{owner}:connector"), owner.clone(), Role::Boundary, points),
                &Policy::default(),
            )
    };
    let other = if note.side == NoteSide::Left { NoteSide::Right } else { NoteSide::Left };
    for side in [note.side, other] {
        let sided = Note { side, ..note.clone() };
        let left_side = side == NoteSide::Left;
        let aligned = note_box(
            &sided,
            index,
            if left_side { search.min_x - size.width - 4 } else { search.max_x + 4 },
            target.center_y - size.height.div_euclid(2),
            size,
        );
        let ab = aligned.bounds;
        let note_x = if left_side { ab.left + ab.width } else { ab.left - 1 };
        let connector_y = (ab.top + 1).max(target.center_y.min(ab.top + ab.height - 2));
        let target_x = if left_side { target.left - 1 } else { target.left + target.width };
        let points = vec![Point { x: target_x, y: target.center_y }, Point { x: note_x, y: connector_y }];
        if fits(&aligned, &points) {
            return Ok(NoteBox { connector: Some(NoteConnector { connector_y, points }), ..aligned });
        }
        let rail_x = if left_side { search.min_x - 2 } else { search.max_x + 2 };
        let bound = note_box(&sided, index, if left_side { rail_x - size.width - 2 } else { rail_x + 3 }, top, size);
        let bb = bound.bounds;
        let note_x = if left_side { bb.left + bb.width } else { bb.left - 1 };
        let connector_y = bb.top + 1;
        let side_x = if left_side { target.left - 1 } else { target.left + target.width };
        let mut escapes: Vec<Vec<Point>> = [target.top, target.center_y, target.top + target.height - 1]
            .into_iter()
            .map(|y| vec![Point { x: side_x, y }, Point { x: rail_x, y }])
            .collect();
        escapes.push(vec![Point { x: target.center_x, y: target.top - 1 }, Point { x: rail_x, y: target.top - 1 }]);
        escapes.push(vec![
            Point { x: target.center_x, y: target.top + target.height },
            Point { x: rail_x, y: target.top + target.height },
        ]);
        for escape in escapes {
            let mut points = escape;
            points.extend([Point { x: rail_x, y: connector_y }, Point { x: note_x, y: connector_y }]);
            if fits(&bound, &points) {
                return Ok(NoteBox { connector: Some(NoteConnector { connector_y, points }), ..bound });
            }
        }
    }
    for below in [true, false] {
        let rail_y = if below { search.max_y + 2 } else { search.min_y - 2 };
        let left_side = note.side == NoteSide::Left;
        let bound = note_box(
            note,
            index,
            if left_side { search.min_x - size.width - 4 } else { search.max_x + 4 },
            if below { rail_y + 2 } else { rail_y - size.height - 2 },
            size,
        );
        let bb = bound.bounds;
        let note_x = if left_side { bb.left + bb.width } else { bb.left - 1 };
        let connector_y = bb.top + 1;
        let target_y = if below { target.top + target.height } else { target.top - 1 };
        let mut escapes: Vec<Vec<Point>> = [target.left, target.center_x, target.left + target.width - 1]
            .into_iter()
            .map(|x| vec![Point { x, y: target_y }, Point { x, y: rail_y }])
            .collect();
        escapes.push(vec![
            Point { x: target.left, y: target_y },
            Point { x: target.left - 1, y: target_y },
            Point { x: target.left - 1, y: rail_y },
        ]);
        escapes.push(vec![
            Point { x: target.left + target.width - 1, y: target_y },
            Point { x: target.left + target.width, y: target_y },
            Point { x: target.left + target.width, y: rail_y },
        ]);
        for escape in escapes {
            let mut points = escape;
            points.extend([Point { x: note_x, y: rail_y }, Point { x: note_x, y: connector_y }]);
            if fits(&bound, &points) {
                return Ok(NoteBox { connector: Some(NoteConnector { connector_y, points }), ..bound });
            }
        }
    }
    Err(format!("State {} has no exterior note corridor", note.target))
}
