//! Color math shared by the resolver and the V1 migrations: hex parsing like Core's `RGBA.fromHex`, the ANSI
//! palette, and OKLCH conversion (`packages/theme/src/tui/color.ts`).

use opentui::style::Color;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Oklch {
    pub l: f64,
    pub c: f64,
    pub h: f64,
}

/// Whether `value` is a theme hex color: `#` and 3, 4, 6, or 8 hex digits.
pub(crate) fn is_hex(value: &str) -> bool {
    value
        .strip_prefix('#')
        .is_some_and(|digits| matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Core's `RGBA.fromHex`: an optional `#`, 3, 4, 6, or 8 digits; anything else is magenta.
pub(crate) fn from_hex(value: &str) -> Color {
    let digits = value.strip_prefix('#').unwrap_or(value);
    let expanded: String = match digits.len() {
        3 | 4 => digits.chars().flat_map(|c| [c, c]).collect(),
        _ => digits.to_owned(),
    };
    if !matches!(expanded.len(), 6 | 8) || !expanded.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Color::rgba(255, 0, 255, 255);
    }
    let byte = |index: usize| u8::from_str_radix(&expanded[index..index + 2], 16).unwrap_or(0);
    let alpha = if expanded.len() == 8 { byte(6) } else { 255 };
    Color::rgba(byte(0), byte(2), byte(4), alpha)
}

/// `#rrggbb`, with `aa` appended when the color is not opaque.
pub(crate) fn hex(color: Color) -> String {
    hex_ints(color.r, color.g, color.b, color.a)
}

pub(crate) fn hex_ints(r: u8, g: u8, b: u8, a: u8) -> String {
    if a == 255 {
        return format!("#{r:02x}{g:02x}{b:02x}");
    }
    format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
}

/// The xterm 256-color palette as the TUI's V1 themes read numeric colors.
pub(crate) fn ansi(code: f64) -> Color {
    const ANSI16: [&str; 16] = [
        "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0", "#808080", "#ff0000",
        "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    if code < 16.0 {
        // A negative or fractional index reads `undefined` in TypeScript and falls back to black.
        let index = if code >= 0.0 && code.fract() == 0.0 { code as usize } else { 16 };
        return from_hex(ANSI16.get(index).copied().unwrap_or("#000000"));
    }
    if code < 232.0 {
        let index = code - 16.0;
        let level = |part: f64| if part == 0.0 { 0.0 } else { part * 40.0 + 55.0 };
        return from_floats(level((index / 36.0).floor()), level((index / 6.0).floor() % 6.0), level(index % 6.0));
    }
    if code < 256.0 {
        let gray = (code - 232.0) * 10.0 + 8.0;
        return from_floats(gray, gray, gray);
    }
    Color::rgb(0, 0, 0)
}

/// Core's `RGBA.fromInts` for computed channels: rounded and clamped to a byte.
pub(crate) fn from_floats(r: f64, g: f64, b: f64) -> Color {
    Color::rgb(to_byte(r), to_byte(g), to_byte(b))
}

pub(crate) fn to_byte(value: f64) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    round(value.clamp(0.0, 255.0)) as u8
}

/// `Math.round`: halves round up.
pub(crate) fn round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A channel as the 0 to 1 value Core's `RGBA` getters return.
pub(crate) fn unit(channel: u8) -> f64 {
    f64::from(channel) / 255.0
}

/// Perceived brightness on the 0 to 1 scale, as the TUI computes it from `RGBA` channels.
pub(crate) fn luminance(color: Color) -> f64 {
    0.299 * unit(color.r) + 0.587 * unit(color.g) + 0.114 * unit(color.b)
}

pub(crate) fn to_oklch(color: Color) -> Oklch {
    rgb_to_oklch(unit(color.r), unit(color.g), unit(color.b))
}

fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(value: f64) -> f64 {
    if value <= 0.0031308 { value * 12.92 } else { 1.055 * value.powf(1.0 / 2.4) - 0.055 }
}

pub(crate) fn rgb_to_oklch(red: f64, green: f64, blue: f64) -> Oklch {
    let (red, green, blue) = (srgb_to_linear(red), srgb_to_linear(green), srgb_to_linear(blue));
    let l_root = (0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue).cbrt();
    let m_root = (0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue).cbrt();
    let s_root = (0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue).cbrt();
    let l = 0.2104542553 * l_root + 0.793617785 * m_root - 0.0040720468 * s_root;
    let a = 1.9779984951 * l_root - 2.428592205 * m_root + 0.4505937099 * s_root;
    let b = 0.0259040371 * l_root + 0.7827717662 * m_root - 0.808675766 * s_root;
    let angle = b.atan2(a) * (180.0 / std::f64::consts::PI);
    Oklch { l, c: (a * a + b * b).sqrt(), h: if angle < 0.0 { angle + 360.0 } else { angle } }
}

fn oklch_to_rgb(color: Oklch) -> (f64, f64, f64) {
    let a = color.c * (color.h * std::f64::consts::PI / 180.0).cos();
    let b = color.c * (color.h * std::f64::consts::PI / 180.0).sin();
    let l_root = color.l + 0.3963377774 * a + 0.2158037573 * b;
    let m_root = color.l - 0.1055613458 * a - 0.0638541728 * b;
    let s_root = color.l - 0.0894841775 * a - 1.291485548 * b;
    let (l, m, s) = (l_root * l_root * l_root, m_root * m_root * m_root, s_root * s_root * s_root);
    (
        linear_to_srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linear_to_srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linear_to_srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    )
}

fn in_gamut((r, g, b): (f64, f64, f64)) -> bool {
    (0.0..=1.0).contains(&r) && (0.0..=1.0).contains(&g) && (0.0..=1.0).contains(&b)
}

/// Reduces chroma until the color fits in sRGB, as `fitOklch` does.
fn fit(color: Oklch) -> Oklch {
    let base = Oklch { l: color.l.clamp(0.0, 1.0), c: color.c.max(0.0), h: ((color.h % 360.0) + 360.0) % 360.0 };
    if in_gamut(oklch_to_rgb(base)) {
        return base;
    }
    (1..=24)
        .map(|index| Oklch { c: base.c * 0.9f64.powf(f64::from(index)), ..base })
        .find(|next| in_gamut(oklch_to_rgb(*next)))
        .unwrap_or(Oklch { c: 0.0, ..base })
}

/// `oklchToHex`: always six digits.
pub(crate) fn oklch_to_hex(color: Oklch) -> String {
    let (r, g, b) = oklch_to_rgb(fit(color));
    let byte = |value: f64| round(value.clamp(0.0, 1.0) * 255.0) as u8;
    hex_ints(byte(r), byte(g), byte(b), 255)
}

/// Mixes `overlay` into `base` by `alpha`, as the TUI's `tint` does.
pub fn tint(base: Color, overlay: Color, alpha: f64) -> Color {
    let mix = |from: u8, to: u8| (unit(from) + (unit(to) - unit(from)) * alpha) * 255.0;
    from_floats(mix(base.r, overlay.r), mix(base.g, overlay.g), mix(base.b, overlay.b))
}
