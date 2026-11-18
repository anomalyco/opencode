# P.2: Markdown math, and opentui-tex's parser fixes

**TypeScript.** The LaTeX plugin registers code-block renderers for `latex` and `math` fences only
(`packages/latex/src/plugin.ts`). Core's Markdown does not parse math, so `$…$`, `\(…\)`, `$$…$$` and `\[…\]` show
as typed: `Energy is $E=mc^2$`.

**Rust.** Where the plugin renders (assistant text, the compaction summary, reasoning, and plugin Markdown with
the plugin fences), the TUI turns on OpenTUI's Markdown math (`MarkdownExtension::Math`, OpenTUI #2072):

- `$$…$$` and `\[…\]` reach the `math` fence renderer and draw as display math, as a `math` fence does in both.
- `$…$` and `\(…\)` draw on one row in the text through the plugin's inline renderer (`Setup::inline_math`), in
  Unicode: scripts as super- and subscript characters where Unicode has them, `\frac{a}{b}` as `a/b`, `\sqrt{x}`
  as `√x`, accents as combining marks, matrices as `(a, b; c, d)`. TeX that does not parse shows as typed, without
  its delimiters. With markers shown (`session.markdown` is `source`), math keeps its source and delimiters.
- Dollars that are not math stay text, as OpenTUI decides: `$5 and $10`, `$HOME`, a lone `$`, `\$`. While a
  message streams, a `$` shows as text until it is decided, and math that showed never reverts.

The parser and layout take opentui-tex's fixes; `P2-latex-opentui-tex` lists where fences then differ from TS,
such as `\displaystyle \frac{a}{b}` with no space before the fraction. Inputs TS rejects and Rust now draws:
`\ `, `\degree`, combining marks after a command or delimiter, comments inside raw groups, and `\limits` after a
styled operator.

`P.2/inline-math` shows a message with all of these. The `latex` fence and the line of dollars match; the inline
and display math, and the rows below them, differ (191 cells).

**Reason.** Models write `$…$` math in prose constantly, and its TeX is hard to read in a terminal. opentui-tex's
parser fixes are bug fixes: TS drew a stray space or rejected the input.
