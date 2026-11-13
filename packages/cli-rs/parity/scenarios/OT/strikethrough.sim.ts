// OT2079 (parity/deviations/OT2079-strikethrough.md): a reply that contains `~~gone~~`. Both clients hide the
// tildes and draw the text muted; Rust strikes it through, TS does not.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  model: [{ items: [{ type: "textDelta", text: "Answer a ~~gone~~ b." }] }],
  steps: [
    { until: "Simulated Model" },
    { type: "Strike it" },
    { until: "Strike it" },
    { enter: true },
    {
      checkpoint: "done",
      until: "Answer a",
      masks: [duration],
      deviation: [{ file: "OT2079-strikethrough", cells: 4 }],
    },
  ],
})
