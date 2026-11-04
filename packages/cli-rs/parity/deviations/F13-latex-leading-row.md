# F13: no blank row above a formula that opens a message

**TypeScript.** The LaTeX renderer gives its scroll box `marginTop: 1` (`packages/latex/src/markdown.ts:81`),
because Core's top-level Markdown sets no margin on a custom block. Between blocks this gives the usual one blank
row. When the formula is the first block of the text, it also leaves a blank row above it, under the
message's top edge.

**Rust.** opentui-rust's `Markdown` puts one blank row between blocks and none before the first. The formula widget
has no margin of its own. Between blocks the rows are the same: `parity/fixtures/P.2/*.json` match cell for cell.
A formula that opens the text starts on the first row.

**Reason.** A renderer does not know if its block is first, so it cannot add the margin only there. Adding it
always would put two blank rows between blocks everywhere else.
