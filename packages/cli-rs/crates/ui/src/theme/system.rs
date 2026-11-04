//! The `system` theme, generated from the terminal's palette (`packages/tui/src/theme/system.ts`).

use opentui::style::Color;
use opentui::theme::ThemeMode;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::color::{ansi, from_floats, from_hex, hex, tint, unit};

/// The colors a terminal reports, in the shape Core's `TerminalColors` has and the `system-theme` storage key keeps.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalColors {
    #[serde(default)]
    pub palette: Vec<Option<String>>,
    #[serde(default)]
    pub default_foreground: Option<String>,
    #[serde(default)]
    pub default_background: Option<String>,
    /// The other colors Core reports (cursor, mouse, and others), kept so a round trip loses nothing.
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

impl TerminalColors {
    /// The colors opentui reports, with hex strings as Core writes them.
    pub fn from_palette(palette: &opentui::term::TerminalPalette) -> Self {
        let text =
            |color: Option<Color>| color.map(|color| hex(Color::rgb(color.r, color.g, color.b)));
        let mut other = Map::new();
        other.insert("cursorColor".to_owned(), json!(text(palette.cursor)));
        Self {
            palette: palette.colors.iter().map(|color| text(*color)).collect(),
            default_foreground: text(palette.foreground),
            default_background: text(palette.background),
            other,
        }
    }

    /// Whether a theme can be generated: a background and a foreground, from the defaults or palette slots 0 and 7.
    pub fn usable(&self) -> bool {
        self.background().is_some() && self.foreground().is_some()
    }

    // `defaultBackground ?? palette[0]`: an empty default does not fall back, and makes the palette unusable.
    fn background(&self) -> Option<&str> {
        self.default_or(self.default_background.as_deref(), 0)
    }

    fn foreground(&self) -> Option<&str> {
        self.default_or(self.default_foreground.as_deref(), 7)
    }

    fn default_or<'a>(&'a self, default: Option<&'a str>, index: usize) -> Option<&'a str> {
        default
            .or_else(|| self.palette.get(index).and_then(Option::as_deref))
            .filter(|hex| !hex.is_empty())
    }

    fn slot(&self, index: usize) -> Option<&str> {
        self.palette
            .get(index)
            .and_then(Option::as_deref)
            .filter(|hex| !hex.is_empty())
    }
}

/// `terminalMode`: light when the default background is bright.
pub fn terminal_mode(colors: &TerminalColors) -> Option<ThemeMode> {
    let background = from_hex(
        colors
            .default_background
            .as_deref()
            .filter(|hex| !hex.is_empty())?,
    );
    let brightness =
        0.299 * unit(background.r) + 0.587 * unit(background.g) + 0.114 * unit(background.b);
    Some(if brightness > 0.5 {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    })
}

/// `generateSystem`: a V1 theme built from the palette for `mode`.
pub fn generate_system(colors: &TerminalColors, mode: ThemeMode) -> Value {
    let background = from_hex(colors.background().unwrap_or_default());
    let foreground = from_hex(colors.foreground().unwrap_or_default());
    let transparent = Color::rgba(background.r, background.g, background.b, 0);
    let dark = mode == ThemeMode::Dark;
    let slot = |index: usize| {
        colors
            .slot(index)
            .map_or_else(|| ansi(index as f64), from_hex)
    };
    let grays = gray_scale(background, dark);
    let muted = muted_text(background, dark);
    let (red, green, yellow, blue, magenta, cyan) =
        (slot(1), slot(2), slot(3), slot(4), slot(5), slot(6));
    let (red_bright, green_bright) = (slot(9), slot(10));
    let alpha = if dark { 0.22 } else { 0.14 };
    let context = grays[2];
    let c = |color: Color| json!(hex(color));
    // Two halves keep `json!` under the default recursion limit.
    let mut theme = json!({
            "primary": c(cyan),
            "secondary": c(magenta),
            "accent": c(cyan),
            "error": c(red),
            "warning": c(yellow),
            "success": c(green),
            "info": c(cyan),
            "text": c(foreground),
            "textMuted": c(muted),
            "selectedListItemText": c(background),
            "background": c(transparent),
            "backgroundPanel": c(grays[2]),
            "backgroundElement": c(grays[3]),
            "backgroundMenu": c(grays[3]),
            "borderSubtle": c(grays[6]),
            "border": c(grays[7]),
            "borderActive": c(grays[8]),
            "diffAdded": c(green),
            "diffRemoved": c(red),
            "diffContext": c(grays[7]),
            "diffHunkHeader": c(grays[7]),
            "diffHighlightAdded": c(green_bright),
            "diffHighlightRemoved": c(red_bright),
            "diffAddedBg": c(tint(background, green, alpha)),
            "diffRemovedBg": c(tint(background, red, alpha)),
            "diffContextBg": c(context),
            "diffLineNumber": c(muted),
            "diffAddedLineNumberBg": c(tint(context, green, alpha)),
            "diffRemovedLineNumberBg": c(tint(context, red, alpha)),
    });
    let rest = json!({
            "markdownText": c(foreground),
            "markdownHeading": c(foreground),
            "markdownLink": c(blue),
            "markdownLinkText": c(cyan),
            "markdownCode": c(green),
            "markdownBlockQuote": c(yellow),
            "markdownEmph": c(yellow),
            "markdownStrong": c(foreground),
            "markdownHorizontalRule": c(grays[7]),
            "markdownListItem": c(blue),
            "markdownListEnumeration": c(cyan),
            "markdownImage": c(blue),
            "markdownImageText": c(cyan),
            "markdownCodeBlock": c(foreground),
            "syntaxComment": c(muted),
            "syntaxKeyword": c(magenta),
            "syntaxFunction": c(blue),
            "syntaxVariable": c(foreground),
            "syntaxString": c(green),
            "syntaxNumber": c(yellow),
            "syntaxType": c(cyan),
            "syntaxOperator": c(cyan),
            "syntaxPunctuation": c(foreground),
    });
    if let (Value::Object(theme), Value::Object(rest)) = (&mut theme, rest) {
        theme.extend(rest);
    }
    json!({ "theme": theme })
}

/// Twelve grays stepping away from the background; index 0 is unused, as in TypeScript.
fn gray_scale(background: Color, dark: bool) -> [Color; 13] {
    // Channels as TypeScript computes them, `bg.r * 255`, which is not always the exact byte.
    let (r, g, b) = (
        unit(background.r) * 255.0,
        unit(background.g) * 255.0,
        unit(background.b) * 255.0,
    );
    let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    let mut grays = [Color::TRANSPARENT; 13];
    for (i, gray) in grays.iter_mut().enumerate().skip(1) {
        let factor = i as f64 / 12.0;
        if dark && luminance < 10.0 {
            let value = (factor * 0.4 * 255.0).floor();
            *gray = from_floats(value, value, value);
            continue;
        }
        if !dark && luminance > 245.0 {
            let value = (255.0 - factor * 0.4 * 255.0).floor();
            *gray = from_floats(value, value, value);
            continue;
        }
        let next = if dark {
            luminance + (255.0 - luminance) * factor * 0.4
        } else {
            luminance * (1.0 - factor * 0.4)
        };
        let ratio = next / luminance;
        let channel = |value: f64| (value * ratio).clamp(0.0, 255.0).floor();
        *gray = from_floats(channel(r), channel(g), channel(b));
    }
    grays
}

fn muted_text(background: Color, dark: bool) -> Color {
    let luminance = 0.299 * unit(background.r) * 255.0
        + 0.587 * unit(background.g) * 255.0
        + 0.114 * unit(background.b) * 255.0;
    let gray = if dark {
        if luminance < 10.0 {
            180.0
        } else {
            (160.0 + luminance * 0.3).floor().min(200.0)
        }
    } else if luminance > 245.0 {
        75.0
    } else {
        (100.0 - (255.0 - luminance) * 0.2).floor().max(60.0)
    };
    from_floats(gray, gray, gray)
}
