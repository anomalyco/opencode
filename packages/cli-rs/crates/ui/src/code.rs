//! Code wrapper (U.4a): the syntax theme the TUI derives from its theme, and highlighted code as the Write tool
//! shows it (`<line_number>` around `<code>`, `packages/tui/src/routes/session/index.tsx`).

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{Code, LineNumbers};

use crate::theme::{Theme, contrast};

/// The capture styles for code, Markdown, and the prompt, from the TUI theme: a port of `generateSyntax`
/// (`packages/theme/src/tui/syntax.ts`). Rules apply in order, so a scope listed twice keeps its last style.
///
/// A name without a style falls back to its first dotted part, as in Core: `string.special.path` takes `string`.
pub fn syntax_theme(theme: &Theme) -> SyntaxTheme {
    let syntax = &theme.syntax;
    let markdown = &theme.markdown;
    let feedback = &theme.text.feedback;
    let fg = |color: Color| Style::new().fg(color);
    let categorical = theme.categorical();
    let rules = [
        (&["default"][..], fg(theme.text.base)),
        (&["prompt"], fg(theme.accent().step(200))),
        (&["extmark.file"], fg(feedback.warning.base).bold()),
        (&["extmark.agent"], fg(categorical[0].step(200)).bold()),
        (&["extmark.skill"], fg(categorical.get(1).unwrap_or(&categorical[0]).step(200)).bold()),
        (&["extmark.paste"], fg(paste_text(theme)).bg(feedback.warning.base).bold()),
        (&["comment", "comment.documentation"], fg(syntax.comment).italic()),
        (&["string", "symbol", "character.special", "character"], fg(syntax.string)),
        (&["number", "boolean", "constant", "float"], fg(syntax.number)),
        (
            &["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
            fg(syntax.keyword).italic(),
        ),
        (&["keyword.type"], fg(syntax.r#type).bold().italic()),
        (&["keyword.function", "function.method"], fg(syntax.function)),
        (&["keyword"], fg(syntax.keyword).italic()),
        (&["keyword.import", "string.escape", "string.regexp", "tag.attribute", "keyword.export"], fg(syntax.keyword)),
        (
            &["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"],
            fg(syntax.operator),
        ),
        (
            &[
                "variable",
                "variable.parameter",
                "function.method.call",
                "function.call",
                "property",
                "parameter",
                "field",
            ],
            fg(syntax.variable),
        ),
        (&["variable.member", "function", "constructor"], fg(syntax.function)),
        (&["type", "module", "class", "namespace"], fg(syntax.r#type)),
        (&["type.definition"], fg(syntax.r#type).bold()),
        (&["punctuation", "punctuation.bracket"], fg(syntax.punctuation)),
        (
            &[
                "variable.builtin",
                "type.builtin",
                "function.builtin",
                "module.builtin",
                "constant.builtin",
                "variable.super",
            ],
            fg(feedback.error.base),
        ),
        (&["keyword.directive", "keyword.modifier", "keyword.exception"], fg(syntax.keyword).italic()),
        (&["punctuation.special", "tag.delimiter"], fg(syntax.operator)),
        (
            &[
                "markup.heading",
                "markup.heading.2",
                "markup.heading.3",
                "markup.heading.4",
                "markup.heading.5",
                "markup.heading.6",
            ],
            fg(markdown.heading).bold(),
        ),
        (&["markup.heading.1"], fg(markdown.heading).bold().underline()),
        (&["markup.bold", "markup.strong"], fg(markdown.strong).bold()),
        (&["markup.italic"], fg(markdown.emphasis).italic()),
        (&["markup.list"], fg(markdown.list_item)),
        (&["markup.quote"], fg(markdown.block_quote).italic()),
        (&["markup.raw", "markup.raw.block"], fg(markdown.code)),
        (&["markup.raw.inline"], fg(markdown.code).bg(theme.background.base)),
        (&["markup.link", "markup.link.url", "string.special", "string.special.url"], fg(markdown.link).underline()),
        (&["markup.link.label"], fg(markdown.link_text).underline()),
        (&["label"], fg(markdown.link_text)),
        (&["spell", "nospell"], fg(theme.text.base)),
        (&["markup.underline"], fg(theme.text.base).underline()),
        (&["comment.error"], fg(feedback.error.base).italic().bold()),
        (&["comment.warning"], fg(feedback.warning.base).italic().bold()),
        (&["comment.todo", "comment.note"], fg(feedback.info.base).italic().bold()),
        (&["attribute", "annotation"], fg(feedback.warning.base)),
        (&["tag"], fg(feedback.error.base)),
        (&["markup.strikethrough", "markup.list.unchecked", "debug"], fg(theme.text.muted)),
        (&["markup.list.checked"], fg(feedback.success.base)),
        (&["diff.plus"], fg(theme.diff.text.added).bg(theme.diff.background.added)),
        (&["diff.minus"], fg(theme.diff.text.removed).bg(theme.diff.background.removed)),
        (&["diff.delta"], fg(theme.diff.text.context).bg(theme.diff.background.context)),
        (&["error"], fg(feedback.error.base).bold()),
        (&["warning"], fg(feedback.warning.base).bold()),
        (&["info"], fg(feedback.info.base)),
    ];
    let mut styles = SyntaxTheme::new().first_part_fallback();
    for (scopes, style) in rules {
        for scope in scopes {
            styles.set(*scope, style);
        }
    }
    styles
}

/// The paste chip's text: the page color, dark in dark mode and light in light mode (#62930). A transparent page (the
/// system theme) still holds the terminal's background in its channels, so the chip takes that. A transparent page
/// without one takes the end of the neutral scale that reads better on the chip.
///
/// TypeScript takes the selected-row text instead, which is the light foreground on the system theme in dark mode
/// (`parity/deviations/O89-paste-chip-contrast.md`).
fn paste_text(theme: &Theme) -> Color {
    let page = theme.background.base;
    if page.a == 255 {
        return page;
    }
    if (page.r, page.g, page.b) != (0, 0, 0) {
        return Color::rgb(page.r, page.g, page.b);
    }
    let chip = theme.text.feedback.warning.base;
    // The best contrast against one color is always at the darkest or the lightest step.
    let neutral = theme.neutral().0.into_iter().filter(|step| step.a == 255);
    neutral.max_by(|a, b| contrast(*a, chip).total_cmp(&contrast(*b, chip))).unwrap_or(theme.text.base)
}

/// Read-only code in the theme's text color, highlighted as `filetype` (`<code conceal={false} fg={text.base}>`).
/// It shows all its lines, wraps at a word as Core's `<code>` does, and takes no focus, as in the transcript.
pub fn view(app: &App, theme: &Theme, syntax: &SyntaxTheme, filetype: Option<&str>, content: &str) -> Code {
    crate::grammars::register();
    Code::new(app)
        .fg(theme.text.base)
        .syntax_theme(syntax.clone())
        .filetype(filetype)
        .set_code(content)
        .wrap(WrapMode::Word)
        .focusable(false)
}

/// `code` with muted line numbers, as the Write tool shows a file (`<line_number fg={text.muted} minWidth={3}
/// paddingRight={1}>`).
pub fn numbered(app: &App, theme: &Theme, code: &Code) -> LineNumbers {
    // Core's gutter grows its target to the rest of the row.
    code.grow(1.0).basis(Length::Auto);
    LineNumbers::new(app, code).fg(theme.text.muted).gutter_min_width(3).gutter_padding(1)
}
