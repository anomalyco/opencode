//! The mini theme (`packages/tui/src/mini/theme.ts`): the TUI theme mapped to the few roles the split footer
//! and the scrollback use. Scrollback is immutable once written, so its colors are quantized to the terminal's
//! palette slots, and a palette change later still reads well. `mini.mono` uses the terminal's default colors
//! only.

use std::path::PathBuf;

use opencode_ui::theme::{
    Catalog, TerminalColors, Theme as UiTheme, ThemeMode, discover, generate_system, terminal_mode,
};
use opentui::prelude::*;
use opentui::style::Intent;
use opentui::syntax::SyntaxTheme;
use opentui::term::TerminalPalette;
use opentui::widget::MarkdownColors;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tone {
    pub body: Color,
    pub start: Option<Color>,
}

/// One color per scrollback entry kind (`RunEntryTheme`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntryTheme {
    pub system: Tone,
    pub user: Tone,
    pub assistant: Tone,
    pub reasoning: Tone,
    pub tool: Tone,
    pub error: Tone,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SplashTheme {
    pub left: Color,
    pub right: Color,
    pub left_shadow: Color,
}

/// The footer's colors (`RunFooterTheme`). They are not quantized: the footer repaints.
#[derive(Clone, Debug, PartialEq)]
pub struct FooterTheme {
    pub action_secondary_text: Color,
    pub action_focused_bg: Color,
    pub action_focused_text: Color,
    pub formfield_text: Color,
    pub formfield_focused_bg: Color,
    pub formfield_focused_text: Color,
    pub selection: Color,
    pub running: Color,
    pub question: Color,
    pub permission: Color,
    pub success: Color,
    pub link: Color,
    pub categorical: Vec<Color>,
    pub warning: Color,
    pub error: Color,
    pub muted: Color,
    pub text: Color,
    pub shade: Color,
    pub surface: Color,
    pub pane: Color,
    pub border: Color,
    pub line: Color,
}

/// Colors of structured blocks in the scrollback (`RunBlockTheme`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlockTheme {
    pub text: Color,
    pub muted: Color,
    pub faint: Color,
    pub warning: Color,
    pub diff_removed: Color,
    pub diff_added_bg: Color,
    pub diff_removed_bg: Color,
    pub diff_context_bg: Color,
    pub diff_highlight_added: Color,
    pub diff_highlight_removed: Color,
    pub diff_line_number: Color,
    pub diff_added_line_number_bg: Color,
    pub diff_removed_line_number_bg: Color,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunTheme {
    pub background: Color,
    pub footer: FooterTheme,
    pub entry: EntryTheme,
    pub splash: SplashTheme,
    pub block: BlockTheme,
    /// Code and Markdown highlighting, quantized like the entries; `None` in mono.
    pub syntax: Option<SyntaxTheme>,
    pub markdown: MarkdownColors,
}

/// What the theme is resolved from.
#[derive(Clone, Debug, Default)]
pub struct ThemeInput {
    /// `theme.name` from `cli.json`, `opencode` when unset.
    pub name: Option<String>,
    /// `theme.mode` from `cli.json`, used when the terminal does not report its background.
    pub mode: Option<ThemeMode>,
    /// The colors the terminal reported at startup.
    pub palette: Option<TerminalPalette>,
    /// Where custom themes live (`configDirectories`).
    pub directories: Vec<PathBuf>,
    pub mono: bool,
}

/// `resolveRunTheme`.
pub fn resolve(input: &ThemeInput) -> RunTheme {
    let colors = input
        .palette
        .as_ref()
        .map(TerminalColors::from_palette)
        .filter(TerminalColors::usable);
    let mode = colors
        .as_ref()
        .and_then(terminal_mode)
        .or(input.mode)
        .unwrap_or(ThemeMode::Dark);
    if input.mono {
        return mono(mode);
    }
    let name = input.name.as_deref().unwrap_or("opencode");
    let indexed = indexed(input.palette.as_ref());
    if name == "system" && colors.is_none() {
        return map(&fallback(mode), &indexed, false);
    }
    let mut catalog = Catalog::default();
    if name == "system" {
        catalog.set_system(colors.as_ref().map(|colors| generate_system(colors, mode)));
    } else if let Ok(custom) = discover(&input.directories) {
        catalog.set_custom(custom);
    }
    // Mini keeps the terminal background, so a theme without this mode falls back to opencode.
    let resolved = catalog
        .load(name, mode)
        .ok()
        .filter(|loaded| loaded.mode == mode)
        .map(|loaded| loaded.theme);
    let system = name == "system" && resolved.is_some();
    let theme = resolved.unwrap_or_else(|| fallback(mode));
    let mut run = map(&theme, &indexed, system);
    run.background = terminal_default(
        input
            .palette
            .as_ref()
            .and_then(|palette| palette.background)
            .unwrap_or(theme.background.base),
    );
    run
}

fn fallback(mode: ThemeMode) -> UiTheme {
    Catalog::default()
        .load("opencode", mode)
        .expect("the built-in opencode theme resolves")
        .theme
}

/// The 256 palette slots: the terminal's colors where it reported them, else xterm's.
fn indexed(palette: Option<&TerminalPalette>) -> Vec<(u8, Color)> {
    (0..=255u8)
        .map(|index| {
            let reported = palette
                .and_then(|palette| palette.colors.get(usize::from(index)).copied().flatten());
            let fallback = Color::indexed(index);
            let color = reported.unwrap_or(fallback);
            (index, Color::rgb(color.r, color.g, color.b))
        })
        .collect()
}

/// The terminal's default color, with `color` as its snapshot (`RGBA.defaultForeground(color)`).
fn terminal_default(color: Color) -> Color {
    Color::default_with(color.r, color.g, color.b)
}

fn map(theme: &UiTheme, indexed: &[(u8, Color)], system: bool) -> RunTheme {
    // The V1 system migration serializes colors; restore the terminal defaults before quantizing scrollback.
    let exact = |color: Color| {
        if system && color == theme.text.base {
            return terminal_default(color);
        }
        if system && color == theme.background.base {
            return terminal_default(color);
        }
        color
    };
    let scrollback = |color: Color| {
        let value = exact(color);
        if value.a == 0 || value.intent() != Intent::Rgb {
            return value;
        }
        nearest(indexed, value)
    };
    let tone = |color: Color| Tone {
        body: scrollback(color),
        start: None,
    };
    let text = &theme.text;
    let mut categorical: Vec<Color> = Vec::new();
    for scale in theme.categorical() {
        let color = exact(scale.step(200));
        if !categorical.contains(&color) {
            categorical.push(color);
        }
    }
    let mut syntax = opencode_ui::code::syntax_theme(theme);
    let names: Vec<String> = syntax.names().map(str::to_owned).collect();
    for name in names {
        if let Some(mut style) = syntax.get(&name) {
            style.fg = style.fg.map(scrollback);
            style.bg = style.bg.map(scrollback);
            syntax.set(name, style);
        }
    }
    let markdown = opencode_ui::markdown::colors(theme);
    RunTheme {
        background: terminal_default(theme.background.base),
        footer: FooterTheme {
            action_secondary_text: exact(text.action.secondary.base),
            action_focused_bg: exact(theme.background.action.primary.focused),
            action_focused_text: exact(text.action.primary.focused),
            formfield_text: exact(text.formfield.base),
            formfield_focused_bg: exact(theme.background.formfield.focused),
            formfield_focused_text: exact(text.formfield.focused),
            selection: exact(text.formfield.selected),
            running: exact(theme.interactive().step(200)),
            question: exact(theme.accent().step(200)),
            permission: exact(theme.accent().step(200)),
            success: exact(text.feedback.success.base),
            link: exact(theme.markdown.link),
            categorical,
            warning: exact(text.feedback.warning.base),
            error: exact(text.feedback.error.base),
            muted: exact(text.muted),
            text: exact(text.base),
            shade: exact(theme.background.raised.base),
            surface: exact(theme.background.raised.base),
            pane: exact(theme.background.raised.high),
            border: exact(theme.border.base),
            line: exact(theme.background.raised.high),
        },
        entry: EntryTheme {
            system: tone(text.muted),
            user: tone(text.base),
            assistant: tone(theme.markdown.text),
            reasoning: tone(text.muted),
            tool: Tone {
                body: scrollback(text.muted),
                start: Some(scrollback(text.muted)),
            },
            error: tone(text.feedback.error.base),
        },
        splash: SplashTheme {
            left: nearest(indexed, text.muted),
            right: nearest(indexed, text.base),
            left_shadow: nearest(indexed, theme.background.raised.base),
        },
        block: BlockTheme {
            text: scrollback(text.base),
            muted: scrollback(text.muted),
            faint: scrollback(text.faint),
            warning: scrollback(text.feedback.warning.base),
            diff_removed: scrollback(theme.diff.text.removed),
            diff_added_bg: scrollback(theme.diff.background.added),
            diff_removed_bg: scrollback(theme.diff.background.removed),
            diff_context_bg: scrollback(theme.diff.background.context),
            diff_highlight_added: scrollback(theme.diff.highlight.added),
            diff_highlight_removed: scrollback(theme.diff.highlight.removed),
            diff_line_number: scrollback(theme.diff.line_number.text),
            diff_added_line_number_bg: scrollback(theme.diff.line_number.background.added),
            diff_removed_line_number_bg: scrollback(theme.diff.line_number.background.removed),
        },
        syntax: Some(syntax),
        markdown: MarkdownColors {
            text: scrollback(markdown.text),
            heading: scrollback(markdown.heading),
            emphasis: scrollback(markdown.emphasis),
            code: scrollback(markdown.code),
            // Mini keeps the terminal background behind code spans.
            code_bg: Color::TRANSPARENT,
            link: scrollback(markdown.link),
            quote: scrollback(markdown.quote),
            marker: scrollback(markdown.marker),
            rule: scrollback(markdown.rule),
        },
    }
}

/// `monoTheme`: the terminal's default foreground and background only.
pub fn mono(mode: ThemeMode) -> RunTheme {
    let (fg, bg) = match mode {
        ThemeMode::Light => (
            Color::default_with(0, 0, 0),
            Color::default_with(255, 255, 255),
        ),
        ThemeMode::Dark => (
            Color::default_with(255, 255, 255),
            Color::default_with(0, 0, 0),
        ),
    };
    let tone = Tone {
        body: fg,
        start: None,
    };
    RunTheme {
        background: bg,
        footer: FooterTheme {
            action_secondary_text: fg,
            action_focused_bg: bg,
            action_focused_text: fg,
            formfield_text: fg,
            formfield_focused_bg: bg,
            formfield_focused_text: fg,
            selection: fg,
            running: fg,
            question: fg,
            permission: fg,
            success: fg,
            link: fg,
            categorical: vec![fg],
            warning: fg,
            error: fg,
            muted: fg,
            text: fg,
            shade: bg,
            surface: bg,
            pane: bg,
            border: fg,
            line: bg,
        },
        entry: EntryTheme {
            system: tone,
            user: tone,
            assistant: tone,
            reasoning: tone,
            tool: tone,
            error: tone,
        },
        splash: SplashTheme {
            left: fg,
            right: fg,
            left_shadow: bg,
        },
        block: BlockTheme {
            text: fg,
            muted: fg,
            faint: fg,
            warning: fg,
            diff_removed: fg,
            diff_added_bg: bg,
            diff_removed_bg: bg,
            diff_context_bg: bg,
            diff_highlight_added: fg,
            diff_highlight_removed: fg,
            diff_line_number: fg,
            diff_added_line_number_bg: bg,
            diff_removed_line_number_bg: bg,
        },
        syntax: None,
        markdown: MarkdownColors {
            text: fg,
            heading: fg,
            emphasis: fg,
            code: fg,
            code_bg: Color::TRANSPARENT,
            link: fg,
            quote: fg,
            marker: fg,
            rule: fg,
        },
    }
}

/// `nearestIndexed`: the palette slot closest in OKLab, with lightness weighted double.
pub fn nearest(indexed: &[(u8, Color)], color: Color) -> Color {
    let target = oklab(color);
    let mut best = (f64::INFINITY, 0u8);
    for (index, sample) in indexed {
        let sample = oklab(*sample);
        let (dl, da, db) = (
            sample.0 - target.0,
            sample.1 - target.1,
            sample.2 - target.2,
        );
        let distance = dl * dl * 2.0 + da * da + db * db;
        if distance < best.0 {
            best = (distance, *index);
        }
    }
    // The slot's snapshot is xterm's color; terminals with a palette draw their own.
    Color::indexed(best.1)
}

fn oklab(color: Color) -> (f64, f64, f64) {
    let linear = |channel: u8| {
        let value = f64::from(channel) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    let (r, g, b) = (linear(color.r), linear(color.g), linear(color.b));
    let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
    let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
    let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
    (
        0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    )
}

/// `prefixes` of `mono.ts`: status glyphs at the start of a line.
fn prefix(c: char) -> Option<&'static str> {
    Some(match c {
        '\u{2192}' => "->",
        '\u{2190}' => "<-",
        '\u{2731}' | '\u{2699}' | '\u{25c8}' | '\u{25c9}' | '\u{27f3}' => "*",
        '\u{2716}' | '\u{2717}' => "!",
        _ => return None,
    })
}

/// `markdown` of `mono.ts`: ASCII for the characters text commonly uses.
fn ascii(c: char) -> Option<&'static str> {
    prefix(c).or(Some(match c {
        '\u{a0}' => " ",
        '\u{b7}' | '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' => "-",
        '\u{2014}' => "--",
        '\u{2018}' | '\u{2019}' => "'",
        '\u{201c}' | '\u{201d}' => "\"",
        '\u{2022}' => "*",
        '\u{2026}' => "...",
        '\u{2191}' => "up",
        '\u{2193}' => "down",
        _ => return None,
    }))
}

/// `monoText`: printable ASCII, tabs, and newlines stay; known characters become ASCII, others `?`.
pub fn mono_text(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\t' | '\n' | ' '..='~' => c.to_string(),
            c => ascii(c).unwrap_or("?").to_owned(),
        })
        .collect()
}

/// `monoPrefix`: a leading status glyph as ASCII.
pub fn mono_prefix(value: &str, mono: bool) -> String {
    let mut chars = value.chars();
    match (mono, chars.next().and_then(prefix)) {
        (true, Some(prefix)) => format!("{prefix}{}", chars.as_str()),
        _ => value.to_owned(),
    }
}

/// `monoToolText`: `monoPrefix`, and ` - ` for the dot of a completed tool's summary.
pub fn mono_tool_text(value: &str, mono: bool) -> String {
    let result = mono_prefix(value, mono);
    if !mono {
        return result;
    }
    let separator = " \u{b7} ";
    let Some(index) = result.rfind(separator) else {
        return result;
    };
    let head = &result[..index];
    let questions = head
        .strip_suffix(" questions")
        .is_some_and(|count| !count.is_empty() && count.bytes().all(|b| b.is_ascii_digit()));
    if !head.contains(" completed") && head != "patch" && !questions {
        return result;
    }
    format!("{head} - {}", &result[index + separator.len()..])
}

/// `monoTruncate`.
pub fn mono_truncate(value: &str, width: usize, mono: bool) -> String {
    let count = value.chars().count();
    if !mono || count <= width {
        return value.to_owned();
    }
    if width <= 3 {
        return ".".repeat(width);
    }
    value.chars().take(width - 3).chain("...".chars()).collect()
}

/// `monoSnapshot`: every non-ASCII cell of a scrollback snapshot as one ASCII character, colors kept.
pub fn mono_snapshot(buffer: &opentui::native::Buffer) -> opentui::Result<()> {
    let capture = buffer.capture()?;
    for y in 0..capture.height {
        for x in 0..capture.width {
            let Some(cell) = capture.cell(x, y) else {
                continue;
            };
            let mut chars = cell.symbol.chars();
            let character = match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii() => continue,
                // The trailing cell of a wide character.
                (None, _) => ' ',
                (Some('\u{2500}'), None) => '-',
                (Some('\u{2502}'), None) => '|',
                (Some(c), None) => ascii(c).and_then(|text| text.chars().next()).unwrap_or('?'),
                // A grapheme cluster.
                (Some(_), Some(_)) => '?',
            };
            let style = Style {
                fg: Some(cell.fg),
                bg: Some(cell.bg),
                attributes: cell.attributes,
            };
            buffer.cell(x as i32, y as i32, character, style)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_text_matches_mono_ts() {
        assert_eq!(mono_text("a — b… “q” • ✓\tx"), "a -- b... \"q\" * ?\tx");
        assert_eq!(mono_prefix("→ Skill", true), "-> Skill");
        assert_eq!(mono_prefix("→ Skill", false), "→ Skill");
        assert_eq!(
            mono_tool_text("2 questions · done", true),
            "2 questions - done"
        );
        assert_eq!(mono_tool_text("read · a.ts", true), "read · a.ts");
        assert_eq!(mono_truncate("abcdefgh", 6, true), "abc...");
    }

    #[test]
    fn nearest_picks_the_closest_slot() {
        let slots = indexed(None);
        assert_eq!(
            nearest(&slots, Color::rgb(255, 0, 0)).intent(),
            Intent::Indexed(9)
        );
        assert_eq!(
            nearest(&slots, Color::rgb(0, 0, 0)).intent(),
            Intent::Indexed(0)
        );
        // A gray lands on the gray ramp, not on a primary.
        let gray = nearest(&slots, Color::rgb(0x80, 0x80, 0x80));
        assert!(matches!(gray.intent(), Intent::Indexed(8 | 244)));
    }

    #[test]
    fn scrollback_colors_are_palette_slots_and_footer_colors_are_not() {
        let theme = resolve(&ThemeInput::default());
        assert!(matches!(theme.entry.user.body.intent(), Intent::Indexed(_)));
        assert!(matches!(theme.markdown.text.intent(), Intent::Indexed(_)));
        assert_eq!(theme.footer.text.intent(), Intent::Rgb);
        assert_eq!(theme.background.intent(), Intent::Default);
    }

    #[test]
    fn mono_uses_default_colors_by_mode() {
        let dark = resolve(&ThemeInput {
            mono: true,
            ..ThemeInput::default()
        });
        assert_eq!(dark.entry.assistant.body.intent(), Intent::Default);
        assert_eq!((dark.entry.user.body.r, dark.background.r), (255, 0));
        let light = resolve(&ThemeInput {
            mono: true,
            mode: Some(ThemeMode::Light),
            ..ThemeInput::default()
        });
        assert_eq!((light.entry.user.body.r, light.background.r), (0, 255));
        assert!(light.syntax.is_none());
    }
}
