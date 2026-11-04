//! Flowchart layout (`flowchart/layout.ts`): ranks, node placement, subgraph frames, and the passes that
//! separate top-level items before routing.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use indexmap::{IndexMap, IndexSet};

use super::labels::{
    edge_label_layout, horizontal_label_rank_gap, label_width, route_label_layout, vertical_branch_label_gap,
};
use super::routing::{self, Frames, Nodes};
use super::types::{Diagram, Edge, FlowDirection, LabelSide, Node, NodeBounds, Route, Shape, Subgraph, SubgraphBounds};
use crate::core::geometry::{
    Axis, Bounds, Point, bounds_from_bounds, bounds_from_points, segment_between, segment_span,
};
use crate::core::text::{measure_text_box, split_lines, width};

pub const DEFAULT_MIN_NODE_GAP: i32 = 5;
pub const DEFAULT_MIN_BRANCH_LABEL_GAP: i32 = 12;
const DEFAULT_MAX_UNLABELED_RANK_WIDTH: i32 = 120;
pub const DEFAULT_MIN_RANK_GAP: i32 = 7;
pub const DEFAULT_MIN_VERTICAL_RANK_GAP: i32 = 4;
pub const COMPACT_MIN_RANK_GAP: i32 = 4;
pub const COMPACT_MIN_VERTICAL_RANK_GAP: i32 = 2;
const SUBGRAPH_PADDING_X: i32 = 2;
const SUBGRAPH_PADDING_TOP: i32 = 1;
const SUBGRAPH_PADDING_BOTTOM: i32 = 1;
const MIN_SUBGRAPH_VERTICAL_EDGE_GAP: i32 = 3;
const MIN_SUBGRAPH_HORIZONTAL_EDGE_GAP: i32 = 4;
const CROSSING_SWEEPS: usize = 8;

#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    pub compact: bool,
    /// Target rendered width. Oversized horizontal layouts fold vertically and broad vertical ranks wrap.
    pub layout_max_width: Option<i32>,
}

pub struct Layout {
    pub diagram: Diagram,
    pub bounds: Nodes,
    pub routes: Vec<Route>,
    pub subgraph_bounds: Frames,
    pub width: i32,
    pub height: i32,
}

/// The layout has no room for a subgraph (TS throws a plain `Error`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutError(pub String);

#[derive(Clone, Debug)]
struct NodeSize {
    width: i32,
    height: i32,
    lines: Vec<String>,
}

pub fn layout(source: &Diagram, options: &Options) -> Result<Layout, LayoutError> {
    let direction = source.direction;
    let result = layout_with_direction(source, options, direction, false)?;
    let Some(max_width) = options.layout_max_width else {
        return Ok(result);
    };
    if !direction.horizontal() || result.width <= max_width.max(1) {
        return Ok(result);
    }
    let fallback = if direction == FlowDirection::RL { FlowDirection::BT } else { FlowDirection::TD };
    layout_with_direction(source, options, fallback, true)
}

fn layout_with_direction(
    source: &Diagram,
    options: &Options,
    direction: FlowDirection,
    responsive_fallback: bool,
) -> Result<Layout, LayoutError> {
    let mut diagram = source.clone();
    diagram.direction = direction;
    let diagram = diagram;
    let horizontal = direction.horizontal();
    let min_node_gap = DEFAULT_MIN_NODE_GAP;
    let min_rank_gap = match (options.compact, horizontal) {
        (true, true) => COMPACT_MIN_RANK_GAP,
        (true, false) => COMPACT_MIN_VERTICAL_RANK_GAP,
        (false, true) => DEFAULT_MIN_RANK_GAP,
        (false, false) => DEFAULT_MIN_VERTICAL_RANK_GAP,
    };
    let sizes: HashMap<String, NodeSize> = diagram.nodes.iter().map(|node| (node.id.clone(), node_size(node))).collect();
    let target_width = if horizontal { None } else { options.layout_max_width.map(|width| width.max(1)) };
    let ranked = layout_ranked_nodes(&diagram, direction, &sizes, min_node_gap, min_rank_gap, target_width);
    let mut bounds = ranked.0;
    let responsive = layout_local_subgraph_directions(&diagram, &mut bounds, min_node_gap, min_rank_gap, target_width)?;
    let direction_aligned = responsive_fallback || responsive || ranked.1;
    let node_ids: HashSet<&str> = diagram.nodes.iter().map(|node| node.id.as_str()).collect();
    let has_subgraph_endpoints = diagram
        .edges
        .iter()
        .any(|edge| !edge.order_only && (!node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str())));
    let member_diagram = if has_subgraph_endpoints {
        let mut member = diagram.clone();
        member
            .edges
            .retain(|edge| node_ids.contains(edge.from.as_str()) && node_ids.contains(edge.to.as_str()));
        member
    } else {
        diagram.clone()
    };
    let route = |bounds: &Nodes, frames: Option<&Frames>, target: &Diagram, locked: Option<&[Route]>| {
        routing::route_edges(
            target,
            bounds,
            &|edge: &Edge| edge_direction(&diagram, edge),
            frames,
            target_width,
            direction_aligned,
            locked,
        )
    };

    let mut subgraph_bounds = Frames::new();
    let mut routes;
    if diagram.subgraphs.is_empty() {
        routes = route(&bounds, None, &diagram, None);
    } else {
        let gap = 1.max(min_rank_gap.div_euclid(2));
        routes = route(&bounds, None, &member_diagram, None);
        subgraph_bounds = layout_subgraphs(&diagram, &bounds, &routes);
        if separate_top_level_items(&diagram, &mut bounds, &mut subgraph_bounds, gap, target_width) {
            routes = route(&bounds, None, &member_diagram, None);
            subgraph_bounds = layout_subgraphs(&diagram, &bounds, &routes);
        }
        routes = route(&bounds, Some(&subgraph_bounds), &member_diagram, None);
        subgraph_bounds = layout_subgraphs(&diagram, &bounds, &routes);
        // Frame-aware routes can expand a group after initial separation. Move the expanded frame rigidly
        // before rerouting so external edges cannot grow it back across neighboring top-level items.
        if separate_top_level_items(&diagram, &mut bounds, &mut subgraph_bounds, gap, target_width) {
            routes = route(&bounds, Some(&subgraph_bounds), &member_diagram, None);
        }
        if has_subgraph_endpoints {
            let locked = routes.clone();
            for edge in &diagram.edges {
                if edge.order_only || node_ids.contains(edge.from.as_str()) {
                    continue;
                }
                let Some(source_frame) = subgraph_bounds.get(&edge.from).cloned() else {
                    continue;
                };
                let target = bounds
                    .get(&edge.to)
                    .map(|node| node.bounds)
                    .or_else(|| subgraph_bounds.get(&edge.to).map(|frame| frame.bounds));
                let Some(target) = target else {
                    continue;
                };
                if source_frame.label_side != LabelSide::Top {
                    continue;
                }
                if !edge_direction(&diagram, edge).horizontal() && target.center_y < source_frame.bounds.center_y {
                    let bottom = label_slot(&source_frame, LabelSide::Bottom);
                    if !routes.iter().any(|route| route_overlaps_slot(route, &source_frame, &bottom, &node_ids))
                        && let Some(frame) = subgraph_bounds.get_mut(&edge.from)
                    {
                        frame.label_side = LabelSide::Bottom;
                    }
                }
            }
            routes = route(&bounds, Some(&subgraph_bounds), &diagram, Some(&locked));
            let mut changed = false;
            let sides: Vec<LabelSide> = subgraph_bounds
                .values()
                .map(|frame| choose_subgraph_label_side(frame, &routes, &node_ids))
                .collect();
            for (frame, side) in subgraph_bounds.values_mut().zip(sides) {
                if side != frame.label_side {
                    frame.label_side = side;
                    changed = true;
                }
            }
            if changed {
                routes = route(&bounds, Some(&subgraph_bounds), &diagram, Some(&locked));
            }
        }
        routing::avoid_frame_borders(&mut routes, &bounds, &subgraph_bounds);
    }
    for route in &mut routes {
        if route.edge.label.is_empty() || route.label_point.is_some() {
            continue;
        }
        route.label_point = Some(edge_label_layout(&route.points, &route.edge.label, route.label_axis, None).point);
    }
    let mut extra = route_render_bounds(&routes);
    let all = || {
        bounds
            .values()
            .map(|node| node.bounds)
            .chain(subgraph_bounds.values().map(|frame| frame.bounds))
            .chain(extra.iter().copied())
            .collect::<Vec<_>>()
    };
    let current = all();
    let dx = 0.max(-(current.iter().map(|b| b.left).min().unwrap_or(0).min(0)));
    let dy = 0.max(-(current.iter().map(|b| b.top).min().unwrap_or(0).min(0)));
    if dx > 0 || dy > 0 {
        for node in bounds.values_mut() {
            node.bounds.translate(dx, dy);
        }
        for frame in subgraph_bounds.values_mut() {
            frame.bounds.translate(dx, dy);
        }
        for bound in &mut extra {
            bound.translate(dx, dy);
        }
        for route in &mut routes {
            for point in &mut route.points {
                point.x += dx;
                point.y += dy;
            }
            if let Some(point) = &mut route.label_point {
                point.x += dx;
                point.y += dy;
            }
        }
    }
    let all = bounds
        .values()
        .map(|node| node.bounds)
        .chain(subgraph_bounds.values().map(|frame| frame.bounds))
        .chain(extra.iter().copied())
        .collect::<Vec<_>>();
    let max_x = all.iter().map(|b| b.left + b.width).max().unwrap_or(0).max(0);
    let max_y = all.iter().map(|b| b.top + b.height).max().unwrap_or(0).max(0);
    Ok(Layout {
        diagram,
        bounds,
        routes,
        subgraph_bounds,
        width: max_x + 4,
        height: max_y + 4,
    })
}

fn node_size(node: &Node) -> NodeSize {
    let text = measure_text_box(&node.label, 2, 0, 1);
    let inner = text.width - 4;
    let lines = text.lines;
    let count = lines.len() as i32;
    match node.shape {
        Shape::Decision => {
            let width = inner + 6;
            NodeSize { width: if width % 2 == 0 { width + 1 } else { width }, height: 5.max(count + 4), lines }
        }
        Shape::Database => NodeSize { width: inner + 4, height: count + 4, lines },
        Shape::Subroutine => NodeSize { width: inner + 6, height: count + 2, lines },
        Shape::Box | Shape::Rounded => NodeSize { width: inner + 4, height: count + 2, lines },
    }
}

// Subgraph membership.

pub(crate) fn collect_subgraph_node_ids(diagram: &Diagram, id: &str) -> IndexSet<String> {
    let mut ids = IndexSet::new();
    for subgraph in &diagram.subgraphs {
        let child = subgraph.parent_id.as_deref() == Some(id);
        if subgraph.id != id && !child {
            continue;
        }
        ids.extend(subgraph.node_ids.iter().cloned());
        if child {
            ids.extend(collect_subgraph_node_ids(diagram, &subgraph.id));
        }
    }
    ids
}

pub(crate) fn collect_descendant_subgraph_ids(diagram: &Diagram, id: &str) -> IndexSet<String> {
    let mut ids = IndexSet::new();
    for child in &diagram.subgraphs {
        if child.parent_id.as_deref() != Some(id) {
            continue;
        }
        ids.insert(child.id.clone());
        ids.extend(collect_descendant_subgraph_ids(diagram, &child.id));
    }
    ids
}

fn subgraph_contains_endpoint(diagram: &Diagram, subgraph: &Subgraph, endpoint: &str) -> bool {
    collect_subgraph_node_ids(diagram, &subgraph.id).contains(endpoint)
        || collect_descendant_subgraph_ids(diagram, &subgraph.id).contains(endpoint)
}

fn edge_direction(diagram: &Diagram, edge: &Edge) -> FlowDirection {
    for subgraph in diagram.subgraphs.iter().rev() {
        let Some(direction) = subgraph.direction else {
            continue;
        };
        if subgraph_contains_endpoint(diagram, subgraph, &edge.from)
            && subgraph_contains_endpoint(diagram, subgraph, &edge.to)
        {
            return direction;
        }
    }
    diagram.direction
}

// Ranks.

struct RankSpan {
    start: i32,
    end: i32,
    unshared: Vec<usize>,
}

fn endpoint_ranks(diagram: &Diagram, id: &str, ranks: &IndexMap<String, i32>, node_ids: &HashSet<&str>) -> Vec<i32> {
    let ids: Vec<String> =
        if node_ids.contains(id) { vec![id.to_string()] } else { collect_subgraph_node_ids(diagram, id).into_iter().collect() };
    ids.iter().filter_map(|id| ranks.get(id).copied()).collect()
}

fn endpoint_rank_span(
    diagram: &Diagram,
    edge: &Edge,
    ranks: &IndexMap<String, i32>,
    node_ids: &HashSet<&str>,
) -> Option<RankSpan> {
    let from = endpoint_ranks(diagram, &edge.from, ranks, node_ids);
    let to = endpoint_ranks(diagram, &edge.to, ranks, node_ids);
    if from.is_empty() || to.is_empty() {
        return None;
    }
    let forward = (*from.iter().max()?, *to.iter().min()?);
    let reverse = (*to.iter().max()?, *from.iter().min()?);
    let (start, end) = if forward.0 < forward.1 {
        forward
    } else if reverse.0 < reverse.1 {
        reverse
    } else {
        return None;
    };
    let has_subgraph_endpoint = !node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str());
    let unshared = if has_subgraph_endpoint {
        diagram
            .subgraphs
            .iter()
            .enumerate()
            .filter(|(_, subgraph)| {
                let from = subgraph.id == edge.from || subgraph_contains_endpoint(diagram, subgraph, &edge.from);
                let to = subgraph.id == edge.to || subgraph_contains_endpoint(diagram, subgraph, &edge.to);
                from != to
            })
            .map(|(index, _)| index)
            .collect()
    } else {
        Vec::new()
    };
    Some(RankSpan { start, end, unshared })
}

fn ensure_rank_span_gap(gaps: &mut [i32], start: usize, end: usize, required: i32) {
    let low = start.min(end);
    let high = start.max(end);
    if low == high {
        return;
    }
    if high - low == 1 {
        gaps[low] = gaps[low].max(required);
        return;
    }
    let current: i32 = gaps[low..high].iter().sum();
    if current < required {
        gaps[high - 1] += required - current;
    }
}

fn rank_gaps(
    diagram: &Diagram,
    ranks: &IndexMap<String, i32>,
    rank_keys: &[i32],
    fallback: i32,
    horizontal: bool,
) -> Vec<i32> {
    let mut gaps = vec![fallback; rank_keys.len().saturating_sub(1)];
    let indexes: HashMap<i32, usize> = rank_keys.iter().enumerate().map(|(index, &rank)| (rank, index)).collect();
    let node_ids: HashSet<&str> = diagram.nodes.iter().map(|node| node.id.as_str()).collect();
    for edge in &diagram.edges {
        if edge.order_only {
            continue;
        }
        let has_subgraph_endpoint = !node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str());
        if edge.label.is_empty() && !has_subgraph_endpoint {
            continue;
        }
        if !has_subgraph_endpoint {
            let index = |id: &str| indexes.get(&ranks.get(id).copied().unwrap_or(-1)).copied();
            let (Some(from), Some(to)) = (index(&edge.from), index(&edge.to)) else {
                continue;
            };
            if from == to {
                continue;
            }
            let gap = if horizontal {
                horizontal_label_rank_gap(label_width(&edge.label))
            } else {
                split_lines(&edge.label).len() as i32 + 2
            };
            for slot in &mut gaps[from.min(to)..from.max(to)] {
                *slot = (*slot).max(gap);
            }
            continue;
        }
        let Some(span) = endpoint_rank_span(diagram, edge, ranks, &node_ids) else {
            continue;
        };
        let (Some(&start), Some(&end)) = (indexes.get(&span.start), indexes.get(&span.end)) else {
            continue;
        };
        let (padding, clearance) = if horizontal {
            let padding = span.unshared.len() as i32 * SUBGRAPH_PADDING_X;
            let clearance = if edge.label.is_empty() {
                MIN_SUBGRAPH_HORIZONTAL_EDGE_GAP
            } else {
                MIN_SUBGRAPH_HORIZONTAL_EDGE_GAP.max(horizontal_label_rank_gap(label_width(&edge.label)))
            };
            (padding, clearance)
        } else {
            let padding = span
                .unshared
                .iter()
                .map(|&index| SUBGRAPH_PADDING_TOP.max(split_lines(&diagram.subgraphs[index].label).len() as i32))
                .sum();
            let clearance = if edge.label.is_empty() {
                MIN_SUBGRAPH_VERTICAL_EDGE_GAP
            } else {
                MIN_SUBGRAPH_VERTICAL_EDGE_GAP.max(split_lines(&edge.label).len() as i32 + 2)
            };
            (padding, clearance)
        };
        ensure_rank_span_gap(&mut gaps, start, end, padding + clearance);
    }
    gaps
}

fn rank_nodes(diagram: &Diagram) -> IndexMap<String, i32> {
    let mut ranks: IndexMap<String, i32> = IndexMap::new();
    let mut outgoing: IndexMap<String, Vec<String>> = IndexMap::new();
    let mut incoming: HashSet<String> = HashSet::new();
    let mut incoming_counts: IndexMap<String, i32> =
        diagram.nodes.iter().map(|node| (node.id.clone(), 0)).collect();
    let node_ids: HashSet<&str> = diagram.nodes.iter().map(|node| node.id.as_str()).collect();
    let subgraph = |id: &str| diagram.subgraphs.iter().find(|subgraph| subgraph.id == id);
    let inside = |endpoint: &str, subgraph_id: &str| {
        subgraph(subgraph_id).is_some_and(|subgraph| subgraph_contains_endpoint(diagram, subgraph, endpoint))
    };
    let members_of = |id: &str| -> Vec<String> {
        if node_ids.contains(id) { vec![id.to_string()] } else { collect_subgraph_node_ids(diagram, id).into_iter().collect() }
    };
    // Members of the subgraph with no edge inside it in `outward` direction: its exits or entries.
    let boundary_nodes = |subgraph_id: &str, exits: bool| -> Vec<String> {
        let members = collect_subgraph_node_ids(diagram, subgraph_id);
        let mut internal: HashSet<String> = HashSet::new();
        for edge in &diagram.edges {
            if edge.from == edge.to || !inside(&edge.from, subgraph_id) || !inside(&edge.to, subgraph_id) {
                continue;
            }
            internal.extend(members_of(if exits { &edge.from } else { &edge.to }));
        }
        let boundary: Vec<String> = members.iter().filter(|id| !internal.contains(*id)).cloned().collect();
        if boundary.is_empty() { members.into_iter().collect() } else { boundary }
    };
    let mut rank_edges: Vec<(String, String)> = Vec::new();
    for edge in &diagram.edges {
        if node_ids.contains(edge.from.as_str()) && node_ids.contains(edge.to.as_str()) {
            rank_edges.push((edge.from.clone(), edge.to.clone()));
            continue;
        }
        let from_ids =
            if node_ids.contains(edge.from.as_str()) { vec![edge.from.clone()] } else { boundary_nodes(&edge.from, true) };
        let to_ids =
            if node_ids.contains(edge.to.as_str()) { vec![edge.to.clone()] } else { boundary_nodes(&edge.to, false) };
        for from in &from_ids {
            for to in &to_ids {
                rank_edges.push((from.clone(), to.clone()));
            }
        }
    }
    for (from, to) in &rank_edges {
        outgoing.entry(from.clone()).or_default().push(to.clone());
        incoming.insert(to.clone());
        *incoming_counts.entry(to.clone()).or_insert(0) += 1;
    }

    let mut starts: Vec<&str> =
        diagram.nodes.iter().filter(|node| !incoming.contains(&node.id)).map(|node| node.id.as_str()).collect();
    if starts.is_empty()
        && let Some(first) = diagram.nodes.first()
    {
        starts.push(&first.id);
    }
    let mut queue: Vec<String> = starts.iter().map(|id| id.to_string()).collect();
    for id in &starts {
        ranks.insert(id.to_string(), 0);
    }
    let mut index = 0;
    while index < queue.len() {
        let id = queue[index].clone();
        index += 1;
        let rank = ranks.get(&id).copied().unwrap_or(0);
        for to in outgoing.get(&id).cloned().unwrap_or_default() {
            let next = rank + 1;
            if ranks.get(&to).is_some_and(|&existing| existing <= next) {
                continue;
            }
            ranks.insert(to.clone(), next);
            queue.push(to);
        }
    }
    for node in &diagram.nodes {
        if !ranks.contains_key(&node.id) {
            let size = ranks.len() as i32;
            ranks.insert(node.id.clone(), size);
        }
    }

    let mut acyclic: IndexMap<String, i32> = IndexMap::new();
    let mut queue: Vec<String> = diagram
        .nodes
        .iter()
        .filter(|node| incoming_counts.get(&node.id) == Some(&0))
        .map(|node| node.id.clone())
        .collect();
    for id in &queue {
        acyclic.insert(id.clone(), 0);
    }
    let mut index = 0;
    while index < queue.len() {
        let id = queue[index].clone();
        index += 1;
        let rank = acyclic.get(&id).copied().unwrap_or(0);
        for to in outgoing.get(&id).cloned().unwrap_or_default() {
            let current = acyclic.get(&to).copied().unwrap_or(0);
            acyclic.insert(to.clone(), current.max(rank + 1));
            let remaining = incoming_counts.get(&to).copied().unwrap_or(0) - 1;
            incoming_counts.insert(to.clone(), remaining);
            if remaining == 0 {
                queue.push(to);
            }
        }
    }
    for (id, rank) in acyclic {
        ranks.insert(id, rank);
    }
    ranks
}

fn layout_ranked_nodes(
    diagram: &Diagram,
    direction: FlowDirection,
    sizes: &HashMap<String, NodeSize>,
    min_node_gap: i32,
    min_rank_gap: i32,
    target_width: Option<i32>,
) -> (Nodes, bool) {
    let horizontal = direction.horizontal();
    let ranks = rank_nodes(diagram);
    let max_rank = ranks.values().copied().max().unwrap_or(0).max(0);
    let mut by_rank: IndexMap<i32, Vec<&Node>> = IndexMap::new();
    let mut normalized: IndexMap<String, i32> = IndexMap::new();
    for node in &diagram.nodes {
        let rank = ranks.get(&node.id).copied().unwrap_or(0);
        let rank = if direction.reversed() { max_rank - rank } else { rank };
        normalized.insert(node.id.clone(), rank);
        by_rank.entry(rank).or_default().push(node);
    }
    reduce_rank_crossings(diagram, &ranks, &normalized, &mut by_rank);

    let size = |node: &Node| &sizes[&node.id];
    let spacious_gap = min_node_gap.max(DEFAULT_MIN_BRANCH_LABEL_GAP);
    let widest_unlabeled = by_rank
        .values()
        .map(|nodes| nodes.iter().map(|node| size(node).width).sum::<i32>() + 0.max(nodes.len() as i32 - 1) * spacious_gap)
        .max()
        .unwrap_or(0)
        .max(0);
    let touches = |edge: &Edge, rank: i32| {
        !edge.label.is_empty() && (normalized.get(&edge.from) == Some(&rank) || normalized.get(&edge.to) == Some(&rank))
    };
    let vertical_node_gap = |rank: i32| {
        let widest = diagram
            .edges
            .iter()
            .filter(|edge| touches(edge, rank))
            .map(|edge| label_width(&edge.label))
            .max()
            .unwrap_or(0)
            .max(0);
        if widest > 0 {
            return spacious_gap.max(vertical_branch_label_gap(widest));
        }
        if widest_unlabeled > DEFAULT_MAX_UNLABELED_RANK_WIDTH { min_node_gap } else { spacious_gap }
    };

    let mut rank_keys: Vec<i32> = by_rank.keys().copied().collect();
    rank_keys.sort_unstable();
    let gaps = rank_gaps(diagram, &normalized, &rank_keys, min_rank_gap, horizontal);
    let mut bounds = Nodes::new();
    let mut wrapped = false;
    let mut place = |node: &Node, left: i32, top: i32| {
        let size = size(node);
        bounds.insert(
            node.id.clone(),
            NodeBounds {
                id: node.id.clone(),
                bounds: Bounds::rect(left, top, size.width, size.height),
                lines: size.lines.clone(),
            },
        );
    };

    if horizontal {
        let column_widths: Vec<i32> =
            rank_keys.iter().map(|rank| by_rank[rank].iter().map(|node| size(node).width).max().unwrap_or(0)).collect();
        let column_heights: Vec<i32> = rank_keys
            .iter()
            .map(|rank| {
                let nodes = &by_rank[rank];
                nodes.iter().map(|node| size(node).height).sum::<i32>() + 0.max(nodes.len() as i32 - 1) * min_node_gap
            })
            .collect();
        let canvas_height = column_heights.iter().copied().max().unwrap_or(1).max(1);
        let baseline = canvas_height.div_euclid(2);
        let mut x = 0;
        for (index, rank) in rank_keys.iter().enumerate() {
            let width = column_widths[index];
            let mut y = baseline - column_heights[index].div_euclid(2);
            for node in &by_rank[rank] {
                let node_size = size(node);
                place(node, x + (width - node_size.width).div_euclid(2), y);
                y += node_size.height + min_node_gap;
            }
            x += width + gaps.get(index).copied().unwrap_or(0);
        }
        return (bounds, wrapped);
    }

    struct Band<'a> {
        nodes: Vec<&'a Node>,
        width: i32,
        height: i32,
    }
    let rank_bands: Vec<(Vec<Band>, i32)> = rank_keys
        .iter()
        .map(|&rank| {
            let nodes = &by_rank[&rank];
            let roomy = vertical_node_gap(rank);
            let natural =
                nodes.iter().map(|node| size(node).width).sum::<i32>() + 0.max(nodes.len() as i32 - 1) * roomy;
            let labeled: Vec<&Rc<Edge>> = diagram.edges.iter().filter(|edge| touches(edge, rank)).collect();
            let grouped = |ids: &[&str]| {
                diagram.subgraphs.is_empty()
                    || diagram
                        .subgraphs
                        .iter()
                        .any(|subgraph| ids.iter().all(|id| subgraph.node_ids.iter().any(|member| member == id)))
            };
            let needs_label_lanes = labeled.len() > 1
                && labeled.iter().any(|edge| {
                    let targets: IndexSet<&str> =
                        labeled.iter().filter(|c| c.from == edge.from).map(|c| c.to.as_str()).collect();
                    let sources: IndexSet<&str> =
                        labeled.iter().filter(|c| c.to == edge.to).map(|c| c.from.as_str()).collect();
                    let grouped_with = |first: &str, rest: &IndexSet<&str>| {
                        grouped(&std::iter::once(first).chain(rest.iter().copied()).collect::<Vec<_>>())
                    };
                    (targets.len() > 1 && grouped_with(&edge.from, &targets))
                        || (sources.len() > 1 && grouped_with(&edge.to, &sources))
                });
            let node_gap = match target_width {
                Some(target) if natural > target && (!needs_label_lanes || diagram.subgraphs.is_empty()) => min_node_gap,
                _ => roomy,
            };
            let mut bands: Vec<Band> = Vec::new();
            for node in nodes {
                let node_size = size(node);
                let Some(current) = bands.last_mut() else {
                    bands.push(Band { nodes: vec![node], width: node_size.width, height: node_size.height });
                    continue;
                };
                let width = current.width + node_gap + node_size.width;
                if target_width.is_some_and(|target| width > target) {
                    wrapped = true;
                    bands.push(Band { nodes: vec![node], width: node_size.width, height: node_size.height });
                    continue;
                }
                current.nodes.push(node);
                current.width = width;
                current.height = current.height.max(node_size.height);
            }
            (bands, node_gap)
        })
        .collect();
    let canvas_width =
        rank_bands.iter().flat_map(|(bands, _)| bands.iter().map(|band| band.width)).max().unwrap_or(1).max(1);
    let mut y = 0;
    for (index, (bands, node_gap)) in rank_bands.iter().enumerate() {
        for (band_index, band) in bands.iter().enumerate() {
            let mut x = (canvas_width - band.width).div_euclid(2);
            for node in &band.nodes {
                let node_size = size(node);
                place(node, x, y + (band.height - node_size.height).div_euclid(2));
                x += node_size.width + node_gap;
            }
            y += band.height + if band_index < bands.len() - 1 { min_node_gap } else { 0 };
        }
        y += gaps.get(index).copied().unwrap_or(0);
    }
    (bounds, wrapped)
}

struct Link {
    layer: usize,
    upper: String,
    lower: String,
}

/// Barycenter ordering within ranks. Source order is kept unless a sweep strictly reduces crossings, so
/// crossing-free diagrams render exactly as authored.
fn reduce_rank_crossings(
    diagram: &Diagram,
    ranks: &IndexMap<String, i32>,
    normalized: &IndexMap<String, i32>,
    by_rank: &mut IndexMap<i32, Vec<&Node>>,
) {
    // Reordering could interleave members of different subgraphs and break their frames.
    if !diagram.subgraphs.is_empty() {
        return;
    }
    let mut rank_keys: Vec<i32> = by_rank.keys().copied().collect();
    rank_keys.sort_unstable();
    let layer_of: HashMap<i32, usize> = rank_keys.iter().enumerate().map(|(index, &rank)| (rank, index)).collect();
    // Feedback edges route around the diagram, so only forward edges between adjacent ranks can cross.
    let links: Vec<Link> = diagram
        .edges
        .iter()
        .filter_map(|edge| {
            let from_rank = ranks.get(&edge.from)?;
            let to_rank = ranks.get(&edge.to)?;
            if edge.order_only || *to_rank != from_rank + 1 {
                return None;
            }
            let from = normalized[&edge.from];
            let to = normalized[&edge.to];
            if (from - to).abs() != 1 {
                return None;
            }
            Some(if from < to {
                Link { layer: layer_of[&from], upper: edge.from.clone(), lower: edge.to.clone() }
            } else {
                Link { layer: layer_of[&to], upper: edge.to.clone(), lower: edge.from.clone() }
            })
        })
        .collect();
    let original: Vec<Vec<String>> =
        rank_keys.iter().map(|rank| by_rank[rank].iter().map(|node| node.id.clone()).collect()).collect();
    let initial = layer_crossings(&original, &links);
    if initial == 0 {
        return;
    }
    let mut current = original.clone();
    let mut best: Option<Vec<Vec<String>>> = None;
    let mut crossings = initial;
    for sweep in 0..CROSSING_SWEEPS {
        current = sweep_layers(&current, &links, sweep % 2 == 0);
        let count = layer_crossings(&current, &links);
        if count < crossings {
            best = Some(current.clone());
            crossings = count;
        }
    }
    let Some(best) = best else {
        return;
    };
    let node_of: HashMap<&str, &Node> = by_rank.values().flatten().map(|node| (node.id.as_str(), *node)).collect();
    let reordered: Vec<(i32, Vec<&Node>)> = rank_keys
        .iter()
        .zip(&best)
        .map(|(&rank, ids)| (rank, ids.iter().map(|id| node_of[id.as_str()]).collect()))
        .collect();
    for (rank, nodes) in reordered {
        by_rank.insert(rank, nodes);
    }
}

fn sweep_layers(layers: &[Vec<String>], links: &[Link], down: bool) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = layers.to_vec();
    let indices: Vec<usize> = if down { (1..next.len()).collect() } else { (0..next.len().saturating_sub(1)).rev().collect() };
    for index in indices {
        let fixed = next[if down { index - 1 } else { index + 1 }].clone();
        let position = |id: &str| fixed.iter().position(|candidate| candidate == id).map_or(-1.0, |p| p as f64);
        let keys: HashMap<String, f64> = next[index]
            .iter()
            .enumerate()
            .map(|(order, id)| {
                let neighbors: Vec<f64> = links
                    .iter()
                    .filter_map(|link| {
                        if down && link.layer + 1 == index && link.lower == *id {
                            return Some(position(&link.upper));
                        }
                        if !down && link.layer == index && link.upper == *id {
                            return Some(position(&link.lower));
                        }
                        None
                    })
                    .collect();
                let key = if neighbors.is_empty() {
                    order as f64
                } else {
                    neighbors.iter().sum::<f64>() / neighbors.len() as f64
                };
                (id.clone(), key)
            })
            .collect();
        next[index].sort_by(|a, b| keys[a].partial_cmp(&keys[b]).unwrap_or(std::cmp::Ordering::Equal));
    }
    next
}

fn layer_crossings(layers: &[Vec<String>], links: &[Link]) -> usize {
    let position: HashMap<&str, i64> = layers
        .iter()
        .flat_map(|layer| layer.iter().enumerate().map(|(index, id)| (id.as_str(), index as i64)))
        .collect();
    let at = |id: &str| position.get(id).copied().unwrap_or(0);
    links
        .iter()
        .enumerate()
        .map(|(index, link)| {
            links[index + 1..]
                .iter()
                .filter(|other| {
                    other.layer == link.layer
                        && (at(&link.upper) - at(&other.upper)) * (at(&link.lower) - at(&other.lower)) < 0
                })
                .count()
        })
        .sum()
}

// Subgraphs with their own direction.

struct LocalItem {
    id: String,
    node_ids: Vec<String>,
    bounds: Bounds,
    child_id: Option<String>,
}

fn layout_local_subgraph_directions(
    diagram: &Diagram,
    nodes: &mut Nodes,
    min_node_gap: i32,
    min_rank_gap: i32,
    target_width: Option<i32>,
) -> Result<bool, LayoutError> {
    let mut wrapped = false;
    let subgraphs = &diagram.subgraphs;
    let by_id = |id: &str| subgraphs.iter().find(|subgraph| subgraph.id == id);
    for subgraph in subgraphs.iter().rev() {
        let mut parent = subgraph.parent_id.as_deref().and_then(by_id);
        while let Some(current) = parent
            && current.direction.is_none()
        {
            parent = current.parent_id.as_deref().and_then(by_id);
        }
        let inherited = parent.and_then(|parent| {
            let siblings = subgraphs.iter().filter(|child| child.parent_id.as_deref() == Some(&parent.id)).count();
            if siblings > 1 { parent.direction } else { None }
        });
        let Some(direction) = subgraph.direction.or(inherited) else {
            continue;
        };
        if direction == diagram.direction {
            continue;
        }
        let children: Vec<&Subgraph> =
            subgraphs.iter().filter(|child| child.parent_id.as_deref() == Some(&subgraph.id)).collect();
        let covered: HashSet<String> =
            children.iter().flat_map(|child| collect_subgraph_node_ids(diagram, &child.id)).collect();
        let mut items: Vec<LocalItem> = Vec::new();
        for child in &children {
            let node_ids: Vec<String> = collect_subgraph_node_ids(diagram, &child.id).into_iter().collect();
            let content: Vec<Bounds> = node_ids.iter().filter_map(|id| nodes.get(id).map(|node| node.bounds)).collect();
            if let Some(content) = bounds_from_bounds(&content) {
                items.push(LocalItem {
                    id: format!("subgraph:{}", child.id),
                    node_ids,
                    bounds: frame_from_children(&child.id, &child.label, &[content]).bounds,
                    child_id: Some(child.id.clone()),
                });
            }
        }
        for id in &subgraph.node_ids {
            if covered.contains(id) {
                continue;
            }
            if let Some(node) = nodes.get(id) {
                items.push(LocalItem { id: id.clone(), node_ids: vec![id.clone()], bounds: node.bounds, child_id: None });
            }
        }
        if items.is_empty() {
            continue;
        }
        let Some(current) = bounds_from_bounds(&items.iter().map(|item| item.bounds).collect::<Vec<_>>()) else {
            continue;
        };
        let mut item_of: HashMap<String, String> = HashMap::new();
        for item in &items {
            for id in &item.node_ids {
                item_of.insert(id.clone(), item.id.clone());
            }
            if let Some(child) = &item.child_id {
                item_of.insert(child.clone(), item.id.clone());
                for nested in collect_descendant_subgraph_ids(diagram, child) {
                    item_of.insert(nested, item.id.clone());
                }
            }
        }
        let local = Diagram {
            direction,
            nodes: items
                .iter()
                .map(|item| Node { id: item.id.clone(), label: item.id.clone(), shape: Shape::Box })
                .collect(),
            edges: diagram
                .edges
                .iter()
                .filter_map(|edge| {
                    let from = item_of.get(&edge.from)?;
                    let to = item_of.get(&edge.to)?;
                    (from != to).then(|| Rc::new(Edge { from: from.clone(), to: to.clone(), ..(**edge).clone() }))
                })
                .collect(),
            subgraphs: Vec::new(),
        };
        let sizes: HashMap<String, NodeSize> = items
            .iter()
            .map(|item| {
                (
                    item.id.clone(),
                    NodeSize { width: item.bounds.width, height: item.bounds.height, lines: vec![item.id.clone()] },
                )
            })
            .collect();
        let (local_bounds, local_wrapped) = layout_ranked_nodes(
            &local,
            direction,
            &sizes,
            min_node_gap.max(SUBGRAPH_PADDING_X * 2 + 1),
            min_rank_gap,
            target_width,
        );
        wrapped |= local_wrapped;
        let Some(extent) = bounds_from_bounds(&local_bounds.values().map(|node| node.bounds).collect::<Vec<_>>())
        else {
            continue;
        };
        let target_left = current.left + (current.width - extent.width).div_euclid(2);
        let target_top = current.top + (current.height - extent.height).div_euclid(2);
        let dx = target_left - extent.left;
        let dy = target_top - extent.top;

        let mut translations: IndexMap<String, (i32, i32)> = IndexMap::new();
        for item in &items {
            let bound = local_bounds[&item.id].bounds;
            let shift = (bound.left + dx - item.bounds.left, bound.top + dy - item.bounds.top);
            for id in &item.node_ids {
                translations.insert(id.clone(), shift);
            }
        }

        let mut offset = (0, 0);
        if target_width.is_some() {
            let external: Vec<Bounds> =
                nodes.iter().filter(|(id, _)| !translations.contains_key(*id)).map(|(_, node)| node.bounds).collect();
            let overlaps = |offset: (i32, i32)| {
                translations.iter().any(|(id, translation)| {
                    let Some(bound) = nodes.get(id).map(|node| node.bounds) else {
                        return false;
                    };
                    let left = bound.left + translation.0 + offset.0;
                    let top = bound.top + translation.1 + offset.1;
                    external.iter().any(|other| {
                        left < other.left + other.width + min_node_gap
                            && left + bound.width + min_node_gap > other.left
                            && top < other.top + other.height + min_node_gap
                            && top + bound.height + min_node_gap > other.top
                    })
                })
            };
            if overlaps(offset) {
                let vertical = !diagram.direction.horizontal();
                let sign = if diagram.direction.reversed() { -1 } else { 1 };
                let found = (1..1_000).find_map(|distance| {
                    let candidates = if vertical {
                        [(0, sign * distance), (0, -sign * distance), (distance, 0), (-distance, 0)]
                    } else {
                        [(sign * distance, 0), (-sign * distance, 0), (0, distance), (0, -distance)]
                    };
                    candidates.into_iter().find(|&candidate| !overlaps(candidate))
                });
                let Some(found) = found else {
                    return Err(LayoutError(format!(
                        "Subgraph {} has no collision-free responsive position",
                        subgraph.id
                    )));
                };
                offset = found;
            }
        }
        for (id, translation) in &translations {
            if let Some(node) = nodes.get_mut(id) {
                node.bounds.translate(translation.0 + offset.0, translation.1 + offset.1);
            }
        }
    }
    Ok(wrapped)
}

// Subgraph frames.

fn frame_from_children(id: &str, label: &str, children: &[Bounds]) -> SubgraphBounds {
    let lines = split_lines(label);
    let label_height = lines.len() as i32;
    let mut left = children.iter().map(|b| b.left).min().unwrap_or(0) - SUBGRAPH_PADDING_X;
    let top = children.iter().map(|b| b.top).min().unwrap_or(0) - SUBGRAPH_PADDING_TOP.max(label_height);
    let mut right = children.iter().map(|b| b.left + b.width).max().unwrap_or(0) + SUBGRAPH_PADDING_X;
    let bottom =
        children.iter().map(|b| b.top + b.height).max().unwrap_or(0) + SUBGRAPH_PADDING_BOTTOM.max(label_height);
    let min_width = lines.iter().map(|line| width(line)).max().unwrap_or(0) + 5;
    if right - left < min_width {
        let extra = min_width - (right - left);
        left -= extra.div_euclid(2);
        right += extra - extra.div_euclid(2);
    }
    SubgraphBounds {
        id: id.to_string(),
        label: label.to_string(),
        bounds: Bounds::rect(left, top, right - left, 3.max(bottom - top)),
        label_side: LabelSide::Top,
    }
}

fn spans_overlap(left_start: i32, left_end: i32, right_start: i32, right_end: i32) -> bool {
    left_start <= right_end && right_start <= left_end
}

pub(crate) fn label_slot(frame: &SubgraphBounds, side: LabelSide) -> Bounds {
    let lines = split_lines(&frame.label);
    let left = frame.bounds.left + 2;
    let height = lines.len() as i32;
    let top = if side == LabelSide::Top { frame.bounds.top } else { frame.bounds.top + frame.bounds.height - height };
    let slot_width = lines.iter().map(|line| width(&format!(" {line} "))).max().unwrap_or(0);
    Bounds::rect(left, top, slot_width, height)
}

fn segment_overlaps_slot(from: Point, to: Point, slot: &Bounds) -> bool {
    let Some(segment) = segment_between(from, to) else {
        return false;
    };
    let right = slot.left + slot.width - 1;
    let bottom = slot.top + slot.height - 1;
    let span = segment_span(&segment);
    if segment.axis == Axis::X {
        return segment.from.y >= slot.top
            && segment.from.y <= bottom
            && spans_overlap(span.start, span.end, slot.left, right);
    }
    segment.from.x >= slot.left && segment.from.x <= right && spans_overlap(span.start, span.end, slot.top, bottom)
}

pub(crate) fn route_overlaps_slot(route: &Route, frame: &SubgraphBounds, slot: &Bounds, node_ids: &HashSet<&str>) -> bool {
    if route.edge.from == frame.id
        && !node_ids.contains(frame.id.as_str())
        && let Some(&first) = route.points.first()
    {
        let connector = routing::source_connector(&frame.bounds, first);
        if connector.x >= slot.left
            && connector.x < slot.left + slot.width
            && connector.y >= slot.top
            && connector.y < slot.top + slot.height
        {
            return true;
        }
    }
    if route.points.windows(2).any(|pair| segment_overlaps_slot(pair[0], pair[1], slot)) {
        return true;
    }
    let Some(label) = label_bounds(route) else {
        return false;
    };
    if !spans_overlap(label.top, label.top + label.height - 1, slot.top, slot.top + slot.height - 1) {
        return false;
    }
    spans_overlap(label.left, label.left + label.width - 1, slot.left, slot.left + slot.width - 1)
}

fn choose_subgraph_label_side(frame: &SubgraphBounds, routes: &[Route], node_ids: &HashSet<&str>) -> LabelSide {
    let top = label_slot(frame, LabelSide::Top);
    if !routes.iter().any(|route| route_overlaps_slot(route, frame, &top, node_ids)) {
        return LabelSide::Top;
    }
    let bottom = label_slot(frame, LabelSide::Bottom);
    if routes.iter().any(|route| route_overlaps_slot(route, frame, &bottom, node_ids)) {
        LabelSide::Top
    } else {
        LabelSide::Bottom
    }
}

fn label_bounds(route: &Route) -> Option<Bounds> {
    if route.edge.label.is_empty() {
        return None;
    }
    let label = route_label_layout(route);
    Some(Bounds::rect(label.point.x, label.point.y, label.width, label.height))
}

fn route_render_bounds<'a>(routes: impl IntoIterator<Item = &'a Route>) -> Vec<Bounds> {
    let mut bounds = Vec::new();
    for route in routes {
        bounds.extend(bounds_from_points(&route.points));
        bounds.extend(label_bounds(route));
    }
    bounds
}

fn layout_subgraphs(diagram: &Diagram, nodes: &Nodes, routes: &[Route]) -> Frames {
    let mut frames = Frames::new();
    let node_ids: HashSet<&str> = diagram.nodes.iter().map(|node| node.id.as_str()).collect();
    for subgraph in diagram.subgraphs.iter().rev() {
        let mut children: Vec<Bounds> =
            subgraph.node_ids.iter().filter_map(|id| nodes.get(id).map(|node| node.bounds)).collect();
        let members: HashSet<&str> = subgraph.node_ids.iter().map(String::as_str).collect();
        children.extend(route_render_bounds(
            routes
                .iter()
                .filter(|route| members.contains(route.edge.from.as_str()) && members.contains(route.edge.to.as_str())),
        ));
        for child in &diagram.subgraphs {
            if child.parent_id.as_deref() != Some(&subgraph.id) {
                continue;
            }
            if let Some(frame) = frames.get(&child.id) {
                children.push(frame.bounds);
            }
        }
        if !children.is_empty() {
            let mut frame = frame_from_children(&subgraph.id, &subgraph.label, &children);
            frame.label_side = choose_subgraph_label_side(&frame, routes, &node_ids);
            frames.insert(subgraph.id.clone(), frame);
        }
    }
    frames
}

// Separation of top-level subgraphs and nodes.

fn rank_graph_components(ids: &[String], outgoing: &IndexMap<String, IndexSet<String>>) -> HashMap<String, i32> {
    let mut reachable: HashMap<&str, HashSet<String>> = HashMap::new();
    for id in ids {
        let mut seen: HashSet<String> = HashSet::new();
        let mut queue = vec![id.clone()];
        let mut index = 0;
        while index < queue.len() {
            let current = queue[index].clone();
            index += 1;
            if !seen.insert(current.clone()) {
                continue;
            }
            if let Some(targets) = outgoing.get(&current) {
                queue.extend(targets.iter().cloned());
            }
        }
        reachable.insert(id, seen);
    }
    let mut component_of: HashMap<&str, usize> = HashMap::new();
    let mut components: Vec<Vec<&str>> = Vec::new();
    for id in ids {
        if component_of.contains_key(id.as_str()) {
            continue;
        }
        let component: Vec<&str> = ids
            .iter()
            .filter(|candidate| {
                !component_of.contains_key(candidate.as_str())
                    && reachable[id.as_str()].contains(*candidate)
                    && reachable[candidate.as_str()].contains(id)
            })
            .map(String::as_str)
            .collect();
        let index = components.len();
        for member in &component {
            component_of.insert(member, index);
        }
        components.push(component);
    }
    let mut component_outgoing: Vec<IndexSet<usize>> = vec![IndexSet::new(); components.len()];
    let mut incoming = vec![0; components.len()];
    for (from, targets) in outgoing {
        let from = component_of[from.as_str()];
        for to in targets {
            let to = component_of[to.as_str()];
            if from == to || component_outgoing[from].contains(&to) {
                continue;
            }
            component_outgoing[from].insert(to);
            incoming[to] += 1;
        }
    }
    let mut component_ranks: HashMap<usize, i32> = HashMap::new();
    let mut queue: Vec<usize> = (0..components.len()).filter(|&index| incoming[index] == 0).collect();
    for &component in &queue {
        component_ranks.insert(component, 0);
    }
    let mut index = 0;
    while index < queue.len() {
        let component = queue[index];
        index += 1;
        for &to in &component_outgoing[component] {
            let rank = component_ranks.get(&to).copied().unwrap_or(0).max(component_ranks[&component] + 1);
            component_ranks.insert(to, rank);
            incoming[to] -= 1;
            if incoming[to] == 0 {
                queue.push(to);
            }
        }
    }
    ids.iter()
        .map(|id| (id.clone(), component_ranks.get(&component_of[id.as_str()]).copied().unwrap_or(0)))
        .collect()
}

#[derive(Clone)]
struct Item {
    id: String,
    /// A top-level subgraph rather than a lone node.
    frame: bool,
    node_ids: IndexSet<String>,
    rank: i32,
}

fn separate_top_level_items(
    diagram: &Diagram,
    nodes: &mut Nodes,
    frames: &mut Frames,
    gap: i32,
    target_width: Option<i32>,
) -> bool {
    let has_local_direction = diagram
        .subgraphs
        .iter()
        .any(|subgraph| subgraph.direction.is_some_and(|direction| direction != diagram.direction));
    let by_id = |id: &str| diagram.subgraphs.iter().find(|subgraph| subgraph.id == id);
    let top_level_of = |id: &str| -> String {
        let mut current = by_id(id);
        while let Some(subgraph) = current
            && let Some(parent) = &subgraph.parent_id
        {
            current = by_id(parent);
        }
        current.map_or(id.to_string(), |subgraph| subgraph.id.clone())
    };
    let mut covered: HashSet<String> = HashSet::new();
    let mut items: Vec<Item> = Vec::new();
    let mut item_of: HashMap<String, String> = HashMap::new();
    let top_level_ids: HashSet<&str> =
        diagram.subgraphs.iter().filter(|s| s.parent_id.is_none()).map(|s| s.id.as_str()).collect();
    for subgraph in &diagram.subgraphs {
        if subgraph.parent_id.is_some() {
            continue;
        }
        let node_ids = collect_subgraph_node_ids(diagram, &subgraph.id);
        if !frames.contains_key(&subgraph.id) || node_ids.is_empty() {
            continue;
        }
        item_of.insert(subgraph.id.clone(), subgraph.id.clone());
        for id in &node_ids {
            covered.insert(id.clone());
            item_of.insert(id.clone(), subgraph.id.clone());
        }
        items.push(Item { id: subgraph.id.clone(), frame: true, node_ids, rank: 0 });
    }
    for subgraph in &diagram.subgraphs {
        item_of.insert(subgraph.id.clone(), top_level_of(&subgraph.id));
    }
    for node in &diagram.nodes {
        if covered.contains(&node.id) || !nodes.contains_key(&node.id) {
            continue;
        }
        items.push(Item { id: node.id.clone(), frame: false, node_ids: IndexSet::from([node.id.clone()]), rank: 0 });
        item_of.insert(node.id.clone(), node.id.clone());
    }
    if items.len() < 2 {
        return false;
    }

    let horizontal = diagram.direction.horizontal();
    let reversed = diagram.direction.reversed();
    let node_ids: HashSet<&str> = diagram.nodes.iter().map(|node| node.id.as_str()).collect();
    let bounds_of = |item: &Item, nodes: &Nodes, frames: &Frames| -> Bounds {
        if item.frame { frames[&item.id].bounds } else { nodes[&item.id].bounds }
    };
    let move_item = |item: &Item, dx: i32, dy: i32, nodes: &mut Nodes, frames: &mut Frames| {
        for id in &item.node_ids {
            if let Some(node) = nodes.get_mut(id) {
                node.bounds.translate(dx, dy);
            }
        }
        if !top_level_ids.contains(item.id.as_str()) {
            return;
        }
        for subgraph in &diagram.subgraphs {
            if top_level_of(&subgraph.id) != item.id {
                continue;
            }
            if let Some(frame) = frames.get_mut(&subgraph.id) {
                frame.bounds.translate(dx, dy);
            }
        }
    };
    let min_edge_gap = |from_item: &str, to_item: &str| -> i32 {
        let matching: Vec<&Rc<Edge>> = diagram
            .edges
            .iter()
            .filter(|edge| {
                !edge.order_only
                    && (!node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str()))
                    && item_of.get(&edge.from).map(String::as_str) == Some(from_item)
                    && item_of.get(&edge.to).map(String::as_str) == Some(to_item)
            })
            .collect();
        if matching.is_empty() {
            return gap;
        }
        let minimum = if horizontal { MIN_SUBGRAPH_HORIZONTAL_EDGE_GAP } else { MIN_SUBGRAPH_VERTICAL_EDGE_GAP };
        matching
            .iter()
            .map(|edge| {
                if edge.label.is_empty() {
                    0
                } else if horizontal {
                    horizontal_label_rank_gap(label_width(&edge.label))
                } else {
                    split_lines(&edge.label).len() as i32 + 2
                }
            })
            .fold(gap.max(minimum), i32::max)
    };

    if has_local_direction {
        let mut outgoing: IndexMap<String, IndexSet<String>> =
            items.iter().map(|item| (item.id.clone(), IndexSet::new())).collect();
        for edge in &diagram.edges {
            if let (Some(from), Some(to)) = (item_of.get(&edge.from), item_of.get(&edge.to))
                && from != to
                && let Some(set) = outgoing.get_mut(from)
            {
                set.insert(to.clone());
            }
        }
        let ids: Vec<String> = items.iter().map(|item| item.id.clone()).collect();
        let ranks = rank_graph_components(&ids, &outgoing);
        {
            let (nodes_ref, frames_ref) = (&*nodes, &*frames);
            items.sort_by(|a, b| {
                let (ab, bb) = (bounds_of(a, nodes_ref, frames_ref), bounds_of(b, nodes_ref, frames_ref));
                ranks[&a.id].cmp(&ranks[&b.id]).then_with(|| {
                    if horizontal { ab.center_x.cmp(&bb.center_x) } else { ab.center_y.cmp(&bb.center_y) }
                })
            });
        }
        let mut cursor: Option<i32> = None;
        let mut previous: Option<String> = None;
        let mut moved = false;
        for item in &items {
            let bounds = bounds_of(item, nodes, frames);
            let start = if horizontal { bounds.left } else { bounds.top };
            let size = if horizontal { bounds.width } else { bounds.height };
            let Some(at) = cursor else {
                cursor = Some(start + size);
                previous = Some(item.id.clone());
                continue;
            };
            let pair_gap = match &previous {
                Some(previous) => min_edge_gap(previous, &item.id).max(min_edge_gap(&item.id, previous)),
                None => gap,
            };
            let shift = at + pair_gap - start;
            moved |= shift != 0;
            move_item(item, if horizontal { shift } else { 0 }, if horizontal { 0 } else { shift }, nodes, frames);
            cursor = Some(start + shift + size);
            previous = Some(item.id.clone());
        }
        return moved;
    }

    let primary_start = |bound: &Bounds| {
        let start = if horizontal { bound.left } else { bound.top };
        let size = if horizontal { bound.width } else { bound.height };
        if reversed { -(start + size) } else { start }
    };
    let primary_end = |bound: &Bounds| primary_start(bound) + if horizontal { bound.width } else { bound.height };
    let ensure_clearance = |items: &[Item], nodes: &mut Nodes, frames: &mut Frames| -> bool {
        let mut adjusted = false;
        let endpoint = |id: &str, nodes: &Nodes, frames: &Frames| {
            nodes.get(id).map(|node| node.bounds).or_else(|| frames.get(id).map(|frame| frame.bounds))
        };
        for edge in &diagram.edges {
            if edge.order_only || (node_ids.contains(edge.from.as_str()) && node_ids.contains(edge.to.as_str())) {
                continue;
            }
            let find = |id: Option<&String>| id.and_then(|id| items.iter().position(|item| item.id == *id));
            let (Some(from_item), Some(to_item)) = (find(item_of.get(&edge.from)), find(item_of.get(&edge.to))) else {
                continue;
            };
            if from_item == to_item {
                continue;
            }
            let (Some(from_bound), Some(to_bound)) =
                (endpoint(&edge.from, nodes, frames), endpoint(&edge.to, nodes, frames))
            else {
                continue;
            };
            if primary_start(&to_bound) <= primary_start(&from_bound) {
                continue;
            }
            let required = min_edge_gap(&items[from_item].id, &items[to_item].id);
            let deficit = primary_end(&from_bound) + required - primary_start(&to_bound);
            if deficit <= 0 {
                continue;
            }
            adjusted = true;
            let to_start = primary_start(&bounds_of(&items[to_item], nodes, frames));
            let offset = if reversed { -deficit } else { deficit };
            for (index, candidate) in items.iter().enumerate() {
                if index != to_item && primary_start(&bounds_of(candidate, nodes, frames)) < to_start {
                    continue;
                }
                if index == from_item {
                    continue;
                }
                move_item(candidate, if horizontal { offset } else { 0 }, if horizontal { 0 } else { offset }, nodes, frames);
            }
        }
        adjusted
    };

    let mut ranked: Vec<Item> = items.iter().filter(|item| top_level_ids.contains(item.id.as_str())).cloned().collect();
    if ranked.len() < 2 {
        return ensure_clearance(&items, nodes, frames);
    }
    let ranked_ids: HashSet<String> = ranked.iter().map(|item| item.id.clone()).collect();
    let mut outgoing: IndexMap<String, IndexSet<String>> =
        ranked.iter().map(|item| (item.id.clone(), IndexSet::new())).collect();
    for edge in &diagram.edges {
        let (Some(from), Some(to)) = (item_of.get(&edge.from), item_of.get(&edge.to)) else {
            continue;
        };
        if from == to || !ranked_ids.contains(from) || !ranked_ids.contains(to) {
            continue;
        }
        outgoing[from].insert(to.clone());
    }
    let ids: Vec<String> = ranked.iter().map(|item| item.id.clone()).collect();
    let ranks = rank_graph_components(&ids, &outgoing);
    for item in &mut ranked {
        item.rank = ranks[&item.id];
    }
    let mut by_rank: IndexMap<i32, Vec<Item>> = IndexMap::new();
    for item in &ranked {
        by_rank.entry(item.rank).or_default().push(item.clone());
    }
    let mut rank_keys: Vec<i32> = by_rank.keys().copied().collect();
    rank_keys.sort_unstable();
    let mut previous_end: Option<i32> = None;
    let mut previous_items: Vec<Item> = Vec::new();
    let mut moved = false;
    for rank in &rank_keys {
        let rank_items = &by_rank[rank];
        let start = rank_items.iter().map(|item| primary_start(&bounds_of(item, nodes, frames))).min().unwrap_or(0);
        let end = rank_items.iter().map(|item| primary_end(&bounds_of(item, nodes, frames))).max().unwrap_or(0);
        let Some(previous) = previous_end else {
            previous_end = Some(end);
            previous_items = rank_items.clone();
            continue;
        };
        let rank_gap = previous_items
            .iter()
            .flat_map(|prev| rank_items.iter().map(move |curr| (prev.id.clone(), curr.id.clone())))
            .map(|(prev, curr)| min_edge_gap(&prev, &curr))
            .fold(gap, i32::max);
        let shift = 0.max(previous + rank_gap - start);
        if shift > 0 {
            moved = true;
            let offset = if reversed { -shift } else { shift };
            for item in rank_items {
                move_item(item, if horizontal { offset } else { 0 }, if horizontal { 0 } else { offset }, nodes, frames);
            }
        }
        previous_end = Some(end + shift);
        previous_items = rank_items.clone();
    }
    for rank in &rank_keys {
        let mut rank_items = by_rank[rank].clone();
        rank_items.sort_by_key(|item| {
            let bounds = bounds_of(item, nodes, frames);
            if horizontal { bounds.top } else { bounds.left }
        });
        let mut cross: Option<i32> = None;
        for item in &rank_items {
            let bounds = bounds_of(item, nodes, frames);
            let start = if horizontal { bounds.top } else { bounds.left };
            let size = if horizontal { bounds.height } else { bounds.width };
            let Some(at) = cross else {
                cross = Some(start + size + gap);
                continue;
            };
            let shift = 0.max(at - start);
            if shift > 0 {
                moved = true;
                move_item(item, if horizontal { 0 } else { shift }, if horizontal { shift } else { 0 }, nodes, frames);
            }
            cross = Some(start + shift + size + gap);
        }
    }
    if target_width.is_some() && !horizontal {
        let member_bounds = |item: &Item, nodes: &Nodes| -> Vec<Bounds> {
            item.node_ids.iter().filter_map(|id| nodes.get(id).map(|node| node.bounds)).collect()
        };
        let intersects = |left: &Item, right: &Item, nodes: &Nodes| {
            member_bounds(left, nodes).iter().any(|a| {
                member_bounds(right, nodes).iter().any(|b| {
                    a.left <= b.left + b.width - 1
                        && a.left + a.width - 1 >= b.left
                        && a.top <= b.top + b.height - 1
                        && a.top + a.height - 1 >= b.top
                })
            })
        };
        for right_index in 1..items.len() {
            for left_index in 0..right_index {
                if !intersects(&items[left_index], &items[right_index], nodes) {
                    continue;
                }
                let (Some(left), Some(right)) = (
                    bounds_from_bounds(&member_bounds(&items[left_index], nodes)),
                    bounds_from_bounds(&member_bounds(&items[right_index], nodes)),
                ) else {
                    continue;
                };
                let shift = if reversed {
                    left.top - gap - (right.top + right.height)
                } else {
                    left.top + left.height + gap - right.top
                };
                moved |= shift != 0;
                move_item(&items[right_index], 0, shift, nodes, frames);
            }
        }
    }
    ensure_clearance(&items, nodes, frames) || moved
}
