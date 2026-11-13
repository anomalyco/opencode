# M06: mini keeps the blank row where a streamed reply is cut

TypeScript: mini commits a streaming Markdown reply to the scrollback in parts: the blocks Core 0.8.4 calls stable
(all but the last two of marked's tokens), then the rest. Each part before the end is committed with
`trailingNewline: false` (`flushActive` and `commitMarkdownBlocks` in `packages/tui/src/mini/scrollback.surface.ts`),
so its last row stays open. That row is the empty gap before the next block, and the next part's first row is written
into it. One blank row between blocks is lost at each cut:

- In `parity/scenarios/M.1/table-gap.pty.ts`, a replayed `Packing list:` / table / `Done.` shows the table directly
  under `Packing list:`.
- A replayed `One.` / `Two.` / `Three.` shows `Three.` directly under `Two.`.

Core renders both gaps when it lays out the whole reply (block `y` 0, 2 and 6 for the table reply, 0, 2 and 4 for
the paragraphs).

Rust: mini cuts the reply at the same block (`stable_prefix`) and ends each part before the end with a newline
(`Active::commit` in `crates/mini/src/scrollback.rs`). The next part then starts on its own row, and the committed rows
equal the reply rendered whole. The checkpoint has blank rows before the table and before `Three.`, and the rows below
each move down, 16 lines in all. Test `scrollback::a_streamed_reply_commits_the_rows_of_the_whole_reply` checks that
streamed equals whole over paragraph, table, list, fence and heading boundaries, with the text cut once, at every
line and at every character. Ending the parts without the newline gives TS's rows.

Reason: O-89. TS's lost row is a defect in TS mini's commit path; OpenTUI's commit rule is as documented ("startOnNewLine
adds a newline before this commit if the previous commit ended mid-row"). The difference goes away when TS mini ends
its intermediate parts with a newline.
