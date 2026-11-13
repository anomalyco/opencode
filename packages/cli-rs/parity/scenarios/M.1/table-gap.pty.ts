// M06 (parity/deviations/M06-mini-dropped-blank-row.md): mini replays two replies of three blocks each, a paragraph, a
// left-aligned table and a paragraph, then three paragraphs. Both clients commit a reply's leading blocks first and
// the last two at the end, where Core 0.8.4 cuts it. TS loses the blank row at that cut (before the table, before
// `Three.`); Rust keeps it, as the replies rendered whole show.
import { definePty } from "../../pty/run"
import { assistant, config, server, statusMask, user } from "./fixture"

const table = ["Packing list:", "", "| Item | Qty |", "| --- | --- |", "| Tent | 1 |", "| Stove | 2 |", "", "Done."]

const messages = [
  user("msg_u1", "pack", 10),
  assistant("msg_a1", [{ type: "text", text: table.join("\n") }], 11),
  user("msg_u2", "count", 12),
  assistant("msg_a2", [{ type: "text", text: "One.\n\nTwo.\n\nThree." }], 13),
]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 24,
  server: server({ messages }),
  setup: (root) => config(root),
  steps: [
    {
      until: { screen: "Three." },
      settle: 800,
      timeout: 30_000,
      checkpoint: "replayed",
      deviation: { file: "M06-mini-dropped-blank-row", lines: 16 },
    },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
