# P.2 LaTeX plugin (`opencode-latex`)

`opencode.latex` draws `latex` and `math` Markdown fences (and `tex`, which resolves to `latex`) as Unicode math in
terminal cells, as `packages/latex/src/plugin.ts` does. It registers one renderer for both languages through the
P.1 code-block API. Beyond TS, it also draws Markdown math: `$…$` and `\(…\)` on one row in the text, and `$$…$$`
and `\[…\]` as display math (deviation `P2-latex-inline`).

## Library choice

Plan 6.10 asks for a plugin on a Rust library. The run notes add: if no library gives terminal output close to TS,
parse with a library and port only the TS layout and symbol tables.

No Rust crate lays out math in terminal cells. I checked the parser candidates:

- `pulldown-latex` 0.8.0 is the maintained KaTeX-style parser. It emits MathML-oriented events. A probe over the
  TS test sources (`plprobe`, not committed) found these problems:
  - `\left(A\rightarrow B\right)` and `\left(\left[A\right]\rightharpoonup B\right)` fail with "expected a
    delimiter token". The parser reads `\rightarrow` as `\right` plus `arrow`. Arrows inside `\left…\right` are
    common in model output, and TS renders both.
  - `\displaylines` and `\mbox` are unknown commands. `\newcommand` cannot define `\displaylines`, because `\\`
    is rejected inside the expansion.
  - `\operatorname*{arg\,max}_{x}` comes back as the function name `*{arg\,max}_{x}`, followed by stray events.
  - `\cfrac[l]{1}{12345}` parses `[l]` as the numerator and draws the wrong fraction. It does not fall back to
    the source.
  - MathML artifacts reach the events: `~` becomes the text `&nbsp;`, `-` becomes U+2212, and text-group escapes
    such as `\{` stay raw.
- `latex2mathml` and `katex` (JavaScript through an embedded engine) target HTML and MathML and are further from
  terminal output.

Mapping `pulldown-latex` events back to the TS structure would take as much code as the TS parser (598 lines),
and it would still need workarounds for the bugs above. So the crate ports the TS parser, layout, and tables,
and uses `unicode-segmentation` for graphemes (TS `Intl.Segmenter`). The P-ORACLE test checks every one of the
207 cases against TS. If a library later gives equal output, it can replace `parse.rs` behind `render`.

## Modules

- `parse.rs`: `parser.ts` and `limits.ts` in strict mode, the mode the plugin uses: unsupported commands,
  environments, and delimiters fail. The 100 000-character source limit and the 256-level nesting limit are kept.
  User macros (`ParseOptions.macros`) are not ported: the plugin never passes any.
- `layout.rs`: `layout.ts`. `Layout` holds cells, width, height, and baseline, and `Display` gives TS
  `toString`. `Options` keeps `displayMode` and `compactScripts` for the oracle. The plugin uses the defaults
  (display math, compact scripts).
- `symbols.rs`: `symbols.ts` with opentui-tex's changes: `\epsilon` is `ϵ` and `\varepsilon` `ε`, `\bullet` is
  `•`, `\degree`, and `/`, `<` and `>` as delimiters.
- `inline.rs`: inline math on one row. `linear` rewrites what display math stacks: `\frac{a}{b}` is `a/b`
  (parentheses around several atoms), `\sqrt[3]{x}` is `∛x`, a script Unicode has no characters for is `^(…)` or
  `_(…)`, limits and `\overset` are scripts, accents are combining marks, a matrix is `(a, b; c, d)`. The layout then
  runs with `Options::inline`, whose compact scripts take every Latin and Greek super- and subscript letter Unicode
  has. A source that does not parse, or that lays out to nothing, is an error.
- `lib.rs`: `plugin()`, `render()`, and `renderer()`, the Markdown adapter (`markdown.ts`). The formula is a
  `Text` with no wrapping, as wide as the formula, inside a `ScrollBox` that scrolls only sideways, with hidden
  scrollbars. TS adds one row of top margin. The Rust Markdown already puts a blank row between blocks, so the
  widget adds none (deviation `F13-latex-leading-row`). Structural glyphs (brackets, the radical, box drawing) use
  `theme.text.muted`. Everything else uses `theme.text.base`, or `\textcolor`'s color (`#rgb`, `#rrggbb`, an
  xcolor base color). Relations are bold. A source that does not parse returns `None`, so Markdown shows the
  source in its code view; so does an empty source, one over 4096 UTF-8 bytes, a block over 16 384 cells, and a
  formula that draws nothing (opentui-tex's Unicode backend).

## opentui-tex

Simon's opentui-tex (`math-parser.ts`, `math-layout.ts`) grew from the same parser and is ahead of TS. The crate
takes its fixes where they apply to cells: literals are whole graphemes, so a prepended or combining character does
not split from its base or take TeX syntax; combining marks after a command or delimiter stay on it, and on a
stretched delimiter's middle row; style directives and `\limits` make no atom, so `x^\displaystyle 2` is `x²` and a
leading `\displaystyle` adds no space; `\limits` reaches an operator through `\mathbf` and colors, and so does the
scripts' placement and the operator's spacing; `\color` ends at a matrix cell; `\not` takes an argument and negates
through styles; comments end at `\r` too and leave raw groups (`\textcolor`, array columns), not text; `\ ` is a
space; an empty script, such as an empty `\textcolor`, adds no rows. `tex_rows.rs` has its parser and layout rows.

Its layout too (`latex-more`), where fences then differ from TS (deviation `P2-latex-opentui-tex`, which lists
each oracle case): the radical is `√` on the radicand's baseline under a `╭─` overbar, with its index above;
matrix rows have no blank row between them; limits come in three ways (`parse::Limits`: `\int` beside, `\sum` above
and below in display math, `\limits` and `\operatorname*` always above and below); widths are `string-width`'s
(`unicode-width`), and a delimiter is as wide as its glyph with its marks; a literal delimiter not in the table
fails.

`parse::Mode` ports its two modes. `permissive` keeps an unsupported command as its name in text and an unsupported
delimiter as its name or character; the plugin stays strict, because `latex` fences often hold whole documents
(`\documentclass`, `\section`), which permissive mode would draw as run-together command names where strict mode
shows the source. `incomplete` reads a prefix as one streams: a construct the end cuts off takes `□` for the missing
part, and malformed syntax before the end still fails. The fence renderer uses it while the fence streams (see
Streaming).

Not taken: its renderable (selection, sizing, scrolling, theme updates, the `fallback` and `[TeX error]` output,
the raw-source tail of an unrecoverable stream), whose place the host's fence widget and code view take; output
clipping to a width and height (`boxToOutput`), as the host scrolls; the native renderer and its macro and column
aliases; the document parser (`parseDocument`, `parseInline`) and its document-wide bounds, whose place OpenTUI's
Markdown takes, with the 4096-byte bound per formula; and request cancellation, as rendering is synchronous.

## Markdown math

`CodeBlockRenderers` carries the inline math renderer of `Setup::inline_math` (in-process plugins only; the other
loaders do not carry it). A `markdown::view` with one turns on `MarkdownExtension::Math` and an inline hook that
replaces each math span with the renderer's row, in the span's style with the row's attributes: relations bold,
`\mathbf` and `\mathit` as in display math, no colors of its own. With markers shown it keeps the source. Session
links compose after it (`markdown::inline_hook`). So math is on wherever the plugin fences are: assistant text, the
compaction summary, reasoning, and plugin Markdown. The `mini` client and Markdown without plugin renderers keep `$`
as text.

OpenTUI decides what is math: a `$` that may still be currency or a shell variable shows as text until it is
decided, and math never reverts while a message streams. The renderer is pure, so it keeps that property.

## Streaming

While the fence streams and is open, the renderer draws the formula as far as it goes, as opentui-tex's preview
does: whole if it parses, else in `Mode::incomplete` with `□` placeholders. TS shows the source until the formula
parses. When even the incomplete parse fails (a command name half typed, `\fr`), it keeps the last frame, as TS
does: it returns `CodeBlock::previous` (the widget it returned last for that block) when the document is streaming
and the source extends the source of that widget. So shown math never goes back to the source while the fence is
open. It keeps a map from widget ID to source
only for widgets made while streaming. It removes the entry when the block gets a new widget.

When the message completes, `Markdown::streaming(false)` must run the renderer again, so that a retained preview
over broken math turns back into the source. opentui-rust skipped unchanged blocks there. Its branch
`rs-plugin-latex` (`markdown: run code-block renderers again when streaming ends`) reruns the renderers of
custom blocks with their widgets. Mermaid's last-good diagram needs the same change.

TS also checks that the fence is still open. The renderer reads that from `CodeBlock::closed`, so a closing fence
over broken math shows the source while the message still streams, as in TS.

## Proof

- P-ORACLE: `parity/oracle/P.2-latex.ts` writes `parity/fixtures/P.2/layouts.json`: the text, geometry, styled
  cells, or parse failure of 207 sources. These are every source in `packages/latex/src/*.test.ts`, about 60
  textbook formulas, malformed input, and the option variants. `tests::layouts_match_typescript` requires them to be
  equal but for the 51 cases where opentui-tex draws otherwise, which `crates/latex/src/oracle_rust.json` holds
  (written by `OPENCODE_RS_LATEX_ORACLE=write`) and which must differ from TS.
- P-COMP: `parity/component/P.2-latex.tsx` renders `TextPart`'s `<markdown>` with the TS plugin's renderer over
  four documents: structures, the adapter cases of `markdown.test.ts`, a wide formula at 30 columns, and invalid
  math next to an ordinary fence. `tests::transcript_fences_match_typescript` renders the same documents with
  `opencode_ui::markdown::view` and this renderer. Every cell is equal, colors and attributes included, but for
  the radicals and matrix rows of `structures` (125 cells) and `adapter` (197 cells), counted exactly.
- Behavior tests port `markdown.test.ts`: fallback to source, streaming retention, discard on stop, and no
  reuse across fences.
- `tex_rows.rs`: opentui-tex's parser and layout rows, and the inline rows. `tests.rs`: inline `$…$` and `\(…\)`,
  display `$$…$$` and `\[…\]`, dollars that are not math, and streamed inline math.
- P-APP `P.2/inline-math`: a message that mixes them, against TS (deviation `P2-latex-inline`, 191 cells).
