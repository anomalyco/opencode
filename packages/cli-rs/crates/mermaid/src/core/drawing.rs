//! Box-drawing helpers (`core/drawing.ts`), with OpenTUI's `BorderChars`.

use super::geometry::{Bounds, Direction, Point, direction_between, walk_orthogonal_segment};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BorderChars {
    pub top_left: &'static str,
    pub top_right: &'static str,
    pub bottom_left: &'static str,
    pub bottom_right: &'static str,
    pub horizontal: &'static str,
    pub vertical: &'static str,
    pub top_t: &'static str,
    pub bottom_t: &'static str,
    pub left_t: &'static str,
    pub right_t: &'static str,
    pub cross: &'static str,
}

pub const SINGLE: BorderChars = BorderChars {
    top_left: "┌",
    top_right: "┐",
    bottom_left: "└",
    bottom_right: "┘",
    horizontal: "─",
    vertical: "│",
    top_t: "┬",
    bottom_t: "┴",
    left_t: "├",
    right_t: "┤",
    cross: "┼",
};

pub const DOUBLE: BorderChars = BorderChars {
    top_left: "╔",
    top_right: "╗",
    bottom_left: "╚",
    bottom_right: "╝",
    horizontal: "═",
    vertical: "║",
    top_t: "╦",
    bottom_t: "╩",
    left_t: "╠",
    right_t: "╣",
    cross: "╬",
};

pub const ROUNDED: BorderChars = BorderChars {
    top_left: "╭",
    top_right: "╮",
    bottom_left: "╰",
    bottom_right: "╯",
    ..SINGLE
};

pub const HEAVY: BorderChars = BorderChars {
    top_left: "┏",
    top_right: "┓",
    bottom_left: "┗",
    bottom_right: "┛",
    horizontal: "━",
    vertical: "┃",
    top_t: "┳",
    bottom_t: "┻",
    left_t: "┣",
    right_t: "┫",
    cross: "╋",
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CornerStyle {
    Square,
    Rounded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineStyle {
    Single,
    Heavy,
    Dashed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrowHeadStyle {
    Filled,
    Line,
}

pub const ARROW_HEADS: [&str; 8] = ["▶", "◀", "▼", "▲", "→", "←", "↓", "↑"];

pub fn is_arrow_head(ch: &str) -> bool {
    ARROW_HEADS.contains(&ch)
}

fn is_heavy(ch: &str) -> bool {
    [
        HEAVY.top_left,
        HEAVY.top_right,
        HEAVY.bottom_left,
        HEAVY.bottom_right,
        HEAVY.horizontal,
        HEAVY.vertical,
        HEAVY.top_t,
        HEAVY.bottom_t,
        HEAVY.left_t,
        HEAVY.right_t,
        HEAVY.cross,
    ]
    .contains(&ch)
}

pub struct DiamondChars {
    pub top_left: &'static str,
    pub top_right: &'static str,
    pub upper_left: &'static str,
    pub upper_left_join: &'static str,
    pub upper_right_join: &'static str,
    pub upper_right: &'static str,
    pub vertical: &'static str,
    pub lower_left: &'static str,
    pub lower_left_join: &'static str,
    pub lower_right_join: &'static str,
    pub lower_right: &'static str,
    pub bottom_left: &'static str,
    pub bottom_right: &'static str,
    pub horizontal: &'static str,
}

pub fn diamond_chars(chars: &BorderChars) -> DiamondChars {
    DiamondChars {
        top_left: chars.top_left,
        top_right: chars.top_right,
        upper_left: chars.top_left,
        upper_left_join: chars.bottom_right,
        upper_right_join: chars.bottom_left,
        upper_right: chars.top_right,
        vertical: chars.vertical,
        lower_left: chars.bottom_left,
        lower_left_join: chars.top_right,
        lower_right_join: chars.top_left,
        lower_right: chars.bottom_right,
        bottom_left: chars.bottom_left,
        bottom_right: chars.bottom_right,
        horizontal: chars.horizontal,
    }
}

/// The directions a line glyph connects; `None` for other characters.
fn line_directions(ch: &str) -> Option<&'static [Direction]> {
    use Direction::*;
    Some(match ch {
        "─" | "━" => &[Left, Right],
        "│" | "┃" => &[Up, Down],
        "┌" | "╭" | "┏" => &[Right, Down],
        "┐" | "╮" | "┓" => &[Left, Down],
        "└" | "╰" | "┗" => &[Up, Right],
        "┘" | "╯" | "┛" => &[Up, Left],
        "├" | "┣" => &[Up, Down, Right],
        "┤" | "┫" => &[Up, Down, Left],
        "┬" | "┳" => &[Left, Right, Down],
        "┴" | "┻" => &[Left, Right, Up],
        "┼" | "╋" => &[Up, Down, Left, Right],
        _ => return None,
    })
}

/// A set of directions as four flags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Directions {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
}

impl Directions {
    pub fn of(directions: &[Direction]) -> Self {
        let mut set = Self::default();
        for &direction in directions {
            set.add(direction);
        }
        set
    }

    pub fn add(&mut self, direction: Direction) {
        match direction {
            Direction::Up => self.up = true,
            Direction::Down => self.down = true,
            Direction::Left => self.left = true,
            Direction::Right => self.right = true,
        }
    }
}

pub fn line_glyph(directions: Directions, corner: CornerStyle, line: LineStyle) -> &'static str {
    let Directions {
        up,
        down,
        left,
        right,
    } = directions;
    if line == LineStyle::Heavy {
        let chars = HEAVY;
        return if up && down && left && right {
            chars.cross
        } else if up && down && right {
            chars.left_t
        } else if up && down && left {
            chars.right_t
        } else if left && right && down {
            chars.top_t
        } else if left && right && up {
            chars.bottom_t
        } else if up && right {
            chars.bottom_left
        } else if up && left {
            chars.bottom_right
        } else if down && right {
            chars.top_left
        } else if down && left {
            chars.top_right
        } else if up || down {
            chars.vertical
        } else {
            chars.horizontal
        };
    }
    let rounded = corner == CornerStyle::Rounded;
    if up && down && left && right {
        "┼"
    } else if up && down && right {
        "├"
    } else if up && down && left {
        "┤"
    } else if left && right && down {
        "┬"
    } else if left && right && up {
        "┴"
    } else if up && right {
        if rounded { "╰" } else { "└" }
    } else if up && left {
        if rounded { "╯" } else { "┘" }
    } else if down && right {
        if rounded { "╭" } else { "┌" }
    } else if down && left {
        if rounded { "╮" } else { "┐" }
    } else if up || down {
        "│"
    } else {
        "─"
    }
}

fn segment_glyph(direction: Direction, line: LineStyle) -> &'static str {
    let directions = match direction {
        Direction::Left | Direction::Right => Directions {
            left: true,
            right: true,
            ..Default::default()
        },
        _ => Directions {
            up: true,
            down: true,
            ..Default::default()
        },
    };
    line_glyph(
        directions,
        CornerStyle::Square,
        if line == LineStyle::Heavy {
            LineStyle::Heavy
        } else {
            LineStyle::Single
        },
    )
}

pub fn merge_line_glyph(
    existing: &str,
    incoming: &str,
    corner: CornerStyle,
) -> Option<&'static str> {
    let mut directions = Directions::of(line_directions(existing)?);
    for &direction in line_directions(incoming)? {
        directions.add(direction);
    }
    let heavy = is_heavy(existing) && is_heavy(incoming);
    Some(line_glyph(
        directions,
        corner,
        if heavy {
            LineStyle::Heavy
        } else {
            LineStyle::Single
        },
    ))
}

pub fn arrow_head(direction: Direction, style: ArrowHeadStyle) -> &'static str {
    match (style, direction) {
        (ArrowHeadStyle::Line, Direction::Right) => "→",
        (ArrowHeadStyle::Line, Direction::Left) => "←",
        (ArrowHeadStyle::Line, Direction::Up) => "↑",
        (ArrowHeadStyle::Line, Direction::Down) => "↓",
        (ArrowHeadStyle::Filled, Direction::Right) => "▶",
        (ArrowHeadStyle::Filled, Direction::Left) => "◀",
        (ArrowHeadStyle::Filled, Direction::Up) => "▲",
        (ArrowHeadStyle::Filled, Direction::Down) => "▼",
    }
}

pub fn arrow_head_between(from: Point, to: Point, style: ArrowHeadStyle) -> &'static str {
    arrow_head(
        direction_between(from, to).unwrap_or(Direction::Right),
        style,
    )
}

pub fn draw_frame(
    bounds: &Bounds,
    chars: &BorderChars,
    mut set: impl FnMut(i32, i32, &'static str),
) {
    let right = bounds.left + bounds.width - 1;
    let bottom = bounds.top + bounds.height - 1;
    set(bounds.left, bounds.top, chars.top_left);
    set(right, bounds.top, chars.top_right);
    set(bounds.left, bottom, chars.bottom_left);
    set(right, bottom, chars.bottom_right);
    for x in bounds.left + 1..right {
        set(x, bounds.top, chars.horizontal);
        set(x, bottom, chars.horizontal);
    }
    for y in bounds.top + 1..bottom {
        set(bounds.left, y, chars.vertical);
        set(right, y, chars.vertical);
    }
}

pub fn fill_frame_interior(bounds: &Bounds, mut set: impl FnMut(i32, i32)) {
    for y in bounds.top + 1..bounds.top + bounds.height - 1 {
        for x in bounds.left + 1..bounds.left + bounds.width - 1 {
            set(x, y);
        }
    }
}

pub fn draw_diamond(
    bounds: &Bounds,
    chars: &DiamondChars,
    mut set: impl FnMut(i32, i32, &'static str),
) {
    let left = bounds.left;
    let right = bounds.left + bounds.width - 1;
    let top = bounds.top;
    let bottom = bounds.top + bounds.height - 1;
    let cap_inset = 2.min(1.max((bounds.width - 1).div_euclid(2)));
    let cap_left = left + cap_inset;
    let cap_right = right - cap_inset;

    set(cap_left, top, chars.top_left);
    for x in cap_left + 1..cap_right {
        set(x, top, chars.horizontal);
    }
    set(cap_right, top, chars.top_right);

    set(left, top + 1, chars.upper_left);
    for x in left + 1..cap_left {
        set(x, top + 1, chars.horizontal);
    }
    set(cap_left, top + 1, chars.upper_left_join);
    set(cap_right, top + 1, chars.upper_right_join);
    for x in cap_right + 1..right {
        set(x, top + 1, chars.horizontal);
    }
    set(right, top + 1, chars.upper_right);

    for y in top + 2..bottom - 1 {
        set(left, y, chars.vertical);
        set(right, y, chars.vertical);
    }

    set(left, bottom - 1, chars.lower_left);
    for x in left + 1..cap_left {
        set(x, bottom - 1, chars.horizontal);
    }
    set(cap_left, bottom - 1, chars.lower_left_join);
    set(cap_right, bottom - 1, chars.lower_right_join);
    for x in cap_right + 1..right {
        set(x, bottom - 1, chars.horizontal);
    }
    set(right, bottom - 1, chars.lower_right);

    set(cap_left, bottom, chars.bottom_left);
    for x in cap_left + 1..cap_right {
        set(x, bottom, chars.horizontal);
    }
    set(cap_right, bottom, chars.bottom_right);
}

pub fn draw_orthogonal_path(
    points: &[Point],
    corner: CornerStyle,
    line: LineStyle,
    mut set: impl FnMut(i32, i32, &'static str),
) {
    for index in 1..points.len() {
        let (from, to) = (points[index - 1], points[index]);
        let Some(direction) = direction_between(from, to) else {
            continue;
        };
        let glyph = segment_glyph(direction, line);
        let mut step = if index == 1 { 0 } else { 1 };
        walk_orthogonal_segment(from, to, index == 1, |point| {
            if line != LineStyle::Dashed || step % 2 == 0 {
                set(point.x, point.y, glyph);
            }
            step += 1;
            true
        });
    }
    let corner_line = if line == LineStyle::Heavy {
        LineStyle::Heavy
    } else {
        LineStyle::Single
    };
    for index in 1..points.len().saturating_sub(1) {
        let (previous, current, next) = (points[index - 1], points[index], points[index + 1]);
        let mut directions = Directions::default();
        if let Some(direction) = direction_between(current, previous) {
            directions.add(direction);
        }
        if let Some(direction) = direction_between(current, next) {
            directions.add(direction);
        }
        set(
            current.x,
            current.y,
            line_glyph(directions, corner, corner_line),
        );
    }
}
