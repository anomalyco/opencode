// A reply streams a Rust fence, holds inside it, and the theme changes through `/themes` while the fence streams and
// again after the reply completes. TS restyles in place; Rust remounts the route, and OpenTUI #2091 restyles a kept
// code view's highlight without parsing again. Both show the fence and the table in each new theme.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

const theme = (name: string) => [
  { type: "/themes" },
  { until: "/themes" },
  { enter: true as const },
  { until: "Search themes" },
  { type: name },
  { until: name },
  // The first match previews after the filter lands.
  { sleep: 500 },
  { enter: true as const },
  // The dialog closes and the route repaints in the theme; no text marks the frame.
  { sleep: 1000 },
]

export default defineSim({
  height: 30,
  model: [
    {
      items: [
        { type: "textDelta", text: 'Code:\n\n```rust\nfn main() {\n    let x = "s"; // note\n' },
        { hold: "fence" },
        { type: "textDelta", text: '    println!("{x}");\n}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDone.' },
      ],
    },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Show a fence" },
    { until: "Show a fence" },
    { enter: true },
    { checkpoint: "streaming", until: "// note" },
    ...theme("tokyonight"),
    { checkpoint: "switched-streaming", until: "// note" },
    { release: "fence" },
    { checkpoint: "done", until: "Done.", masks: [duration] },
    ...theme("github"),
    { checkpoint: "switched-done", until: "Done.", masks: [duration] },
  ],
})
