//! State diagram drawing (`state/drawing.ts`) and its styles (`state/style.ts`).

use super::layout::{
    Layout, NoteBox, create, expand_for_feedback, expand_for_internal_transitions, note_connector_of, separate_external,
};
use super::routing::{Glyph, RenderOptions, RenderPlan, junction_plans, measure_label, render_plans};
use super::{Diagram, NoteSide, StateDirection, StateKind, is_hidden_composite_marker, visible};
use crate::core::canvas::{Canvas, Cell, SizeError, TRIM_BOTH};
use crate::core::drawing::{
    ArrowHeadStyle, BorderChars, CornerStyle, DOUBLE, Directions, LineStyle, ROUNDED, arrow_head, draw_frame,
    fill_frame_interior, line_glyph, merge_line_glyph,
};
use crate::core::geometry::{Bounds, direction_between, orthogonal_path_points};
use crate::core::text::{LABEL_PADDING_X, width};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    State,
    StateBorder,
    Composite,
    CompositeLabel,
    Transition,
    Label,
    NoteBorder,
    NoteText,
    NoteConnector,
    Start,
    End,
    Choice,
    /// `noteConnectorRamp1` to `noteConnectorRamp3`, as 0 to 2.
    NoteRamp(u8),
    /// `stateDepartureRamp1` to `stateDepartureRamp3`, as 0 to 2.
    DepartureRamp(u8),
}

pub type Grid = Canvas<Style>;

#[derive(Debug)]
pub enum DrawError {
    Size(SizeError),
    Layout(String),
}

fn transition_like(style: Option<Style>) -> bool {
    matches!(style, Some(Style::Transition | Style::DepartureRamp(_)))
}

fn merge(existing: &Cell<Style>, incoming: Cell<Style>) -> Cell<Style> {
    if transition_like(existing.style) && transition_like(incoming.style) {
        let ch = merge_line_glyph(&existing.ch, &incoming.ch, CornerStyle::Rounded).map(str::to_string);
        return Cell { ch: ch.unwrap_or(incoming.ch), ..incoming };
    }
    incoming
}

fn frame(grid: &mut Grid, bounds: &Bounds, chars: &BorderChars, style: Style) {
    draw_frame(bounds, chars, |x, y, ch| grid.set(x, y, ch, Some(style)));
}

fn container_label(grid: &mut Grid, bounds: &Bounds, label: &str, style: Style) {
    if !label.is_empty() {
        grid.text(bounds.left + 2, bounds.top, &format!(" {label} "), Some(style));
    }
}

fn note_glyph(directions: Directions) -> &'static str {
    let c = DOUBLE;
    let Directions { up, down, left, right } = directions;
    if up && down && left && right {
        c.cross
    } else if up && down && right {
        c.left_t
    } else if up && down && left {
        c.right_t
    } else if left && right && down {
        c.top_t
    } else if left && right && up {
        c.bottom_t
    } else if up && right {
        c.bottom_left
    } else if up && left {
        c.bottom_right
    } else if down && right {
        c.top_left
    } else if down && left {
        c.top_right
    } else if up || down {
        c.vertical
    } else {
        c.horizontal
    }
}

fn draw_note(grid: &mut Grid, note: &NoteBox, target: &Bounds) {
    let connector = note_connector_of(note, target);
    let points = orthogonal_path_points(&connector.points);
    for (index, &point) in points.iter().enumerate() {
        let mut directions = Directions::default();
        if index > 0
            && let Some(direction) = direction_between(point, points[index - 1])
        {
            directions.add(direction);
        }
        if let Some(&next) = points.get(index + 1)
            && let Some(direction) = direction_between(point, next)
        {
            directions.add(direction);
        }
        let distance = points.len() - index - 1;
        let style = if distance < 3 { Style::NoteRamp((2 - distance) as u8) } else { Style::NoteConnector };
        grid.set(point.x, point.y, note_glyph(directions), Some(style));
    }
    let b = &note.bounds;
    frame(grid, b, &DOUBLE, Style::NoteBorder);
    let right = note.note.side == NoteSide::Right;
    grid.set(
        if right { b.left } else { b.left + b.width - 1 },
        connector.connector_y,
        if right { DOUBLE.right_t } else { DOUBLE.left_t },
        Some(Style::NoteBorder),
    );
    for (index, line) in note.lines.iter().enumerate() {
        grid.text(b.left + 2, b.top + 1 + index as i32, line, Some(Style::NoteText));
    }
}

fn draw_plan(grid: &mut Grid, plan: &RenderPlan, ramp: bool) {
    let departure: Vec<(i32, i32)> = if ramp { plan.path.iter().take(3).copied().collect() } else { Vec::new() };
    for cell in &plan.cells {
        let ch = match cell.glyph {
            Glyph::Arrow(direction) => arrow_head(direction, ArrowHeadStyle::Filled),
            Glyph::Char(ch) => ch,
        };
        let style = departure
            .iter()
            // TS builds a Map from the first three points, so a repeated point takes its last index.
            .rposition(|&p| p == (cell.x, cell.y))
            .map_or(Style::Transition, |index| Style::DepartureRamp(index as u8));
        grid.set(cell.x, cell.y, ch, Some(style));
    }
    if let Some(label) = &plan.label {
        for (index, line) in label.lines.iter().enumerate() {
            let y = label.y + index as i32;
            let left = label.x - LABEL_PADDING_X;
            if grid.cell(left, y).is_some_and(|c| c.ch == " ") {
                grid.set(left, y, " ", Some(Style::Label));
            }
            grid.text(label.x, y, line, Some(Style::Label));
            let right = label.x + width(line) + LABEL_PADDING_X - 1;
            if grid.cell(right, y).is_some_and(|c| c.ch == " ") {
                grid.set(right, y, " ", Some(Style::Label));
            }
        }
    }
}

/// Draws with the source direction; a horizontal diagram wider than `max_width` folds to vertical when that is
/// narrower.
pub fn draw(source: &Diagram, max_width: Option<i32>) -> Result<Grid, DrawError> {
    let direction = source.direction;
    let (Some(max_width), true) = (max_width, direction.horizontal()) else {
        return draw_with(source, direction);
    };
    let fallback = if direction == StateDirection::RL { StateDirection::BT } else { StateDirection::TB };
    let drawing = match draw_with(source, direction) {
        Ok(grid) => grid,
        Err(DrawError::Size(_)) => return draw_with(source, fallback),
        Err(error) => return Err(error),
    };
    if drawing.text_width(TRIM_BOTH) <= max_width.max(1) {
        return Ok(drawing);
    }
    let folded = draw_with(source, fallback)?;
    if folded.text_width(TRIM_BOTH) >= drawing.text_width(TRIM_BOTH) {
        return Ok(drawing);
    }
    Ok(folded)
}

fn draw_with(source: &Diagram, direction: StateDirection) -> Result<Grid, DrawError> {
    let diagram = visible(&Diagram { direction, ..source.clone() });
    let mut budget = super::MAX_SEARCH_VISITS;
    let mut layout = create(&diagram, 5, &mut budget).map_err(DrawError::Layout)?;
    let bottoms = layout.bounds.values().map(|&i| layout.arena[i]).chain(layout.notes.iter().map(|n| n.bounds));
    let lane_y = bottoms.clone().map(|b| b.top + b.height).fold(0, i32::max) + 3;
    let top_y = bottoms.map(|b| b.top).fold(0, i32::min) - 3;
    expand_for_feedback(&diagram, &mut layout, lane_y);
    let attempts = diagram.states.len() + diagram.composites.len() + 1;
    let mut plans: Vec<RenderPlan> = Vec::new();
    for attempt in 0..attempts {
        let notes = layout.notes.clone();
        plans = render_plans(
            &diagram,
            &layout.boxes(),
            lane_y,
            &RenderOptions { feedback_top_y: Some(top_y), notes: &notes, repair: true },
            &mut budget,
        )
        .map_err(DrawError::Layout)?;
        expand_for_internal_transitions(&diagram, &mut layout, &plans);
        if !separate_external(&diagram, &mut layout) {
            break;
        }
        if attempt == attempts - 1 {
            return Err(DrawError::Layout("State composite separation did not converge".to_string()));
        }
    }
    let connectors = |layout: &Layout| -> Vec<crate::core::geometry::Point> {
        layout.notes.iter().flat_map(|n| n.connector.iter().flat_map(|c| c.points.iter().copied())).collect()
    };
    let boxes = |layout: &Layout| -> Vec<Bounds> {
        layout.bounds.values().map(|&i| layout.arena[i]).chain(layout.notes.iter().map(|n| n.bounds)).collect()
    };
    let points = connectors(&layout);
    let all = boxes(&layout);
    let left =
        all.iter()
            .map(|b| b.left)
            .chain(points.iter().map(|p| p.x))
            .chain(plans.iter().flat_map(|plan| {
                plan.cells.iter().map(|c| c.x).chain(plan.label.iter().map(|l| l.x - LABEL_PADDING_X))
            }))
            .fold(0, i32::min);
    let top = all
        .iter()
        .map(|b| b.top)
        .chain(points.iter().map(|p| p.y))
        .chain(plans.iter().flat_map(|plan| plan.cells.iter().map(|c| c.y).chain(plan.label.iter().map(|l| l.y))))
        .fold(0, i32::min);
    if left < 0 || top < 0 {
        layout.translate(-left, -top);
        for plan in &mut plans {
            for cell in &mut plan.cells {
                cell.x -= left;
                cell.y -= top;
            }
            for point in &mut plan.path {
                point.0 -= left;
                point.1 -= top;
            }
            if let Some(label) = &mut plan.label {
                label.x -= left;
                label.y -= top;
            }
        }
    }
    let points = connectors(&layout);
    let all = boxes(&layout);
    let max_x = all.iter().map(|b| b.left + b.width).chain(points.iter().map(|p| p.x + 1)).fold(0, i32::max);
    let max_y = all.iter().map(|b| b.top + b.height).chain(points.iter().map(|p| p.y + 1)).fold(0, i32::max);
    let label_sizes: Vec<_> = diagram.transitions.iter().map(|t| measure_label(&t.label)).collect();
    let label_width = label_sizes.iter().map(|s| s.width).fold(0, i32::max);
    let label_lines = label_sizes.iter().map(|s| s.height).fold(0, i32::max);
    let right = plans
        .iter()
        .flat_map(|plan| {
            plan.cells
                .iter()
                .map(|c| c.x + 1)
                .chain(plan.label.iter().map(|l| l.x + measure_label(&plan.route.label).width + LABEL_PADDING_X))
        })
        .fold(max_x, i32::max);
    let bottom = plans
        .iter()
        .flat_map(|plan| {
            plan.cells.iter().map(|c| c.y + 1).chain(plan.label.iter().map(|l| l.y + l.lines.len() as i32))
        })
        .fold(max_y, i32::max);
    let mut grid = Grid::new(
        (max_x + 24.max(label_width + 4)).max(right + 2),
        (max_y + 8 + label_lines).max(bottom + 2),
        Some(merge),
    )
    .map_err(DrawError::Size)?;
    for composite in &diagram.composites {
        if let Some(b) = layout.composite(&composite.id) {
            frame(&mut grid, &b, &ROUNDED, Style::Composite);
            container_label(&mut grid, &b, &composite.label, Style::Composite);
        }
    }
    for state in &diagram.states {
        let (Some(b), Some(size)) = (layout.get(&state.id), layout.sizes.get(&state.id)) else {
            continue;
        };
        if is_hidden_composite_marker(Some(state)) {
            continue;
        }
        let style = match state.kind {
            StateKind::Start => Style::Start,
            StateKind::End => Style::End,
            StateKind::Choice => Style::Choice,
            StateKind::State => {
                fill_frame_interior(&b, |x, y| grid.set(x, y, " ", Some(Style::State)));
                frame(&mut grid, &b, &ROUNDED, Style::StateBorder);
                for (index, line) in size.lines.iter().enumerate() {
                    grid.text(b.left + 2, b.top + 1 + index as i32, line, Some(Style::State));
                }
                continue;
            }
        };
        grid.set(b.left, b.top, &state.label, Some(style));
    }
    for plan in &plans {
        let source = diagram.states.iter().find(|s| s.id == plan.route.from_id);
        draw_plan(&mut grid, plan, source.is_some_and(|s| s.kind == StateKind::State));
    }
    for junction in junction_plans(&diagram, &layout.boxes(), &plans) {
        let (ch, style) = if junction.choice {
            ("◆", Style::Choice)
        } else {
            (line_glyph(junction.connections, CornerStyle::Rounded, LineStyle::Single), Style::Transition)
        };
        grid.set(junction.bounds.left, junction.bounds.top, ch, Some(style));
    }
    for composite in &diagram.composites {
        if let Some(b) = layout.composite(&composite.id) {
            container_label(&mut grid, &b, &composite.label, Style::CompositeLabel);
        }
    }
    for note in &layout.notes {
        if let Some(target) = layout.get(&note.note.target) {
            draw_note(&mut grid, note, &target);
        }
    }
    Ok(grid)
}
