//! Grid geometry (`core/geometry.ts`).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

pub const fn point(x: i32, y: i32) -> Point {
    Point { x, y }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Axis {
    X,
    Y,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub center_x: i32,
    pub center_y: i32,
}

impl Bounds {
    pub fn rect(left: i32, top: i32, width: i32, height: i32) -> Self {
        Self {
            left,
            top,
            width,
            height,
            center_x: left + width.div_euclid(2),
            center_y: top + height.div_euclid(2),
        }
    }

    pub fn translate(&mut self, dx: i32, dy: i32) {
        self.left += dx;
        self.top += dy;
        self.center_x += dx;
        self.center_y += dy;
    }

    pub fn right(&self) -> i32 {
        self.left + self.width
    }

    pub fn bottom(&self) -> i32 {
        self.top + self.height
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub from: Point,
    pub to: Point,
    pub axis: Axis,
    pub direction: Direction,
    pub length: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lane {
    pub axis: Axis,
    pub coordinate: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: i32,
    pub end: i32,
}

pub fn bounds_from_bounds(bounds: &[Bounds]) -> Option<Bounds> {
    if bounds.is_empty() {
        return None;
    }
    let left = bounds.iter().map(|b| b.left).min()?;
    let top = bounds.iter().map(|b| b.top).min()?;
    let right = bounds.iter().map(|b| b.left + b.width).max()?;
    let bottom = bounds.iter().map(|b| b.top + b.height).max()?;
    Some(Bounds::rect(left, top, right - left, bottom - top))
}

pub fn bounds_from_points(points: &[Point]) -> Option<Bounds> {
    if points.is_empty() {
        return None;
    }
    let left = points.iter().map(|p| p.x).min()?;
    let top = points.iter().map(|p| p.y).min()?;
    let right = points.iter().map(|p| p.x).max()?;
    let bottom = points.iter().map(|p| p.y).max()?;
    Some(Bounds::rect(left, top, right - left + 1, bottom - top + 1))
}

pub fn coordinate(point: Point, axis: Axis) -> i32 {
    match axis {
        Axis::X => point.x,
        Axis::Y => point.y,
    }
}

pub fn with_coordinate(point: Point, axis: Axis, value: i32) -> Point {
    match axis {
        Axis::X => Point { x: value, y: point.y },
        Axis::Y => Point { x: point.x, y: value },
    }
}

pub fn shift_point(point: Point, direction: Direction, distance: i32) -> Point {
    match direction {
        Direction::Left => Point { x: point.x - distance, y: point.y },
        Direction::Right => Point { x: point.x + distance, y: point.y },
        Direction::Up => Point { x: point.x, y: point.y - distance },
        Direction::Down => Point { x: point.x, y: point.y + distance },
    }
}

pub fn clamp_point(point: Point) -> Point {
    Point { x: point.x.max(0), y: point.y.max(0) }
}

pub fn direction_axis(direction: Direction) -> Axis {
    match direction {
        Direction::Left | Direction::Right => Axis::X,
        Direction::Up | Direction::Down => Axis::Y,
    }
}

pub fn direction_sign(direction: Direction) -> i32 {
    match direction {
        Direction::Left | Direction::Up => -1,
        Direction::Right | Direction::Down => 1,
    }
}

pub fn side_for_direction(direction: Direction) -> Side {
    match direction {
        Direction::Left => Side::Left,
        Direction::Right => Side::Right,
        Direction::Up => Side::Top,
        Direction::Down => Side::Bottom,
    }
}

pub fn opposite_side(side: Side) -> Side {
    match side {
        Side::Left => Side::Right,
        Side::Right => Side::Left,
        Side::Top => Side::Bottom,
        Side::Bottom => Side::Top,
    }
}

pub fn direction_between(from: Point, to: Point) -> Option<Direction> {
    if from.y == to.y {
        if to.x > from.x {
            return Some(Direction::Right);
        }
        if to.x < from.x {
            return Some(Direction::Left);
        }
    }
    if from.x == to.x {
        if to.y > from.y {
            return Some(Direction::Down);
        }
        if to.y < from.y {
            return Some(Direction::Up);
        }
    }
    None
}

pub fn bounds_center(bounds: &Bounds) -> Point {
    point(bounds.center_x, bounds.center_y)
}

/// The point on `side` just outside the bounds (`surface: "outside"`).
pub fn bounds_side_point(bounds: &Bounds, side: Side) -> Point {
    match side {
        Side::Left => point(bounds.left - 1, bounds.center_y),
        Side::Right => point(bounds.left + bounds.width, bounds.center_y),
        Side::Top => point(bounds.center_x, bounds.top - 1),
        Side::Bottom => point(bounds.center_x, bounds.top + bounds.height),
    }
}

/// The point on `side` on the border (`surface: "border"`).
pub fn bounds_border_point(bounds: &Bounds, side: Side) -> Point {
    match side {
        Side::Left => point(bounds.left, bounds.center_y),
        Side::Right => point(bounds.left + bounds.width - 1, bounds.center_y),
        Side::Top => point(bounds.center_x, bounds.top),
        Side::Bottom => point(bounds.center_x, bounds.top + bounds.height - 1),
    }
}

pub fn center_coordinate(bounds: &Bounds, axis: Axis) -> i32 {
    match axis {
        Axis::X => bounds.center_x,
        Axis::Y => bounds.center_y,
    }
}

pub fn snap_coordinate(source: i32, target: i32, tolerance: i32) -> i32 {
    if (source - target).abs() <= tolerance { target } else { source }
}

pub fn path_through(points: &[Point]) -> Vec<Point> {
    let mut path: Vec<Point> = Vec::with_capacity(points.len());
    for &next in points {
        if path.last() != Some(&next) {
            path.push(next);
        }
    }
    path
}

pub fn lane(axis: Axis, coordinate: i32) -> Lane {
    Lane { axis, coordinate }
}

pub fn path_via_lane(start: Point, lane: Lane, end: Point) -> Vec<Point> {
    path_through(&[
        start,
        with_coordinate(start, lane.axis, lane.coordinate),
        with_coordinate(end, lane.axis, lane.coordinate),
        end,
    ])
}

fn dominant_axis(start: Point, end: Point) -> Axis {
    if (end.x - start.x).abs() >= (end.y - start.y).abs() { Axis::X } else { Axis::Y }
}

fn terminal_lane(start: Point, end: Point, axis: Axis, clearance: i32) -> i32 {
    let start = coordinate(start, axis);
    let end = coordinate(end, axis);
    let delta = end - start;
    let sign = delta.signum();
    if sign == 0 {
        return end;
    }
    end - sign * clearance.min(1.max(delta.abs() - 1))
}

pub fn orthogonal_path(start: Point, end: Point, preferred_axis: Option<Axis>) -> Vec<Point> {
    if start.x == end.x || start.y == end.y {
        return path_through(&[start, end]);
    }
    let axis = preferred_axis.unwrap_or_else(|| dominant_axis(start, end));
    path_via_lane(start, lane(axis, terminal_lane(start, end, axis, 4)), end)
}

pub fn segment_between(from: Point, to: Point) -> Option<Segment> {
    let direction = direction_between(from, to)?;
    let axis = direction_axis(direction);
    Some(Segment {
        from,
        to,
        axis,
        direction,
        length: (coordinate(to, axis) - coordinate(from, axis)).abs(),
    })
}

/// Visits the cells from `from` toward `to`, `to` excluded; `visit` returns false to stop.
pub fn walk_orthogonal_segment(
    from: Point,
    to: Point,
    include_start: bool,
    mut visit: impl FnMut(Point) -> bool,
) {
    let Some(direction) = direction_between(from, to) else {
        return;
    };
    let (dx, dy) = step(direction);
    let mut cursor = if include_start { from } else { point(from.x + dx, from.y + dy) };
    while cursor != to {
        if !visit(cursor) {
            return;
        }
        cursor = point(cursor.x + dx, cursor.y + dy);
    }
}

fn step(direction: Direction) -> (i32, i32) {
    match direction {
        Direction::Right => (1, 0),
        Direction::Left => (-1, 0),
        Direction::Down => (0, 1),
        Direction::Up => (0, -1),
    }
}

pub fn orthogonal_path_points(points: &[Point]) -> Vec<Point> {
    let mut path: Vec<Point> = Vec::new();
    for pair in points.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        let Some(direction) = direction_between(from, to) else {
            continue;
        };
        let (dx, dy) = step(direction);
        let mut cursor = if path.is_empty() { from } else { point(from.x + dx, from.y + dy) };
        loop {
            path.push(cursor);
            if cursor == to {
                break;
            }
            cursor = point(cursor.x + dx, cursor.y + dy);
        }
    }
    path
}

pub fn ordered_span(left: i32, right: i32) -> Span {
    if left <= right { Span { start: left, end: right } } else { Span { start: right, end: left } }
}

pub fn segment_span(segment: &Segment) -> Span {
    ordered_span(coordinate(segment.from, segment.axis), coordinate(segment.to, segment.axis))
}

pub fn point_on_segment(segment: &Segment, value: i32) -> Point {
    with_coordinate(segment.from, segment.axis, value)
}

pub fn inset_span(span: Span, amount: i32) -> Span {
    Span { start: span.start + amount, end: span.end - amount }
}

pub fn span_capacity(span: Span) -> i32 {
    0.max(span.end - span.start + 1)
}

pub fn centered_span_start(span: Span, width: i32) -> i32 {
    span.start + (span_capacity(span) - width).div_euclid(2)
}

/// `Math.round((start + end) / 2)`.
pub fn midpoint(span: Span) -> i32 {
    js_round(f64::from(span.start + span.end) / 2.0)
}

/// JavaScript's `Math.round`: halves round toward positive infinity.
pub fn js_round(value: f64) -> i32 {
    (value + 0.5).floor() as i32
}

pub fn advance_coordinate(origin: i32, direction: Direction, distance: i32) -> i32 {
    origin + direction_sign(direction) * distance
}

pub fn before_nearest_coordinate(points: &[Point], axis: Axis, direction: Direction, clearance: i32) -> i32 {
    let coordinates = points.iter().map(|&p| coordinate(p, axis));
    let nearest = if direction_sign(direction) > 0 {
        coordinates.min().unwrap_or(i32::MAX)
    } else {
        coordinates.max().unwrap_or(i32::MIN)
    };
    advance_coordinate(nearest, direction, -clearance)
}

pub fn after_farthest_coordinate(points: &[Point], axis: Axis, direction: Direction, clearance: i32) -> i32 {
    let coordinates = points.iter().map(|&p| coordinate(p, axis));
    let farthest = if direction_sign(direction) > 0 {
        coordinates.max().unwrap_or(i32::MIN)
    } else {
        coordinates.min().unwrap_or(i32::MAX)
    };
    advance_coordinate(farthest, direction, clearance)
}

pub fn keep_before(preferred: i32, boundary: i32, direction: Direction) -> i32 {
    if direction_sign(direction) > 0 { preferred.min(boundary) } else { preferred.max(boundary) }
}

pub fn keep_after(preferred: i32, boundary: i32, direction: Direction) -> i32 {
    if direction_sign(direction) > 0 { preferred.max(boundary) } else { preferred.min(boundary) }
}
