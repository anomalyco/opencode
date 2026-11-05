//! The V1 migration of the `new-designs` experiment (`v1-migrate-new-designs.ts` in `packages/theme/src/tui`). It
//! lays V1 colors out on the steps of the `opencode2` theme.

use opentui::style::Color;
use opentui::theme::ThemeMode;
use serde_json::{Map, Value, json};

use super::color::{Oklch, from_hex, hex, oklch_to_hex, to_oklch, unit};
use super::document::STEPS;
use super::v1::{
    V1, dialog_background, feedback_background, feedback_text, infer_hues, migrate_with, palette_tokens,
    reference_hues, scale_value, selected_foreground, splice_palette, with_alpha,
};

/// `migrateV1NewDesigns`.
pub(crate) fn migrate(theme: &Value) -> Result<Value, String> {
    migrate_with(theme, migrate_mode, light_overrides)
}

/// Light dialogs sit a step below the page, like `opencode2`'s, so rows can hover above them.
fn light_dialog() -> Value {
    json!({
        "background": {
            "base": "$hue.neutral.800",
            "raised": { "high": "$hue.neutral.700" },
            "action": {
                "primary": { "$hovered": "$hue.neutral.600" },
                "secondary": { "$hovered": "$hue.neutral.600" },
            },
        },
    })
}

fn light_overrides(definition: &Map<String, Value>, theme: &V1) -> Value {
    let mut dialog = light_dialog();
    if theme.get("backgroundPanel").a != 255 {
        dialog["background"]["base"] = json!(dialog_background(theme));
    }
    json!({ "hue": definition["hue"], "@dialog": dialog })
}

fn migrate_mode(theme: &V1, mode: ThemeMode) -> Map<String, Value> {
    let color = |key: &str| hex(theme.get(key));
    let neutral = Neutral::new(theme, mode);
    let primary = "$hue.interactive.400";
    let hues = infer_hues(theme);
    let mut hue = Map::new();
    hue.insert("gray".to_owned(), scale_value(&neutral.scale));
    for (name, matched) in hues.chromatic() {
        hue.insert(name.to_owned(), scale_value(&hue_scale(matched, mode, &neutral)));
    }
    hue.insert("accent".to_owned(), json!(hues.alias("accent")));
    hue.insert("interactive".to_owned(), json!(hues.alias("primary")));
    hue.insert("neutral".to_owned(), json!("$hue.gray"));
    let definition = json!({
        "hue": hue,
        "categorical": hues.categorical(),
        "text": {
            "base": "$hue.neutral.100",
            "muted": "$hue.neutral.200",
            "faint": "$hue.neutral.300",
            "action": {
                "primary": { "base": "$text.base", "$disabled": "$text.faint", "$focused": "$text.base", "$selected": primary },
                "secondary": { "base": "$text.muted", "$hovered": "$text.base", "$focused": "$hue.interactive.200" },
                "destructive": { "base": hex(selected_foreground(theme, theme.get("error"))), "$disabled": "$text.faint" },
            },
            "formfield": {
                "base": "$text.base",
                "$hovered": primary,
                "$focused": primary,
                "$pressed": primary,
                "$disabled": "$text.faint",
                "$selected": primary,
            },
            "feedback": feedback_text(theme),
        },
        "background": {
            "base": "$hue.neutral.900",
            "raised": { "base": "$hue.neutral.700", "high": "$hue.neutral.600", "max": "$hue.neutral.500" },
            "action": {
                "primary": {
                    "base": "transparent",
                    "$hovered": "$hue.neutral.700",
                    "$focused": "$hue.interactive.600",
                    "$selected": "transparent",
                },
                "secondary": { "base": "transparent" },
                "destructive": { "base": color("error") },
            },
            "formfield": { "base": "$background.base" },
            "feedback": feedback_background(),
        },
        "@palette": palette_tokens(theme),
        "@dialog": {
            "background": {
                "base": dialog_background(theme),
                "action": {
                    "primary": { "$hovered": "$background.raised.max" },
                    "secondary": { "$hovered": "$background.raised.max" },
                },
            },
        },
    });
    reference_hues(splice_palette(definition))
}

/// Step profiles measured from the `opencode2` theme; only lightness and chroma come from it.
struct Profile {
    /// Lightness of each surface step (900 to 400) above the page background.
    surface: [f64; 6],
    /// Where muted (200) and faint (300) text sit between the page (0) and the text color (1).
    text: [f64; 2],
    /// Lightness of each chromatic step relative to the neutral step of the same number; 400 and 500 unused.
    hue_lightness: [f64; 9],
    /// Chroma of each chromatic step as a share of the anchor's; 400 unused.
    hue_chroma: [f64; 9],
    /// Step 500 sits this far from the anchor toward step 600.
    hue_mid: f64,
    /// Least share of the text-on-page contrast that text keeps on background steps 900 to 500.
    readable: [f64; 5],
    /// The same for chromatic steps 900 to 600.
    readable_hue: [f64; 4],
}

const DARK: Profile = Profile {
    surface: [0.0, 0.039, 0.057, 0.11, 0.175, 0.253],
    text: [0.719, 0.538],
    hue_lightness: [-0.035, -0.023, -0.003, 0.0, 0.0, 0.095, 0.071, 0.024, 0.012],
    hue_chroma: [0.1, 0.24, 0.22, 0.0, 0.64, 0.2, 0.14, 0.09, 0.07],
    hue_mid: 0.55,
    readable: [0.99, 0.95, 0.92, 0.81, 0.66],
    readable_hue: [0.99, 0.92, 0.82, 0.7],
};

const LIGHT: Profile = Profile {
    surface: [0.0, -0.015, -0.039, -0.102, -0.145, -0.227],
    text: [0.688, 0.484],
    hue_lightness: [0.083, 0.13, 0.116, 0.0, 0.0, 0.021, -0.002, -0.004, -0.008],
    hue_chroma: [0.19, 0.12, 0.16, 0.0, 0.38, 0.17, 0.1, 0.05, 0.02],
    hue_mid: 0.65,
    readable: [0.97, 0.96, 0.89, 0.74, 0.64],
    readable_hue: [0.97, 0.93, 0.88, 0.78],
};

impl Profile {
    fn for_mode(mode: ThemeMode) -> &'static Profile {
        if mode == ThemeMode::Dark { &DARK } else { &LIGHT }
    }

    /// Surface offset of a step from 900 down to 400.
    fn surface(&self, step: u16) -> f64 {
        self.surface[usize::from((900 - step) / 100)]
    }

    fn readable(&self, step: u16) -> f64 {
        self.readable[usize::from((900 - step) / 100)]
    }

    fn readable_hue(&self, step: u16) -> f64 {
        self.readable_hue[usize::from((900 - step) / 100)]
    }
}

// Body text on surfaces and selections should stay comfortable to read even in low-contrast themes.
const MINIMUM_SURFACE_CONTRAST: f64 = 4.5;
const MAXIMUM_DIMMING: f64 = 0.6;

/// The gray scale, the lightness of each step before readability dimming, and what readability needs.
struct Neutral {
    scale: Vec<String>,
    lightness: [f64; 9],
    text: Color,
    page: Oklch,
    page_contrast: f64,
}

fn index(step: u16) -> usize {
    usize::from(step / 100 - 1)
}

impl Neutral {
    fn new(theme: &V1, mode: ThemeMode) -> Self {
        let profile = Profile::for_mode(mode);
        let opaque = |color: Color| color.a > 0;
        let (background, panel) = (theme.get("background"), theme.get("backgroundPanel"));
        let element = [theme.get("backgroundElement"), theme.get("backgroundMenu")].into_iter().find(|c| opaque(*c));
        let sources = [(900, Some(background)), (700, Some(panel)), (600, element)];
        let reference = sources.iter().find_map(|(step, color)| color.filter(|c| opaque(*c)).map(|c| (*step, c)));
        let fallback = if mode == ThemeMode::Dark { Color::rgb(0, 0, 0) } else { Color::rgb(255, 255, 255) };
        let page = to_oklch(reference.map_or(fallback, |(_, color)| color));
        let page_lightness = page.l - reference.map_or(0.0, |(step, _)| profile.surface(step));
        let tint =
            |colors: [Option<Color>; 3]| colors.into_iter().flatten().find(|c| opaque(*c)).map_or(page, to_oklch);
        let surface_tint = |step: u16| match step {
            900 => tint([Some(background), Some(panel), element]),
            800 | 700 => tint([Some(panel), Some(background), element]),
            _ => tint([element, Some(panel), Some(background)]),
        };
        let text = theme.get("text");
        let page = Oklch { l: page_lightness, ..surface_tint(900) };
        let page_contrast = contrast(text, from_hex(&oklch_to_hex(page)));
        let mut neutral = Neutral { scale: vec![String::new(); 9], lightness: [0.0; 9], text, page, page_contrast };
        let mut planned = [None; 9];
        for step in [800, 700, 600, 500, 400] {
            let generated = Oklch { l: page_lightness + profile.surface(step), ..surface_tint(step) };
            let color = if step == 400 { generated } else { neutral.readable(generated, profile.readable(step)) };
            planned[index(step)] = Some(generated.l);
            neutral.lightness[index(step)] = color.l;
            neutral.scale[index(step)] = oklch_to_hex(color);
        }
        neutral.lightness[index(900)] = page_lightness;
        neutral.scale[index(900)] = hex(background);
        // Transparent V1 surfaces stay transparent so the terminal shows through, as they did before.
        for (step, color) in [(800, panel), (700, panel), (600, theme.get("backgroundElement"))] {
            if !opaque(color) {
                neutral.scale[index(step)] = hex(color);
            }
        }
        let text = to_oklch(text);
        neutral.lightness[index(100)] = text.l;
        neutral.scale[index(100)] = hex(theme.get("text"));
        for (step, share) in [(200, profile.text[0]), (300, profile.text[1])] {
            let generated = mix(page, text, share);
            neutral.lightness[index(step)] = generated.l;
            neutral.scale[index(step)] = oklch_to_hex(generated);
        }
        // Keep the theme's own muted text on whichever text step it is closest to.
        let muted = to_oklch(theme.get("textMuted"));
        let (l200, l300) = (neutral.lightness[index(200)], neutral.lightness[index(300)]);
        let muted_step = if (muted.l - l200).abs() <= (muted.l - l300).abs() { 200 } else { 300 };
        neutral.lightness[index(muted_step)] = muted.l;
        neutral.scale[index(muted_step)] = hex(theme.get("textMuted"));
        for (slot, planned) in neutral.lightness.iter_mut().zip(planned) {
            if let Some(planned) = planned {
                *slot = planned;
            }
        }
        neutral
    }

    /// Pulls a generated background back toward the page until text on it keeps enough contrast.
    fn readable(&self, color: Oklch, share: f64) -> Oklch {
        let target = (self.page_contrast * share).max(MINIMUM_SURFACE_CONTRAST.min(self.page_contrast * 0.95));
        let passes =
            |amount: f64| contrast(self.text, from_hex(&oklch_to_hex(mix(color, self.page, amount)))) >= target;
        if passes(0.0) {
            return color;
        }
        // Stop short of the page so surfaces and selections stay visible in low-contrast themes.
        if !passes(MAXIMUM_DIMMING) {
            return mix(color, self.page, MAXIMUM_DIMMING);
        }
        let (mut low, mut high) = (0.0, MAXIMUM_DIMMING);
        for _ in 0..12 {
            let amount = (low + high) / 2.0;
            if passes(amount) {
                high = amount;
            } else {
                low = amount;
            }
        }
        mix(color, self.page, high)
    }
}

fn hue_scale(color: Color, mode: ThemeMode, neutral: &Neutral) -> Vec<String> {
    let profile = Profile::for_mode(mode);
    let anchor = to_oklch(color);
    let lightness = |step: u16| neutral.lightness[index(step)] + profile.hue_lightness[index(step)];
    STEPS
        .iter()
        .map(|step| {
            let step = *step;
            if step == 400 {
                return hex(color);
            }
            let l =
                if step == 500 { anchor.l + (lightness(600) - anchor.l) * profile.hue_mid } else { lightness(step) };
            let generated = Oklch { l, c: anchor.c * profile.hue_chroma[index(step)], h: anchor.h };
            let generated =
                if step >= 600 { neutral.readable(generated, profile.readable_hue(step)) } else { generated };
            with_alpha(oklch_to_hex(generated), color.a)
        })
        .collect()
}

/// WCAG contrast ratio.
fn contrast(first: Color, second: Color) -> f64 {
    let luminance = |color: Color| {
        let channel = |value: u8| {
            if unit(value) <= 0.04045 { unit(value) / 12.92 } else { ((unit(value) + 0.055) / 1.055).powf(2.4) }
        };
        0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    };
    let (first, second) = (luminance(first), luminance(second));
    (first.max(second) + 0.05) / (first.min(second) + 0.05)
}

fn mix(start: Oklch, end: Oklch, amount: f64) -> Oklch {
    let start_hue = if start.c > 0.002 { start.h } else { end.h };
    let end_hue = if end.c > 0.002 { end.h } else { start_hue };
    let hue = (((end_hue - start_hue) % 360.0 + 540.0) % 360.0) - 180.0;
    Oklch {
        l: start.l + (end.l - start.l) * amount,
        c: start.c + (end.c - start.c) * amount,
        h: start_hue + hue * amount,
    }
}
