# V03: Markdown on opentui-rust's widget

TypeScript: `TextPart` (`packages/tui/src/routes/session/message-parts.tsx:173-200`) renders assistant text with
Core's `MarkdownRenderable`: the `marked` parser, `conceal` from `session.markdown` (markers hidden in `rendered`
mode, shown otherwise), every span styled through the syntax style (`markup.*` scopes), `renderNode` for code
fences (LaTeX, Mermaid), `streaming`, `internalBlockMode: "top-level"`, and grid tables with `cellPaddingX: 1`.

Rust: `opencode_ui::markdown::view` wraps opentui-rust's `Markdown` widget
(`rust:crates/opentui/src/widget/markdown.rs`), which has its own parser and lays out like Core's top-level mode
(G.3). Conceal, streaming, the code-block renderer hook, grid tables, and scope styles (G.11,
`Markdown::scope_styles`) are set as in TypeScript. `parity/fixtures/U.4a/markdown-prose.json`,
`U.4c/markdown-raw.json`, and `U.4c/markdown-table.json` match cell for cell, colors included
(`crates/ui/tests/content.rs`).

Not in the corpus, documented by G.3 (`rust:crates/opentui/docs/markdown.md`): task items keep their checkbox,
concealed escapes drop the backslash, quotes hold rendered blocks, and setext headings show as ATX headings in
source mode.

The block background (`bg={theme.background.base}`) is not set; the widget has no background. The transcript
background shows through, which is the same color.

Reason: the widget's own parser, which differs from `marked` and Core's tree-sitter queries in these cases.
