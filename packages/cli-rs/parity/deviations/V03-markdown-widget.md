# V03: Markdown on opentui-rust's current widget

TypeScript: `TextPart` (`packages/tui/src/routes/session/message-parts.tsx:173-200`) renders assistant text with
Core's `MarkdownRenderable`: the `marked` parser, `conceal` from `session.markdown` (markers hidden in `rendered`
mode, shown otherwise), every span styled through the syntax style (`markup.*` scopes), `renderNode` for code
fences (LaTeX, Mermaid), `streaming`, `internalBlockMode: "top-level"`, and grid tables with `cellPaddingX: 1`.

Rust: `opencode_ui::markdown::view` wraps opentui-rust's `Markdown` widget
(`rust:crates/opentui/src/widget/markdown.rs`), which has its own parser and layout and styles spans through
`MarkdownColors`. Seen in `parity/fixtures/U.4a/markdown-*.json` (`crates/ui/tests/content.rs`):

- Markers are always concealed. `session.markdown = "raw"` (markers shown) has no effect.
- A link shows only its label. Core also shows ` (url)` after the label in rendered mode.
- Bullets are `•`, `◦`, `▪` by depth. Core uses `-` at every depth.
- Only `#` and `##` headings take `markdown.heading`. Core colors every level; deeper levels show in the text
  color here, still bold.
- Italic text keeps the text color. Core colors it `markdown.emphasis`.
- Code blocks are padded by one column on each side. Core starts them at the paragraph's column.
- No code-fence hook, so LaTeX and Mermaid fences show as code. No table options: tables use the widget's layout.
- The block background (`bg={theme.background.base}`) is not set; the widget has no background. The transcript
  background shows through, which is the same color.

Matching cells: paragraphs, bold, inline code, link labels, list markers' color and indentation, ordered lists,
headings' text and position, and the spacing between blocks.

Reason: an opentui-rust difference not yet aligned. G.3 (`markdown-parity`) adds conceal, the code-block hook,
streaming, and table options to the widget; U.4c moves the wrapper onto them and removes this file. The rows the
test exempts are listed in `crates/ui/tests/content.rs`, which fails once a row matches.
