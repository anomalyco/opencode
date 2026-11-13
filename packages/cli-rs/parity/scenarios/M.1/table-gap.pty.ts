// Mini replays two replies of three blocks each: a paragraph, a left-aligned table and a paragraph, then three
// paragraphs. Both clients commit a reply's leading blocks first and the last two at the end. The blank row at that
// boundary is lost (`stable_prefix` in `crates/mini/src/scrollback.rs`), so the blank row before the table and the one
// before `Two.` are missing on both sides.
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
    { until: { screen: "Three." }, settle: 800, timeout: 30_000, checkpoint: "replayed" },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
