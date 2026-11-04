//! Edge label placement (`flowchart/labels.ts`).

use super::types::Route;
use crate::core::geometry::{
    Axis, Direction, Point, Segment, centered_span_start, clamp_point, inset_span, midpoint, point,
    point_on_segment, segment_between, segment_span, shift_point, span_capacity,
};
use crate::core::text::{measure_label_width, pad_label_line, split_lines};

const LABEL_BUS_CLEARANCE: i32 = 3;
const LABEL_NODE_CLEARANCE: i32 = 2;
const LABEL_LINE_CLEARANCE: i32 = 2;
const LABEL_TERMINAL_CLEARANCE: i32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LabelLayout {
    pub lines: Vec<String>,
    pub point: Point,
    pub width: i32,
    pub height: i32,
}

pub fn label_width(label: &str) -> i32 {
    measure_label_width(label)
}

fn minimum_inline_label_length(width: i32) -> i32 {
    width + LABEL_LINE_CLEARANCE * 2 - 1
}

pub fn horizontal_label_rank_gap(width: i32) -> i32 {
    minimum_inline_label_length(width) + LABEL_BUS_CLEARANCE + 1
}

pub fn vertical_branch_label_gap(width: i32) -> i32 {
    minimum_inline_label_length(width) + LABEL_BUS_CLEARANCE + LABEL_NODE_CLEARANCE
}

fn inline_label_slot(segment: &Segment, width: i32) -> (i32, bool) {
    let slot = inset_span(segment_span(segment), LABEL_LINE_CLEARANCE);
    (
        centered_span_start(slot, width),
        span_capacity(slot) >= width,
    )
}

fn segment_label_point(segment: &Segment, width: i32, height: i32) -> Point {
    if segment.axis == Axis::X {
        let (x, fits) = inline_label_slot(segment, width);
        if height == 1 && fits {
            return point(x, segment.from.y);
        }
        if height > 1 {
            return shift_point(point(x, segment.from.y), Direction::Up, height);
        }
        return clamp_point(shift_point(
            shift_point(segment.from, segment.direction, LABEL_LINE_CLEARANCE),
            Direction::Up,
            height,
        ));
    }
    let slot = inset_span(segment_span(segment), LABEL_TERMINAL_CLEARANCE);
    if span_capacity(slot) >= height {
        return clamp_point(point(segment.from.x + 1, centered_span_start(slot, height)));
    }
    let center = shift_point(
        point_on_segment(segment, midpoint(segment_span(segment))),
        Direction::Right,
        1,
    );
    clamp_point(shift_point(
        center,
        Direction::Up,
        (height - 1).div_euclid(2),
    ))
}

fn best_label_segment(
    points: &[Point],
    width: i32,
    preferred_axis: Option<Axis>,
    preferred_segment: Option<usize>,
) -> Option<Segment> {
    let segments: Vec<Segment> = points
        .windows(2)
        .filter_map(|pair| segment_between(pair[0], pair[1]))
        .collect();
    if let Some(segment) = preferred_segment.and_then(|index| segments.get(index)) {
        return Some(*segment);
    }
    if let Some(axis) = preferred_axis
        && let Some(segment) = segments.iter().find(|segment| segment.axis == axis)
    {
        return Some(*segment);
    }
    let mut roomy: Option<Segment> = None;
    let mut vertical: Option<Segment> = None;
    let mut longest: Option<Segment> = None;
    for segment in &segments {
        if roomy.is_none() && segment.axis == Axis::X && inline_label_slot(segment, width).1 {
            roomy = Some(*segment);
        }
        if vertical.is_none() && segment.axis == Axis::Y {
            vertical = Some(*segment);
        }
        if longest.is_none_or(|longest| segment.length > longest.length) {
            longest = Some(*segment);
        }
    }
    roomy.or(vertical).or(longest)
}

fn label_point(
    points: &[Point],
    width: i32,
    height: i32,
    preferred_axis: Option<Axis>,
    preferred_segment: Option<usize>,
) -> Point {
    match best_label_segment(points, width, preferred_axis, preferred_segment) {
        Some(segment) => segment_label_point(&segment, width, height),
        None => points.first().copied().unwrap_or(point(0, 0)),
    }
}

pub fn edge_label_layout(
    points: &[Point],
    label: &str,
    preferred_axis: Option<Axis>,
    preferred_segment: Option<usize>,
) -> LabelLayout {
    let lines: Vec<String> = split_lines(label)
        .iter()
        .map(|line| pad_label_line(line))
        .collect();
    let width = label_width(label);
    let height = lines.len() as i32;
    LabelLayout {
        point: label_point(points, width, height, preferred_axis, preferred_segment),
        lines,
        width,
        height,
    }
}

pub fn route_label_layout(route: &Route) -> LabelLayout {
    let lines: Vec<String> = split_lines(&route.edge.label)
        .iter()
        .map(|line| pad_label_line(line))
        .collect();
    let width = label_width(&route.edge.label);
    let height = lines.len() as i32;
    LabelLayout {
        point: route
            .label_point
            .unwrap_or_else(|| label_point(&route.points, width, height, route.label_axis, None)),
        lines,
        width,
        height,
    }
}
