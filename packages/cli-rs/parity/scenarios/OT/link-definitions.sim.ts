// OT2049 (parity/deviations/OT2049-link-reference-definitions.md): a reply with reference links, a table, and the
// link reference definitions at its end. TS draws the definition lines as text and resolves the links in the table
// only; Rust hides the definitions, as CommonMark does, and resolves every link.
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
    {
      checkpoint: "done",
      until: "first.",
      masks: [duration],
      deviation: [
        // The two definition rows, and the turn row they move up.
        { file: "OT2049-link-reference-definitions", cells: 224 },
        // ` (https://example.com/cafes)` after the paragraph's link.
        { file: "OT2049-link-reference-definitions", cells: 34 },
        // The space before each table link's ` (url)` suffix.
        { file: "OT2049-link-reference-definitions", cells: 2, styleOnly: true },
      ],
    },
  ],
})
