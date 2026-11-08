//! The diagram palette from the TUI theme (`palette.ts`).

use opencode_plugin_abi::{Read, Rgba, ThemeMode};

use crate::core::color::{blend, with_alpha};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    pub text: Rgba,
    pub primary: Rgba,
    pub secondary: Rgba,
    pub muted: Rgba,
    pub warning: Rgba,
    pub background: Rgba,
    pub request: Rgba,
    pub response: Rgba,
    pub note: Rgba,
    pub note_background: Rgba,
    pub box_text: Rgba,
    pub box_border: Rgba,
    pub line: Rgba,
    pub label_background: Rgba,
    pub group: Rgba,
    pub group_text: Rgba,
    pub marker: Rgba,
    pub note_border: Rgba,
    pub note_text: Rgba,
    pub note_connector: Rgba,
}

pub struct PaletteInput {
    pub text: Rgba,
    pub subdued: Rgba,
    pub info: Rgba,
    pub success: Rgba,
    pub warning: Rgba,
    pub background: Rgba,
    pub accent_soft: Rgba,
    pub accent_clear: Rgba,
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

    /// `resolveOpenCodeDiagramPalette`, with the mode from the plugin context (`context.themeMode`). The accent is
    /// the fourth categorical scale, else the first, else the muted and base text.
    pub fn read(read: &dyn Read) -> Self {
        let text = read.color("text.base").unwrap_or(Rgba::new(255, 255, 255, 255));
        let token = |token: &str| read.color(token).unwrap_or(text);
        let (soft, clear) = if read.theme_mode() == ThemeMode::Dark { (300, 200) } else { (700, 800) };
        let accent = [3, 0].into_iter().find_map(|index| {
            let step = |step| read.color(&format!("categorical.{index}.{step}"));
            Some((step(soft)?, step(clear)?))
        });
        let (accent_soft, accent_clear) = accent.unwrap_or((token("text.muted"), text));
        Self::new(&PaletteInput {
            text,
            subdued: token("text.muted"),
            info: token("text.feedback.info.base"),
            success: token("text.feedback.success.base"),
            warning: token("text.feedback.warning.base"),
            background: token("background.base"),
            accent_soft,
            accent_clear,
        })
    }
}
