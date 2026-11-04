//! Easing curves shared by the sweeps, from `packages/tui/src/component/tab-pulse.tsx`. All math is `f64`, as in
//! JavaScript, so values match the TypeScript ones bit for bit before they are narrowed to a cell mask's `f32`.

pub fn clamp(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub fn smootherstep(value: f64) -> f64 {
    value * value * value * (value * (value * 6.0 - 15.0) + 10.0)
}

/// The brightness at `index` of a sweep whose front is at `front`: it rises over `head` cells ahead of the front
/// and decays over `tail` cells behind it.
pub fn intensity_at(index: f64, front: f64, head: f64, tail: f64) -> f64 {
    let distance = front - index;
    if distance < 0.0 {
        return smootherstep(clamp(1.0 + distance / head));
    }
    smootherstep(clamp(1.0 - distance / tail))
}

/// Progress through a sweep that accelerates over its first fifth, coasts, and settles over its last fifth.
pub fn coast(value: f64) -> f64 {
    let ramp = 0.2;
    if value < ramp {
        return (value * value) / (2.0 * ramp * (1.0 - ramp));
    }
    if value > 1.0 - ramp {
        return 1.0 - ((1.0 - value) * (1.0 - value)) / (2.0 * ramp * (1.0 - ramp));
    }
    (value - ramp / 2.0) / (1.0 - ramp)
}
