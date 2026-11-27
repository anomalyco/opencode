//! Transcript Markdown with syntax-theme styles for markup spans.

use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use opentui::prelude::*;
use opentui::syntax::{SyntaxTheme, filetype_for_info_string};
use opentui::sys;
use opentui::widget::{
    CodeBlock, InlineContext, InlineSpan, Markdown, MarkdownColors, MarkdownExtension, MarkdownTableOptions,
    MarkdownTableStyle,
};

use crate::theme::Theme;

/// Renders a fenced code block instead of the default code view, or returns `None` to keep it. See
/// [`Markdown::code_block_renderer`].
pub type CodeBlockRenderer = Rc<dyn Fn(&CodeBlock<'_>) -> Option<AnyWidget>>;

/// Input passed to a widget-free [`CodeBlockProbe`] to check whether a custom renderer claims
/// a code block instead of falling back to the default code view.
pub struct CodeBlockProbeInput<'a> {
    pub language: &'a str,
    pub info: &'a str,
    pub code: &'a str,
    pub conceal: bool,
    pub width: u16,
}

/// Widget-free check returning `true` when the registered code-block renderer claims the fence
/// (drawing a custom view instead of a `Code` widget) and `false` when it falls back to code.
pub type CodeBlockProbe = Rc<dyn Fn(&CodeBlockProbeInput<'_>) -> bool>;

/// Renders inline math's TeX as one row of spans, or returns `None` to show the TeX as typed.
pub type InlineMathRenderer = Rc<dyn Fn(&str) -> Option<Vec<Span<'static>>>>;

/// The code-block renderers plugins register, such as LaTeX and Mermaid: the Rust form of the TUI plugins'
/// `renderNode` (`plugins.markdown()`), and the inline math renderer. Empty until a plugin registers one.
#[derive(Clone, Default)]
pub struct CodeBlockRenderers {
    blocks: Vec<(String, CodeBlockRenderer, Option<CodeBlockProbe>)>,
    math: Option<InlineMathRenderer>,
}

impl CodeBlockRenderers {
    /// Renders fences of `language` with `render`. A later registration for the same language replaces it.
    pub fn register(&mut self, language: impl Into<String>, render: CodeBlockRenderer) {
        self.register_entry(language.into(), render, None);
    }

    /// Renders fences of `language` with `render`, pairing a widget-free `probe` so callers can
    /// tell whether a fence is claimed without building a widget.
    pub fn register_with_probe(
        &mut self,
        language: impl Into<String>,
        render: CodeBlockRenderer,
        probe: CodeBlockProbe,
    ) {
        self.register_entry(language.into(), render, Some(probe));
    }

    fn register_entry(&mut self, language: String, render: CodeBlockRenderer, probe: Option<CodeBlockProbe>) {
        self.blocks.retain(|(key, _, _)| *key != language);
        self.blocks.push((language, render, probe));
    }

    /// Renders inline math with `render`, replacing an earlier one. A [`view`] with an inline math renderer parses
    /// Markdown math: `$…$` and `\(…\)` reach `render`, and `$$…$$` and `\[…\]` the code-block renderer of `math`.
    pub fn register_math(&mut self, render: InlineMathRenderer) {
        self.math = Some(render);
    }

    /// Returns the custom code-block renderer registered for `language`, if any.
    pub fn get(&self, language: &str) -> Option<&CodeBlockRenderer> {
        let language = filetype_for_info_string(language).unwrap_or_else(|| language.to_owned());
        self.blocks.iter().find(|(key, _, _)| *key == language).map(|(_, render, _)| render)
    }

    /// Whether a registered custom code-block renderer claims this fence (returning a custom widget
    /// instead of falling back to the default code view), evaluated without building any widget.
    pub fn claims(&self, input: &CodeBlockProbeInput<'_>) -> bool {
        let language = filetype_for_info_string(input.language).unwrap_or_else(|| input.language.to_owned());
        let Some((_, _, probe)) = self.blocks.iter().find(|(key, _, _)| *key == language) else {
            return false;
        };
        probe.as_ref().is_none_or(|probe| probe(input))
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
        .table_options(table(theme))
        .conceal(conceal)
        .streaming(streaming);
    for (language, render, _) in &renderers.blocks {
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
/// Updates the table border color to the new theme's `border.base`, repainting tables in place.
pub fn restyle(markdown: &Markdown, theme: &Theme, colors: MarkdownColors, syntax: &Arc<SyntaxTheme>) {
    // Each style Markdown takes builds its blocks again, and a custom block afresh: the first build is not the last.
    RESTYLING.set(true);
    markdown.colors(colors);
    RESTYLING.set(false);
    markdown.syntax_theme(syntax.clone()).table_options(table(theme));
}

thread_local! {
    static RESTYLING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Whether Markdown builds its blocks now for a [`restyle`] that builds them once more before it ends: a renderer
/// whose work is costly may leave a block to the code view now and draw it at the last build.
pub fn restyling() -> bool {
    RESTYLING.get()
}

/// Grid tables with one column of cell padding, bordered in `theme.border.base`.
fn table(theme: &Theme) -> MarkdownTableOptions {
    MarkdownTableOptions {
        style: MarkdownTableStyle::Grid,
        cell_padding_x: Some(1),
        border_color: Some(theme.border.base),
        ..MarkdownTableOptions::default()
    }
}

/// One searchable text block produced by OpenTUI's native Markdown engine (`ot_markdown_*`),
/// matching what [`Markdown`] renders without building any widgets or running layout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShownBlock {
    /// A paragraph or heading after `inline_hook` (including inline math and caller hooks).
    Prose { top_index: usize, text: String },
    /// One GFM table cell after `inline_hook`.
    TableCell { top_index: usize, row: usize, total_rows: usize, text: String },
    /// A fenced or indented code block rendered as code (not claimed by a custom renderer).
    Code { top_index: usize, language: Option<String>, has_info: bool, source_range: Range<usize>, text: String },
    /// A fenced code block claimed by a custom renderer (e.g. Mermaid or LaTeX): displays a
    /// custom widget rather than `Code`, so it contributes zero code-block text matches.
    CustomCode { top_index: usize, language: String },
}

impl ShownBlock {
    /// The displayed text of this block, or `None` for custom-rendered code blocks.
    pub fn text(&self) -> Option<&str> {
        match self {
            Self::Prose { text, .. } | Self::TableCell { text, .. } | Self::Code { text, .. } => Some(text),
            Self::CustomCode { .. } => None,
        }
    }
}

/// Whether `app`'s session reports OSC 8 hyperlink support (same check `opentui::widget::Markdown` uses).
pub fn hyperlinks(app: &App) -> bool {
    app.session()
        .capabilities()
        .is_ok_and(|capabilities| capabilities.flags.contains(opentui::native::CapabilityFlags::HYPERLINKS))
}

/// Output of [`MarkdownParser::parse`]: every shown block in exact document preorder.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParsedMarkdown {
    pub blocks: Vec<ShownBlock>,
}

/// Reusable handle to OpenTUI's native Markdown engine (`ot_markdown_*`) for extracting the exact
/// displayed text of Markdown documents without creating scene nodes, widgets, or layout.
pub struct MarkdownParser {
    doc: native::Doc,
}

impl MarkdownParser {
    /// Creates a parser bound to `app`'s native context.
    pub fn new(app: &App) -> opentui::Result<Self> {
        let flags = sys::OT_MD_CONCEAL | sys::OT_MD_HOOK;
        Ok(Self { doc: native::Doc::new(app.session().context().clone(), flags)? })
    }

    /// Parses `source` through the native Markdown engine using the same flags (`conceal`,
    /// `app.hyperlinks()`, `renderers.math`), inline math expansion, `inline` hook, and custom
    /// code-block claim checks as [`view`].
    pub fn parse(
        &mut self,
        app: &App,
        source: &str,
        renderers: &CodeBlockRenderers,
        conceal: bool,
        syntax: &SyntaxTheme,
        mut inline: impl FnMut(Vec<InlineSpan>, &InlineContext<'_>) -> Vec<InlineSpan>,
    ) -> ParsedMarkdown {
        if source.is_empty() {
            return ParsedMarkdown::default();
        }
        let mut flags = sys::OT_MD_HOOK;
        if conceal {
            flags |= sys::OT_MD_CONCEAL;
        }
        if hyperlinks(app) {
            flags |= sys::OT_MD_HYPERLINKS;
        }
        if renderers.math.is_some() {
            flags |= sys::OT_MD_MATH;
        }
        if self.doc.set_flags(flags).is_err() {
            return ParsedMarkdown::default();
        }
        let Ok(blocks) = self.doc.parse(source) else {
            return ParsedMarkdown::default();
        };
        // Precompute top-level block indices and table row counts from the engine's preorder tree.
        let mut top_count = 0usize;
        let mut block_top = Vec::with_capacity(blocks.len());
        let mut table_rows = vec![0usize; blocks.len()];
        for block in &blocks {
            if block.parent_index == u32::MAX {
                block_top.push(top_count);
                top_count += 1;
            } else {
                let parent = block.parent_index as usize;
                block_top.push(block_top.get(parent).copied().unwrap_or(0));
                if u32::from(block.kind) == sys::OT_MD_TABLE_ROW && parent < table_rows.len() {
                    table_rows[parent] += 1;
                }
            }
        }
        let mut current_row = vec![0usize; blocks.len()];
        let mut shown = Vec::new();
        let width = app.size().0;
        for block in &blocks {
            let index = block.index as usize;
            let top_index = block_top.get(index).copied().unwrap_or(0);
            let kind = u32::from(block.kind);
            match kind {
                sys::OT_MD_TABLE_ROW => {
                    let parent = block.parent_index as usize;
                    if parent < current_row.len() {
                        let row = current_row[parent];
                        current_row[parent] = row + 1;
                        current_row[index] = row;
                    }
                }
                sys::OT_MD_PARAGRAPH | sys::OT_MD_HEADING | sys::OT_MD_TABLE_CELL => {
                    let table_cell = kind == sys::OT_MD_TABLE_CELL;
                    let Some(spans) = self.doc.read_leaf_spans(block.index, conceal) else { continue };
                    let inline_source = self.doc.read_source(block.index).unwrap_or_default();
                    let cx = InlineContext { source: &inline_source, conceal, syntax, table_cell };
                    let spans = match &renderers.math {
                        Some(math) => math_spans(math, spans, &cx),
                        None => spans,
                    };
                    let spans = inline(spans, &cx);
                    let text: String = spans.iter().map(|span| span.span.content.as_ref()).collect();
                    if table_cell {
                        let row_block = block.parent_index as usize;
                        let row = current_row.get(row_block).copied().unwrap_or(0);
                        let table_block = blocks.get(row_block).map(|row| row.parent_index as usize).unwrap_or(0);
                        let total_rows = table_rows.get(table_block).copied().unwrap_or(1).max(1);
                        shown.push(ShownBlock::TableCell { top_index, row, total_rows, text });
                    } else {
                        shown.push(ShownBlock::Prose { top_index, text });
                    }
                }
                sys::OT_MD_CODE => {
                    let Some(code) = self.doc.read_leaf_text(block.index) else { continue };
                    let info =
                        source.get(block.info_start_byte as usize..block.info_end_byte as usize).unwrap_or_default();
                    let is_math = u32::from(block.flags) & sys::OT_MD_BLOCK_MATH != 0;
                    let name = if is_math { Some("math") } else { (!info.is_empty()).then_some(info) };
                    let language = name.and_then(filetype_for_info_string);
                    if let Some(lang) = language.as_deref() {
                        let probe_info = if is_math { "math" } else { info };
                        let input =
                            CodeBlockProbeInput { language: lang, info: probe_info, code: &code, conceal, width };
                        if renderers.claims(&input) {
                            shown.push(ShownBlock::CustomCode { top_index, language: lang.to_owned() });
                            continue;
                        }
                    }
                    let start = (block.source_start_byte as usize).min(source.len());
                    let end = (block.source_end_byte as usize).clamp(start, source.len());
                    shown.push(ShownBlock::Code {
                        top_index,
                        language,
                        has_info: name.is_some(),
                        source_range: start..end,
                        text: code,
                    });
                }
                _ => {}
            }
        }
        ParsedMarkdown { blocks: shown }
    }
}

/// Rewrites untagged code blocks (plain fenced blocks with empty info string and indented code
/// blocks) reported by [`MarkdownParser::parse`] so their opening fence carries `tag`, allowing
/// `Markdown::code_block_renderer(tag, ...)` to receive them without changing their code bytes.
/// Returns `None` when every code block already has an info string.
pub fn tag_untagged_code_blocks(source: &str, parsed: &ParsedMarkdown, tag: &str) -> Option<String> {
    let mut untagged: Vec<(&Range<usize>, &str)> = parsed
        .blocks
        .iter()
        .filter_map(|block| match block {
            ShownBlock::Code { has_info: false, source_range, text, .. } => Some((source_range, text.as_str())),
            _ => None,
        })
        .collect();
    if untagged.is_empty() {
        return None;
    }
    untagged.sort_by_key(|(range, _)| range.start);
    let mut out = String::with_capacity(source.len() + untagged.len() * (tag.len() + 16));
    let mut pos = 0usize;
    for (range, code) in untagged {
        if range.start < pos
            || range.end > source.len()
            || !source.is_char_boundary(range.start)
            || !source.is_char_boundary(range.end)
        {
            continue;
        }
        out.push_str(&source[pos..range.start]);
        let slice = &source[range.start..range.end];
        if let Some(insert_at) = plain_fence_insert_offset(slice) {
            out.push_str(&slice[..insert_at]);
            out.push_str(tag);
            out.push_str(&slice[insert_at..]);
        } else {
            write_fenced_indented(&mut out, source, range, code, tag);
        }
        pos = range.end;
    }
    out.push_str(&source[pos..]);
    Some(out)
}

/// If `slice` begins with a plain opening fence (` ``` ` or `~~~` with empty info string),
/// returns the byte offset inside `slice` right after the fence delimiter chars.
fn plain_fence_insert_offset(slice: &str) -> Option<usize> {
    let line_end = slice.find('\n').unwrap_or(slice.len());
    let first_line = slice[..line_end].strip_suffix('\r').unwrap_or(&slice[..line_end]);
    let mut rest = first_line;
    let mut offset = 0usize;
    loop {
        let trimmed = rest.trim_start_matches(' ');
        let spaces = rest.len() - trimmed.len();
        if let Some(after) = trimmed.strip_prefix('>') {
            let skip = spaces + 1 + usize::from(after.starts_with(' '));
            offset += skip;
            rest = &rest[skip..];
            continue;
        }
        break;
    }
    let trimmed = rest.trim_start_matches(' ');
    let indent = rest.len() - trimmed.len();
    if indent > 3 {
        return None;
    }
    let marker = *trimmed.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let count = trimmed.bytes().take_while(|&byte| byte == marker).count();
    if count < 3 || !trimmed[count..].trim().is_empty() {
        return None;
    }
    Some(offset + indent + count)
}

/// Rewrites an indented code block at `range` into a tagged fenced code block carrying the exact
/// same `code` bytes and container prefix.
fn write_fenced_indented(out: &mut String, source: &str, range: &Range<usize>, code: &str, tag: &str) {
    let slice = &source[range.start..range.end];
    let line_start = source[..range.start].rfind('\n').map_or(0, |index| index + 1);
    let before = &source[line_start..range.start];
    let first_end = slice.find('\n').unwrap_or(slice.len());
    let raw_first = slice[..first_end].strip_suffix('\r').unwrap_or(&slice[..first_end]);
    let code_first = code.split('\n').next().unwrap_or_default().strip_suffix('\r').unwrap_or_default();
    let cont_in_range = raw_first.strip_suffix(code_first).map(strip_code_indent).unwrap_or("");
    let full_prefix = format!("{before}{cont_in_range}");
    let mut max_ticks = 0usize;
    let mut run = 0usize;
    for byte in code.bytes() {
        if byte == b'`' {
            run += 1;
            max_ticks = max_ticks.max(run);
        } else {
            run = 0;
        }
    }
    let fence: String = std::iter::repeat_n('`', (max_ticks + 1).max(3)).collect();
    out.push_str(cont_in_range);
    out.push_str(&fence);
    out.push_str(tag);
    out.push('\n');
    let body = code.strip_suffix('\n').unwrap_or(code);
    for line in body.split('\n') {
        out.push_str(&full_prefix);
        out.push_str(line);
        out.push('\n');
    }
    out.push_str(&full_prefix);
    out.push_str(&fence);
    if slice.ends_with('\n') {
        out.push('\n');
    }
}

/// Strips up to 4 columns of trailing code-block indentation (a single tab or up to 4 spaces).
fn strip_code_indent(prefix: &str) -> &str {
    if let Some(rest) = prefix.strip_suffix('\t') {
        return rest;
    }
    let mut rest = prefix;
    for _ in 0..4 {
        match rest.strip_suffix(' ') {
            Some(next) => rest = next,
            None => break,
        }
    }
    rest
}

#[allow(unsafe_code)]
mod native {
    use opentui::native::Context;
    use opentui::style::{Attributes, Color, Span, Style};
    use opentui::sys;
    use opentui::widget::InlineSpan;

    pub(super) struct Doc {
        context: Context,
        handle: sys::ot_handle,
        flags: u32,
        bytes: Vec<u8>,
        chunks: Vec<sys::ot_styled_text_chunk>,
        spans: Vec<u32>,
        urls: Vec<u8>,
    }

    impl Drop for Doc {
        fn drop(&mut self) {
            // SAFETY: `self.context` keeps the native context alive and `self.handle` was created
            // on it by `ot_markdown_create` and is destroyed here once.
            let _ = unsafe { sys::ot_markdown_destroy(self.context.as_raw(), &self.handle) };
        }
    }

    impl Doc {
        pub(super) fn new(context: Context, flags: u32) -> opentui::Result<Self> {
            let options = make_options(flags);
            let mut handle = sys::ot_handle::default();
            // SAFETY: `context.as_raw()` is valid and both pointers reference stack structs.
            let status = unsafe { sys::ot_markdown_create(context.as_raw(), &options, &mut handle) };
            check("ot_markdown_create", status)?;
            Ok(Self {
                context,
                handle,
                flags,
                bytes: Vec::new(),
                chunks: Vec::new(),
                spans: Vec::new(),
                urls: Vec::new(),
            })
        }

        pub(super) fn set_flags(&mut self, flags: u32) -> opentui::Result<()> {
            if self.flags == flags {
                return Ok(());
            }
            let options = make_options(flags);
            let mut result = sys::ot_markdown_result::default();
            // SAFETY: `self.context` and `self.handle` are live on the UI thread.
            let status =
                unsafe { sys::ot_markdown_set_options(self.context.as_raw(), &self.handle, &options, &mut result) };
            check("ot_markdown_set_options", status)?;
            self.flags = flags;
            Ok(())
        }

        pub(super) fn parse(&mut self, source: &str) -> opentui::Result<Vec<sys::ot_markdown_block>> {
            let ctx = self.context.as_raw();
            let mut result = sys::ot_markdown_result::default();
            // Clear any prior document so consecutive identical inputs still report every block.
            // SAFETY: `ctx` and `self.handle` are live; empty slice with length 0 is valid.
            check("ot_markdown_set", unsafe {
                sys::ot_markdown_set(ctx, &self.handle, std::ptr::null(), 0, &mut result)
            })?;
            let mut drain = 0u32;
            // SAFETY: null buffer with capacity 0 queries count without writing.
            let _ = unsafe { sys::ot_markdown_read_changes(ctx, &self.handle, std::ptr::null_mut(), 0, &mut drain) };
            let len = u32::try_from(source.len()).map_err(|_| err("ot_markdown_set", sys::OT_INVALID_ARGUMENT))?;
            // SAFETY: `source.as_ptr()` is valid for `len` UTF-8 bytes.
            check("ot_markdown_set", unsafe {
                sys::ot_markdown_set(ctx, &self.handle, source.as_ptr(), len, &mut result)
            })?;
            // SAFETY: `ctx` and `self.handle` are live.
            check("ot_markdown_finish", unsafe { sys::ot_markdown_finish(ctx, &self.handle, &mut result) })?;
            let mut count = 0u32;
            // SAFETY: null buffer with capacity 0 queries the exact changed-block count.
            check("ot_markdown_read_changes", unsafe {
                sys::ot_markdown_read_changes(ctx, &self.handle, std::ptr::null_mut(), 0, &mut count)
            })?;
            if count == 0 {
                return Ok(Vec::new());
            }
            let mut blocks = vec![sys::ot_markdown_block::default(); count as usize];
            // SAFETY: `blocks` has `count` initialized slots and stays valid for the call.
            check("ot_markdown_read_changes", unsafe {
                sys::ot_markdown_read_changes(ctx, &self.handle, blocks.as_mut_ptr(), count, &mut count)
            })?;
            blocks.truncate(count as usize);
            Ok(blocks)
        }

        pub(super) fn read_leaf_text(&mut self, index: u32) -> Option<String> {
            self.read_leaf(index).ok()?;
            Some(String::from_utf8_lossy(&self.bytes).into_owned())
        }

        pub(super) fn read_leaf_spans(&mut self, index: u32, conceal: bool) -> Option<Vec<InlineSpan>> {
            self.read_leaf(index).ok()?;
            let mut at = 0usize;
            let spans = self
                .chunks
                .iter()
                .zip(&self.spans)
                .map(|(chunk, flags)| {
                    let end = (at + chunk.byte_count as usize).min(self.bytes.len());
                    let text = String::from_utf8_lossy(&self.bytes[at..end]).into_owned();
                    at = end;
                    let color = |flag: u32, raw: [u16; 4]| (chunk.flags & flag != 0).then(|| Color::from_raw(raw));
                    let style = Style {
                        fg: color(sys::OT_SCENE_TEXT_FOREGROUND, chunk.foreground),
                        bg: color(sys::OT_SCENE_TEXT_BACKGROUND, chunk.background),
                        attributes: Attributes::from_bits(chunk.attributes as u8),
                    };
                    let mut span = Span::styled(text, style);
                    if chunk.flags & sys::OT_SCENE_TEXT_LINK != 0 {
                        let start = (chunk.link_offset as usize).min(self.urls.len());
                        let url_end = (start + chunk.link_byte_count as usize).min(self.urls.len());
                        span = span.link(String::from_utf8_lossy(&self.urls[start..url_end]).into_owned());
                    }
                    let tex = span.content.as_ref();
                    let (open, close) = if conceal {
                        ("", "")
                    } else if tex.starts_with('$') {
                        ("$", "$")
                    } else {
                        ("\\(", "\\)")
                    };
                    let math = (flags & sys::OT_MD_SPAN_MATH != 0)
                        .then(|| Some(tex.strip_prefix(open)?.strip_suffix(close)?.to_owned()))
                        .flatten();
                    let mut inline = InlineSpan::from(span);
                    inline.code = flags & sys::OT_MD_SPAN_CODE != 0;
                    inline.math = math;
                    inline
                })
                .collect();
            Some(spans)
        }

        pub(super) fn read_source(&self, index: u32) -> opentui::Result<String> {
            let ctx = self.context.as_raw();
            let mut len = 0u32;
            // SAFETY: null buffer with capacity 0 queries byte count.
            check("ot_markdown_read_source", unsafe {
                sys::ot_markdown_read_source(ctx, &self.handle, index, std::ptr::null_mut(), 0, &mut len)
            })?;
            if len == 0 {
                return Ok(String::new());
            }
            let mut buf = vec![0u8; len as usize];
            // SAFETY: `buf` has `len` writable bytes.
            check("ot_markdown_read_source", unsafe {
                sys::ot_markdown_read_source(ctx, &self.handle, index, buf.as_mut_ptr(), len, &mut len)
            })?;
            buf.truncate(len as usize);
            Ok(String::from_utf8_lossy(&buf).into_owned())
        }

        fn read_leaf(&mut self, index: u32) -> opentui::Result<()> {
            let ctx = self.context.as_raw();
            let (mut bytes, mut chunks, mut urls) = (0u32, 0u32, 0u32);
            // SAFETY: null buffers with 0 capacities query exact sizes for leaf `index`.
            check("ot_markdown_read_leaf", unsafe {
                sys::ot_markdown_read_leaf(
                    ctx,
                    &self.handle,
                    index,
                    std::ptr::null_mut(),
                    0,
                    &mut bytes,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                    &mut chunks,
                    std::ptr::null_mut(),
                    0,
                    &mut urls,
                )
            })?;
            self.bytes.resize(bytes as usize, 0);
            self.chunks.resize(chunks as usize, sys::ot_styled_text_chunk::default());
            self.spans.resize(chunks as usize, 0);
            self.urls.resize(urls as usize, 0);
            if bytes + chunks + urls > 0 {
                // SAFETY: each scratch buffer was resized to at least its queried capacity.
                check("ot_markdown_read_leaf", unsafe {
                    sys::ot_markdown_read_leaf(
                        ctx,
                        &self.handle,
                        index,
                        self.bytes.as_mut_ptr(),
                        bytes,
                        &mut bytes,
                        self.chunks.as_mut_ptr(),
                        self.spans.as_mut_ptr(),
                        chunks,
                        &mut chunks,
                        self.urls.as_mut_ptr(),
                        urls,
                        &mut urls,
                    )
                })?;
                self.bytes.truncate(bytes as usize);
                self.chunks.truncate(chunks as usize);
                self.spans.truncate(chunks as usize);
                self.urls.truncate(urls as usize);
            }
            Ok(())
        }
    }

    fn make_options(flags: u32) -> sys::ot_markdown_options {
        sys::ot_markdown_options {
            struct_size: std::mem::size_of::<sys::ot_markdown_options>() as u32,
            abi_version: sys::OT_CONTEXT_ABI_VERSION,
            flags,
            syntax_style: sys::ot_handle::default(),
            ..Default::default()
        }
    }

    fn check(operation: &'static str, status: sys::ot_status) -> opentui::Result<()> {
        if status == sys::OT_OK { Ok(()) } else { Err(err(operation, status)) }
    }

    fn err(operation: &'static str, status: sys::ot_status) -> opentui::Error {
        opentui::Error::Native { operation, status: opentui::Status::from_code(status) }
    }
}
