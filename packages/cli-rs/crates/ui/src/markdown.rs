//! Markdown wrapper (U.4a, U.4c): assistant text as the transcript shows it (`TextPart`,
//! `packages/tui/src/routes/session/message-parts.tsx`), on opentui-rust's `Markdown` widget.
//!
//! The widget has its own parser and styles spans through the syntax theme's `markup.*` scopes, as Core does;
//! `parity/deviations/V03-markdown-widget.md` lists what differs.

use std::rc::Rc;

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{
    CodeBlock, Markdown, MarkdownColors, MarkdownTableOptions, MarkdownTableStyle,
};

use crate::theme::Theme;

/// Renders a fenced code block instead of the default code view, or returns `None` to keep it. See
/// [`Markdown::code_block_renderer`].
pub type CodeBlockRenderer = Rc<dyn Fn(&CodeBlock<'_>) -> Option<AnyWidget>>;

/// The code-block renderers plugins register, such as LaTeX and Mermaid: the Rust form of the TUI plugins'
/// `renderNode` (`plugins.markdown()`). Empty until a plugin registers one.
#[derive(Clone, Default)]
pub struct CodeBlockRenderers(Vec<(String, CodeBlockRenderer)>);

impl CodeBlockRenderers {
    /// Renders fences of `language` with `render`. A later registration for the same language replaces it.
    pub fn register(&mut self, language: impl Into<String>, render: CodeBlockRenderer) {
        let language = language.into();
        self.0.retain(|(key, _)| *key != language);
        self.0.push((language, render));
    }
}

/// The widget's colors from the TUI theme's `markdown` tokens, for the parts the syntax theme leaves unstyled. The
/// widget colors bold text with `emphasis` and the label of a link with `link`, so those take the tokens Core uses
/// for `markup.strong` and `markup.link.label`.
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

/// Markdown in the theme's colors with `TextPart`'s options: text styled and code fences highlighted by `syntax`
/// (see [`crate::code::syntax_theme`]), fences drawn by `renderers` where one is registered, grid tables with one column of cell padding, markers
/// hidden when `conceal` (`session.markdown` is `rendered`), and incremental parsing while `streaming` (the message
/// has not completed). Stream text into it with [`Markdown::append`] or [`Markdown::set_markdown`], and call
/// [`Markdown::streaming`] with `false` once the message completes.
pub fn view(
    app: &App,
    theme: &Theme,
    syntax: &SyntaxTheme,
    renderers: &CodeBlockRenderers,
    conceal: bool,
    streaming: bool,
) -> Markdown {
    let markdown = Markdown::new(app)
        .colors(colors(theme))
        .syntax_theme(syntax.clone())
        .scope_styles(true)
        .table_options(MarkdownTableOptions {
            style: MarkdownTableStyle::Grid,
            cell_padding_x: Some(1),
            // Core's table border: the `conceal` scope's color, else this gray.
            border_color: Some(
                syntax
                    .get("conceal")
                    .and_then(|style| style.fg)
                    .unwrap_or(Color::hex(0x888888)),
            ),
            ..MarkdownTableOptions::default()
        })
        .conceal(conceal)
        .streaming(streaming);
    for (language, render) in &renderers.0 {
        let render = render.clone();
        markdown.code_block_renderer(language, move |block| render(block));
    }
    markdown
}
