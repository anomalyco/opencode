//! State transition routing (`state/routing.ts`).

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;

use super::layout::{NoteBox, note_connector_of};
use super::{
    Diagram, StateKind, Transition, is_hidden_composite_marker, manhattan_path, search_space,
};
use crate::core::drawing::{CornerStyle, Directions, LineStyle, ROUNDED, line_glyph};
use crate::core::geometry::{Bounds, Direction, Point, orthogonal_path_points};
use crate::core::spatial::{
    Clearance, ClearancePolicy, Policy, Role, SpatialIndex, path_claim, rect_claim,
};
use crate::core::text::{split_lines, width};

/// State and composite bounds by ID.
pub type Boxes = IndexMap<String, Bounds>;

pub struct LabelMetrics {
    pub lines: Vec<String>,
    pub width: i32,
    pub height: i32,
}

pub fn measure_label(label: &str) -> LabelMetrics {
    if label.is_empty() {
        return LabelMetrics {
            lines: Vec::new(),
            width: 0,
            height: 0,
        };
    }
    let lines = split_lines(label);
    let label_width = lines.iter().map(|line| width(line)).max().unwrap_or(0);
    let height = lines.len() as i32;
    LabelMetrics {
        lines,
        width: label_width,
        height,
    }
}

pub fn has_reverse(diagram: &Diagram, transition: &Transition) -> bool {
    diagram
        .transitions
        .iter()
        .any(|other| other.from == transition.to && other.to == transition.from)
}

pub fn is_horizontal_feedback(diagram: &Diagram, from: &Bounds, to: &Bounds) -> bool {
    if diagram.direction == super::StateDirection::RL {
        to.center_x > from.center_x
    } else {
        to.center_x < from.center_x
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Approach {
    Top,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RouteKind {
    SelfLoop {
        lane: i32,
    },
    HorizontalForward {
        left_to_right: bool,
    },
    BottomFeedback {
        rail_y: i32,
        approach_x: i32,
    },
    TopFeedback {
        rail_y: i32,
    },
    BottomParallel {
        rail_y: i32,
        approach_x: i32,
    },
    VerticalElbow {
        has_reverse: bool,
        offset_connector: bool,
    },
    SideParallel {
        rail_x: i32,
        approach: Option<Approach>,
    },
    Vertical,
}

#[derive(Clone, Debug)]
pub struct RoutePlan {
    /// The index of the transition in the visible diagram.
    pub transition: usize,
    pub from_id: String,
    pub to_id: String,
    pub label: String,
    pub from: Bounds,
    pub to: Bounds,
    pub target_is_choice: bool,
    pub target_is_hidden_marker: bool,
    pub kind: RouteKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Glyph {
    Char(&'static str),
    Arrow(Direction),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cell {
    pub x: i32,
    pub y: i32,
    pub glyph: Glyph,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Label {
    pub x: i32,
    pub y: i32,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RenderPlan {
    pub route: RoutePlan,
    pub cells: Vec<Cell>,
    pub path: Vec<(i32, i32)>,
    pub label: Option<Label>,
    pub repaired: bool,
}

// Feedback lanes.

#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Bottom,
    Top,
}

fn overlap(a: (i32, i32), b: (i32, i32)) -> bool {
    a.0 <= b.1 && b.0 <= a.1
}

fn cross(a: (i32, i32), b: (i32, i32)) -> bool {
    (a.0 < b.0 && b.0 < a.1 && a.1 < b.1) || (b.0 < a.0 && a.0 < b.1 && b.1 < a.1)
}

fn feedback_allocations(
    diagram: &Diagram,
    bounds: &Boxes,
    lane_y: i32,
    gap: i32,
    top_y: Option<i32>,
) -> HashMap<usize, (Side, i32)> {
    let mut allocations = HashMap::new();
    if !diagram.direction.horizontal() {
        return allocations;
    }
    let top_lane =
        top_y.unwrap_or_else(|| bounds.values().map(|b| b.top).min().unwrap_or(i32::MAX) - 3);
    let mut intervals: Vec<(usize, (i32, i32))> = Vec::new();
    for (index, transition) in diagram.transitions.iter().enumerate() {
        let (Some(from), Some(to)) = (bounds.get(&transition.from), bounds.get(&transition.to))
        else {
            continue;
        };
        if transition.from == transition.to || !is_horizontal_feedback(diagram, from, to) {
            continue;
        }
        // Only same-row and upward feedback takes a lane.
        if from.center_y < to.center_y {
            continue;
        }
        intervals.push((
            index,
            (
                from.center_x.min(to.center_x),
                from.center_x.max(to.center_x),
            ),
        ));
    }
    let mut sided: [Vec<(usize, (i32, i32))>; 2] = [Vec::new(), Vec::new()];
    let mut canonical: HashMap<(String, String), Side> = HashMap::new();
    for (index, interval) in intervals {
        let transition = &diagram.transitions[index];
        let key = (transition.from.clone(), transition.to.clone());
        let side = canonical.get(&key).copied().or_else(|| {
            [Side::Bottom, Side::Top].into_iter().find(|side| {
                !sided[*side as usize]
                    .iter()
                    .any(|existing| cross(existing.1, interval))
            })
        });
        let Some(side) = side else {
            continue;
        };
        canonical.insert(key, side);
        sided[side as usize].push((index, interval));
    }
    for side in [Side::Bottom, Side::Top] {
        let mut occupied: Vec<((i32, i32), i32)> = Vec::new();
        let mut by_width = sided[side as usize].clone();
        by_width.sort_by_key(|(_, interval)| interval.1 - interval.0);
        for (index, interval) in by_width {
            let mut lane = 0;
            while occupied.iter().any(|(existing, existing_lane)| {
                *existing_lane == lane && overlap(*existing, interval)
            }) {
                lane += 1;
            }
            let rail_y = if side == Side::Bottom {
                lane_y + lane * gap
            } else {
                top_lane - lane * gap
            };
            occupied.push((interval, lane));
            allocations.insert(index, (side, rail_y));
        }
    }
    allocations
}

fn has_opposing_top_connector(diagram: &Diagram, index: usize, bounds: &Boxes) -> bool {
    let transition = &diagram.transitions[index];
    let (Some(from), Some(to)) = (bounds.get(&transition.from), bounds.get(&transition.to)) else {
        return false;
    };
    if from.center_y == to.center_y {
        return false;
    }
    let lower_id = if from.center_y > to.center_y {
        &transition.from
    } else {
        &transition.to
    };
    let lower = bounds[lower_id];
    let leaves_lower = transition.from == *lower_id;
    diagram
        .transitions
        .iter()
        .enumerate()
        .any(|(other_index, other)| {
            if other_index == index
                || (if leaves_lower {
                    other.to != *lower_id
                } else {
                    other.from != *lower_id
                })
            {
                return false;
            }
            let (Some(other_from), Some(other_to)) =
                (bounds.get(&other.from), bounds.get(&other.to))
            else {
                return false;
            };
            if other_from.center_y.max(other_to.center_y) != lower.center_y {
                return false;
            }
            if other.from != *lower_id {
                return true;
            }
            !(diagram.direction.horizontal()
                && is_horizontal_feedback(diagram, other_from, other_to))
        })
}

fn unrelated<'a>(
    diagram: &'a Diagram,
    transition: &'a Transition,
    bounds: &'a Boxes,
) -> impl Iterator<Item = (&'a str, Bounds)> + 'a {
    diagram.states.iter().filter_map(move |state| {
        if state.id == transition.from
            || state.id == transition.to
            || is_hidden_composite_marker(Some(state))
        {
            return None;
        }
        bounds.get(&state.id).map(|b| (state.id.as_str(), *b))
    })
}

fn vertical_corridor_crosses(
    diagram: &Diagram,
    transition: &Transition,
    from: &Bounds,
    to: &Bounds,
    bounds: &Boxes,
) -> bool {
    let top = (from.top + from.height).min(to.top + to.height);
    let bottom = (from.top - 1).max(to.top - 1);
    unrelated(diagram, transition, bounds).any(|(_, b)| {
        from.center_x >= b.left
            && from.center_x < b.left + b.width
            && top < b.top + b.height
            && bottom >= b.top
    })
}

fn has_vertical_corridor(from: &Bounds, to: &Bounds) -> bool {
    if from.center_y < to.center_y {
        return from.top + from.height <= to.top - 1;
    }
    from.top - 1 >= to.top + to.height
}

fn body_space<'a>(
    diagram: &'a Diagram,
    transition: &'a Transition,
    bounds: &'a Boxes,
) -> SpatialIndex {
    SpatialIndex::default().add(
        unrelated(diagram, transition, bounds).map(|(id, b)| {
            rect_claim(format!("state:{id}"), format!("state:{id}"), Role::Body, &b)
        }),
    )
}

fn horizontal_corridor_crosses(
    diagram: &Diagram,
    transition: &Transition,
    from: &Bounds,
    to: &Bounds,
    bounds: &Boxes,
) -> bool {
    let left_to_right = from.center_x <= to.center_x;
    let start = if left_to_right {
        from.left + from.width
    } else {
        from.left - 1
    };
    let end = if left_to_right {
        to.left - 1
    } else {
        to.left + to.width
    };
    let corridor = path_claim(
        format!("corridor:{}:{}", transition.from, transition.to),
        format!("transition:{}:{}", transition.from, transition.to),
        Role::Route,
        &[
            Point {
                x: start,
                y: from.center_y,
            },
            Point {
                x: end,
                y: from.center_y,
            },
        ],
    );
    !body_space(diagram, transition, bounds).is_free(&corridor, &Policy::default())
}

fn bottom_approach_x(
    diagram: &Diagram,
    transition: &Transition,
    from: &Bounds,
    to: &Bounds,
    bounds: &Boxes,
    rail_y: i32,
) -> i32 {
    let target_x = if to.width > 1 {
        if from.center_x > to.center_x {
            to.left + 1
        } else {
            to.left + to.width - 2
        }
    } else {
        to.center_x
    };
    let target_bottom = to.top + to.height;
    let top = target_bottom.min(rail_y);
    let bottom = target_bottom.max(rail_y);
    let is_clear = |x: i32| {
        !unrelated(diagram, transition, bounds).any(|(_, b)| {
            x >= b.left && x < b.left + b.width && top < b.top + b.height && bottom >= b.top
        })
    };
    if is_clear(target_x) {
        return target_x;
    }
    let max_x = bounds
        .values()
        .map(|b| b.left + b.width)
        .fold(target_x, i32::max)
        + 1;
    for distance in 1..=max_x {
        if is_clear(target_x + distance) {
            return target_x + distance;
        }
        let left = target_x - distance;
        if left >= 0 && is_clear(left) {
            return left;
        }
    }
    target_x
}

fn inner_connector_x(bounds: &Bounds, preferred: i32) -> i32 {
    if bounds.width <= 2 {
        return bounds.center_x;
    }
    (bounds.left + 1).max((bounds.left + bounds.width - 2).min(preferred))
}

fn side_parallel_approach(
    diagram: &Diagram,
    transition: &Transition,
    from: &Bounds,
    to: &Bounds,
    bounds: &Boxes,
    rail_x: i32,
) -> Option<Approach> {
    let space = body_space(diagram, transition, bounds);
    let claim = |points: &[Point]| {
        path_claim(
            format!("side-target:{}:{}", transition.from, transition.to),
            "side-target",
            Role::Route,
            points,
        )
    };
    let free = |points: &[Point]| space.is_free(&claim(points), &Policy::default());
    if free(&[
        Point {
            x: rail_x,
            y: to.center_y,
        },
        Point {
            x: to.left + to.width,
            y: to.center_y,
        },
    ]) {
        return None;
    }
    let target_x = inner_connector_x(to, from.center_x);
    let preferred = if from.center_y > to.center_y {
        Approach::Top
    } else {
        Approach::Bottom
    };
    let other = if preferred == Approach::Top {
        Approach::Bottom
    } else {
        Approach::Top
    };
    [preferred, other].into_iter().find(|side| {
        let rail_y = if *side == Approach::Top {
            to.top - 2
        } else {
            to.top + to.height + 1
        };
        let target_y = if *side == Approach::Top {
            to.top - 1
        } else {
            to.top + to.height
        };
        free(&[
            Point {
                x: rail_x,
                y: rail_y,
            },
            Point {
                x: target_x,
                y: rail_y,
            },
            Point {
                x: target_x,
                y: target_y,
            },
        ])
    })
}

pub fn containing_composites(diagram: &Diagram, id: &str) -> Vec<String> {
    let parent_of = |id: &str| {
        diagram
            .states
            .iter()
            .find(|state| state.id == id)
            .and_then(|state| state.parent_id.clone())
            .or_else(|| {
                diagram
                    .composites
                    .iter()
                    .find(|c| c.id == id)
                    .and_then(|c| c.parent_id.clone())
            })
    };
    let mut ids = Vec::new();
    let mut parent = parent_of(id);
    while let Some(current) = parent {
        parent = diagram
            .composites
            .iter()
            .find(|c| c.id == current)
            .and_then(|c| c.parent_id.clone());
        ids.push(current);
    }
    ids
}

fn innermost_common(diagram: &Diagram, transition: &Transition) -> Option<String> {
    let target: HashSet<String> = containing_composites(diagram, &transition.to)
        .into_iter()
        .collect();
    containing_composites(diagram, &transition.from)
        .into_iter()
        .find(|id| target.contains(id))
}

pub fn route_plans(
    diagram: &Diagram,
    bounds: &Boxes,
    lane_y: i32,
    top_y: Option<i32>,
) -> Vec<RoutePlan> {
    let state_of = |id: &str| diagram.states.iter().find(|state| state.id == id);
    let mut endpoint_count: HashMap<(String, String), i32> = HashMap::new();
    let mut self_count: HashMap<String, i32> = HashMap::new();
    let gap = diagram
        .transitions
        .iter()
        .map(|t| measure_label(&t.label).height + 2)
        .fold(3, i32::max);
    let mut next_side_rail = bounds.values().map(|b| b.left + b.width).fold(0, i32::max) + 3;
    let mut side_lanes: HashMap<String, i32> = HashMap::new();
    let allocations = feedback_allocations(diagram, bounds, lane_y, gap, top_y);
    let mut next_bottom_rail = allocations
        .values()
        .filter(|(side, _)| *side == Side::Bottom)
        .map(|(_, rail)| *rail)
        .fold(lane_y - gap, i32::max)
        + gap;
    let mut plans = Vec::new();
    for (index, transition) in diagram.transitions.iter().enumerate() {
        let (Some(&from), Some(&to)) = (bounds.get(&transition.from), bounds.get(&transition.to))
        else {
            continue;
        };
        let target = state_of(&transition.to);
        let base = |kind: RouteKind| RoutePlan {
            transition: index,
            from_id: transition.from.clone(),
            to_id: transition.to.clone(),
            label: transition.label.clone(),
            from,
            to,
            target_is_choice: target.is_some_and(|state| state.kind == StateKind::Choice),
            target_is_hidden_marker: is_hidden_composite_marker(target),
            kind,
        };
        let mut side_parallel = |next_side_rail: &mut i32| {
            let composite_id = innermost_common(diagram, transition);
            let composite = composite_id.as_ref().and_then(|id| bounds.get(id));
            let rail_x = match (&composite_id, composite) {
                (Some(id), Some(composite)) => {
                    let lane = side_lanes.get(id).copied().unwrap_or(0);
                    side_lanes.insert(id.clone(), lane + 1);
                    let right = diagram
                        .states
                        .iter()
                        .filter(|state| containing_composites(diagram, &state.id).contains(id))
                        .filter_map(|state| bounds.get(&state.id).map(|b| b.left + b.width))
                        .fold(composite.left + 1, i32::max);
                    (right + 2 + lane * 3).min(composite.left + composite.width - 2)
                }
                _ => {
                    let rail = *next_side_rail;
                    *next_side_rail += 3;
                    rail
                }
            };
            base(RouteKind::SideParallel {
                rail_x,
                approach: side_parallel_approach(diagram, transition, &from, &to, bounds, rail_x),
            })
        };
        let bottom_rail = |next: &mut i32| {
            let rail = *next;
            *next += gap;
            rail
        };
        let bottom_parallel = |rail_y: i32| {
            base(RouteKind::BottomParallel {
                rail_y,
                approach_x: bottom_approach_x(diagram, transition, &from, &to, bounds, rail_y),
            })
        };
        let bottom_feedback = |rail_y: i32| {
            base(RouteKind::BottomFeedback {
                rail_y,
                approach_x: bottom_approach_x(diagram, transition, &from, &to, bounds, rail_y),
            })
        };
        if transition.from == transition.to {
            let lane = self_count.entry(transition.from.clone()).or_insert(0);
            plans.push(base(RouteKind::SelfLoop { lane: *lane }));
            *lane += 1;
            continue;
        }
        let key = (transition.from.clone(), transition.to.clone());
        let parallel_index = *endpoint_count.get(&key).unwrap_or(&0);
        endpoint_count.insert(key, parallel_index + 1);
        let feedback =
            diagram.direction.horizontal() && is_horizontal_feedback(diagram, &from, &to);
        if let Some(&(side, rail_y)) = allocations.get(&index) {
            plans.push(if side == Side::Bottom {
                bottom_feedback(rail_y)
            } else {
                base(RouteKind::TopFeedback { rail_y })
            });
            continue;
        }
        if parallel_index > 0 {
            if from.center_y == to.center_y {
                let rail = bottom_rail(&mut next_bottom_rail);
                plans.push(bottom_parallel(rail));
            } else {
                plans.push(side_parallel(&mut next_side_rail));
            }
            continue;
        }
        if !diagram.direction.horizontal() {
            let from_parent = state_of(&transition.from).and_then(|s| s.parent_id.as_deref());
            let to_parent = target.and_then(|s| s.parent_id.as_deref());
            let vertical_feedback = if diagram.direction == super::StateDirection::BT {
                from.center_y < to.center_y
            } else {
                from.center_y > to.center_y
            };
            let plan = if (from_parent.is_some() && to_parent.is_some() && from_parent != to_parent)
                || vertical_corridor_crosses(diagram, transition, &from, &to, bounds)
                || vertical_feedback
            {
                side_parallel(&mut next_side_rail)
            } else if from.center_y == to.center_y {
                if has_reverse(diagram, transition) && from.center_x > to.center_x {
                    let rail = bottom_rail(&mut next_bottom_rail);
                    bottom_parallel(rail)
                } else {
                    base(RouteKind::HorizontalForward {
                        left_to_right: from.center_x <= to.center_x,
                    })
                }
            } else if !has_vertical_corridor(&from, &to) {
                side_parallel(&mut next_side_rail)
            } else if from.center_x != to.center_x {
                base(RouteKind::VerticalElbow {
                    has_reverse: false,
                    offset_connector: false,
                })
            } else {
                base(RouteKind::Vertical)
            };
            plans.push(plan);
            continue;
        }
        let plan = if from.center_y != to.center_y {
            if !has_vertical_corridor(&from, &to) {
                side_parallel(&mut next_side_rail)
            } else if from.center_y > to.center_y && feedback {
                bottom_feedback(lane_y)
            } else {
                let reverse = has_reverse(diagram, transition);
                base(RouteKind::VerticalElbow {
                    has_reverse: reverse,
                    offset_connector: reverse || has_opposing_top_connector(diagram, index, bounds),
                })
            }
        } else if feedback {
            bottom_feedback(lane_y)
        } else if horizontal_corridor_crosses(diagram, transition, &from, &to, bounds) {
            let rail = bottom_rail(&mut next_bottom_rail);
            bottom_parallel(rail)
        } else {
            base(RouteKind::HorizontalForward {
                left_to_right: from.center_x <= to.center_x,
            })
        };
        plans.push(plan);
    }
    plans
}

// Render plans.

struct Builder {
    route: RoutePlan,
    cells: Vec<Cell>,
    path: Vec<(i32, i32)>,
    label: Option<Label>,
}

impl Builder {
    fn cell(&mut self, x: i32, y: i32, glyph: Glyph) {
        self.cells.push(Cell { x, y, glyph });
        self.path.push((x, y));
    }

    fn ch(&mut self, x: i32, y: i32, ch: &'static str) {
        self.cell(x, y, Glyph::Char(ch));
    }

    fn point(&mut self, x: i32, y: i32) {
        self.path.push((x, y));
    }

    fn label_at(&mut self, x: i32, y: i32) {
        let metrics = measure_label(&self.route.label);
        if !metrics.lines.is_empty() {
            self.label = Some(Label {
                x,
                y,
                lines: metrics.lines,
            });
        }
    }

    fn horizontal(&mut self, from: i32, to: i32, y: i32, step: i32) {
        let mut x = from;
        while if step == 1 { x <= to } else { x >= to } {
            self.ch(x, y, "─");
            x += step;
        }
    }

    fn vertical(&mut self, x: i32, from: i32, to: i32, step: i32) {
        let mut y = from;
        while if step == 1 { y <= to } else { y >= to } {
            self.ch(x, y, "│");
            y += step;
        }
    }

    fn departure(&mut self, bounds: &Bounds, x: i32, y: i32, ch: &'static str) {
        if bounds.width > 1 && bounds.height > 1 {
            self.ch(x, y, ch);
        }
    }

    fn end_point(&mut self) {
        if self.route.target_is_choice || self.route.target_is_hidden_marker {
            let to = self.route.to;
            self.point(to.left, to.top);
        }
    }
}

fn horizontal_forward(b: &mut Builder, left_to_right: bool) {
    let (from, to) = (b.route.from, b.route.to);
    let y = from.center_y;
    if left_to_right {
        b.departure(
            &from,
            from.left + from.width - 1,
            from.center_y,
            ROUNDED.left_t,
        );
    } else {
        b.departure(&from, from.left, from.center_y, ROUNDED.right_t);
    }
    let step = if left_to_right { 1 } else { -1 };
    let start = if left_to_right {
        from.left + from.width
    } else {
        from.left - 1
    };
    let end = if left_to_right {
        to.left - 1
    } else {
        to.left + to.width
    };
    b.horizontal(start, end - step, y, step);
    if b.route.target_is_hidden_marker {
        b.ch(end, y, "─");
    } else {
        b.cell(
            end,
            y,
            Glyph::Arrow(if left_to_right {
                Direction::Right
            } else {
                Direction::Left
            }),
        );
    }
    if b.route.target_is_choice || b.route.target_is_hidden_marker {
        b.point(to.left, y);
    }
    if b.route.label.is_empty() {
        return;
    }
    let metrics = measure_label(&b.route.label);
    let x = start.min(end) + 1.max(((end - start).abs() - metrics.width).div_euclid(2));
    b.label_at(x, 0.max(y - metrics.height));
}

fn self_loop(b: &mut Builder, lane: i32) {
    let bounds = b.route.from;
    let labeled = !b.route.label.is_empty();
    if bounds.width <= 1 || bounds.height <= 1 {
        let rail_x = bounds.left + 4 + lane * 4;
        let rail_y = bounds.top + 2 + lane * 2;
        b.horizontal(bounds.left + 1, rail_x - 1, bounds.top, 1);
        b.ch(rail_x, bounds.top, "╮");
        b.vertical(rail_x, bounds.top + 1, rail_y - 1, 1);
        b.ch(rail_x, rail_y, "╯");
        b.horizontal(rail_x - 1, bounds.left + 1, rail_y, -1);
        b.ch(bounds.left, rail_y, "╰");
        let mut y = rail_y - 1;
        while y > bounds.top + 1 {
            b.ch(bounds.left, y, "│");
            y -= 1;
        }
        b.cell(bounds.left, bounds.top + 1, Glyph::Arrow(Direction::Up));
        b.point(bounds.left, bounds.top);
        if labeled {
            b.label_at(
                rail_x + 2,
                if lane == 0 {
                    bounds.top + 1
                } else {
                    rail_y - 1
                },
            );
        }
        return;
    }
    let source_x = bounds.left + 2.max(bounds.width.div_euclid(3));
    let bottom = bounds.top + bounds.height - 1;
    let rail_y = bottom + 2 + lane * 3;
    let two_thirds = bounds.width * 2;
    let ceil = two_thirds.div_euclid(3) + i32::from(two_thirds.rem_euclid(3) != 0);
    let target_x = (source_x + 3).max(bounds.left + (bounds.width - 3).min(ceil)) + lane * 4;
    b.departure(&bounds, source_x, bottom, ROUNDED.top_t);
    b.vertical(source_x, bottom + 1, rail_y - 1, 1);
    b.ch(source_x, rail_y, "╰");
    for x in source_x + 1..target_x {
        b.ch(x, rail_y, "─");
    }
    b.ch(target_x, rail_y, "╯");
    let mut y = rail_y - 1;
    while y > bottom + 1 {
        b.ch(target_x, y, "│");
        y -= 1;
    }
    b.cell(target_x, bottom + 1, Glyph::Arrow(Direction::Up));
    if labeled {
        b.label_at(
            target_x + 2,
            if lane == 0 { bottom + 1 } else { rail_y - 1 },
        );
    }
}

fn bottom_lane(b: &mut Builder, rail_y: i32, approach_x: i32) {
    let (from, to) = (b.route.from, b.route.to);
    let source_x = from.center_x;
    let target_x = if to.width > 1 {
        if source_x > to.center_x {
            to.left + 1
        } else {
            to.left + to.width - 2
        }
    } else {
        to.center_x
    };
    let cuts_source = target_x >= from.left && target_x <= from.left + from.width - 1;
    let rail_target = if cuts_source {
        (from.left + from.width).max(to.left + to.width) + 2
    } else {
        approach_x
    };
    let source_bottom = from.top + from.height;
    let target_bottom = to.top + to.height;
    b.departure(&from, source_x, from.top + from.height - 1, ROUNDED.top_t);
    b.vertical(source_x, source_bottom, rail_y - 1, 1);
    b.ch(
        source_x,
        rail_y,
        if source_x > rail_target { "╯" } else { "╰" },
    );
    if source_x != rail_target {
        let step = if source_x < rail_target { 1 } else { -1 };
        let mut x = source_x + step;
        while x != rail_target {
            b.ch(x, rail_y, "─");
            x += step;
        }
    }
    b.ch(
        rail_target,
        rail_y,
        if source_x > rail_target { "╰" } else { "╯" },
    );
    let mut y = rail_y - 1;
    while y > target_bottom {
        b.ch(rail_target, y, "│");
        y -= 1;
    }
    if rail_target != target_x {
        b.ch(
            rail_target,
            target_bottom,
            if rail_target < target_x { "╭" } else { "╮" },
        );
        let step = if rail_target < target_x { 1 } else { -1 };
        let mut x = rail_target + step;
        while x != target_x {
            b.ch(x, target_bottom, "─");
            x += step;
        }
    }
    if b.route.target_is_hidden_marker {
        b.ch(target_x, target_bottom, "│");
    } else {
        b.cell(target_x, target_bottom, Glyph::Arrow(Direction::Up));
    }
    b.end_point();
    if b.route.label.is_empty() {
        return;
    }
    let metrics = measure_label(&b.route.label);
    let room = (source_x - rail_target).abs() - 2;
    let x = if metrics.width <= room {
        source_x.min(rail_target)
            + 1.max(((source_x - rail_target).abs() - metrics.width).div_euclid(2))
    } else {
        rail_target + 2
    };
    b.label_at(x, 0.max(rail_y - metrics.height));
}

fn top_feedback(b: &mut Builder, rail_y: i32) {
    let (from, to) = (b.route.from, b.route.to);
    let source_x = from.center_x;
    let target_x = if to.width > 1 {
        if source_x > to.center_x {
            to.left + to.width - 2
        } else {
            to.left + 1
        }
    } else {
        to.center_x
    };
    let source_top = from.top - 1;
    let target_top = to.top - 1;
    b.departure(&from, source_x, from.top, ROUNDED.bottom_t);
    b.vertical(source_x, source_top, rail_y + 1, -1);
    b.ch(
        source_x,
        rail_y,
        if source_x > target_x { "╮" } else { "╭" },
    );
    if source_x != target_x {
        let step = if source_x < target_x { 1 } else { -1 };
        let mut x = source_x + step;
        while x != target_x {
            b.ch(x, rail_y, "─");
            x += step;
        }
    }
    b.ch(
        target_x,
        rail_y,
        if source_x > target_x { "╭" } else { "╮" },
    );
    for y in rail_y + 1..target_top {
        b.ch(target_x, y, "│");
    }
    if b.route.target_is_hidden_marker {
        b.ch(target_x, target_top, "│");
    } else {
        b.cell(target_x, target_top, Glyph::Arrow(Direction::Down));
    }
    b.end_point();
    if b.route.label.is_empty() {
        return;
    }
    let metrics = measure_label(&b.route.label);
    let room = (source_x - target_x).abs() - 2;
    let x = if metrics.width <= room {
        source_x.min(target_x) + 1.max(((source_x - target_x).abs() - metrics.width).div_euclid(2))
    } else {
        target_x + 2
    };
    b.label_at(x, rail_y - metrics.height);
}

fn side_parallel(b: &mut Builder, rail_x: i32, approach: Option<Approach>) {
    let (from, to) = (b.route.from, b.route.to);
    let start_x = from.left + from.width;
    let start_y = from.center_y;
    let end_y = match approach {
        Some(Approach::Top) => to.top - 2,
        Some(Approach::Bottom) => to.top + to.height + 1,
        None => to.center_y,
    };
    let step = if start_y <= end_y { 1 } else { -1 };
    b.departure(
        &from,
        from.left + from.width - 1,
        from.center_y,
        ROUNDED.left_t,
    );
    b.horizontal(start_x, rail_x - 1, start_y, 1);
    b.ch(rail_x, start_y, if step == 1 { "╮" } else { "╯" });
    let mut y = start_y + step;
    while y != end_y {
        b.ch(rail_x, y, "│");
        y += step;
    }
    b.ch(rail_x, end_y, if step == 1 { "╯" } else { "╮" });
    if let Some(approach) = approach {
        let target_x = inner_connector_x(&to, from.center_x);
        let mut x = rail_x - 1;
        while x > target_x {
            b.ch(x, end_y, "─");
            x -= 1;
        }
        let top = approach == Approach::Top;
        b.ch(target_x, end_y, if top { "╭" } else { "╰" });
        b.cell(
            target_x,
            if top { end_y + 1 } else { end_y - 1 },
            Glyph::Arrow(if top { Direction::Down } else { Direction::Up }),
        );
        b.end_point();
        if !b.route.label.is_empty() {
            let metrics = measure_label(&b.route.label);
            b.label_at(
                rail_x + 2,
                0.max((start_y + to.center_y - metrics.height + 1).div_euclid(2)),
            );
        }
        return;
    }
    let end_x = to.left + to.width;
    let mut x = rail_x - 1;
    while x > end_x {
        b.ch(x, end_y, "─");
        x -= 1;
    }
    if b.route.target_is_hidden_marker {
        b.ch(end_x, end_y, "─");
    } else {
        b.cell(end_x, end_y, Glyph::Arrow(Direction::Left));
    }
    b.end_point();
    if !b.route.label.is_empty() {
        let metrics = measure_label(&b.route.label);
        b.label_at(
            rail_x + 2,
            0.max((start_y + end_y - metrics.height + 1).div_euclid(2)),
        );
    }
}

fn vertical_elbow(b: &mut Builder, has_reverse: bool, offset_connector: bool) {
    let (from, to) = (b.route.from, b.route.to);
    let down = from.center_y < to.center_y;
    let offset = if offset_connector {
        if down { -2 } else { 2 }
    } else {
        0
    };
    let start_x = inner_connector_x(&from, from.center_x + offset);
    let end_x = inner_connector_x(&to, to.center_x + offset);
    let start_y = if down {
        from.top + from.height
    } else {
        from.top - 1
    };
    let end_y = if down { to.top - 1 } else { to.top + to.height };
    let step = if down { 1 } else { -1 };
    if down {
        b.departure(&from, start_x, from.top + from.height - 1, ROUNDED.top_t);
    } else {
        b.departure(&from, start_x, from.top, ROUNDED.bottom_t);
    }
    let available = 0.max((end_y - start_y).abs() - 1);
    let bend_y = if start_x == end_x {
        end_y
    } else if down {
        end_y - step * 2.min(available)
    } else {
        start_y
    };
    let approach_length = (end_y - bend_y).abs();
    let has_approach = approach_length > 0;
    if start_y != bend_y {
        b.vertical(start_x, start_y, bend_y - step, step);
    }
    if start_x != end_x {
        let h = if start_x < end_x { 1 } else { -1 };
        let right = start_x < end_x;
        b.ch(
            start_x,
            bend_y,
            match (down, right) {
                (true, true) => "╰",
                (true, false) => "╯",
                (false, true) => "╭",
                (false, false) => "╮",
            },
        );
        let mut x = start_x + h;
        while x != end_x {
            b.ch(x, bend_y, "─");
            x += h;
        }
        if has_approach {
            b.ch(
                end_x,
                bend_y,
                match (down, right) {
                    (true, true) => "╮",
                    (true, false) => "╭",
                    (false, true) => "╯",
                    (false, false) => "╰",
                },
            );
            for distance in 1..approach_length {
                b.ch(end_x, bend_y + step * distance, "│");
            }
        }
    }
    if b.route.target_is_hidden_marker {
        let ch = if has_approach || start_x == end_x {
            "│"
        } else if down {
            "┬"
        } else {
            "┴"
        };
        b.ch(end_x, end_y, ch);
    } else {
        b.cell(
            end_x,
            end_y,
            Glyph::Arrow(if down { Direction::Down } else { Direction::Up }),
        );
    }
    b.end_point();
    if b.route.label.is_empty() {
        return;
    }
    let metrics = measure_label(&b.route.label);
    if down {
        let left_x = start_x - metrics.width - 2;
        let x = if from.width == 1 && (end_x - start_x).abs() >= metrics.width + 2 {
            start_x.min(end_x) + ((end_x - start_x).abs() - metrics.width).div_euclid(2)
        } else if has_reverse || end_x < start_x {
            if left_x >= 0 { left_x } else { start_x + 4 }
        } else {
            start_x + 2
        };
        b.label_at(
            x,
            if has_approach {
                0.max(bend_y - metrics.height)
            } else {
                (start_y + 1).min(end_y)
            },
        );
    } else {
        let x = start_x.min(end_x) + 1.max(((end_x - start_x).abs() - metrics.width).div_euclid(2));
        b.label_at(
            if start_x == end_x { start_x + 3 } else { x },
            if has_approach {
                0.max(bend_y - metrics.height)
            } else {
                0.max(start_y)
            },
        );
    }
}

fn vertical(b: &mut Builder) {
    let (from, to) = (b.route.from, b.route.to);
    let down = from.center_y <= to.center_y;
    let x = from.center_x;
    let start_y = if down {
        from.top + from.height
    } else {
        from.top - 1
    };
    let end_y = if down { to.top - 1 } else { to.top + to.height };
    let step = if down { 1 } else { -1 };
    if down {
        b.departure(&from, x, from.top + from.height - 1, ROUNDED.top_t);
    } else {
        b.departure(&from, x, from.top, ROUNDED.bottom_t);
    }
    if start_y != end_y {
        b.vertical(x, start_y, end_y - step, step);
    }
    if b.route.target_is_hidden_marker {
        b.ch(x, end_y, "│");
    } else {
        b.cell(
            x,
            end_y,
            Glyph::Arrow(if down { Direction::Down } else { Direction::Up }),
        );
    }
    b.end_point();
    if !b.route.label.is_empty() {
        b.label_at(x + 2, start_y.min(end_y) + 1);
    }
}

fn render_plan(route: RoutePlan) -> RenderPlan {
    let kind = route.kind;
    let mut b = Builder {
        route,
        cells: Vec::new(),
        path: Vec::new(),
        label: None,
    };
    match kind {
        RouteKind::SelfLoop { lane } => self_loop(&mut b, lane),
        RouteKind::HorizontalForward { left_to_right } => horizontal_forward(&mut b, left_to_right),
        RouteKind::BottomFeedback { rail_y, approach_x }
        | RouteKind::BottomParallel { rail_y, approach_x } => {
            bottom_lane(&mut b, rail_y, approach_x)
        }
        RouteKind::TopFeedback { rail_y } => top_feedback(&mut b, rail_y),
        RouteKind::VerticalElbow {
            has_reverse,
            offset_connector,
        } => vertical_elbow(&mut b, has_reverse, offset_connector),
        RouteKind::Vertical => vertical(&mut b),
        RouteKind::SideParallel { rail_x, approach } => side_parallel(&mut b, rail_x, approach),
    }
    RenderPlan {
        route: b.route,
        cells: b.cells,
        path: b.path,
        label: b.label,
        repaired: false,
    }
}

// Repairs around unrelated states and notes.

fn inside(point: (i32, i32), bounds: &Bounds) -> bool {
    point.0 >= bounds.left
        && point.0 < bounds.left + bounds.width
        && point.1 >= bounds.top
        && point.1 < bounds.top + bounds.height
}

fn intersects_unrelated(
    plan: &RenderPlan,
    diagram: &Diagram,
    bounds: &Boxes,
    notes: &[NoteBox],
) -> bool {
    let transition = &diagram.transitions[plan.route.transition];
    if unrelated(diagram, transition, bounds).any(|(_, b)| plan.path.iter().any(|&p| inside(p, &b)))
    {
        return true;
    }
    notes.iter().any(|note| {
        if plan.path.iter().any(|&p| inside(p, &note.bounds)) {
            return true;
        }
        let Some(target) = bounds.get(&note.note.target) else {
            return false;
        };
        let connector = path_claim(
            "note-connector",
            "note-connector",
            Role::Boundary,
            &note_connector_of(note, target).points,
        );
        plan.path.iter().any(|&(x, y)| {
            connector
                .spans
                .iter()
                .any(|s| s.y == y && x >= s.from_x && x <= s.to_x)
        })
    })
}

fn find_body_safe_path(
    start: (i32, i32),
    end: (i32, i32),
    diagram: &Diagram,
    bounds: &Boxes,
    plan: &RenderPlan,
    search: &super::SearchSpace,
    budget: &mut i64,
) -> Option<Vec<(i32, i32)>> {
    let margin = 8.max(bounds.len() as i32 * 2);
    let composite = innermost_common(diagram, &diagram.transitions[plan.route.transition])
        .and_then(|id| bounds.get(&id).copied());
    let xs = plan.path.iter().map(|p| p.0);
    let ys = plan.path.iter().map(|p| p.1);
    let area = match composite {
        Some(c) => super::SearchBounds {
            min_x: c.left + 1,
            min_y: c.top + 1,
            max_x: c.left + c.width - 2,
            max_y: c.top + c.height - 2,
        },
        None => super::SearchBounds {
            min_x: search.min_x - margin,
            min_y: ys.clone().fold(search.min_y, i32::min) - margin,
            max_x: xs.clone().fold(search.max_x, i32::max) + margin,
            max_y: ys.clone().fold(search.max_y, i32::max) + margin,
        },
    };
    let free = |(x, y): (i32, i32)| {
        x >= area.min_x
            && x <= area.max_x
            && y >= area.min_y
            && y <= area.max_y
            && !search.blocked.contains(&Point { x, y })
    };
    let (min_x, max_x) = (xs.clone().min()?, xs.max()?);
    let (min_y, max_y) = (ys.clone().min()?, ys.max()?);
    let mut candidates: Vec<Vec<(i32, i32)>> = vec![
        vec![start, (start.0, end.1), end],
        vec![start, (end.0, start.1), end],
    ];
    for offset in 1..=4 {
        candidates.push(vec![
            start,
            (start.0, min_y - offset),
            (end.0, min_y - offset),
            end,
        ]);
        candidates.push(vec![
            start,
            (start.0, max_y + offset),
            (end.0, max_y + offset),
            end,
        ]);
        candidates.push(vec![
            start,
            (min_x - offset, start.1),
            (min_x - offset, end.1),
            end,
        ]);
        candidates.push(vec![
            start,
            (max_x + offset, start.1),
            (max_x + offset, end.1),
            end,
        ]);
    }
    let direct = candidates
        .iter()
        .map(|points| {
            let points: Vec<Point> = points.iter().map(|&(x, y)| Point { x, y }).collect();
            orthogonal_path_points(&points)
                .into_iter()
                .map(|p| (p.x, p.y))
                .collect::<Vec<_>>()
        })
        .filter(|points| points.iter().all(|&p| free(p)))
        .min_by_key(Vec::len);
    if direct.is_some() {
        return direct;
    }
    manhattan_path(
        &[Point {
            x: start.0,
            y: start.1,
        }],
        Point { x: end.0, y: end.1 },
        &area,
        budget,
        |p| free((p.x, p.y)),
    )
    .map(|path| path.into_iter().map(|p| (p.x, p.y)).collect())
}

fn connection_direction(from: (i32, i32), to: (i32, i32)) -> Direction {
    let dx = to.0 - from.0;
    let dy = to.1 - from.1;
    if dx.abs() >= dy.abs() && dx != 0 {
        return if dx > 0 {
            Direction::Right
        } else {
            Direction::Left
        };
    }
    if dy != 0 {
        return if dy > 0 {
            Direction::Down
        } else {
            Direction::Up
        };
    }
    Direction::Right
}

fn render_safe(
    plan: &RenderPlan,
    safe: &[(i32, i32)],
    prefix: &[(i32, i32)],
    suffix: &[(i32, i32)],
    source_char: Option<&'static str>,
) -> RenderPlan {
    let prefix_keys: HashSet<(i32, i32)> = prefix.iter().copied().collect();
    let mut cells: Vec<Cell> = match source_char {
        Some(ch) => prefix
            .iter()
            .map(|&(x, y)| Cell {
                x,
                y,
                glyph: Glyph::Char(ch),
            })
            .collect(),
        None => plan
            .cells
            .iter()
            .filter(|c| prefix_keys.contains(&(c.x, c.y)))
            .copied()
            .collect(),
    };
    let previous = prefix.last().copied();
    for (index, &point) in safe.iter().enumerate() {
        if index == safe.len() - 1 {
            let direction =
                connection_direction(point, (plan.route.to.center_x, plan.route.to.center_y));
            let glyph = if plan.route.target_is_hidden_marker {
                Glyph::Char(if matches!(direction, Direction::Left | Direction::Right) {
                    "─"
                } else {
                    "│"
                })
            } else {
                Glyph::Arrow(direction)
            };
            cells.push(Cell {
                x: point.0,
                y: point.1,
                glyph,
            });
            continue;
        }
        let before = if index == 0 {
            previous
        } else {
            Some(safe[index - 1])
        };
        let mut directions = Directions::default();
        if let Some(before) = before {
            directions.add(connection_direction(point, before));
        }
        directions.add(connection_direction(point, safe[index + 1]));
        cells.push(Cell {
            x: point.0,
            y: point.1,
            glyph: Glyph::Char(line_glyph(
                directions,
                CornerStyle::Rounded,
                LineStyle::Single,
            )),
        });
    }
    let path = prefix.iter().chain(safe).chain(suffix).copied().collect();
    RenderPlan {
        route: plan.route.clone(),
        cells,
        path,
        label: plan.label.clone(),
        repaired: true,
    }
}

/// A port: the cell outside the side, the border cell, and the border's connector glyph.
type Port = ((i32, i32), (i32, i32), &'static str);

fn ports(bounds: &Bounds) -> Vec<Port> {
    [
        (
            (bounds.center_x, bounds.top - 1),
            (bounds.center_x, bounds.top),
            ROUNDED.bottom_t,
        ),
        (
            (bounds.center_x, bounds.top + bounds.height),
            (bounds.center_x, bounds.top + bounds.height - 1),
            ROUNDED.top_t,
        ),
        (
            (bounds.left - 1, bounds.center_y),
            (bounds.left, bounds.center_y),
            ROUNDED.right_t,
        ),
        (
            (bounds.left + bounds.width, bounds.center_y),
            (bounds.left + bounds.width - 1, bounds.center_y),
            ROUNDED.left_t,
        ),
    ]
    .into_iter()
    .filter(|port| port.0.0 >= 0)
    .collect()
}

fn alternate_safe(
    plan: &RenderPlan,
    diagram: &Diagram,
    bounds: &Boxes,
    notes: &[NoteBox],
    search: &super::SearchSpace,
    budget: &mut i64,
) -> RenderPlan {
    let mut candidates: Vec<RenderPlan> = Vec::new();
    for source in ports(&plan.route.from) {
        for target in ports(&plan.route.to) {
            let Some(safe) =
                find_body_safe_path(source.0, target.0, diagram, bounds, plan, search, budget)
            else {
                continue;
            };
            let from = plan.route.from;
            let prefix: Vec<(i32, i32)> = if from.width > 1 && from.height > 1 {
                vec![source.1]
            } else {
                Vec::new()
            };
            let suffix: Vec<(i32, i32)> =
                if plan.route.target_is_choice || plan.route.target_is_hidden_marker {
                    vec![(plan.route.to.left, plan.route.to.top)]
                } else {
                    Vec::new()
                };
            let repaired = render_safe(plan, &safe, &prefix, &suffix, Some(source.2));
            if !intersects_unrelated(&repaired, diagram, bounds, notes) {
                candidates.push(repaired);
            }
        }
    }
    candidates
        .into_iter()
        .min_by_key(|candidate| candidate.path.len())
        .unwrap_or_else(|| plan.clone())
}

#[allow(clippy::too_many_arguments)]
fn body_safe(
    plan: &RenderPlan,
    diagram: &Diagram,
    bounds: &Boxes,
    notes: &[NoteBox],
    search: &super::SearchSpace,
    budget: &mut i64,
    force: bool,
) -> RenderPlan {
    if !force && !intersects_unrelated(plan, diagram, bounds, notes) {
        return plan.clone();
    }
    let source = plan.path.iter().position(|&p| !inside(p, &plan.route.from));
    let target = plan.path.iter().rposition(|&p| !inside(p, &plan.route.to));
    let (Some(source), Some(target)) = (source, target) else {
        return plan.clone();
    };
    if target < source {
        return plan.clone();
    }
    let Some(safe) = find_body_safe_path(
        plan.path[source],
        plan.path[target],
        diagram,
        bounds,
        plan,
        search,
        budget,
    ) else {
        return alternate_safe(plan, diagram, bounds, notes, search, budget);
    };
    let repaired = render_safe(
        plan,
        &safe,
        &plan.path[..source],
        &plan.path[target + 1..],
        None,
    );
    if safe.len() <= plan.path.len() + 4 {
        return repaired;
    }
    let alternate = alternate_safe(plan, diagram, bounds, notes, search, budget);
    if alternate.repaired && alternate.path.len() < repaired.path.len() {
        alternate
    } else {
        repaired
    }
}

// Labels.

fn label_distance(x: i32, y: i32, width: i32, height: i32, path: &[(i32, i32)]) -> i32 {
    path.iter()
        .map(|&(px, py)| {
            let dx = if px < x {
                x - px
            } else if px >= x + width {
                px - (x + width - 1)
            } else {
                0
            };
            let dy = if py < y {
                y - py
            } else if py >= y + height {
                py - (y + height - 1)
            } else {
                0
            };
            dx + dy
        })
        .min()
        .unwrap_or(i32::MAX)
}

fn label_candidates(plan: &RenderPlan, width: i32, height: i32) -> Vec<(i32, i32)> {
    let mut candidates: IndexMap<(i32, i32), ()> = IndexMap::new();
    if let Some(label) = &plan.label
        && (!plan.repaired || label_distance(label.x, label.y, width, height, &plan.path) <= 4)
    {
        candidates.insert((label.x, label.y), ());
    }
    for &(x, y) in &plan.path {
        candidates.insert((x + 2, y - height.div_euclid(2)), ());
        candidates.insert((x - width - 2, y - height.div_euclid(2)), ());
        candidates.insert((x - width.div_euclid(2), y - height - 1), ());
        candidates.insert((x - width.div_euclid(2), y + 2), ());
    }
    let preferred = plan
        .label
        .as_ref()
        .map(|l| (l.x, l.y))
        .or(plan.path.first().copied())
        .unwrap_or((0, 0));
    let mut list: Vec<(i32, i32)> = candidates.into_keys().collect();
    list.sort_by_key(|c| (c.0 - preferred.0).abs() + (c.1 - preferred.1).abs());
    list
}

fn closed_frame(b: &Bounds) -> [Point; 5] {
    let (right, bottom) = (b.left + b.width - 1, b.top + b.height - 1);
    [
        Point {
            x: b.left,
            y: b.top,
        },
        Point { x: right, y: b.top },
        Point {
            x: right,
            y: bottom,
        },
        Point {
            x: b.left,
            y: bottom,
        },
        Point {
            x: b.left,
            y: b.top,
        },
    ]
}

fn note_claims(notes: &[NoteBox], bounds: &Boxes) -> Vec<crate::core::spatial::Claim> {
    notes
        .iter()
        .flat_map(|note| {
            let mut claims = vec![rect_claim(
                format!("note:{}", note.id),
                format!("note:{}", note.id),
                Role::Body,
                &note.bounds,
            )];
            if let Some(target) = bounds.get(&note.note.target) {
                claims.push(path_claim(
                    format!("note-connector:{}", note.id),
                    format!("note-connector:{}", note.id),
                    Role::Boundary,
                    &note_connector_of(note, target).points,
                ));
            }
            claims
        })
        .collect()
}

fn path_points(path: &[(i32, i32)]) -> Vec<Point> {
    path.iter().map(|&(x, y)| Point { x, y }).collect()
}

fn place_labels(
    plans: Vec<RenderPlan>,
    diagram: &Diagram,
    bounds: &Boxes,
    notes: &[NoteBox],
) -> Result<Vec<RenderPlan>, String> {
    let mut claims = Vec::new();
    for state in &diagram.states {
        if let Some(b) = bounds.get(&state.id)
            && !is_hidden_composite_marker(Some(state))
        {
            claims.push(rect_claim(
                format!("state:{}", state.id),
                format!("state:{}", state.id),
                Role::Body,
                b,
            ));
        }
    }
    for (index, plan) in plans.iter().enumerate() {
        claims.push(path_claim(
            format!("route:{index}"),
            format!("route:{index}"),
            Role::Route,
            &path_points(&plan.path),
        ));
    }
    for composite in &diagram.composites {
        if let Some(b) = bounds.get(&composite.id) {
            let id = format!("composite:{}", composite.id);
            claims.push(path_claim(id.clone(), id, Role::Boundary, &closed_frame(b)));
        }
    }
    claims.extend(note_claims(notes, bounds));
    let mut space = SpatialIndex::default().add(claims);

    let mut counts: HashMap<(&str, &str), i32> = HashMap::new();
    for plan in &plans {
        *counts
            .entry((&plan.route.from_id, &plan.route.to_id))
            .or_insert(0) += 1;
    }
    let mut order: Vec<usize> = (0..plans.len()).collect();
    order.sort_by_key(|&index| plans[index].repaired);
    let mut placed: HashMap<usize, RenderPlan> = HashMap::new();
    for index in order {
        let plan = &plans[index];
        let Some(label) = &plan.label else {
            placed.insert(index, plan.clone());
            continue;
        };
        let label_width = label
            .lines
            .iter()
            .map(|line| width(line))
            .max()
            .unwrap_or(0);
        let height = label.lines.len() as i32;
        let lanes = counts
            .get(&(plan.route.from_id.as_str(), plan.route.to_id.as_str()))
            .copied()
            .unwrap_or(0)
            > 1;
        let padding = if lanes || label.lines.len() > 1 { 1 } else { 0 };
        let claim = |x: i32, y: i32| {
            rect_claim(
                format!("label:{index}"),
                format!("label:{index}"),
                Role::Label,
                &Bounds::rect(x, y, label_width, height),
            )
        };
        let shares_loop = plans.iter().any(|candidate| {
            candidate.route.from_id == plan.route.from_id
                && match plan.route.kind {
                    RouteKind::SelfLoop { .. } => candidate.route.kind == RouteKind::Vertical,
                    _ => matches!(candidate.route.kind, RouteKind::SelfLoop { .. }),
                }
        });
        let side = matches!(plan.route.kind, RouteKind::SideParallel { .. });
        let corridor_top = if side
            && plans.iter().enumerate().any(|(other, candidate)| {
                other != index && candidate.route.to_id == plan.route.to_id
            }) {
            plan.path.iter().map(|p| p.1).min()
        } else if shares_loop
            && (matches!(plan.route.kind, RouteKind::SelfLoop { .. })
                || (plan.route.kind == RouteKind::Vertical
                    && plan.route.from.center_y < plan.route.to.center_y))
        {
            Some(plan.route.from.top + plan.route.from.height)
        } else {
            None
        };
        let corridor_bottom = plan.path.iter().map(|p| p.1).max().unwrap_or(0);
        let strict = plan.repaired || side || lanes || corridor_top.is_some();
        let policy = Policy {
            contacts: Vec::new(),
            clearance: ClearancePolicy::ByRole(vec![
                (
                    Role::Body,
                    Clearance {
                        x: padding,
                        y: padding,
                    },
                ),
                (Role::Label, Clearance { x: 1, y: 1 }),
                (
                    Role::Route,
                    if strict {
                        Clearance { x: 1, y: 0 }
                    } else {
                        Clearance::default()
                    },
                ),
            ]),
        };
        let is_clear = |space: &SpatialIndex, x: i32, y: i32| {
            if x < 0 || y < 0 || corridor_top.is_some_and(|top| y < top || y > corridor_bottom) {
                return false;
            }
            space.is_free(&claim(x, y), &policy)
        };
        let candidates = label_candidates(plan, label_width, height);
        let nearby = candidates.iter().copied().find(|&(x, y)| {
            (!strict || label_distance(x, y, label_width, height, &plan.path) >= 2)
                && is_clear(&space, x, y)
        });
        let (mut x, mut y) = nearby
            .or(candidates.first().copied())
            .unwrap_or((label.x, label.y));
        if nearby.is_none() {
            'search: for distance in 1..500i32 {
                for dx in -distance..=distance {
                    let dy = distance - dx.abs();
                    let ys = if dy == 0 {
                        vec![y]
                    } else {
                        vec![y - dy, y + dy]
                    };
                    for cy in ys {
                        let cx = x + dx;
                        let path_distance = label_distance(cx, cy, label_width, height, &plan.path);
                        if !(2..=8).contains(&path_distance) || !is_clear(&space, cx, cy) {
                            continue;
                        }
                        x = cx;
                        y = cy;
                        break 'search;
                    }
                }
            }
        }
        if !is_clear(&space, x, y) {
            'fallback: for distance in 1..500i32 {
                for dx in -distance..=distance {
                    let dy = distance - dx.abs();
                    let ys = if dy == 0 {
                        vec![y]
                    } else {
                        vec![y - dy, y + dy]
                    };
                    for cy in ys {
                        if !is_clear(&space, x + dx, cy) {
                            continue;
                        }
                        x += dx;
                        y = cy;
                        break 'fallback;
                    }
                }
            }
        }
        if !is_clear(&space, x, y) {
            return Err(format!(
                "Transition {} has no clear label position",
                plan.route.from_id
            ));
        }
        space = space.add([claim(x, y)]);
        let mut next = plan.clone();
        next.label = Some(Label {
            x,
            y,
            lines: label.lines.clone(),
        });
        placed.insert(index, next);
    }
    Ok((0..plans.len())
        .map(|index| {
            placed
                .remove(&index)
                .unwrap_or_else(|| plans[index].clone())
        })
        .collect())
}

pub struct RenderOptions<'a> {
    pub feedback_top_y: Option<i32>,
    pub notes: &'a [NoteBox],
    pub repair: bool,
}

pub fn render_plans(
    diagram: &Diagram,
    bounds: &Boxes,
    lane_y: i32,
    options: &RenderOptions,
    budget: &mut i64,
) -> Result<Vec<RenderPlan>, String> {
    let plans: Vec<RenderPlan> = route_plans(diagram, bounds, lane_y, options.feedback_top_y)
        .into_iter()
        .map(render_plan)
        .collect();
    if !options.repair {
        return place_labels(plans, diagram, bounds, options.notes);
    }
    let mut base_claims = Vec::new();
    for state in &diagram.states {
        if let Some(b) = bounds.get(&state.id)
            && !is_hidden_composite_marker(Some(state))
        {
            base_claims.push(rect_claim(
                format!("state:{}", state.id),
                format!("state:{}", state.id),
                Role::Body,
                b,
            ));
        }
    }
    base_claims.extend(note_claims(options.notes, bounds));
    let base = SpatialIndex::default().add(base_claims);
    let mut repaired: Vec<RenderPlan> = Vec::new();
    for (index, plan) in plans.iter().enumerate() {
        let disjoint: Vec<usize> = (0..repaired.len())
            .filter(|&i| {
                let ends = [
                    repaired[i].route.from_id.as_str(),
                    repaired[i].route.to_id.as_str(),
                ];
                !ends.contains(&plan.route.from_id.as_str())
                    && !ends.contains(&plan.route.to_id.as_str())
            })
            .collect();
        let obstacles: Vec<usize> = (0..repaired.len())
            .filter(|i| {
                disjoint.contains(i)
                    || (repaired[*i].route.from_id == plan.route.to_id
                        && repaired[*i].route.to_id == plan.route.from_id)
            })
            .collect();
        let space = base.add(obstacles.iter().enumerate().map(|(previous_index, &i)| {
            let id = format!("transition:{index}:obstacle:{previous_index}");
            path_claim(id.clone(), id, Role::Route, &path_points(&repaired[i].path))
        }));
        let search = search_space(&space, |_| 0);
        let force = disjoint.iter().any(|&i| {
            let occupied: HashSet<(i32, i32)> = repaired[i].path.iter().copied().collect();
            plan.path.iter().any(|p| occupied.contains(p))
        });
        let next = body_safe(plan, diagram, bounds, options.notes, &search, budget, force);
        repaired.push(next);
    }
    place_labels(repaired, diagram, bounds, options.notes)
}

pub struct Junction {
    pub bounds: Bounds,
    pub choice: bool,
    pub connections: Directions,
}

pub fn junction_plans(diagram: &Diagram, bounds: &Boxes, plans: &[RenderPlan]) -> Vec<Junction> {
    let by_transition: HashMap<usize, &RenderPlan> = plans
        .iter()
        .map(|plan| (plan.route.transition, plan))
        .collect();
    diagram
        .states
        .iter()
        .filter_map(|state| {
            let choice = state.kind == StateKind::Choice;
            if !choice && !is_hidden_composite_marker(Some(state)) {
                return None;
            }
            let b = *bounds.get(&state.id)?;
            let mut connections = Directions::default();
            for (index, transition) in diagram.transitions.iter().enumerate() {
                let plan = by_transition.get(&index);
                if transition.to == state.id
                    && let Some(plan) = plan
                    && plan.path.len() >= 2
                {
                    let junction = plan.path[plan.path.len() - 1];
                    connections.add(connection_direction(
                        junction,
                        plan.path[plan.path.len() - 2],
                    ));
                }
                if transition.from == state.id
                    && let Some(first) = plan.and_then(|plan| plan.path.first())
                {
                    connections.add(connection_direction((b.left, b.top), *first));
                }
            }
            Some(Junction {
                bounds: b,
                choice,
                connections,
            })
        })
        .collect()
}
