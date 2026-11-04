//! Edge routing (`flowchart/routing.ts`).

use std::collections::HashSet;
use std::rc::Rc;

use indexmap::{IndexMap, IndexSet};

use super::labels::{LabelLayout, edge_label_layout, route_label_layout};
use super::types::{
    Diagram, Edge, Endpoint, FlowDirection, LabelSide, NodeBounds, Route, Subgraph, SubgraphBounds,
};
use crate::core::geometry::{
    Axis, Bounds, Direction, Lane, Point, Side, advance_coordinate, after_farthest_coordinate,
    before_nearest_coordinate, bounds_border_point, bounds_center, bounds_side_point,
    center_coordinate, coordinate, js_round, keep_after, keep_before, lane, opposite_side,
    orthogonal_path, orthogonal_path_points, path_through, path_via_lane, point, segment_between,
    segment_span, shift_point, side_for_direction, snap_coordinate, with_coordinate,
};
use crate::core::text::{split_lines, width};

pub type Nodes = IndexMap<String, NodeBounds>;
pub type Frames = IndexMap<String, SubgraphBounds>;

const BUS_CLEARANCE: i32 = 3;
const NODE_CLEARANCE: i32 = 2;
const CANDIDATE_BUDGET: i32 = 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Source,
    Target,
}

struct Record {
    edge: Rc<Edge>,
    source_port: Point,
    target_port: Point,
}

/// Nodes shadow frames with the same ID, as TS's `new Map([...frames, ...nodes])`.
struct Endpoints<'a> {
    nodes: &'a Nodes,
    frames: Option<&'a Frames>,
}

impl<'a> Endpoints<'a> {
    fn get(&self, id: &str) -> Option<Endpoint<'a>> {
        self.nodes.get(id).map(Endpoint::Node).or_else(|| {
            self.frames
                .and_then(|frames| frames.get(id))
                .map(Endpoint::Subgraph)
        })
    }
}

fn vertical_travel(from: &Bounds, to: &Bounds) -> Direction {
    if center_coordinate(to, Axis::Y) >= center_coordinate(from, Axis::Y) {
        Direction::Down
    } else {
        Direction::Up
    }
}

fn is_vertical_back_edge(from: &Bounds, to: &Bounds, direction: FlowDirection) -> bool {
    if direction == FlowDirection::BT {
        to.center_y > from.center_y
    } else {
        to.center_y < from.center_y
    }
}

fn is_horizontal_back_edge(from: &Bounds, to: &Bounds, direction: FlowDirection) -> bool {
    if direction == FlowDirection::RL {
        to.center_x > from.center_x
    } else {
        to.center_x < from.center_x
    }
}

fn horizontal_travel(from: &Bounds, to: &Bounds, direction: FlowDirection) -> Direction {
    let right = if direction == FlowDirection::RL {
        to.center_x > from.center_x
    } else {
        to.center_x >= from.center_x
    };
    if right {
        Direction::Right
    } else {
        Direction::Left
    }
}

pub(crate) fn title_bounds(frame: &SubgraphBounds) -> Bounds {
    let lines = split_lines(&frame.label);
    let height = lines.len() as i32;
    let top = if frame.label_side == LabelSide::Top {
        frame.bounds.top
    } else {
        frame.bounds.top + frame.bounds.height - height
    };
    Bounds {
        left: frame.bounds.left + 2,
        top,
        width: lines
            .iter()
            .map(|line| width(&format!(" {line} ")))
            .max()
            .unwrap_or(0),
        height,
        center_x: 0,
        center_y: 0,
    }
}

fn contains(bounds: &Bounds, point: Point) -> bool {
    point.y >= bounds.top
        && point.y < bounds.top + bounds.height
        && point.x >= bounds.left
        && point.x < bounds.left + bounds.width
}

fn clear_title_port(endpoint: Endpoint, port: Point, role: Role) -> Point {
    let Endpoint::Subgraph(frame) = endpoint else {
        return port;
    };
    if role != Role::Source || frame.label.is_empty() {
        return port;
    }
    let connector = source_connector(&frame.bounds, port);
    let title = title_bounds(frame);
    if !contains(&title, point(connector.x, connector.y)) {
        return port;
    }
    let after = title.left + title.width;
    if after <= frame.bounds.left + frame.bounds.width - 2 {
        return point(after, port.y);
    }
    if title.left - 1 >= frame.bounds.left + 1 {
        return point(title.left - 1, port.y);
    }
    port
}

fn side_point(endpoint: Endpoint, side: Side, role: Role) -> Point {
    clear_title_port(endpoint, bounds_side_point(endpoint.bounds(), side), role)
}

fn vertical_back_edge_path(from: Endpoint, to: Endpoint, left_boundary: Option<i32>) -> Vec<Point> {
    let start = side_point(from, Side::Left, Role::Source);
    let end = side_point(to, Side::Left, Role::Target);
    let preferred =
        after_farthest_coordinate(&[start, end], Axis::X, Direction::Left, BUS_CLEARANCE);
    let bus = left_boundary.map_or(preferred, |boundary| {
        preferred.min(boundary - BUS_CLEARANCE * 2)
    });
    path_via_lane(start, lane(Axis::X, bus), end)
}

fn vertical_forward_edge_path(from: Endpoint, to: Endpoint) -> Vec<Point> {
    let travel = vertical_travel(from.bounds(), to.bounds());
    let start_side = side_for_direction(travel);
    let source = bounds_center(from.bounds());
    let target = bounds_center(to.bounds());
    let snapped = with_coordinate(
        bounds_side_point(from.bounds(), start_side),
        Axis::X,
        snap_coordinate(source.x, target.x, 1),
    );
    let start = clear_title_port(from, snapped, Role::Source);
    let end = side_point(to, opposite_side(start_side), Role::Target);
    orthogonal_path(start, end, Some(Axis::Y))
}

fn horizontal_back_edge_path(from: Endpoint, to: Endpoint) -> Vec<Point> {
    let start = side_point(from, Side::Top, Role::Source);
    let end = side_point(to, Side::Top, Role::Target);
    let bus = after_farthest_coordinate(&[start, end], Axis::Y, Direction::Up, BUS_CLEARANCE);
    path_via_lane(start, lane(Axis::Y, bus), end)
}

fn horizontal_edge_path(from: Endpoint, to: Endpoint, direction: FlowDirection) -> Vec<Point> {
    let (f, t) = (from.bounds(), to.bounds());
    if f.left < t.left + t.width && t.left < f.left + f.width {
        return vertical_forward_edge_path(from, to);
    }
    if is_horizontal_back_edge(f, t, direction) {
        return horizontal_back_edge_path(from, to);
    }
    let start_side = side_for_direction(horizontal_travel(f, t, direction));
    orthogonal_path(
        side_point(from, start_side, Role::Source),
        side_point(to, opposite_side(start_side), Role::Target),
        Some(Axis::X),
    )
}

fn self_edge_path(endpoint: Endpoint, offset: i32) -> Vec<Point> {
    let bounds = endpoint.bounds();
    let start = side_point(endpoint, Side::Right, Role::Source);
    let end = side_point(endpoint, Side::Bottom, Role::Target);
    let right = bounds.left + bounds.width + BUS_CLEARANCE + offset;
    let bottom = bounds.top + bounds.height + 1 + offset;
    vec![
        start,
        point(right, start.y),
        point(right, bottom),
        point(end.x, bottom),
        end,
    ]
}

fn parallel_edge_path(from: Endpoint, to: Endpoint, axis: Axis, coordinate: i32) -> Vec<Point> {
    let side = if axis == Axis::Y {
        Side::Bottom
    } else {
        Side::Right
    };
    path_via_lane(
        side_point(from, side, Role::Source),
        lane(axis, coordinate),
        side_point(to, side, Role::Target),
    )
}

fn label_height(edge: &Edge) -> i32 {
    if edge.label.is_empty() {
        0
    } else {
        split_lines(&edge.label).len() as i32
    }
}

fn right_render_extent(route: &Route) -> i32 {
    let mut right = route.points.iter().map(|p| p.x).max().unwrap_or(i32::MIN);
    if !route.edge.label.is_empty() {
        let label = route_label_layout(route);
        right = right.max(label.point.x + label.width - 1);
    }
    right
}

fn parallel_lane_axis(from: &Bounds, to: &Bounds) -> Axis {
    if (to.center_x - from.center_x).abs() >= (to.center_y - from.center_y).abs() {
        Axis::Y
    } else {
        Axis::X
    }
}

fn edge_path(
    from: Endpoint,
    to: Endpoint,
    direction: FlowDirection,
    left_boundary: Option<i32>,
) -> Vec<Point> {
    if from.id() == to.id() {
        return self_edge_path(from, 0);
    }
    if !direction.vertical() {
        return horizontal_edge_path(from, to, direction);
    }
    let (f, t) = (from.bounds(), to.bounds());
    if f.top < t.top + t.height && t.top < f.top + f.height {
        let travel = if t.center_x >= f.center_x {
            Direction::Right
        } else {
            Direction::Left
        };
        return orthogonal_path(
            side_point(from, side_for_direction(travel), Role::Source),
            side_point(to, opposite_side(side_for_direction(travel)), Role::Target),
            None,
        );
    }
    if is_vertical_back_edge(f, t, direction) {
        vertical_back_edge_path(from, to, left_boundary)
    } else {
        vertical_forward_edge_path(from, to)
    }
}

fn source_fan_out_lane(source: Point, targets: &[Point], axis: Axis, travel: Direction) -> i32 {
    let unclamped = keep_before(
        advance_coordinate(coordinate(source, axis), travel, BUS_CLEARANCE),
        before_nearest_coordinate(targets, axis, travel, NODE_CLEARANCE),
        travel,
    );
    keep_after(unclamped, coordinate(source, axis), travel)
}

fn reserve_fan_out_lane(
    source: Point,
    targets: &[Point],
    axis: Axis,
    travel: Direction,
    reserved: &mut HashSet<i32>,
) -> i32 {
    let preferred = source_fan_out_lane(source, targets, axis, travel);
    let boundary = before_nearest_coordinate(targets, axis, travel, NODE_CLEARANCE);
    let origin = coordinate(source, axis);
    let usable = |candidate: i32, reserved: &HashSet<i32>| {
        keep_before(candidate, boundary, travel) == candidate
            && keep_after(candidate, origin, travel) == candidate
            && !reserved.contains(&candidate)
    };
    let mut checked = 0;
    let mut available = None;
    let mut offset = 0;
    while offset <= (boundary - preferred).abs() && checked < CANDIDATE_BUDGET {
        checked += 1;
        let candidate = advance_coordinate(preferred, travel, offset);
        if usable(candidate, reserved) {
            available = Some(candidate);
            break;
        }
        offset += 1;
    }
    if available.is_none() {
        let mut offset = 1;
        while offset <= (preferred - origin).abs() && checked < CANDIDATE_BUDGET {
            checked += 1;
            let candidate = advance_coordinate(preferred, travel, -offset);
            if usable(candidate, reserved) {
                available = Some(candidate);
                break;
            }
            offset += 1;
        }
    }
    let lane = available.unwrap_or(preferred);
    reserved.insert(lane);
    lane
}

fn target_fan_in_lane(sources: &[Point], target: Point, axis: Axis, travel: Direction) -> i32 {
    let unclamped = keep_after(
        advance_coordinate(coordinate(target, axis), travel, -BUS_CLEARANCE),
        after_farthest_coordinate(sources, axis, travel, NODE_CLEARANCE),
        travel,
    );
    keep_before(
        unclamped,
        advance_coordinate(coordinate(target, axis), travel, -1),
        travel,
    )
}

fn port_for_travel(endpoint: Endpoint, travel: Direction, role: Role) -> Point {
    let side = if role == Role::Source {
        side_for_direction(travel)
    } else {
        opposite_side(side_for_direction(travel))
    };
    side_point(endpoint, side, role)
}

pub(crate) fn subgraph_contains_member(
    subgraphs: &[Subgraph],
    subgraph: &Subgraph,
    endpoint: &str,
) -> bool {
    subgraph.node_ids.iter().any(|id| id == endpoint)
        || subgraphs.iter().any(|child| {
            child.parent_id.as_deref() == Some(&subgraph.id)
                && (child.id == endpoint || subgraph_contains_member(subgraphs, child, endpoint))
        })
}

fn forward_records(
    edges: &[Rc<Edge>],
    endpoints: &Endpoints,
    direction: FlowDirection,
) -> Vec<Record> {
    let travel = match direction {
        FlowDirection::RL => Direction::Left,
        FlowDirection::LR => Direction::Right,
        FlowDirection::BT => Direction::Up,
        FlowDirection::TB | FlowDirection::TD => Direction::Down,
    };
    edges
        .iter()
        .filter_map(|edge| {
            let source = endpoints.get(&edge.from)?;
            let target = endpoints.get(&edge.to)?;
            let (s, t) = (source.bounds(), target.bounds());
            let forward = match direction {
                FlowDirection::RL => t.center_x < s.center_x,
                FlowDirection::LR => t.center_x > s.center_x,
                FlowDirection::BT => t.center_y < s.center_y,
                FlowDirection::TB | FlowDirection::TD => t.center_y > s.center_y,
            };
            forward.then(|| Record {
                edge: edge.clone(),
                source_port: port_for_travel(source, travel, Role::Source),
                target_port: port_for_travel(target, travel, Role::Target),
            })
        })
        .collect()
}

fn horizontal_subgraph<'a>(diagram: &'a Diagram, edge: &Edge, exit: bool) -> Option<&'a Subgraph> {
    let subgraphs = &diagram.subgraphs;
    subgraphs.iter().rev().find(|subgraph| {
        if !matches!(
            subgraph.direction,
            Some(FlowDirection::LR | FlowDirection::RL)
        ) {
            return false;
        }
        if subgraph.id == edge.from || subgraph.id == edge.to {
            return false;
        }
        let (inside, outside) = if exit {
            (&edge.from, &edge.to)
        } else {
            (&edge.to, &edge.from)
        };
        subgraph_contains_member(subgraphs, subgraph, inside)
            && !subgraph_contains_member(subgraphs, subgraph, outside)
    })
}

fn entry_travel(subgraph: &Subgraph) -> Direction {
    if subgraph.direction == Some(FlowDirection::RL) {
        Direction::Left
    } else {
        Direction::Right
    }
}

fn entry_lane(subgraph: &Subgraph, frame: &Bounds) -> i32 {
    if subgraph.direction == Some(FlowDirection::RL) {
        frame.left + frame.width + BUS_CLEARANCE
    } else {
        frame.left - BUS_CLEARANCE
    }
}

fn join_y(from: &Bounds, target: &Bounds) -> i32 {
    if from.center_y <= target.center_y {
        let start = from.top + from.height;
        let end = target.top - 1;
        return if start <= end {
            (start + end).div_euclid(2)
        } else {
            start
        };
    }
    let start = target.top + target.height;
    let end = from.top - 1;
    if start <= end {
        (start + end).div_euclid(2)
    } else {
        end
    }
}

fn exit_join_y(from: &Bounds, target: Point, below: bool) -> i32 {
    if below {
        let outside = from.top + from.height;
        let before = target.y - 1;
        let preferred = target.y - BUS_CLEARANCE;
        return if outside <= before {
            outside.max(preferred).min(before)
        } else {
            before
        };
    }
    let outside = from.top - 1;
    let after = target.y + 1;
    let preferred = target.y + BUS_CLEARANCE;
    if after <= outside {
        outside.min(preferred).max(after)
    } else {
        after
    }
}

fn group<T>(
    items: impl IntoIterator<Item = T>,
    key: impl Fn(&T) -> String,
) -> IndexMap<String, Vec<T>> {
    let mut groups: IndexMap<String, Vec<T>> = IndexMap::new();
    for item in items {
        groups.entry(key(&item)).or_default().push(item);
    }
    groups
}

fn fan_route(edge: &Rc<Edge>, source: Point, target: Point, lane: Lane) -> Route {
    Route::new(edge.clone(), path_via_lane(source, lane, target))
}

/// An edge leaving a horizontal subgraph: the edge, the subgraph, and its source.
type ExitRecord<'a, 'b> = (Rc<Edge>, &'a Subgraph, Endpoint<'b>);

struct Router<'a> {
    endpoints: Endpoints<'a>,
    handled: HashSet<usize>,
    routes: Vec<Route>,
}

impl Router<'_> {
    fn horizontal_fan_out(&mut self, records: &[Record], direction: FlowDirection) {
        let mut reserved = HashSet::new();
        let mut owners: IndexMap<String, String> = IndexMap::new();
        let travel = if direction == FlowDirection::RL {
            Direction::Left
        } else {
            Direction::Right
        };
        for (source_id, group) in group(records.iter(), |record| record.edge.from.clone()) {
            if group.len() < 2 {
                continue;
            }
            let source = group[0].source_port;
            let targets: Vec<Point> = group.iter().map(|record| record.target_port).collect();
            let bus = reserve_fan_out_lane(source, &targets, Axis::X, travel, &mut reserved);
            for record in group {
                let owner = owners.get(&record.edge.to).cloned();
                owners.insert(
                    record.edge.to.clone(),
                    owner.clone().unwrap_or_else(|| source_id.clone()),
                );
                let target = self.endpoints.get(&record.edge.to);
                // A target another fan already reaches from the side gets this edge on its top or bottom.
                let Some(target) = target.filter(|_| owner.is_some_and(|owner| owner != source_id))
                else {
                    self.routes.push(fan_route(
                        &record.edge,
                        source,
                        record.target_port,
                        lane(Axis::X, bus),
                    ));
                    self.handled.insert(record.edge.id);
                    continue;
                };
                let side = if source.y < record.target_port.y {
                    Side::Top
                } else {
                    Side::Bottom
                };
                let target_point = side_point(target, side, Role::Target);
                let approach = shift_point(
                    target_point,
                    if side == Side::Top {
                        Direction::Up
                    } else {
                        Direction::Down
                    },
                    1,
                );
                self.routes.push(Route::new(
                    record.edge.clone(),
                    path_through(&[
                        source,
                        point(bus, source.y),
                        point(bus, approach.y),
                        approach,
                        target_point,
                    ]),
                ));
                self.handled.insert(record.edge.id);
            }
        }
    }

    fn fan_in(&mut self, records: &[Record], direction: FlowDirection, axis: Axis) {
        let travel = match direction {
            FlowDirection::RL => Direction::Left,
            FlowDirection::LR => Direction::Right,
            FlowDirection::BT => Direction::Up,
            FlowDirection::TB | FlowDirection::TD => Direction::Down,
        };
        let unhandled = records
            .iter()
            .filter(|record| !self.handled.contains(&record.edge.id));
        for (_, group) in group(unhandled, |record| record.edge.to.clone()) {
            let group: Vec<Record> = if axis == Axis::Y {
                align_clustered_sources(&group)
            } else {
                group
                    .iter()
                    .map(|record| Record {
                        edge: record.edge.clone(),
                        source_port: record.source_port,
                        target_port: record.target_port,
                    })
                    .collect()
            };
            if group.len() < 2 {
                continue;
            }
            let target = group[0].target_port;
            let sources: Vec<Point> = group.iter().map(|record| record.source_port).collect();
            let bus = target_fan_in_lane(&sources, target, axis, travel);
            for record in &group {
                self.routes.push(fan_route(
                    &record.edge,
                    record.source_port,
                    target,
                    lane(axis, bus),
                ));
                self.handled.insert(record.edge.id);
            }
        }
    }

    fn vertical_fan_out(&mut self, records: &[Record], direction: FlowDirection) {
        let travel = if direction == FlowDirection::BT {
            Direction::Up
        } else {
            Direction::Down
        };
        for (_, group) in group(records.iter(), |record| record.edge.from.clone()) {
            if group.len() < 2 {
                continue;
            }
            let source = group[0].source_port;
            let targets: Vec<Point> = group.iter().map(|record| record.target_port).collect();
            let bus = source_fan_out_lane(source, &targets, Axis::Y, travel);
            for record in group {
                self.routes.push(fan_route(
                    &record.edge,
                    source,
                    record.target_port,
                    lane(Axis::Y, bus),
                ));
                self.handled.insert(record.edge.id);
            }
        }
    }

    fn parallel_edges(
        &mut self,
        diagram: &Diagram,
        direction_for: &dyn Fn(&Edge) -> FlowDirection,
        direction_aligned: bool,
    ) {
        for (_, edges) in group(diagram.edges.iter(), |edge| {
            format!("{}:{}", edge.from, edge.to)
        }) {
            if edges.len() < 2 {
                continue;
            }
            let (Some(from), Some(to)) = (
                self.endpoints.get(&edges[0].from),
                self.endpoints.get(&edges[0].to),
            ) else {
                continue;
            };
            if from.id() == to.id() {
                for (offset, edge) in edges.iter().enumerate() {
                    self.routes.push(Route::new(
                        (*edge).clone(),
                        self_edge_path(from, offset as i32),
                    ));
                    self.handled.insert(edge.id);
                }
                continue;
            }
            let axis = if direction_aligned && direction_for(edges[0]).vertical() {
                Axis::X
            } else {
                parallel_lane_axis(from.bounds(), to.bounds())
            };
            let mut previous: Option<Route> = None;
            for edge in edges {
                let height = label_height(edge);
                let coordinate = match (&previous, axis) {
                    (Some(previous), Axis::X) => right_render_extent(previous) + NODE_CLEARANCE,
                    (None, Axis::X) => {
                        bounds_side_point(from.bounds(), Side::Right)
                            .x
                            .max(bounds_side_point(to.bounds(), Side::Right).x)
                            + i32::from(direction_aligned)
                    }
                    (Some(previous), Axis::Y) => {
                        previous
                            .points
                            .iter()
                            .map(|p| p.y)
                            .max()
                            .unwrap_or(i32::MIN)
                            + if height > 1 { height + 1 } else { 1 }
                    }
                    (None, Axis::Y) => {
                        bounds_side_point(from.bounds(), Side::Bottom)
                            .y
                            .max(bounds_side_point(to.bounds(), Side::Bottom).y)
                            + if height > 1 { height } else { 0 }
                    }
                };
                let route = Route {
                    edge: edge.clone(),
                    points: parallel_edge_path(from, to, axis, coordinate),
                    label_axis: Some(if axis == Axis::X { Axis::Y } else { Axis::X }),
                    label_point: None,
                };
                self.routes.push(route.clone());
                self.handled.insert(edge.id);
                previous = Some(route);
            }
        }
    }

    fn horizontal_subgraph_exit_fan_in(&mut self, diagram: &Diagram, frames: Option<&Frames>) {
        let Some(frames) = frames else {
            return;
        };
        let mut groups: IndexMap<String, Vec<ExitRecord>> = IndexMap::new();
        for edge in &diagram.edges {
            if self.handled.contains(&edge.id) {
                continue;
            }
            let Some(subgraph) = horizontal_subgraph(diagram, edge, true) else {
                continue;
            };
            let (Some(source), Some(_)) =
                (self.endpoints.get(&edge.from), self.endpoints.get(&edge.to))
            else {
                continue;
            };
            groups
                .entry(format!("{}:{}", subgraph.id, edge.to))
                .or_default()
                .push((edge.clone(), subgraph, source));
        }
        for group in groups.values() {
            let subgraph = group[0].1;
            let (Some(frame), Some(target)) =
                (frames.get(&subgraph.id), self.endpoints.get(&group[0].0.to))
            else {
                continue;
            };
            let frame = frame.bounds;
            let travel = entry_travel(subgraph);
            let bus = if subgraph.direction == Some(FlowDirection::RL) {
                frame.left - BUS_CLEARANCE
            } else {
                frame.left + frame.width + BUS_CLEARANCE
            };
            let target_subgraph = horizontal_subgraph(diagram, &group[0].0, false);
            let target_frame = target_subgraph
                .and_then(|subgraph| frames.get(&subgraph.id))
                .map(|frame| frame.bounds);
            let below = target.bounds().center_y >= frame.center_y;
            let target_port = match target_subgraph {
                Some(subgraph) => port_for_travel(target, entry_travel(subgraph), Role::Target),
                None => side_point(
                    target,
                    if below { Side::Top } else { Side::Bottom },
                    Role::Target,
                ),
            };
            let join = match &target_frame {
                Some(target_frame) => join_y(&frame, target_frame),
                None => exit_join_y(&frame, target_port, below),
            };
            let entry = match (target_subgraph, &target_frame) {
                (Some(subgraph), Some(target_frame)) => entry_lane(subgraph, target_frame),
                _ => target_port.x,
            };
            for (edge, _, source) in group {
                let source_port = port_for_travel(*source, travel, Role::Source);
                self.routes.push(Route::new(
                    edge.clone(),
                    path_through(&[
                        source_port,
                        point(bus, source_port.y),
                        point(bus, join),
                        point(entry, join),
                        point(entry, target_port.y),
                        target_port,
                    ]),
                ));
                self.handled.insert(edge.id);
            }
        }
    }

    fn horizontal_subgraph_entries(&mut self, diagram: &Diagram, frames: Option<&Frames>) {
        let Some(frames) = frames else {
            return;
        };
        for edge in &diagram.edges {
            if self.handled.contains(&edge.id) {
                continue;
            }
            let Some(subgraph) = horizontal_subgraph(diagram, edge, false) else {
                continue;
            };
            let (Some(frame), Some(from), Some(to)) = (
                frames.get(&subgraph.id),
                self.endpoints.get(&edge.from),
                self.endpoints.get(&edge.to),
            ) else {
                continue;
            };
            let target_port = port_for_travel(to, entry_travel(subgraph), Role::Target);
            let entry = entry_lane(subgraph, &frame.bounds);
            let source_port = port_for_travel(
                from,
                vertical_travel(from.bounds(), to.bounds()),
                Role::Source,
            );
            self.routes.push(Route::new(
                edge.clone(),
                path_through(&[
                    source_port,
                    point(entry, source_port.y),
                    point(entry, target_port.y),
                    target_port,
                ]),
            ));
            self.handled.insert(edge.id);
        }
    }
}

fn align_clustered_sources(records: &[&Record]) -> Vec<Record> {
    let xs: Vec<i32> = records.iter().map(|record| record.source_port.x).collect();
    let min = xs.iter().copied().min().unwrap_or(0);
    let max = xs.iter().copied().max().unwrap_or(0);
    let aligned =
        (max - min <= 1).then(|| js_round(f64::from(xs.iter().sum::<i32>()) / xs.len() as f64));
    records
        .iter()
        .map(|record| Record {
            edge: record.edge.clone(),
            source_port: aligned.map_or(record.source_port, |x| point(x, record.source_port.y)),
            target_port: record.target_port,
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Contact {
    Source,
    Target,
    Both,
}

fn path_intersects_bounds(points: &[Point], bounds: &Bounds, contact: Option<Contact>) -> bool {
    let right = bounds.left + bounds.width - 1;
    let bottom = bounds.top + bounds.height - 1;
    let allows_source = matches!(contact, Some(Contact::Source | Contact::Both));
    let allows_target = matches!(contact, Some(Contact::Target | Contact::Both));
    let (Some(&first), Some(&last)) = (points.first(), points.last()) else {
        return false;
    };
    for index in 1..points.len() {
        let (from, to) = (points[index - 1], points[index]);
        if from.x == to.x {
            if from.x < bounds.left || from.x > right {
                continue;
            }
            let top = from.y.min(to.y).max(bounds.top);
            let bottom_overlap = from.y.max(to.y).min(bottom);
            if top > bottom_overlap {
                continue;
            }
            let source = allows_source
                && index == 1
                && top == bottom_overlap
                && from.x == first.x
                && top == first.y;
            let target = allows_target
                && index == points.len() - 1
                && top == bottom_overlap
                && to.x == last.x
                && top == last.y;
            if !source && !target {
                return true;
            }
            continue;
        }
        if from.y < bounds.top || from.y > bottom {
            continue;
        }
        let left = from.x.min(to.x).max(bounds.left);
        let right_overlap = from.x.max(to.x).min(right);
        if left > right_overlap {
            continue;
        }
        let source = allows_source
            && index == 1
            && left == right_overlap
            && left == first.x
            && from.y == first.y;
        let target = allows_target
            && index == points.len() - 1
            && left == right_overlap
            && left == last.x
            && to.y == last.y;
        if !source && !target {
            return true;
        }
    }
    false
}

fn label_intersects_bounds(label: &LabelLayout, bounds: &Bounds) -> bool {
    label.point.x <= bounds.left + bounds.width - 1
        && label.point.x + label.width - 1 >= bounds.left
        && label.point.y <= bounds.top + bounds.height - 1
        && label.point.y + label.height - 1 >= bounds.top
}

fn label_rect(label: &LabelLayout) -> Bounds {
    Bounds {
        left: label.point.x,
        top: label.point.y,
        width: label.width,
        height: label.height,
        center_x: 0,
        center_y: 0,
    }
}

fn label_intersects_frame(label: &LabelLayout, bounds: &Bounds) -> bool {
    let label_right = label.point.x + label.width - 1;
    let label_bottom = label.point.y + label.height - 1;
    let right = bounds.left + bounds.width - 1;
    let bottom = bounds.top + bounds.height - 1;
    (label.point.x <= right
        && label_right >= bounds.left
        && ((label.point.y <= bounds.top && label_bottom >= bounds.top)
            || (label.point.y <= bottom && label_bottom >= bottom)))
        || (label.point.y <= bottom
            && label_bottom >= bounds.top
            && ((label.point.x <= bounds.left && label_right >= bounds.left)
                || (label.point.x <= right && label_right >= right)))
}

fn route_length(route: &Route) -> i32 {
    route
        .points
        .windows(2)
        .map(|pair| (pair[1].x - pair[0].x).abs() + (pair[1].y - pair[0].y).abs())
        .sum()
}

fn label_intersects_labels(label: &LabelLayout, others: &[LabelLayout]) -> bool {
    others
        .iter()
        .any(|other| label_intersects_bounds(label, &label_rect(other)))
}

/// The inner cells of each label line, without its padding.
fn label_line_rects(label: &LabelLayout) -> impl Iterator<Item = Bounds> + '_ {
    label.lines.iter().enumerate().filter_map(|(index, line)| {
        let inner = width(line) - 2;
        (inner > 0).then(|| Bounds {
            left: label.point.x + 1,
            top: label.point.y + index as i32,
            width: inner,
            height: 1,
            center_x: 0,
            center_y: 0,
        })
    })
}

fn label_intersects_route_paths<'a>(
    label: &LabelLayout,
    routes: impl Iterator<Item = &'a Route> + Clone,
) -> bool {
    label_line_rects(label).any(|rect| {
        routes
            .clone()
            .any(|route| path_intersects_bounds(&route.points, &rect, None))
    })
}

fn route_intersects_labels(route: &Route, labels: &[LabelLayout]) -> bool {
    labels.iter().any(|label| {
        label_line_rects(label).any(|rect| path_intersects_bounds(&route.points, &rect, None))
    })
}

fn paths_intersect(left: &[Point], right: &[Point]) -> bool {
    let occupied: HashSet<Point> = orthogonal_path_points(left).into_iter().collect();
    orthogonal_path_points(right)
        .iter()
        .any(|point| occupied.contains(point))
}

fn endpoint_disjoint(left: &Edge, right: &Edge) -> bool {
    left.from != right.from && left.from != right.to && left.to != right.from && left.to != right.to
}

fn endpoint_conflicts<'a>(route: &Route, others: impl Iterator<Item = &'a Route>) -> bool {
    let (Some(&source), Some(&target)) = (route.points.first(), route.points.last()) else {
        return false;
    };
    others
        .into_iter()
        .any(|other| other.points.first() == Some(&target) || other.points.last() == Some(&source))
}

fn path_runs_along_frame(points: &[Point], bounds: &Bounds) -> bool {
    let right = bounds.left + bounds.width - 1;
    let bottom = bounds.top + bounds.height - 1;
    points.windows(2).any(|pair| {
        let Some(segment) = segment_between(pair[0], pair[1]) else {
            return false;
        };
        let span = segment_span(&segment);
        (segment.axis == Axis::X
            && (segment.from.y == bounds.top || segment.from.y == bottom)
            && span.end.min(right) > span.start.max(bounds.left))
            || (segment.axis == Axis::Y
                && (segment.from.x == bounds.left || segment.from.x == right)
                && span.end.min(bottom) > span.start.max(bounds.top))
    })
}

fn side_for_outside_point(bounds: &Bounds, source: Point) -> Side {
    if source.x < bounds.left {
        return Side::Left;
    }
    if source.x >= bounds.left + bounds.width {
        return Side::Right;
    }
    if source.y < bounds.top {
        return Side::Top;
    }
    Side::Bottom
}

pub struct Connector {
    pub x: i32,
    pub y: i32,
    pub ch: &'static str,
}

pub fn source_connector(from: &Bounds, source: Point) -> Connector {
    let side = side_for_outside_point(from, source);
    let border = bounds_border_point(from, side);
    Connector {
        x: if matches!(side, Side::Top | Side::Bottom) {
            source.x
        } else {
            border.x
        },
        y: if matches!(side, Side::Left | Side::Right) {
            source.y
        } else {
            border.y
        },
        ch: match side {
            Side::Left => "┤",
            Side::Right => "├",
            Side::Top => "┴",
            Side::Bottom => "┬",
        },
    }
}

fn shortest(candidates: &[Route], accept: impl Fn(&Route) -> bool) -> Option<Route> {
    candidates
        .iter()
        .filter(|candidate| accept(candidate))
        .min_by_key(|candidate| route_length(candidate))
        .cloned()
}

fn sorted_unique(values: impl IntoIterator<Item = i32>, descending: bool) -> Vec<i32> {
    let mut values: Vec<i32> = values
        .into_iter()
        .collect::<IndexSet<_>>()
        .into_iter()
        .collect();
    values.sort_unstable();
    if descending {
        values.reverse();
    }
    values
}

struct ObstacleContext<'a> {
    nodes: &'a Nodes,
    frames: Option<&'a Frames>,
    diagram: &'a Diagram,
}

fn avoid_node_obstacles(
    context: &ObstacleContext,
    endpoints: &Endpoints,
    routes: &[Route],
    index: usize,
) -> Route {
    let route = &routes[index];
    let nodes: Vec<&NodeBounds> = context.nodes.values().collect();
    let frames: Vec<&SubgraphBounds> = context
        .frames
        .map(|frames| frames.values().collect())
        .unwrap_or_default();
    let subgraphs = &context.diagram.subgraphs;
    let has = |subgraph: &Subgraph, id: &str| subgraph_contains_member(subgraphs, subgraph, id);
    let owner = subgraphs.iter().rev().find(|subgraph| {
        if !has(subgraph, &route.edge.from) || !has(subgraph, &route.edge.to) {
            return false;
        }
        let children: Vec<&Subgraph> = subgraphs
            .iter()
            .filter(|child| child.parent_id.as_deref() == Some(&subgraph.id))
            .collect();
        let holds = |child: &Subgraph, id: &str| child.id == id || has(child, id);
        children.iter().any(|child| holds(child, &route.edge.from))
            && children.iter().any(|child| holds(child, &route.edge.to))
            && !children
                .iter()
                .any(|child| holds(child, &route.edge.from) && holds(child, &route.edge.to))
    });
    let owner_bounds = owner
        .and_then(|owner| context.frames.and_then(|frames| frames.get(&owner.id)))
        .map(|frame| frame.bounds);
    let leaves_owner = |candidate: &Route| {
        owner_bounds.is_some_and(|owner| {
            candidate.points.iter().any(|p| {
                p.x <= owner.left
                    || p.x >= owner.left + owner.width - 1
                    || p.y <= owner.top
                    || p.y >= owner.top + owner.height - 1
            })
        })
    };
    let others = || {
        routes
            .iter()
            .enumerate()
            .filter(move |(other, _)| *other != index)
            .map(|(_, route)| route)
    };
    let other_labels: Vec<LabelLayout> = others()
        .filter(|other| !other.edge.label.is_empty())
        .map(route_label_layout)
        .collect();
    let intersects_node = |candidate: &Route| {
        nodes.iter().any(|bound| {
            let source = bound.id == route.edge.from;
            let target = bound.id == route.edge.to;
            let contact = match (source, target) {
                (true, true) => Some(Contact::Both),
                (true, false) => Some(Contact::Source),
                (false, true) => Some(Contact::Target),
                (false, false) => None,
            };
            path_intersects_bounds(&candidate.points, &bound.bounds, contact)
        })
    };
    let source_frame = if context.nodes.contains_key(&route.edge.from) {
        None
    } else {
        context
            .frames
            .and_then(|frames| frames.get(&route.edge.from))
    };
    let intersects_source_title = |candidate: &Route| {
        let Some(frame) = source_frame else {
            return false;
        };
        let Some(&first) = candidate.points.first() else {
            return false;
        };
        if frame.label.is_empty() {
            return false;
        }
        let connector = source_connector(&frame.bounds, first);
        contains(&title_bounds(frame), point(connector.x, connector.y))
    };
    let intersects_structural = |candidate: &Route| {
        intersects_node(candidate)
            || intersects_source_title(candidate)
            || frames.iter().any(|frame| {
                path_runs_along_frame(&candidate.points, &frame.bounds)
                    || (!frame.label.is_empty()
                        && path_intersects_bounds(&candidate.points, &title_bounds(frame), None))
            })
    };
    let intersects_routing = |candidate: &Route| {
        intersects_structural(candidate)
            || endpoint_conflicts(candidate, others())
            || others().any(|other| {
                endpoint_disjoint(&candidate.edge, &other.edge)
                    && paths_intersect(&candidate.points, &other.points)
            })
    };
    let intersects = |candidate: &Route| {
        let label = (!candidate.edge.label.is_empty()).then(|| route_label_layout(candidate));
        leaves_owner(candidate)
            || intersects_routing(candidate)
            || label.as_ref().is_some_and(|label| {
                nodes
                    .iter()
                    .any(|bound| label_intersects_bounds(label, &bound.bounds))
                    || frames
                        .iter()
                        .any(|frame| label_intersects_frame(label, &frame.bounds))
                    || label_intersects_labels(label, &other_labels)
                    || label_intersects_route_paths(label, others())
            })
            || route_intersects_labels(candidate, &other_labels)
    };
    if !intersects(route) {
        return route.clone();
    }

    let (Some(from), Some(to)) = (
        endpoints.get(&route.edge.from),
        endpoints.get(&route.edge.to),
    ) else {
        return route.clone();
    };
    let routing_bounds: Vec<Bounds> = nodes
        .iter()
        .map(|node| node.bounds)
        .chain(frames.iter().map(|frame| frame.bounds))
        .collect();
    let right_bus = routing_bounds
        .iter()
        .map(|b| b.left + b.width - 1)
        .max()
        .unwrap_or(i32::MIN)
        + BUS_CLEARANCE;
    let left_bus = routing_bounds
        .iter()
        .map(|b| b.left)
        .min()
        .unwrap_or(i32::MAX)
        - BUS_CLEARANCE;
    let top_bus = routing_bounds
        .iter()
        .map(|b| b.top)
        .min()
        .unwrap_or(i32::MAX)
        - BUS_CLEARANCE;
    let bottom_bus = routing_bounds
        .iter()
        .map(|b| b.top + b.height - 1)
        .max()
        .unwrap_or(i32::MIN)
        + BUS_CLEARANCE;
    let owner_value = |value: fn(&Bounds) -> i32| owner_bounds.as_ref().map(value);
    let right_buses = sorted_unique(
        std::iter::once(right_bus)
            .chain(owner_value(|o| o.left + o.width - 2))
            .chain(
                other_labels
                    .iter()
                    .map(|l| right_bus.max(l.point.x + l.width - 1 + NODE_CLEARANCE)),
            ),
        false,
    );
    let left_buses = sorted_unique(
        std::iter::once(left_bus)
            .chain(owner_value(|o| o.left + 1))
            .chain(
                other_labels
                    .iter()
                    .map(|l| left_bus.min(l.point.x - NODE_CLEARANCE)),
            ),
        true,
    );
    let top_buses = sorted_unique(
        std::iter::once(top_bus)
            .chain(owner_value(|o| o.top + 1))
            .chain(
                other_labels
                    .iter()
                    .map(|l| top_bus.min(l.point.y - NODE_CLEARANCE)),
            ),
        true,
    );
    let bottom_buses = sorted_unique(
        std::iter::once(bottom_bus)
            .chain(owner_value(|o| o.top + o.height - 2))
            .chain(
                other_labels
                    .iter()
                    .map(|l| bottom_bus.max(l.point.y + l.height - 1 + NODE_CLEARANCE)),
            ),
        false,
    );
    let limit = 1.max(f64::from(CANDIDATE_BUDGET / 4).sqrt().floor() as usize);
    let cap = |values: Vec<i32>| values.into_iter().take(limit).collect::<Vec<_>>();
    let (left_buses, right_buses, top_buses, bottom_buses) = (
        cap(left_buses),
        cap(right_buses),
        cap(top_buses),
        cap(bottom_buses),
    );
    let buses: Vec<Lane> = left_buses
        .iter()
        .chain(&right_buses)
        .map(|&c| lane(Axis::X, c))
        .chain(
            top_buses
                .iter()
                .chain(&bottom_buses)
                .map(|&c| lane(Axis::Y, c)),
        )
        .collect();
    let with_points = |points: Vec<Point>, label_axis: Option<Axis>| Route {
        edge: route.edge.clone(),
        points,
        label_axis,
        label_point: route.label_point,
    };
    let via_bus = |start: Point, target_side: Side, bus: Lane| {
        let end = bounds_side_point(to.bounds(), target_side);
        let approach = shift_point(
            end,
            match target_side {
                Side::Left => Direction::Left,
                Side::Right => Direction::Right,
                Side::Top => Direction::Up,
                Side::Bottom => Direction::Down,
            },
            1,
        );
        let points = if bus.axis == Axis::X {
            path_through(&[
                start,
                point(bus.coordinate, start.y),
                point(bus.coordinate, approach.y),
                approach,
                end,
            ])
        } else {
            path_through(&[
                start,
                point(start.x, bus.coordinate),
                point(approach.x, bus.coordinate),
                approach,
                end,
            ])
        };
        with_points(
            points,
            route.label_axis.map(|_| {
                if bus.axis == Axis::X {
                    Axis::Y
                } else {
                    Axis::X
                }
            }),
        )
    };

    if from.id() == to.id() {
        let b = from.bounds();
        let side = |side: Side| bounds_side_point(b, side);
        let mut loops: Vec<Route> = Vec::new();
        for &x in &right_buses {
            for &y in &bottom_buses {
                loops.push(with_points(
                    path_through(&[
                        side(Side::Right),
                        point(x, b.center_y),
                        point(x, y),
                        point(b.center_x, y),
                        side(Side::Bottom),
                    ]),
                    route.label_axis,
                ));
            }
        }
        for &y in &bottom_buses {
            for &x in &left_buses {
                loops.push(with_points(
                    path_through(&[
                        side(Side::Bottom),
                        point(b.center_x, y),
                        point(x, y),
                        point(x, b.center_y),
                        side(Side::Left),
                    ]),
                    route.label_axis,
                ));
            }
        }
        for &x in &left_buses {
            for &y in &top_buses {
                loops.push(with_points(
                    path_through(&[
                        side(Side::Left),
                        point(x, b.center_y),
                        point(x, y),
                        point(b.center_x, y),
                        side(Side::Top),
                    ]),
                    route.label_axis,
                ));
            }
        }
        for &y in &top_buses {
            for &x in &right_buses {
                loops.push(with_points(
                    path_through(&[
                        side(Side::Top),
                        point(b.center_x, y),
                        point(x, y),
                        point(x, b.center_y),
                        side(Side::Right),
                    ]),
                    route.label_axis,
                ));
            }
        }
        return shortest(&loops, |c| !intersects(c))
            .or_else(|| shortest(&loops, |c| !intersects_structural(c)))
            .unwrap_or_else(|| route.clone());
    }

    let sides = [Side::Left, Side::Right, Side::Top, Side::Bottom];
    let start = route.points[0];
    let current_side = side_for_outside_point(to.bounds(), *route.points.last().unwrap_or(&start));
    let preserved_targets: Vec<Route> = buses
        .iter()
        .map(|&bus| via_bus(start, current_side, bus))
        .collect();
    let same_side = |side: Side, bus: Lane, axis: Axis| {
        with_points(
            path_via_lane(
                side_point(from, side, Role::Source),
                bus,
                side_point(to, side, Role::Target),
            ),
            route.label_axis.map(|_| axis),
        )
    };
    let same_sides: Vec<Route> = right_buses
        .iter()
        .map(|&x| same_side(Side::Right, lane(Axis::X, x), Axis::Y))
        .chain(
            left_buses
                .iter()
                .map(|&x| same_side(Side::Left, lane(Axis::X, x), Axis::Y)),
        )
        .chain(
            top_buses
                .iter()
                .map(|&y| same_side(Side::Top, lane(Axis::Y, y), Axis::X)),
        )
        .chain(
            bottom_buses
                .iter()
                .map(|&y| same_side(Side::Bottom, lane(Axis::Y, y), Axis::X)),
        )
        .collect();
    let mut preserved_sources: Vec<Route> = Vec::new();
    for &side in &sides {
        for &bus in &buses {
            preserved_sources.push(via_bus(start, side, bus));
        }
    }
    let mut attachments: Vec<Route> = Vec::new();
    for &source in &sides {
        for &target in &sides {
            for &bus in &buses {
                attachments.push(via_bus(side_point(from, source, Role::Source), target, bus));
            }
        }
    }
    if context.frames.is_some() {
        return shortest(&preserved_targets, |c| !intersects(c))
            .or_else(|| shortest(&same_sides, |c| !intersects(c)))
            .or_else(|| shortest(&preserved_sources, |c| !intersects(c)))
            .or_else(|| shortest(&attachments, |c| !intersects(c)))
            .or_else(|| shortest(&preserved_sources, |c| !intersects_structural(c)))
            .or_else(|| shortest(&attachments, |c| !intersects_structural(c)))
            .unwrap_or_else(|| route.clone());
    }
    same_sides
        .iter()
        .find(|c| !intersects(c))
        .cloned()
        .or_else(|| shortest(&preserved_targets, |c| !intersects(c)))
        .or_else(|| attachments.iter().find(|c| !intersects(c)).cloned())
        .or_else(|| shortest(&preserved_sources, |c| !intersects(c)))
        .or_else(|| shortest(&attachments, |c| !intersects_structural(c)))
        .or_else(|| shortest(&preserved_sources, |c| !intersects_structural(c)))
        .unwrap_or_else(|| route.clone())
}

fn avoid_label_overlap(
    context: &ObstacleContext,
    endpoints: &Endpoints,
    route: &Route,
    others: &[&Route],
    target_width: Option<i32>,
    include_label_width: bool,
) -> Route {
    if route.edge.label.is_empty() {
        return route.clone();
    }
    let other_labels: Vec<LabelLayout> = others
        .iter()
        .filter(|other| !other.edge.label.is_empty())
        .map(|other| route_label_layout(other))
        .collect();
    let connectors: Vec<Bounds> = others
        .iter()
        .filter_map(|other| {
            let source = endpoints.get(&other.edge.from)?;
            let first = *other.points.first()?;
            let connector = source_connector(source.bounds(), first);
            Some([
                Bounds::rect(connector.x, connector.y, 1, 1),
                Bounds::rect(first.x, first.y, 1, 1),
            ])
        })
        .flatten()
        .collect();
    let has_parallel = others
        .iter()
        .any(|other| other.edge.from == route.edge.from && other.edge.to == route.edge.to);
    let frames: Vec<&SubgraphBounds> = context
        .frames
        .map(|frames| frames.values().collect())
        .unwrap_or_default();
    let intersects = |label: &LabelLayout| {
        target_width.is_some_and(|target| {
            if has_parallel || !include_label_width {
                label.point.x > target
            } else {
                label.point.x + label.width > target
            }
        }) || context
            .nodes
            .values()
            .any(|node| label_intersects_bounds(label, &node.bounds))
            || frames
                .iter()
                .any(|frame| label_intersects_frame(label, &frame.bounds))
            || label_intersects_labels(label, &other_labels)
            || label_intersects_route_paths(label, others.iter().copied())
            || connectors
                .iter()
                .any(|bound| label_intersects_bounds(label, bound))
    };
    let current = route_label_layout(route);
    if !intersects(&current) {
        return route.clone();
    }
    let with_label = |point: Point| Route {
        label_point: Some(point),
        ..route.clone()
    };
    let seen: std::cell::RefCell<HashSet<Point>> = Default::default();
    let budget = std::cell::Cell::new(CANDIDATE_BUDGET);
    let available = |candidate: Point| {
        budget.set(budget.get() - 1);
        if !seen.borrow_mut().insert(candidate) {
            return false;
        }
        !intersects(&LabelLayout {
            point: candidate,
            ..current.clone()
        })
    };
    let remaining = || budget.get();
    let mut index = 1;
    while index < route.points.len() && remaining() > 0 {
        let Some(segment) = segment_between(route.points[index - 1], route.points[index]) else {
            index += 1;
            continue;
        };
        let label = edge_label_layout(
            &route.points,
            &route.edge.label,
            route.label_axis,
            Some(index - 1),
        );
        let fixed = if segment.axis == Axis::Y {
            vec![
                label.point,
                point(segment.from.x - label.width, label.point.y),
            ]
        } else {
            vec![
                label.point,
                point(label.point.x, segment.from.y - label.height),
                point(label.point.x, segment.from.y + 1),
            ]
        };
        for candidate in fixed {
            if remaining() <= 0 {
                return route.clone();
            }
            if available(candidate) {
                return with_label(candidate);
            }
        }
        if segment.axis == Axis::Y {
            let bottom = segment.from.y.max(segment.to.y) - label.height + 1;
            let mut y = segment.from.y.min(segment.to.y);
            while y <= bottom && remaining() > 0 {
                for x in [segment.from.x + 1, segment.from.x - label.width] {
                    if available(point(x, y)) {
                        return with_label(point(x, y));
                    }
                    if remaining() <= 0 {
                        return route.clone();
                    }
                }
                y += 1;
            }
            index += 1;
            continue;
        }
        let right = segment.from.x.max(segment.to.x) - label.width + 1;
        let mut x = segment.from.x.min(segment.to.x);
        while x <= right && remaining() > 0 {
            for y in [
                segment.from.y,
                segment.from.y - label.height,
                segment.from.y + 1,
            ] {
                if available(point(x, y)) {
                    return with_label(point(x, y));
                }
                if remaining() <= 0 {
                    return route.clone();
                }
            }
            x += 1;
        }
        index += 1;
    }
    if let Some(target) = target_width
        && include_label_width
        && current.point.x + current.width > target
    {
        let x = 0.max(target - current.width);
        for distance in 0..100 {
            let ys = if distance == 0 {
                vec![current.point.y]
            } else {
                vec![current.point.y - distance, current.point.y + distance]
            };
            for y in ys {
                if y < 0
                    || intersects(&LabelLayout {
                        point: point(x, y),
                        ..current.clone()
                    })
                {
                    continue;
                }
                return with_label(point(x, y));
            }
        }
    }
    route.clone()
}

pub fn route_edges(
    diagram: &Diagram,
    nodes: &Nodes,
    direction_for: &dyn Fn(&Edge) -> FlowDirection,
    frames: Option<&Frames>,
    target_width: Option<i32>,
    direction_aligned: bool,
    locked: Option<&[Route]>,
) -> Vec<Route> {
    let routed = Diagram {
        edges: diagram
            .edges
            .iter()
            .filter(|edge| !edge.order_only)
            .cloned()
            .collect(),
        ..diagram.clone()
    };
    let locked_ids: HashSet<usize> = locked
        .unwrap_or_default()
        .iter()
        .map(|route| route.edge.id)
        .collect();
    let mut router = Router {
        endpoints: Endpoints { nodes, frames },
        handled: locked_ids.clone(),
        routes: locked.unwrap_or_default().to_vec(),
    };
    let left_boundary = frames.map(|frames| {
        nodes
            .values()
            .map(|node| node.bounds.left)
            .chain(frames.values().map(|frame| frame.bounds.left))
            .min()
            .unwrap_or(i32::MAX)
    });

    router.parallel_edges(&routed, direction_for, direction_aligned);
    for direction in [FlowDirection::LR, FlowDirection::RL] {
        let edges: Vec<Rc<Edge>> = routed
            .edges
            .iter()
            .filter(|edge| !router.handled.contains(&edge.id) && direction_for(edge) == direction)
            .cloned()
            .collect();
        if edges.is_empty() {
            continue;
        }
        let records = forward_records(&edges, &router.endpoints, direction);
        router.horizontal_fan_out(&records, direction);
        router.fan_in(&records, direction, Axis::X);
    }
    router.horizontal_subgraph_exit_fan_in(&routed, frames);
    router.horizontal_subgraph_entries(&routed, frames);
    for direction in [FlowDirection::TD, FlowDirection::TB, FlowDirection::BT] {
        let edges: Vec<Rc<Edge>> = routed
            .edges
            .iter()
            .filter(|edge| !router.handled.contains(&edge.id) && direction_for(edge) == direction)
            .cloned()
            .collect();
        if edges.is_empty() {
            continue;
        }
        let records = forward_records(&edges, &router.endpoints, direction);
        router.vertical_fan_out(&records, direction);
        router.fan_in(&records, direction, Axis::Y);
    }
    for edge in &routed.edges {
        if router.handled.contains(&edge.id) {
            continue;
        }
        let (Some(from), Some(to)) = (
            router.endpoints.get(&edge.from),
            router.endpoints.get(&edge.to),
        ) else {
            continue;
        };
        let points = edge_path(from, to, direction_for(edge), left_boundary);
        router.routes.push(Route::new(edge.clone(), points));
    }

    let context = ObstacleContext {
        nodes,
        frames,
        diagram: &routed,
    };
    let mut routes = router.routes;
    for index in (0..routes.len()).rev() {
        if locked_ids.contains(&routes[index].edge.id) {
            continue;
        }
        routes[index] = avoid_node_obstacles(&context, &router.endpoints, &routes, index);
    }

    let subgraphs = &diagram.subgraphs;
    let by_id = |id: &str| subgraphs.iter().find(|subgraph| subgraph.id == id);
    let containers = |id: &str| {
        let mut ids: HashSet<&str> = HashSet::new();
        let mut current = match by_id(id) {
            Some(direct) => direct.parent_id.as_deref().and_then(by_id),
            None => subgraphs
                .iter()
                .find(|subgraph| subgraph.node_ids.iter().any(|member| member == id)),
        };
        while let Some(subgraph) = current {
            ids.insert(&subgraph.id);
            current = subgraph.parent_id.as_deref().and_then(by_id);
        }
        ids
    };
    let grouped_label_edge = |edge: &Edge| {
        let from = containers(&edge.from);
        if !containers(&edge.to).iter().any(|id| from.contains(id)) {
            return false;
        }
        let targets: HashSet<&str> = routed
            .edges
            .iter()
            .filter(|c| !c.label.is_empty() && c.from == edge.from)
            .map(|c| c.to.as_str())
            .collect();
        let sources: HashSet<&str> = routed
            .edges
            .iter()
            .filter(|c| !c.label.is_empty() && c.to == edge.to)
            .map(|c| c.from.as_str())
            .collect();
        targets.len() > 1 || sources.len() > 1
    };
    let mut resolved: Vec<Route> = Vec::with_capacity(routes.len());
    for (index, route) in routes.iter().enumerate() {
        if locked_ids.contains(&route.edge.id) {
            resolved.push(route.clone());
            continue;
        }
        let grouped = grouped_label_edge(&route.edge);
        let others: Vec<&Route> = resolved.iter().chain(&routes[index + 1..]).collect();
        let width = match target_width {
            Some(target) if !subgraphs.is_empty() && grouped => Some(1.max(target - 5)),
            other => other,
        };
        let next = avoid_label_overlap(
            &context,
            &router.endpoints,
            route,
            &others,
            width,
            subgraphs.is_empty() || grouped,
        );
        resolved.push(next);
    }
    resolved
}

pub fn avoid_frame_borders(routes: &mut [Route], nodes: &Nodes, frames: &Frames) {
    let endpoints = Endpoints {
        nodes,
        frames: Some(frames),
    };
    let inside = |endpoint: Endpoint, frame: &SubgraphBounds| {
        let node = endpoint.bounds();
        let outer = &frame.bounds;
        endpoint.id() != frame.id
            && node.left >= outer.left
            && node.top >= outer.top
            && node.left + node.width <= outer.left + outer.width
            && node.top + node.height <= outer.top + outer.height
    };
    for route in routes {
        let source = endpoints.get(&route.edge.from);
        let target = endpoints.get(&route.edge.to);
        for frame in frames.values() {
            let inward = matches!((source, target), (Some(s), Some(t)) if inside(s, frame) && inside(t, frame));
            let b = &frame.bounds;
            let right = b.left + b.width - 1;
            let bottom = b.top + b.height - 1;
            let mut points = vec![route.points[0]];
            for pair in route.points.windows(2) {
                let (from, to) = (pair[0], pair[1]);
                let Some(segment) = segment_between(from, to) else {
                    continue;
                };
                let span = segment_span(&segment);
                let horizontal =
                    if segment.axis == Axis::X && span.end.min(right) > span.start.max(b.left) {
                        if segment.from.y == b.top {
                            Some(Side::Top)
                        } else if segment.from.y == bottom {
                            Some(Side::Bottom)
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                let vertical =
                    if segment.axis == Axis::Y && span.end.min(bottom) > span.start.max(b.top) {
                        if segment.from.x == b.left {
                            Some(Side::Left)
                        } else if segment.from.x == right {
                            Some(Side::Right)
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                let step = |inner: bool| if inner == inward { 1 } else { -1 };
                match (horizontal, vertical) {
                    (Some(side), _) => {
                        let offset = if side == Side::Top {
                            b.top + step(true)
                        } else {
                            bottom - step(true)
                        };
                        points.extend([point(from.x, offset), point(to.x, offset), to]);
                    }
                    (None, Some(side)) => {
                        let offset = if side == Side::Left {
                            b.left + step(true)
                        } else {
                            right - step(true)
                        };
                        points.extend([point(offset, from.y), point(offset, to.y), to]);
                    }
                    (None, None) => points.push(to),
                }
            }
            route.points = path_through(&points);
        }
    }
}
