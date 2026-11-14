# OT2112: Markdown table columns follow the delimiter row

TypeScript: `@opentui/core` 0.8.4 left-aligns every Markdown table column. A `---:` column and a `:---:` column look
the same as a `---` column, in the TUI and in mini.

Rust: the client pins OpenTUI `32e9e414e`. Since anomalyco/opentui#2112, the native parser reports each column's
alignment, and the `Markdown` widget passes it to its table. A `---:` column is right-aligned and a `:---:` column is
centred, the header included. Characters, borders and widths are unchanged; only the position of text in its cell
moves.

Driven against TS:

- `parity/scenarios/OT/table-align.sim.ts` (P-TUI): a reply with a packing list. `Item` is left-aligned, `Qty`
  right-aligned, and `Weight` and `Packed` centred. The four rows with text differ in those three columns, 86 cells.
  The borders, the `Item` column and the text around the table are equal.
- `parity/scenarios/OT/table-align-mini.pty.ts` (P-PTY): mini replays the same table as borderless columns. The three
  body rows differ. The header row is equal, because each header is the widest cell of its column.
- `crates/ui/tests/all/content.rs` `markdown_table_matches_typescript` (P-COMP, `U.4c/markdown-table`, written by
  TS): the corpus table has a `---:` `Size` column. 14 cells differ.

Reason: Core's newer releases align columns too (the same pull request changes `MarkdownRenderable`). The difference
goes away when TS moves to an `@opentui/core` release that includes #2112.
