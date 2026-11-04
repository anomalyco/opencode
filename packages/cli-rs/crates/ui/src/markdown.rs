//! Markdown wrapper (U.4a, U.4c): assistant text as the transcript shows it (`TextPart`,
//! `packages/tui/src/routes/session/message-parts.tsx`), on opentui-rust's current `Markdown` widget.
//!
//! The widget has its own parser and layout, not Core's, and no conceal, code-block hook, or table options yet;
//! `parity/deviations/V03-markdown-widget.md` lists what differs. U.4c adds G.3's options here.

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{Markdown, MarkdownColors};

use crate::theme::Theme;

/// The widget's colors from the TUI theme's `markdown` tokens. The widget colors bold text with `emphasis` and the
/// label of a link with `link`, so those take the tokens Core uses for `markup.strong` and `markup.link.label`.
pub fn colors(theme: &Theme) -> MarkdownColors {
    let markdown = &theme.markdown;
    MarkdownColors {
        text: markdown.text,
        heading: markdown.heading,
        emphasis: markdown.strong,
        code: markdown.code,
        code_bg: theme.background.base,
        link: markdown.link_text,
        quote: markdown.block_quote,
        marker: markdown.list_item,
        rule: markdown.horizontal_rule,
    }
}

/// Rendered Markdown in the theme's colors, with code fences highlighted by `syntax` (see
/// [`crate::code::syntax_theme`]). Stream text into it with [`Markdown::append`] or [`Markdown::set_markdown`].
pub fn view(app: &App, theme: &Theme, syntax: &SyntaxTheme) -> Markdown {
    Markdown::new(app)
        .colors(colors(theme))
        .syntax_theme(syntax.clone())
}
