//! Flowchart drawing (`flowchart/drawing.ts`) and its styles (`flowchart/style.ts`).

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;

use super::labels::route_label_layout;
use super::layout::{Layout, LayoutError, Options, layout};
use super::routing::source_connector;
use super::types::{Diagram, EdgeStyle, Endpoint, LabelSide, Node, NodeBounds, Route, Shape, SubgraphBounds};
use crate::core::canvas::{Canvas, Cell, SizeError};
use crate::core::drawing::{
    ArrowHeadStyle, BorderChars, CornerStyle, Directions, LineStyle, ROUNDED, arrow_head_between, diamond_chars,
    draw_diamond, draw_frame, draw_orthogonal_path, fill_frame_interior, is_arrow_head, line_glyph, merge_line_glyph,
};
use crate::core::geometry::{Point, direction_between, walk_orthogonal_segment};
use crate::core::text::{LABEL_PADDING_X, TextRun, parse_lines, width};

pub const FADE_STEPS: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    Node,
    NodeBorder,
    Database,
    DatabaseBorder,
    Edge,
    Label,
    Group,
    GroupLabel,
    /// `nodeEdgeFade1` to `nodeEdgeFade5`, as 0 to 4.
    NodeFade(u8),
    DatabaseFade(u8),
}

pub type Grid = Canvas<Style>;

pub fn italic() -> u8 {
    opentui::prelude::Attributes::ITALIC.bits()
}

#[derive(Debug)]
pub enum DrawError {
    Size(SizeError),
    Layout(LayoutError),
}

fn merge(existing: &Cell<Style>, incoming: Cell<Style>) -> Cell<Style> {
    if incoming.style != Some(Style::Edge) {
        return incoming;
    }
    if existing.style == Some(Style::Label) || incoming.ch == " " {
        return existing.clone();
    }
    if existing.style != Some(Style::Edge) || existing.ch == " " {
        return incoming;
    }
    if is_arrow_head(&existing.ch) {
        return existing.clone();
    }
    if is_arrow_head(&incoming.ch) {
        return incoming;
    }
    let ch = merge_line_glyph(&existing.ch, &incoming.ch, CornerStyle::Rounded).map(str::to_string);
    Cell { ch: ch.unwrap_or(incoming.ch), ..incoming }
}

fn set_rich_text(grid: &mut Grid, x: i32, y: i32, runs: &[TextRun], style: Style) -> i32 {
    let mut offset = 0;
    for run in runs {
        let attributes = if run.italic { italic() } else { 0 };
        grid.text_with(x + offset, y, &run.text, Some(style), |_| attributes);
        offset += width(&run.text);
    }
    offset
}

fn draw_node(grid: &mut Grid, node: &Node, bounds: &NodeBounds, chars: &BorderChars) {
    let b = &bounds.bounds;
    let (style, border) =
        if node.shape == Shape::Database { (Style::Database, Style::DatabaseBorder) } else { (Style::Node, Style::NodeBorder) };
    match node.shape {
        Shape::Decision => draw_diamond(b, &diamond_chars(chars), |x, y, ch| grid.set(x, y, ch, Some(border))),
        Shape::Subroutine => {
            fill_frame_interior(b, |x, y| grid.set(x, y, " ", Some(style)));
            draw_frame(b, chars, |x, y, ch| grid.set(x, y, ch, Some(border)));
            let left_rail = b.left + 2;
            let right_rail = b.left + b.width - 3;
            let bottom = b.top + b.height - 1;
            grid.set(left_rail, b.top, chars.top_t, Some(border));
            grid.set(right_rail, b.top, chars.top_t, Some(border));
            grid.set(left_rail, bottom, chars.bottom_t, Some(border));
            grid.set(right_rail, bottom, chars.bottom_t, Some(border));
            for y in b.top + 1..bottom {
                grid.set(left_rail, y, chars.vertical, Some(border));
                grid.set(right_rail, y, chars.vertical, Some(border));
            }
        }
        Shape::Database => {
            fill_frame_interior(b, |x, y| grid.set(x, y, " ", Some(style)));
            draw_frame(b, chars, |x, y, ch| grid.set(x, y, ch, Some(border)));
            for y in [b.top + 1, b.top + b.height - 2] {
                grid.set(b.left, y, chars.left_t, Some(border));
                grid.set(b.left + b.width - 1, y, chars.right_t, Some(border));
                for x in b.left + 1..b.left + b.width - 1 {
                    grid.set(x, y, chars.horizontal, Some(border));
                }
            }
        }
        Shape::Box | Shape::Rounded => {
            fill_frame_interior(b, |x, y| grid.set(x, y, " ", Some(style)));
            draw_frame(b, chars, |x, y, ch| grid.set(x, y, ch, Some(border)));
        }
    }
    let text_top = match node.shape {
        Shape::Decision => b.top + (b.height - bounds.lines.len() as i32).div_euclid(2),
        Shape::Database => b.top + 2,
        _ => b.top + 1,
    };
    let lines = parse_lines(&node.label);
    for (index, line) in bounds.lines.iter().enumerate() {
        let x = if node.shape == Shape::Subroutine {
            b.left + 3
        } else {
            b.left + 1.max((b.width - width(line)).div_euclid(2))
        };
        if let Some(parsed) = lines.get(index) {
            set_rich_text(grid, x, text_top + index as i32, &parsed.runs, style);
        }
    }
}

fn draw_subgraph_label(grid: &mut Grid, frame: &SubgraphBounds) {
    if frame.label.is_empty() {
        return;
    }
    let lines = parse_lines(&frame.label);
    let b = &frame.bounds;
    let top = if frame.label_side == LabelSide::Top { b.top } else { b.top + b.height - lines.len() as i32 };
    for (index, line) in lines.iter().enumerate() {
        let y = top + index as i32;
        grid.text(b.left + 2, y, " ", Some(Style::GroupLabel));
        let label_width = set_rich_text(grid, b.left + 3, y, &line.runs, Style::GroupLabel);
        grid.text(b.left + label_width + 3, y, " ", Some(Style::GroupLabel));
    }
}

fn draw_edge_label(grid: &mut Grid, route: &Route) {
    let label = route_label_layout(route);
    let padding = " ".repeat(LABEL_PADDING_X as usize);
    for (index, line) in parse_lines(&route.edge.label).iter().enumerate() {
        let y = label.point.y + index as i32;
        grid.text(label.point.x, y, &padding, Some(Style::Label));
        let label_width = set_rich_text(grid, label.point.x + LABEL_PADDING_X, y, &line.runs, Style::Label);
        grid.text(label.point.x + label_width + LABEL_PADDING_X, y, &padding, Some(Style::Label));
    }
}

fn draw_routed_edge(grid: &mut Grid, route: &Route) {
    let points = &route.points;
    if points.len() < 2 {
        return;
    }
    let line = if route.edge.style == Some(EdgeStyle::Thick) { LineStyle::Heavy } else { LineStyle::Single };
    draw_orthogonal_path(points, CornerStyle::Rounded, line, |x, y, ch| grid.set(x, y, ch, Some(Style::Edge)));
    let end = points[points.len() - 1];
    let before = points[points.len() - 2];
    if route.edge.arrowhead {
        grid.set(end.x, end.y, arrow_head_between(before, end, ArrowHeadStyle::Filled), Some(Style::Edge));
    } else if let Some(direction) = direction_between(before, end) {
        let glyph = line_glyph(Directions::of(&[direction]), CornerStyle::Square, LineStyle::Single);
        grid.set(end.x, end.y, glyph, Some(Style::Edge));
    }
    if !route.edge.label.is_empty() {
        draw_edge_label(grid, route);
    }
}

fn route_cell_occupancy(routes: &[Route]) -> HashMap<Point, i32> {
    let mut occupancy: HashMap<Point, i32> = HashMap::new();
    for route in routes {
        let mut cells: HashSet<Point> = HashSet::new();
        for index in 1..route.points.len() {
            walk_orthogonal_segment(route.points[index - 1], route.points[index], index == 1, |point| {
                cells.insert(point);
                true
            });
        }
        for cell in cells {
            *occupancy.entry(cell).or_insert(0) += 1;
        }
    }
    occupancy
}

fn fade_source_path(grid: &mut Grid, connector: Point, points: &[Point], database: bool, occupancy: &HashMap<Point, i32>) {
    let (Some(&from), Some(&to)) = (points.first(), points.get(1)) else {
        return;
    };
    let mut private = vec![connector];
    walk_orthogonal_segment(from, to, true, |point| {
        let Some(cell) = grid.cell(point.x, point.y) else {
            return false;
        };
        if occupancy.get(&point) != Some(&1) || !"─━│┃".contains(cell.ch.as_str()) || cell.style == Some(Style::Label) {
            return false;
        }
        private.push(point);
        true
    });
    let count = private.len();
    for (index, point) in private.iter().enumerate() {
        let step = (FADE_STEPS - 1).min((index + 1) * FADE_STEPS / (count + 1)) as u8;
        let style = if database { Style::DatabaseFade(step) } else { Style::NodeFade(step) };
        if let Some(ch) = grid.cell(point.x, point.y).map(|cell| cell.ch.clone()) {
            grid.set(point.x, point.y, &ch, Some(style));
        }
    }
}

fn draw_source_connectors(grid: &mut Grid, layout: &Layout) {
    let nodes: HashMap<&str, &Node> = layout.diagram.nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let occupancy = route_cell_occupancy(&layout.routes);
    let mut junctions: IndexMap<String, (Directions, bool)> = IndexMap::new();
    for route in &layout.routes {
        let (Some(&source), Some(&next)) = (route.points.first(), route.points.get(1)) else {
            continue;
        };
        let junction = junctions
            .entry(format!("{}:{}:{}", route.edge.from, source.x, source.y))
            .or_insert((Directions::default(), true));
        if let Some(direction) = direction_between(source, next) {
            junction.0.add(direction);
        }
        junction.1 &= route.edge.style == Some(EdgeStyle::Thick);
    }
    for route in &layout.routes {
        let from = layout
            .bounds
            .get(&route.edge.from)
            .map(Endpoint::Node)
            .or_else(|| layout.subgraph_bounds.get(&route.edge.from).map(Endpoint::Subgraph));
        let (Some(from), Some(&source)) = (from, route.points.first()) else {
            continue;
        };
        let database = nodes.get(route.edge.from.as_str()).is_some_and(|node| node.shape == Shape::Database);
        let connector = source_connector(from.bounds(), source);
        grid.set(connector.x, connector.y, connector.ch, Some(Style::Edge));
        let connector_point = Point { x: connector.x, y: connector.y };
        if let Some(direction) = direction_between(source, connector_point)
            && let Some(cell) = grid.cell(source.x, source.y)
            && cell.style != Some(Style::Label)
            && !is_arrow_head(&cell.ch)
        {
            let junction = junctions.get(&format!("{}:{}:{}", route.edge.from, source.x, source.y));
            let mut directions = junction.map(|junction| junction.0).unwrap_or_default();
            directions.add(direction);
            let heavy = junction.map_or(route.edge.style == Some(EdgeStyle::Thick), |junction| junction.1);
            let glyph =
                line_glyph(directions, CornerStyle::Rounded, if heavy { LineStyle::Heavy } else { LineStyle::Single });
            grid.replace(source.x, source.y, glyph, Some(Style::Edge));
        }
        fade_source_path(grid, connector_point, &route.points, database, &occupancy);
        if route.edge.source_arrowhead
            && let Some(&next) = route.points.get(1)
        {
            grid.set(source.x, source.y, arrow_head_between(next, source, ArrowHeadStyle::Filled), Some(Style::Edge));
        }
    }
}

pub fn draw(diagram: &Diagram, options: &Options) -> Result<Grid, DrawError> {
    let layout = layout(diagram, options).map_err(DrawError::Layout)?;
    let mut grid = Grid::new(layout.width, layout.height, Some(merge)).map_err(DrawError::Size)?;
    let chars = ROUNDED;
    for subgraph in &layout.diagram.subgraphs {
        if let Some(frame) = layout.subgraph_bounds.get(&subgraph.id) {
            draw_frame(&frame.bounds, &chars, |x, y, ch| grid.set(x, y, ch, Some(Style::Group)));
        }
    }
    for route in &layout.routes {
        draw_routed_edge(&mut grid, route);
    }
    for node in &layout.diagram.nodes {
        if let Some(bounds) = layout.bounds.get(&node.id) {
            draw_node(&mut grid, node, bounds, &chars);
        }
    }
    draw_source_connectors(&mut grid, &layout);
    for subgraph in &layout.diagram.subgraphs {
        if let Some(frame) = layout.subgraph_bounds.get(&subgraph.id) {
            draw_subgraph_label(&mut grid, frame);
        }
    }
    Ok(grid)
}
