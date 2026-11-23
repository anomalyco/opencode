// A reply that contains `~~gone~~`: the tildes hide and the text is muted and struck through (OpenTUI #2079, on both
// sides since 0.9.4).
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  model: [{ items: [{ type: "textDelta", text: "Answer a ~~gone~~ b." }] }],
  steps: [
    { until: "Simulated Model" },
    { type: "Strike it" },
    { until: "Strike it" },
    { enter: true },
    { checkpoint: "done", until: "Answer a", masks: [duration] },
  ],
})
