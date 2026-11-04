# P.3 Mermaid plugin (`rs-plugin-mermaid`)

Rows F12a (core and flowcharts) and F12b (sequence, state, gantt, gitgraph, timeline). The plugin
`opencode.merman` renders `mermaid` fences in the transcript, as `packages/merman/src/plugin.ts` does.

## Library choice

The run notes ask for a small plugin on a Rust library, and for a port of only the TS layout and drawing
when no library draws close to TS. I looked at every Rust crate that turns Mermaid into terminal text
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
3. `merman-core` is an alpha with a large dependency set; the plugin needs `fancy-regex` (the TS
   flowchart edge pattern uses a lookahead), `unicode-width` and `unicode-segmentation` (TS
   `string-width` and `Intl.Segmenter`), and `html-escape` (TS `entities.decodeHTMLStrict`).

So the "library" is the port itself, kept as one crate with the TS module layout
(`core`, `flowchart`, `sequence`, `state`, `gantt`, `gitgraph`, `timeline`) so a TS change maps to one
Rust file.

## API

- `opencode_mermaid::plugin::<H: Host>() -> Definition<H>`: registers the `mermaid` code-block renderer
  (P.1's `Setup::code_block`, the U.4c hook). The TUI's `host::builtins()` uses it for `opencode.merman`.
- `opencode_mermaid::render(source, width, &Palette) -> Option<Diagram>`: the plan's
  `render(lang, source, width, theme) -> cells`, as styled lines (`Vec<Vec<Run>>`) with their height.
  `None` is TS's `undefined`: not a diagram, a syntax error that cannot fall back, or a canvas over
  250,000 cells.
- `Palette::from_theme(&Theme)`: `resolveOpenCodeDiagramPalette`. TS takes the theme mode from the
  context; the plugin API gives only the theme, so the mode is read from the page background
  (light when its luminance is above one half), which is the mode that resolved the theme.

## Widget

TS's `StaticDiagramRenderable` is a `TextRenderable`: full width, the diagram's height, no wrap, not
selectable, one row of top margin, and a left-drag that scrolls it sideways. The Rust widget is a
`Text` with the same options. Horizontal drag scrolling is a follow-up when opentui-rust exposes mouse
drag on `Text`.

## Streaming

TS keeps the last good diagram per fence (keyed by the block's id) and shows it while a later edit does
not parse. The U.4c hook gives the widget it returned before as `CodeBlock::previous`; the plugin
returns it again when the new source fails with a syntax error and the previous diagram was the same
kind, so the same rule holds without a cache.

## Proof

- P-ORACLE `parity/oracle/P.3-mermaid.ts` collects every Mermaid source in
  `packages/merman/src/**/*.test.ts` (template literals whose first meaningful line is a diagram
  header), renders each through TS's `prepareDiagram` path at 120 and 80 columns with the `opencode`
  dark palette, and writes the styled lines (text, fg, bg, attributes per run) or `null` to
  `parity/fixtures/P.3/corpus.json`. `crates/mermaid/tests/oracle.rs` renders the same sources in Rust
  and compares every run.
- P-COMP `parity/component/P.3-markdown.tsx`: a Markdown message with a `mermaid` fence through the real
  TS plugin renderer, compared cell by cell with the Rust Markdown widget and this plugin.
- Each difference that stays has a file under `parity/deviations/`.
