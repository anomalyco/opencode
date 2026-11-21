# F16: the rows around a fence a renderer draws

**TypeScript (`@opentui/core` 0.9.4, since #63989).** Markdown lays out its top-level blocks with one row between
them (`rowGap: 1`), a block a `renderBlock` renderer returns included, and none before the first. A renderer that sets
no margin (`markdown.registerCodeBlockRenderer`, the plugin fences of `P.2/plugin-fence-margin`) gets that one row, as
Rust does: that scenario is equal. But the built-in LaTeX and Mermaid renderers still set `marginTop: 1`
(`packages/latex/src/markdown.ts`, `packages/merman/src/markdown.ts`), a workaround for Core 0.8.4, which gave a
custom block a `NaN` margin and so no row. With the gap that margin is a second row: TS draws two blank rows above a
formula or a diagram that follows a block, and everything below moves down a row per such fence.

**Rust.** opentui-rust's `Markdown` puts one blank row between any two blocks and none before the first, and the
LaTeX and Mermaid fences add none of their own. So a formula or a diagram after a block has one blank row above it.

**A renderer that wraps the default view** (contract 2.x, step D: one that boxes `defaultRender()` under a label).
Its rows are equal now. In TS 0.9.4 the default code view paints its glyphs on the Markdown's `bg` (the page,
`#0a0a0a`), so inside the plugin's box each line of code sits on a strip of the page color; in Rust the code's glyphs
keep the box's background, which differs in color only.

**Reason.** A TS defect, fixed in Rust: Rust keeps the spacing Core means, one row between blocks. The second row is TS's leftover
margin, not a design: once the built-in renderers drop `marginTop: 1`, `P.2/fence-margin` is equal again. Drives:
`P.2/fence-margin` (two formulas and a diagram after blocks, about 175 cells), `P.2/inline-math` (the fence pushes the
transcript up a row), the P-COMP tests `crates/latex/src/tests.rs` (`transcript_fences_match_typescript`) and
`crates/mermaid/tests/all/markdown.rs`. A fence that opens a message differs as `F13-latex-leading-row.md` and
`F12-mermaid-leading-row.md` say.
