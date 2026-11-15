// OT2049 (parity/deviations/OT2049-brackets-escapes.md): a reply with a bracketed label that is not a link and a
// backslash escape. TS hides the brackets and keeps the backslash; Rust shows the brackets and drops the backslash,
// as CommonMark does.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  model: [
    {
      items: [
        {
          type: "textDelta",
          text: ["[shell] hello-again", "", 'Invalid arguments for tool \\"prune\\".'].join("\n"),
        },
      ],
    },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Show the labels" },
    { until: "Show the labels" },
    { enter: true },
    {
      checkpoint: "done",
      until: "prune",
      masks: [duration],
      deviation: [
        // `[shell]`: the brackets, the link style, and the text they move.
        { file: "OT2049-brackets-escapes", cells: 18 },
        // The two backslashes of `\"prune\"` and the text they move.
        { file: "OT2049-brackets-escapes", cells: 10 },
      ],
    },
  ],
})
