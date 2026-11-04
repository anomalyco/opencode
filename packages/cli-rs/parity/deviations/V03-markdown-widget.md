# V03: Markdown colors on opentui-rust's widget

TypeScript: `TextPart` (`packages/tui/src/routes/session/message-parts.tsx:173-200`) renders assistant text with
Core's `MarkdownRenderable`: the `marked` parser, `conceal` from `session.markdown` (markers hidden in `rendered`
mode, shown otherwise), every span styled through the syntax style (`markup.*` scopes), `renderNode` for code
fences (LaTeX, Mermaid), `streaming`, `internalBlockMode: "top-level"`, and grid tables with `cellPaddingX: 1`.

Rust: `opencode_ui::markdown::view` wraps opentui-rust's `Markdown` widget
(`rust:crates/opentui/src/widget/markdown.rs`), which has its own parser and lays out like Core's top-level mode
(G.3). Conceal, streaming, the code-block renderer hook, and grid tables are set as in TypeScript. The widget styles
spans through `MarkdownColors`, not `markup.*` scopes, so some colors differ. Seen in
`parity/fixtures/U.4a/markdown-prose.json` and `U.4c/markdown-raw.json` (`crates/ui/tests/content.rs`), foreground
and attributes only:

- A link's ` (url)` is all in the link color, and the `(` is underlined. Core shows the parentheses in the text
  color and the URL in `markdown.link`. With markers shown, the `](` and the URL are in the link color too, where
  Core uses the text color and `markdown.link`.
- Only `#` and `##` headings take `markdown.heading`. Core colors every level; deeper levels show in the text
  color here, still bold.
- Italic text keeps the text color. Core colors it `markdown.emphasis`.

Not in the corpus, documented by G.3 (`rust:crates/opentui/docs/markdown.md`): task items keep their checkbox,
concealed escapes drop the backslash, quotes hold rendered blocks, and setext headings show as ATX headings in
source mode.

The block background (`bg={theme.background.base}`) is not set; the widget has no background. The transcript
background shows through, which is the same color.

Reason: an opentui-rust difference not yet aligned. Styling spans through scopes, or more `MarkdownColors` fields,
would remove the color rows. The rows the test exempts are listed in `crates/ui/tests/content.rs`, which fails once
a row matches.
