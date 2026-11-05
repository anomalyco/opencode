//! The diagram palette from the TUI theme (`palette.ts`).

use opencode_ui::theme::Theme;
use opentui::prelude::Color;

use crate::core::color::{blend, with_alpha};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    pub text: Color,
    pub primary: Color,
    pub secondary: Color,
    pub muted: Color,
    pub warning: Color,
    pub background: Color,
    pub request: Color,
    pub response: Color,
    pub note: Color,
    pub note_background: Color,
    pub box_text: Color,
    pub box_border: Color,
    pub line: Color,
    pub label_background: Color,
    pub group: Color,
    pub group_text: Color,
    pub marker: Color,
    pub note_border: Color,
    pub note_text: Color,
    pub note_connector: Color,
}

pub struct PaletteInput {
    pub text: Color,
    pub subdued: Color,
    pub info: Color,
    pub success: Color,
    pub warning: Color,
    pub background: Color,
    pub accent_soft: Color,
    pub accent_clear: Color,
}

impl Palette {
    /// `createOpenCodeDiagramPalette`.
    pub fn new(input: &PaletteInput) -> Self {
        let secondary = blend(input.text, input.subdued, 0.5);
        let muted = blend(input.text, input.subdued, 0.7);
        Self {
            text: input.text,
            primary: input.text,
            secondary,
            muted,
            warning: input.info,
            background: input.background,
            request: input.success,
            response: input.warning,
            note: input.text,
            note_background: blend(input.background, input.subdued, 0.25),
            box_text: input.text,
            box_border: muted,
            line: input.subdued,
            label_background: with_alpha(input.text, 0.08),
            group: input.accent_soft,
            group_text: input.accent_soft,
            marker: secondary,
            note_border: input.accent_soft,
            note_text: input.accent_clear,
            note_connector: input.accent_soft,
        }
    }

    /// `resolveOpenCodeDiagramPalette`. TS takes the mode from the plugin context; the Rust plugin API
    /// passes only the theme, so a page background lighter than half luminance means light mode.
    pub fn from_theme(theme: &Theme) -> Self {
        let categorical = theme.categorical();
        let accent = categorical.get(3).or(categorical.first());
        let dark = !is_light(theme.background.base);
        let (soft, clear) = match accent {
            Some(scale) if dark => (scale.step(300), scale.step(200)),
            Some(scale) => (scale.step(700), scale.step(800)),
            None => (theme.text.muted, theme.text.base),
        };
        Self::new(&PaletteInput {
            text: theme.text.base,
            subdued: theme.text.muted,
            info: theme.text.feedback.info.base,
            success: theme.text.feedback.success.base,
            warning: theme.text.feedback.warning.base,
            background: theme.background.base,
            accent_soft: soft,
            accent_clear: clear,
        })
    }
}

fn is_light(color: Color) -> bool {
    let luminance = 0.2126 * f64::from(color.r) + 0.7152 * f64::from(color.g) + 0.0722 * f64::from(color.b);
    luminance > 127.5
}
