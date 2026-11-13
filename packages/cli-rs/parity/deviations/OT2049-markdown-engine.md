# OT2049: Markdown on OpenTUI's native engine

TypeScript: the TUI and mini render Markdown with `@opentui/core` 0.8.4's `MarkdownRenderable` (marked). A setext
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
- While streaming, the engine holds a last line that has no line ending, because the next bytes can still change
  what it is. Both clients pass the message text trimmed (`TextPart`, `assistant.rs`), so a closing fence at the
  end of the text so far stays open until more text or the end of the stream arrives. In
  `parity/scenarios/OT/held-fence.sim.ts` a reply streams a LaTeX fence whose `x^2` renders, then
  ` + \unsupported{x}` and the closing fence without its newline, and pauses: TS shows the source
  `x^2 + \unsupported{x}`, Rust still shows the last formula, `x²`. Once the reply goes on (`Done.`), both show the
  source.

Reason: the engine follows CommonMark, and Core's newer releases render through it as well. Mini commits only
closed blocks to scrollback (`stable_prefix` includes the closing blank line), so no held line is committed. The
rule color matches TS (`markdown.text`, the `U.4c/markdown-rules` fixture). The differences go away when TS moves
to an `@opentui/core` release that includes the engine.
