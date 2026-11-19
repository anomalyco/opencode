// A reply with reference links, a table, and the link reference definitions at its end: the definitions hide and
// every link resolves, as CommonMark says (OpenTUI #2049, on both sides since 0.9.4).
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  model: [
    {
      items: [
        {
          type: "textDelta",
          text: [
            "Two spots by the lake:",
            "",
            "| Spot | Why |",
            "| --- | --- |",
            "| Harbor | [nearby café][cafes] |",
            "| Pier | [forecast][weather] |",
            "",
            "Try the [nearby café][cafes] first.",
            "",
            "[cafes]: https://example.com/cafes",
            "[weather]: https://example.com/weather",
          ].join("\n"),
        },
      ],
    },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Link the cafes" },
    { until: "Link the cafes" },
    { enter: true },
    { checkpoint: "done", until: "first.", masks: [duration] },
  ],
})
