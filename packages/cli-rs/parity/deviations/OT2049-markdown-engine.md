# OT2049: Markdown on OpenTUI's native engine

TypeScript (before #63989): the TUI and mini rendered Markdown with `@opentui/core` 0.8.4's `MarkdownRenderable` (marked). Since #63989 TS runs Core 0.9.4, which renders through the native engine too; the setext-heading item below was not measured again. A setext
heading (`Title` over `=====` or `---`) is drawn as plain text in the Markdown color, underline row included. While a
message streams, a closing fence closes its block as soon as the three backticks arrive, with or without a line
ending.

Rust: the client pins OpenTUI `d3da53173`, where the `Markdown` widget runs on the native streaming engine
(anomalyco/opentui#2049, #2037, #2078). The characters now match TS where the old Rust parser differed: setext
underline rows and the blank rows around rules and headings are where TS puts them (the old parser dropped them),
and `- - -` is a rule. Two differences remain:

- A setext heading is a heading: its text and its underline row take the `markup.heading` style (heading color,
  bold; level 1 also underlined), as an ATX heading does in both clients. Seen by rendering `Title` / `=====`,
  `Sub` / `---` and two rules through both clients' `TextPart` setup (the U.4c harness): every character equal, the
  heading cells differ in color and attributes only.
- (Resolved by #63989.) While streaming, the engine holds a last line that has no line ending. TS on Core 0.9.4 runs
  the same engine and holds it too: `parity/scenarios/OT/held-fence.sim.ts` shows the formula in both until more text
  arrives, and differs only by `F16-plugin-fence-margin.md`'s row.

Reason: the engine follows CommonMark, and Core's newer releases render through it as well. Mini commits only
closed blocks to scrollback (`stable_prefix` includes the closing blank line), so no held line is committed. The
rule color matches TS (`markdown.text`, the `U.4c/markdown-rules` fixture). The differences go away when TS moves
to an `@opentui/core` release that includes the engine.
