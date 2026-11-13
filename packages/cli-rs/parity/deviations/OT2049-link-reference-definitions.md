# OT2049: link reference definitions are hidden

TypeScript: on `@opentui/core` 0.8.4 the TUI draws link reference definitions (`[cafes]: https://…`) as text.
`marked` lexes each one as a `def` token, and `MarkdownRenderable` has no case for `def`, so the token falls through
to the generic path that draws its raw source. The links that use the definitions render in two ways:

- In a table cell, `marked` resolves `[nearby café][cafes]`, and with conceal on the cell shows
  `nearby café (https://…)`. The ` (` takes the `markup.link` style.
- In a paragraph, the block is drawn from its raw source through the tree-sitter Markdown highlighter. Conceal hides
  the `[cafes]` label but cannot resolve it, so the paragraph shows `nearby café` without the URL.

Rust: the client's `Markdown` widget runs on OpenTUI's native engine (OT2049), which follows CommonMark: a definition
produces no output, and every reference link resolves. A paragraph shows `nearby café (https://…)`, as a table cell
does. In a table cell the `(` of the suffix is in the text color, not `markup.link`; the same is true for inline
links in table cells.

Driven against TS, and equal when run TS against TS: `parity/scenarios/OT/link-definitions.sim.ts` (P-TUI). A reply
has a table with two reference links, a paragraph with one, and the two definitions at its end. At the `done`
checkpoint:

- TS shows the two definition rows under the paragraph; Rust shows a blank row there, so the turn row
  (`Build · Simulated Model`) is two rows higher (224 cells).
- The paragraph's link has ` (https://example.com/cafes)` in Rust only (34 cells).
- The `(` of each table link differs in color only (2 cells).

Reason: CommonMark (0.31.2, section 4.7) says a link reference definition "does not correspond to a structural
element of a document" and is not rendered. Core's newer releases render through the same engine and match Rust:
since anomalyco/opentui#2079 (M3), Core's `Markdown.test.ts` expects `See [y] here.` followed by `[y]: /a` to show
`See y (/a) here.` with no definition row. The TS TUI sets nothing that asks for the definitions
(`message-parts.tsx` `TextPart`), so the 0.8.4 behavior is the fall-through, not a choice. The differences go away
when TS moves to an `@opentui/core` release that includes #2079, except perhaps the `(` color, which this scenario
then shows.
