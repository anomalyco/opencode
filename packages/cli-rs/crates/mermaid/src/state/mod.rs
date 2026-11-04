//! State diagrams (`packages/merman/src/state`), with `note.ts`, `visible-model.ts`, and `search.ts`.

pub mod drawing;
pub mod layout;
pub mod parser;
pub mod routing;

use std::collections::{HashMap, HashSet};

use crate::core::geometry::Point;
use crate::core::spatial::{Role, SpatialIndex};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateDirection {
    TB,
    TD,
    BT,
    LR,
    RL,
}

impl StateDirection {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value.to_ascii_uppercase().as_str() {
            "TB" => Self::TB,
            "TD" => Self::TD,
            "BT" => Self::BT,
            "LR" => Self::LR,
            "RL" => Self::RL,
            _ => return None,
        })
    }

    pub fn horizontal(self) -> bool {
        matches!(self, Self::LR | Self::RL)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateKind {
    State,
    Start,
    End,
    Choice,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub id: String,
    pub label: String,
    pub kind: StateKind,
    pub parent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transition {
    pub from: String,
    pub to: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Composite {
    pub id: String,
    pub label: String,
    pub parent_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteSide {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub target: String,
    pub side: NoteSide,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub direction: StateDirection,
    pub states: Vec<State>,
    pub transitions: Vec<Transition>,
    pub composites: Vec<Composite>,
    pub notes: Vec<Note>,
}

pub fn start_marker_id(scope: Option<&str>) -> String {
    scope.map_or("__start".to_string(), |scope| format!("{scope}.__start"))
}

pub fn end_marker_id(scope: Option<&str>) -> String {
    scope.map_or("__end".to_string(), |scope| format!("{scope}.__end"))
}

// note.ts

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoteConnector {
    pub points: Vec<Point>,
    pub connector_y: i32,
}

/// The rectangle of a note or its target, with its vertical center.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub center_y: i32,
}

pub fn note_connector(note: &Rect, side: NoteSide, target: &Rect) -> NoteConnector {
    let note_x = if side == NoteSide::Right {
        note.left - 1
    } else {
        note.left + note.width
    };
    let target_x = if side == NoteSide::Right {
        target.left + target.width
    } else {
        target.left - 1
    };
    let target_bottom = target.top + target.height - 1;
    let note_bottom = note.top + note.height - 1;
    let above = note_bottom < target.top;
    let below = note.top > target_bottom;
    if above || below {
        let connector_y = note.center_y;
        return NoteConnector {
            connector_y,
            points: vec![
                Point {
                    x: target_x,
                    y: if above {
                        target.top - 1
                    } else {
                        target_bottom + 1
                    },
                },
                Point {
                    x: target_x,
                    y: connector_y,
                },
                Point {
                    x: note_x,
                    y: connector_y,
                },
            ],
        };
    }
    let connector_y = (note.top + 1).max(target.center_y.min(note.top + note.height - 2));
    NoteConnector {
        connector_y,
        points: vec![
            Point {
                x: target_x,
                y: connector_y,
            },
            Point {
                x: note_x,
                y: connector_y,
            },
        ],
    }
}

// visible-model.ts

pub fn is_hidden_composite_marker(state: Option<&State>) -> bool {
    state.is_some_and(|state| {
        state.parent_id.is_some() && matches!(state.kind, StateKind::Start | StateKind::End)
    })
}

fn collapse_once(transitions: &[Transition], states: &[State]) -> Option<Vec<Transition>> {
    let hidden: Vec<&str> = states
        .iter()
        .filter(|state| is_hidden_composite_marker(Some(state)))
        .map(|state| state.id.as_str())
        .collect::<indexmap::IndexSet<_>>()
        .into_iter()
        .collect();
    for marker in hidden {
        let incoming: Vec<usize> = (0..transitions.len())
            .filter(|&i| transitions[i].to == marker && transitions[i].from != marker)
            .collect();
        let outgoing: Vec<usize> = (0..transitions.len())
            .filter(|&i| transitions[i].from == marker && transitions[i].to != marker)
            .collect();
        if incoming.is_empty() || outgoing.is_empty() {
            continue;
        }
        let skipped: HashSet<usize> = incoming.iter().chain(&outgoing).copied().collect();
        let mut next: Vec<Transition> = (0..transitions.len())
            .filter(|i| !skipped.contains(i))
            .map(|i| transitions[i].clone())
            .collect();
        for &i in &incoming {
            for &o in &outgoing {
                let label = [transitions[i].label.as_str(), transitions[o].label.as_str()]
                    .into_iter()
                    .filter(|label| !label.is_empty())
                    .collect::<Vec<_>>()
                    .join("<br/>");
                next.push(Transition {
                    from: transitions[i].from.clone(),
                    to: transitions[o].to.clone(),
                    label,
                });
            }
        }
        return Some(next);
    }
    None
}

/// `prepareVisibleStateDiagram`: composite start and end markers fold into the transitions through them.
pub fn visible(diagram: &Diagram) -> Diagram {
    let mut transitions = diagram.transitions.clone();
    while let Some(next) = collapse_once(&transitions, &diagram.states) {
        transitions = next;
    }
    let by_id: HashMap<&str, &State> = diagram
        .states
        .iter()
        .map(|state| (state.id.as_str(), state))
        .collect();
    let mut referenced: HashSet<&str> = HashSet::new();
    for transition in &transitions {
        for id in [&transition.from, &transition.to] {
            if let Some(state) = by_id.get(id.as_str())
                && is_hidden_composite_marker(Some(state))
            {
                referenced.insert(state.id.as_str());
            }
        }
    }
    Diagram {
        states: diagram
            .states
            .iter()
            .filter(|state| {
                !is_hidden_composite_marker(Some(state)) || referenced.contains(state.id.as_str())
            })
            .cloned()
            .collect(),
        transitions,
        ..diagram.clone()
    }
}

// search.ts

pub const MAX_SEARCH_VISITS: i64 = 250_000;

pub struct SearchSpace {
    pub blocked: HashSet<Point>,
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

pub fn search_space(space: &SpatialIndex, clearance: impl Fn(Role) -> i32) -> SearchSpace {
    let mut result = SearchSpace {
        blocked: HashSet::new(),
        min_x: 0,
        min_y: 0,
        max_x: 0,
        max_y: 0,
    };
    for claim in space.claims() {
        let padding = clearance(claim.role);
        for span in &claim.spans {
            for y in span.y - padding..=span.y + padding {
                for x in span.from_x - padding..=span.to_x + padding {
                    result.blocked.insert(Point { x, y });
                    result.min_x = result.min_x.min(x);
                    result.min_y = result.min_y.min(y);
                    result.max_x = result.max_x.max(x);
                    result.max_y = result.max_y.max(y);
                }
            }
        }
    }
    result
}

pub struct SearchBounds {
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

/// Breadth-first search for a path from any of `starts` to `goal`, toward the goal first.
pub fn manhattan_path(
    starts: &[Point],
    goal: Point,
    bounds: &SearchBounds,
    budget: &mut i64,
    is_free: impl Fn(Point) -> bool,
) -> Option<Vec<Point>> {
    let mut queue: Vec<Point> = Vec::new();
    let mut seen_start: HashSet<Point> = HashSet::new();
    for &point in starts {
        if is_free(point) && seen_start.insert(point) {
            queue.push(point);
        }
    }
    let mut parents: HashMap<Point, Option<Point>> =
        queue.iter().map(|&point| (point, None)).collect();
    let mut cursor = 0;
    while cursor < queue.len() && *budget > 0 {
        let current = queue[cursor];
        if current == goal {
            break;
        }
        let dx = (goal.x - current.x).signum();
        let dy = (goal.y - current.y).signum();
        let mut candidates: Vec<Point> = Vec::with_capacity(6);
        if dx != 0 {
            candidates.push(Point {
                x: current.x + dx,
                y: current.y,
            });
        }
        if dy != 0 {
            candidates.push(Point {
                x: current.x,
                y: current.y + dy,
            });
        }
        candidates.extend([
            Point {
                x: current.x + 1,
                y: current.y,
            },
            Point {
                x: current.x,
                y: current.y + 1,
            },
            Point {
                x: current.x - 1,
                y: current.y,
            },
            Point {
                x: current.x,
                y: current.y - 1,
            },
        ]);
        for candidate in candidates {
            if candidate.x < bounds.min_x
                || candidate.x > bounds.max_x
                || candidate.y < bounds.min_y
                || candidate.y > bounds.max_y
            {
                continue;
            }
            if parents.contains_key(&candidate) || !is_free(candidate) {
                continue;
            }
            parents.insert(candidate, Some(current));
            queue.push(candidate);
        }
        cursor += 1;
        *budget -= 1;
    }
    if !parents.contains_key(&goal) {
        return None;
    }
    let mut path = vec![goal];
    let mut at = goal;
    while let Some(Some(parent)) = parents.get(&at) {
        path.push(*parent);
        at = *parent;
    }
    path.reverse();
    Some(path)
}
