# F12: no blank row above a diagram that opens a message

**TypeScript.** The Mermaid renderer gives its diagram `marginTop: 1` (`packages/merman/src/markdown.ts`), because
Core's top-level Markdown sets no margin on a custom block (`F16-plugin-fence-margin.md`). Between blocks this gives
the usual one blank row. When the diagram is the first block of the text, it also leaves a blank row above it, under
the message's top edge.

**Rust.** opentui-rust's `Markdown` puts one blank row between blocks and none before the first. The diagram has no
margin of its own. Between blocks the rows are the same (`parity/scenarios/P.2/fence-margin.app.ts`). A diagram that
opens the text starts on the first row: `P.2/mermaid-opens` is one row shorter, and otherwise equal.

**Reason.** As for a formula (`F13-latex-leading-row.md`): a renderer does not know if its block is first, so it
cannot add the margin only there, and adding it always would put two blank rows between blocks everywhere else.
