//! Color blending (`core/color/style.ts`). OpenTUI stores colors as bytes and rounds as `Math.round` does.

use opentui::prelude::Color;

pub fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::rgba(r, g, b, 255)
}

fn byte(value: f64) -> u8 {
    (value.clamp(0.0, 255.0) + 0.5).floor() as u8
}

pub fn blend(from: Color, to: Color, amount: f64) -> Color {
    let mix =
        |left: u8, right: u8| byte(f64::from(left) + (f64::from(right) - f64::from(left)) * amount);
    Color::rgba(
        mix(from.r, to.r),
        mix(from.g, to.g),
        mix(from.b, to.b),
        mix(from.a, to.a),
    )
}

/// `count` colors from `from` toward `to`, without either end (`createColorRampTheme`).
pub fn ramp(count: usize, from: Color, to: Color) -> Vec<Color> {
    (0..count)
        .map(|index| blend(from, to, (index + 1) as f64 / (count + 1) as f64))
        .collect()
}

/// `RGBA.fromValues(r, g, b, alpha)` for a color's channels and a 0..1 alpha.
pub fn with_alpha(color: Color, alpha: f64) -> Color {
    Color::rgba(color.r, color.g, color.b, byte(alpha * 255.0))
}
