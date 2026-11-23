// A reply streams a LaTeX fence whose first line renders, then math that does not and the closing fence without its
// line ending, and pauses there. Both clients hold the closer's line, so the fence still streams and keeps the formula
// (TS since #63989, on Core's engine; `parity/deviations/OT2049-markdown-engine.md` has the history). Once more text
// comes, both show the source. TS draws the formula a row lower (`parity/deviations/F16-plugin-fence-margin.md`).
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
    { checkpoint: "formula", until: "x²", deviation: [{ file: "F16-plugin-fence-margin", cells: 4 }] },
    { release: "formula" },
    // The closer has arrived without its line ending: both keep the formula they rendered last, so no text marks the
    // frame.
    { sleep: 1500 },
    { checkpoint: "closed", deviation: [{ file: "F16-plugin-fence-margin", cells: 4 }] },
    { release: "closed" },
    { checkpoint: "done", until: "Done.", masks: [duration] },
  ],
})
