//! Sequence diagram drawing (`sequence/drawing.ts`) and styles (`sequence/style.ts`).

use super::placement::{GroupPlacement, HBounds, StepPlacement, plan};
use super::{Diagram, FragmentKind, Head};
use crate::core::canvas::{Canvas, SizeError};
use crate::core::drawing::ROUNDED;
use crate::core::text::width;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    Participant,
    Lifeline,
    Group,
    Request,
    Response,
    /// `requestFade1` to `requestFade5`, as 0 to 4.
    RequestFade(u8),
    ResponseFade(u8),
    /// `lifelineRamp1` to `lifelineRamp3`, as 0 to 2.
    LifelineRamp(u8),
    Fragment,
    FragmentLabel,
    Note,
    NoteBadge,
}

pub type Grid = Canvas<Style>;

const BORDER: crate::core::drawing::BorderChars = ROUNDED;

fn set(grid: &mut Grid, x: i32, y: i32, ch: &str, style: Style) {
    grid.set(x, y, ch, Some(style));
}

fn text(grid: &mut Grid, x: i32, y: i32, value: &str, style: Style) {
    grid.text(x.max(0), y, value, Some(style));
}

fn arrow_head(head: Option<Head>, direction: i32) -> &'static str {
    let right = direction == 1;
    match head {
        Some(Head::Open) => if right { ">" } else { "<" },
        Some(Head::Cross) => "✕",
        Some(Head::Async) => if right { ")" } else { "(" },
        None => if right { "►" } else { "◄" },
    }
}

fn departure_fade(grid: &mut Grid, x: i32, y: i32, direction: i32, response: bool) {
    let fade = |step: u8| if response { Style::ResponseFade(step) } else { Style::RequestFade(step) };
    set(grid, x, y, if direction == 1 { BORDER.left_t } else { BORDER.right_t }, fade(0));
    for step in 2..=5 {
        set(grid, x + direction * (step - 1), y, BORDER.horizontal, fade((step - 1) as u8));
    }
}

fn group_vertical(grid: &mut Grid, x: i32, y: i32) {
    let blank = grid.cell(x, y).is_none_or(|cell| cell.ch == " " || cell.ch == BORDER.vertical);
    if blank {
        set(grid, x, y, BORDER.vertical, Style::Group);
    }
}

fn draw_groups(grid: &mut Grid, groups: &[GroupPlacement], bottom: i32) {
    for group in groups {
        for x in group.left..=group.right {
            set(grid, x, 0, BORDER.horizontal, Style::Group);
            set(grid, x, bottom, BORDER.horizontal, Style::Group);
        }
        set(grid, group.left, 0, BORDER.top_left, Style::Group);
        set(grid, group.right, 0, BORDER.top_right, Style::Group);
        set(grid, group.left, bottom, BORDER.bottom_left, Style::Group);
        set(grid, group.right, bottom, BORDER.bottom_right, Style::Group);
        for y in 1..bottom {
            group_vertical(grid, group.left, y);
            group_vertical(grid, group.right, y);
        }
        if !group.label.is_empty() {
            text(grid, group.left + 2, 0, &group.label, Style::Group);
        }
    }
}

fn draw_walls(grid: &mut Grid, bounds: HBounds, start: i32, end: i32) {
    for y in start..=end {
        set(grid, bounds.left, y, BORDER.vertical, Style::Fragment);
        set(grid, bounds.right, y, BORDER.vertical, Style::Fragment);
    }
}

pub fn draw(diagram: &Diagram, compact: bool) -> Result<Grid, SizeError> {
    let plan = plan(diagram, compact);
    if plan.width == 0 || plan.height == 0 {
        return Grid::new(0, 0, None);
    }
    let mut grid = Grid::new(plan.width, plan.height, None)?;
    if !plan.groups.is_empty() {
        draw_groups(&mut grid, &plan.groups, plan.height - 1);
    }
    let rows = &plan.rows;
    for participant in &plan.participants {
        let center = participant.center;
        for (index, line) in participant.label_lines.iter().enumerate() {
            text(&mut grid, center - width(line).div_euclid(2), rows.header_y + index as i32, line, Style::Participant);
        }
        if !compact {
            for x in participant.header_left..=participant.header_right {
                set(&mut grid, x, rows.rule_y, BORDER.horizontal, Style::Participant);
            }
            set(&mut grid, center, rows.rule_y, BORDER.top_t, Style::Participant);
        }
        for y in rows.lifeline_start..=rows.lifeline_end {
            let distance = y - rows.lifeline_start;
            let style = if !compact && distance < 3 { Style::LifelineRamp(distance as u8) } else { Style::Lifeline };
            set(&mut grid, center, y, BORDER.vertical, style);
        }
    }
    for step in &plan.steps {
        match step {
            StepPlacement::Note { lines, x, y } => {
                for (index, line) in lines.iter().enumerate() {
                    text(&mut grid, *x, y + index as i32, line, Style::NoteBadge);
                }
            }
            StepPlacement::Fragment { fragment, label, bounds, y, walls_before } => {
                if let Some(walls) = walls_before
                    && walls.end >= walls.start
                {
                    draw_walls(&mut grid, walls.bounds, walls.start, walls.end);
                }
                let (left_ch, right_ch) = match fragment.kind {
                    FragmentKind::Alt | FragmentKind::Loop => (BORDER.top_left, BORDER.top_right),
                    FragmentKind::Else => (BORDER.left_t, BORDER.right_t),
                    FragmentKind::End => (BORDER.bottom_left, BORDER.bottom_right),
                };
                for x in bounds.left..=bounds.right {
                    set(&mut grid, x, *y, BORDER.horizontal, Style::Fragment);
                }
                set(&mut grid, bounds.left, *y, left_ch, Style::Fragment);
                set(&mut grid, bounds.right, *y, right_ch, Style::Fragment);
                if !label.is_empty() {
                    text(&mut grid, bounds.left + 2, *y, label, Style::FragmentLabel);
                }
            }
            StepPlacement::SelfMessage { message, label_lines, center, right, top, bottom } => {
                let style = if message.dashed { Style::Response } else { Style::Request };
                departure_fade(&mut grid, *center, *top, 1, message.dashed);
                for x in center + 5..*right {
                    set(&mut grid, x, *top, BORDER.horizontal, style);
                }
                set(&mut grid, *right, *top, BORDER.top_right, style);
                for (index, line) in label_lines.iter().enumerate() {
                    let y = top + index as i32 + 1;
                    set(&mut grid, *center, y, BORDER.vertical, Style::Lifeline);
                    text(&mut grid, center + 2, y, line, style);
                    set(&mut grid, *right, y, BORDER.vertical, style);
                }
                for x in center + 1..*right {
                    set(&mut grid, x, *bottom, BORDER.horizontal, style);
                }
                let head_x = if message.head.is_none() { *center } else { center + 1 };
                set(&mut grid, head_x, *bottom, arrow_head(message.head, -1), style);
                set(&mut grid, *right, *bottom, BORDER.bottom_right, style);
            }
            StepPlacement::Message {
                message,
                label_lines,
                label_x,
                label_y,
                arrow_y,
                from_x,
                left,
                right,
                head_x,
                direction,
                inline_label,
            } => {
                let style = if message.dashed { Style::Response } else { Style::Request };
                if inline_label.is_none() {
                    for (index, line) in label_lines.iter().enumerate() {
                        text(&mut grid, *label_x, label_y + index as i32, line, style);
                    }
                }
                for x in left + 1..*right {
                    set(&mut grid, x, *arrow_y, BORDER.horizontal, style);
                }
                departure_fade(&mut grid, *from_x, *arrow_y, *direction, message.dashed);
                set(&mut grid, *head_x, *arrow_y, arrow_head(message.head, *direction), style);
                if let Some(label) = inline_label {
                    text(&mut grid, *label_x, *label_y, label, style);
                }
            }
        }
    }
    for activation in &plan.activations {
        for y in activation.start..=activation.end {
            if grid.cell(activation.center, y).is_some_and(|cell| cell.ch == BORDER.vertical) {
                set(&mut grid, activation.center, y, "┃", Style::Lifeline);
            }
        }
    }
    Ok(grid)
}
