// OT2049 (parity/deviations/OT2049-markdown-engine.md): a reply streams a LaTeX fence whose first line renders, then
// math that does not and the closing fence without its line ending, and pauses there. TS closes the fence and shows
// the source; Rust holds the closer's line, so the fence still streams and keeps the formula. Once more text comes,
// both show the source.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  model: [
    {
      items: [
        { type: "textDelta", text: "Math:\n\n```latex\nx^2" },
        { hold: "formula" },
        { type: "textDelta", text: " + \\unsupported{x}\n```" },
        { hold: "closed" },
        { type: "textDelta", text: "\n\nDone." },
      ],
    },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Show the formula" },
    { until: "Show the formula" },
    { enter: true },
    { checkpoint: "formula", until: "x²" },
    { release: "formula" },
    // The closer has arrived: TS shows the source, Rust the formula it rendered last, so no text marks the frame.
    { sleep: 1500 },
    { checkpoint: "closed", deviation: [{ file: "OT2049-markdown-engine", cells: 20 }] },
    { release: "closed" },
    { checkpoint: "done", until: "Done.", masks: [duration] },
  ],
})
