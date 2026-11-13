# M06: mini keeps a different blank row around a table

TypeScript: mini replays a reply `Packing list:`, a table, `Done.` with no blank row between `Packing list:` and the
table, and one blank row between the table and `Done.`.

Rust: mini puts the blank row between `Packing list:` and the table, and none between the table and `Done.`.

Each client drops one of the two blank rows that its Markdown widget draws when it renders the whole reply at once.
The TUI, which renders the whole reply, keeps both in both clients (`parity/scenarios/OT/table-align.sim.ts`). In
`parity/scenarios/M.1/table-gap.pty.ts` the table rows move one row between the clients, so four lines differ. Rust
mini drew the table as a grid before `repin-c5` and lost the same blank row then.

Reason: both clients commit a Markdown reply to the scrollback in parts. TS commits Core's top-level blocks
(`commitMarkdownBlocks` in `packages/tui/src/mini/scrollback.surface.ts`), and Rust commits the rows of the reply's
complete blocks (`flush_active` in `crates/mini/src/scrollback.rs`). Neither path has been traced to the row it
drops. Until that is done, this file records the difference.
