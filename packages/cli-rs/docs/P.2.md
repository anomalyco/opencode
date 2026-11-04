# P.2 LaTeX plugin (`opencode-latex`)

`opencode.latex` draws `latex` and `math` Markdown fences (and `tex`, which resolves to `latex`) as Unicode math in
terminal cells, as `packages/latex/src/plugin.ts` does. It registers one renderer for both languages through the
P.1 code-block API.

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
- `symbols.rs`: `symbols.ts`.
- `lib.rs`: `plugin()`, `render()`, and `renderer()`, the Markdown adapter (`markdown.ts`). The formula is a
  `Text` with no wrapping, as wide as the formula, inside a `ScrollBox` that scrolls only sideways, with hidden
  scrollbars. TS adds one row of top margin. The Rust Markdown already puts a blank row between blocks, so the
  widget adds none (deviation `F13-latex-leading-row`). Structural glyphs (brackets, the radical, box drawing) use
  `theme.text.muted`. Everything else uses `theme.text.base`. Relations are bold. A source that does not parse
  returns `None`, so Markdown shows the source in its code view.

## Streaming

TS keeps the last frame that parsed while the fence streams, if the new source extends it. The Rust renderer
returns `CodeBlock::previous` (the widget it returned last for that block) when the source does not parse, the
document is streaming, and the source extends the source of that widget. It keeps a map from widget ID to source
only for widgets made while streaming. It removes the entry when the block gets a new widget.

When the message completes, `Markdown::streaming(false)` must run the renderer again, so that a retained preview
over broken math turns back into the source. opentui-rust skipped unchanged blocks there. Its branch
`rs-plugin-latex` (`markdown: run code-block renderers again when streaming ends`) reruns the renderers of
custom blocks with their widgets. Mermaid's last-good diagram needs the same change.

TS also checks that the fence is still open. The Rust `CodeBlock` does not say whether the fence closed, so a
closed fence with a broken formula keeps the preview until the message completes. This is deviation
`F13-latex-closed-fence`.

## Proof

- P-ORACLE: `parity/oracle/P.2-latex.ts` writes `parity/fixtures/P.2/layouts.json`: the text, geometry, styled
  cells, or parse failure of 207 sources. These are every source in `packages/latex/src/*.test.ts`, about 60
  textbook formulas, malformed input, and the option variants. `tests::layouts_match_typescript` requires all of
  them to be equal.
- P-COMP: `parity/component/P.2-latex.tsx` renders `TextPart`'s `<markdown>` with the TS plugin's renderer over
  four documents: structures, the adapter cases of `markdown.test.ts`, a wide formula at 30 columns, and invalid
  math next to an ordinary fence. `tests::transcript_fences_match_typescript` renders the same documents with
  `opencode_ui::markdown::view` and this renderer. Every cell is equal, colors and attributes included.
- Behavior tests port `markdown.test.ts`: fallback to source, streaming retention, discard on stop, and no
  reuse across fences.
