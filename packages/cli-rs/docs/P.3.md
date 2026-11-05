# P.3 Mermaid plugin (`rs-plugin-mermaid`)

Rows F12a (core and flowcharts) and F12b (sequence, state, gantt, gitgraph, timeline). The plugin
`opencode.merman` renders `mermaid` fences in the transcript, as `packages/merman/src/plugin.ts` does.

## Library choice

The run notes ask for a small plugin on a Rust library, and for a port of only the TS layout and drawing
when no library draws close to TS. I looked at the Rust crates that turn Mermaid into terminal text
(crates.io, 2026-11):

| Crate | What it is | Why not |
| --- | --- | --- |
| `merman-core` with `merman-ascii` or `mermansi` | Mermaid parser (a port of mermaid.js) plus terminal adapters | Its own layout; `merman-core` is `0.10.0-alpha.1`, a 1.1 MB crate that returns its model as `serde_json::Value` |
| `mmdflux` | Flowchart, class, state, sequence to text or SVG | Its own layered layout; no gantt, gitgraph, or timeline |
| `mermaid-text`, `termiflow`, `graphs-tui` | Flowchart-first text renderers | Their own layouts; the documented examples draw square `┌─┐` boxes and `<Dec>` diamonds |

All of them lay diagrams out their own way, so none can draw cells equal to TS: TS has its own terminal
layout (rounded node frames, source connectors with color fades, label lanes, responsive folding at
`layoutMaxWidth`), and P-COMP compares cells. So the layout and drawing are a port of
`packages/merman/src`.

The parser is ported too, not taken from `merman-core`, for three reasons:

1. The streaming fallback depends on TS's parser errors. TS accepts a subset of Mermaid and throws
   `MermaidSyntaxError` with the line number of the first statement it does not support; the renderer then
   keeps the last good diagram or renders the lines before that line (`markdown.ts:242-272`). A full
   Mermaid parser accepts statements the layout cannot draw and has no such line.
2. The TS parsers are small (about 1,500 lines for all six kinds) next to the layout and routing
   (about 9,000), and their output types are what the layout takes. Mapping `merman-core`'s JSON model
   to them would be about as much code as the parsers, plus the gaps between the two grammars.
3. `merman-core` is an alpha with a large dependency set. The port needs only `fancy-regex` (the TS
   flowchart edge pattern uses a lookahead), `unicode-segmentation` (TS `Intl.Segmenter`), and
   `html-escape` (TS `entities.decodeHTMLStrict`).

So the "library" is the port itself, kept as one crate with the TS module layout (`core`, `flowchart`,
`sequence`, `state`, `gantt`, `gitgraph`, `timeline`) so a TS change maps to one Rust file.

## Port notes

- Text width follows TS `string-width` 7, not `unicode-width`: `core/wide.rs` lists the code points it counts
  as two cells, generated from `string-width` itself. It includes emoji such as `▶` and `◀`, which decide
  whether a wide state diagram folds.
- `Math.round` is `floor(x + 0.5)`, and colors blend and round in bytes, as OpenTUI's `RGBA.fromInts` does.
- TS compares edges, transitions, and bounds by object identity. Edges carry their parsed index, state
  transitions their index in the visible model, and the state layout keeps one arena of boxes that both its
  state and composite maps index, so a move shows through either map.
- Gantt uses the plugin's options only (track style, thin line, labels on the left, spaced sections, faint
  track); the other `GanttDiagramRenderOptions` are not reachable from the plugin.

## API

- `opencode_mermaid::plugin::<H: Host>() -> Definition<H>`: registers the `mermaid` code-block renderer
  (P.1's `Setup::code_block`, the U.4c hook). The TUI's `host::builtins()` uses it for `opencode.merman`.
- `opencode_mermaid::render(source, width, &Palette) -> Rendered`: the plan's
  `render(lang, source, width, theme) -> cells`, as styled lines. `Rendered::Code` is TS's `undefined`;
  `Rendered::Syntax { kind, prefix }` is a syntax error with the drawable prefix, if any.
- `Renderer` adds the streaming fallback; `widget(app, &Diagram)` is the `Text` it returns.
- `Palette::from_theme(&Theme, ThemeMode)`: `resolveOpenCodeDiagramPalette`, with the mode from
  `Host::theme_mode`, as TS reads `context.themeMode`.

## Widget

TS's `StaticDiagramRenderable` is a `TextRenderable`: full width, the diagram's height, no wrap, not
selectable, one row of top margin, and a left drag that scrolls it sideways. The Rust widget is a `Text`
with the same options and drag scrolling, with two differences that keep the cells equal:

- No top margin: Core's Markdown uses that margin as the gap before the block, while the Rust Markdown widget
  puts the gap between blocks itself.
- A white default fg, TS `TextRenderable`'s, which unstyled cells keep.

## Streaming

TS keeps the last good diagram per fence (keyed by the block's id) and shows it while a later edit does
not parse. The U.4c hook gives the widget it returned before as `CodeBlock::previous`; the renderer
remembers each widget's diagram kind and returns the previous widget when the new source fails with a
syntax error of the same kind. opentui-rust's Markdown re-runs renderers when streaming ends, so a kept
preview does not outlive a broken fence.

## Proof

- P-ORACLE `parity/oracle/P.3-mermaid.ts` collects every Mermaid source in
  `packages/merman/src/**/*.test.ts` and the layout-audit fixtures (template literals whose first
  meaningful line is a diagram header: 248 sources), renders each through TS's
  `createMermaidCodeBlockRenderer` at 120 and 60 columns with the `opencode` dark palette, and writes the
  styled lines (text, fg, bg, attributes per run) or `null` to `parity/fixtures/P.3/corpus.json`.
  `crates/mermaid/tests/oracle.rs` renders the same sources in Rust and compares every run: 496 of 496 equal.
- P-COMP `parity/component/P.3-markdown.tsx`: `TextPart`'s Markdown with a flowchart and a sequence fence
  through the real TS renderer, compared cell by cell in `crates/mermaid/tests/markdown.rs`.
- Deviation: `parity/deviations/F12b-diagram-layout-errors.md` (a layout dead end shows the code; TS throws).
