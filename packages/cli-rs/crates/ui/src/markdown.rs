//! Transcript Markdown with syntax-theme styles for markup spans.

use std::rc::Rc;
use std::sync::Arc;

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{
    CodeBlock, InlineContext, InlineSpan, Markdown, MarkdownColors, MarkdownExtension, MarkdownTableOptions,
    MarkdownTableStyle,
};

use crate::theme::Theme;

/// Renders a fenced code block instead of the default code view, or returns `None` to keep it. See
/// [`Markdown::code_block_renderer`].
pub type CodeBlockRenderer = Rc<dyn Fn(&CodeBlock<'_>) -> Option<AnyWidget>>;

/// Renders inline math's TeX as one row of spans, or returns `None` to show the TeX as typed.
pub type InlineMathRenderer = Rc<dyn Fn(&str) -> Option<Vec<Span<'static>>>>;

/// The code-block renderers plugins register, such as LaTeX and Mermaid: the Rust form of the TUI plugins'
/// `renderNode` (`plugins.markdown()`), and the inline math renderer. Empty until a plugin registers one.
#[derive(Clone, Default)]
pub struct CodeBlockRenderers {
    blocks: Vec<(String, CodeBlockRenderer)>,
    math: Option<InlineMathRenderer>,
}

impl CodeBlockRenderers {
    /// Renders fences of `language` with `render`. A later registration for the same language replaces it.
    pub fn register(&mut self, language: impl Into<String>, render: CodeBlockRenderer) {
        let language = language.into();
        self.blocks.retain(|(key, _)| *key != language);
        self.blocks.push((language, render));
    }

    /// Renders inline math with `render`, replacing an earlier one. A [`view`] with an inline math renderer parses
    /// Markdown math: `$…$` and `\(…\)` reach `render`, and `$$…$$` and `\[…\]` the code-block renderer of `math`.
    pub fn register_math(&mut self, render: InlineMathRenderer) {
        self.math = Some(render);
    }
}

/// Makes `hook` the inline hook of a [`view`] made with `renderers`, after the inline math renderer's own.
pub fn inline_hook(
    markdown: &Markdown,
    renderers: &CodeBlockRenderers,
    hook: impl Fn(Vec<InlineSpan>, &InlineContext<'_>) -> Vec<InlineSpan> + 'static,
) {
    let math = renderers.math.clone();
    markdown.inline_hook(move |spans, cx| {
        let spans = match &math {
            Some(math) => math_spans(math, spans, cx),
            None => spans,
        };
        hook(spans, cx)
    });
}

/// Each inline math span as `math` renders it, in the span's style under the renderer's own. With markers shown
/// (no conceal), math keeps its source, as other markup does.
fn math_spans(math: &InlineMathRenderer, spans: Vec<InlineSpan>, cx: &InlineContext<'_>) -> Vec<InlineSpan> {
    if !cx.conceal {
        return spans;
    }
    spans
        .into_iter()
        .flat_map(|span| {
            let Some(rendered) = span.math.as_deref().and_then(|tex| math(tex)) else { return vec![span] };
            let base = span.span.style;
            rendered
                .into_iter()
                .map(|piece| {
                    let style = Style {
                        fg: piece.style.fg.or(base.fg),
                        bg: piece.style.bg.or(base.bg),
                        attributes: base.attributes.union(piece.style.attributes),
                    };
                    let mut inline = span.clone();
                    inline.span = Span::styled(piece.content, style);
                    inline
                })
                .collect()
        })
        .collect()
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
/// (see [`crate::code::syntax_theme`]), fences drawn by `renderers` where one is registered, and math parsed and
/// drawn when `renderers` has an inline math renderer, grid tables with one column of cell padding, markers
/// hidden when `conceal` (`session.markdown` is `rendered`), and incremental parsing while `streaming` (the message
/// has not completed). Stream text into it with [`Markdown::append`] or [`Markdown::set_markdown`], and call
/// [`Markdown::streaming`] with `false` once the message completes.
pub fn view(
    app: &App,
    theme: &Theme,
    syntax: &Arc<SyntaxTheme>,
    renderers: &CodeBlockRenderers,
    conceal: bool,
    streaming: bool,
) -> Markdown {
    crate::grammars::register();
    let markdown = Markdown::new(app)
        .colors(view_colors(theme, syntax))
        .syntax_theme(syntax.clone())
        .scope_styles(true)
        .table_options(table(syntax))
        .conceal(conceal)
        .streaming(streaming);
    for (language, render) in &renderers.blocks {
        let render = render.clone();
        markdown.code_block_renderer(language, move |block| render(block));
    }
    if renderers.math.is_some() {
        markdown.extensions(&[MarkdownExtension::Math]);
        inline_hook(&markdown, renderers, |spans, _| spans);
    }
    markdown
}

/// The colors [`view`] gives its Markdown in `theme`: [`colors`] with Core's rule, the `conceal` scope's color, else
/// the text color.
pub fn view_colors(theme: &Theme, syntax: &SyntaxTheme) -> MarkdownColors {
    let rule = syntax.get("conceal").and_then(|style| style.fg).unwrap_or(theme.markdown.text);
    MarkdownColors { rule, ..colors(theme) }
}

/// Restyles a [`view`] for a new theme in place, as Core's Markdown follows its theme: the text and the code views
/// stay, and code keeps its highlight, so nothing is parsed again. Plugin fences render again and read the theme
/// themselves.
///
/// The table options follow the `conceal` scope, which [`crate::code::syntax_theme`] leaves out, so they stay the
/// same. A new border color would repaint the tables in place.
pub fn restyle(markdown: &Markdown, colors: MarkdownColors, syntax: &Arc<SyntaxTheme>) {
    // Each style Markdown takes builds its blocks again, and a custom block afresh: the first build is not the last.
    RESTYLING.set(true);
    markdown.colors(colors);
    RESTYLING.set(false);
    markdown.syntax_theme(syntax.clone()).table_options(table(syntax));
}

thread_local! {
    static RESTYLING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether Markdown builds its blocks now for a [`restyle`] that builds them once more before it ends: a renderer
/// whose work is costly may leave a block to the code view now and draw it at the last build.
pub fn restyling() -> bool {
    RESTYLING.get()
}

/// Grid tables with one column of cell padding, bordered in Core's table border: the `conceal` scope's color, else
/// a gray.
fn table(syntax: &SyntaxTheme) -> MarkdownTableOptions {
    MarkdownTableOptions {
        style: MarkdownTableStyle::Grid,
        cell_padding_x: Some(1),
        border_color: Some(syntax.get("conceal").and_then(|style| style.fg).unwrap_or(Color::hex(0x888888))),
        ..MarkdownTableOptions::default()
    }
}
