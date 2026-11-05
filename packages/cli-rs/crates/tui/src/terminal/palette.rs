//! The terminal's colors from the theme: `terminalPalette` (`component/terminal-pane.tsx:322-377`). The 16 ANSI
//! colors (OSC 4) and the default foreground and background (OSC 10 and 11), written into the terminal after every
//! checkpoint, since a reset clears them.

use opencode_ui::theme::{Theme, ThemeMode};
use opentui::style::Color;

pub fn osc(theme: &Theme, mode: ThemeMode, background: Color) -> Vec<u8> {
    let dark = mode == ThemeMode::Dark;
    let neutral = theme.neutral();
    let black = &neutral.0[if dark { 7 } else { 1 }];
    let white = &neutral.0[if dark { 1 } else { 7 }];
    let bright_white = &neutral.0[if dark { 0 } else { 8 }];
    let feedback = &theme.text.feedback;
    let normal = [
        &feedback.error.base,
        &feedback.success.base,
        &feedback.warning.base,
        terminal_hue(theme, hue(0.0, 0.0, 1.0)),
        terminal_hue(theme, hue(1.0, 0.0, 1.0)),
        &feedback.info.base,
        white,
    ];
    // `decrease` finds a color's hue step by reference, so the colors stay references into the theme.
    let colors = std::iter::once(*black)
        .chain(normal.iter().map(|color| **color))
        .chain([theme.text.muted])
        .chain(normal[..6].iter().map(|color| theme.decrease(color, 1)))
        .chain([*bright_white]);
    let mut text: String =
        colors.enumerate().map(|(index, color)| format!("\x1b]4;{index};{}\x1b\\", hex(color))).collect();
    text.push_str(&format!("\x1b]10;{}\x1b\\", hex(theme.text.base)));
    text.push_str(&format!("\x1b]11;{}\x1b\\", hex(background)));
    text.into_bytes()
}

/// The step-200 color of the hue nearest `target` degrees, among hues with some chroma; the accent's when none is
/// within 30 degrees.
fn terminal_hue(theme: &Theme, target: f64) -> &Color {
    let nearest = theme
        .hues()
        .iter()
        .map(|(_, scale)| {
            let color = &scale.0[1];
            let (chroma, angle) = oklch(*color);
            (color, chroma, distance(angle, target))
        })
        .filter(|(color, chroma, _)| color.a > 0 && *chroma >= 0.03)
        // `Array.sort` is stable; so is `min_by` on the first of equal elements.
        .min_by(|first, second| first.2.total_cmp(&second.2));
    match nearest {
        Some((color, _, distance)) if distance <= 30.0 => color,
        _ => &theme.accent().0[1],
    }
}

fn distance(first: f64, second: f64) -> f64 {
    let difference = (first - second).abs();
    difference.min(360.0 - difference)
}

fn hex(color: Color) -> String {
    format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)
}

fn hue(red: f64, green: f64, blue: f64) -> f64 {
    oklch_of(red, green, blue).1
}

fn oklch(color: Color) -> (f64, f64) {
    let unit = |channel: u8| f64::from(channel) / 255.0;
    oklch_of(unit(color.r), unit(color.g), unit(color.b))
}

/// Chroma and hue of an sRGB color, as `rgbToOklch` computes them. `opencode-ui` keeps its copy crate-private.
fn oklch_of(red: f64, green: f64, blue: f64) -> (f64, f64) {
    let linear = |value: f64| {
        if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    let (red, green, blue) = (linear(red), linear(green), linear(blue));
    let l = (0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue).cbrt();
    let m = (0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue).cbrt();
    let s = (0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue).cbrt();
    let a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    let b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    let angle = b.atan2(a).to_degrees();
    ((a * a + b * b).sqrt(), if angle < 0.0 { angle + 360.0 } else { angle })
}
