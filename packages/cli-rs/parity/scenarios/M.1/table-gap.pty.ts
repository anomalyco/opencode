// M06 (parity/deviations/M06-mini-table-gap.md): mini replays a reply with a left-aligned table between two
// paragraphs. Both clients keep one of the two blank rows around the table: TS the one after it, Rust the one before.
import { definePty } from "../../pty/run"
import { assistant, config, server, statusMask, user } from "./fixture"

const reply = [
  "Packing list:",
  "",
  "| Item | Qty |",
  "| --- | --- |",
  "| Tent | 1 |",
  "| Stove | 2 |",
  "",
  "Done.",
].join("\n")

const messages = [user("msg_u1", "pack", 10), assistant("msg_a1", [{ type: "text", text: reply }], 11)]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 16,
  server: server({ messages }),
  setup: (root) => config(root),
  steps: [
    {
      until: { screen: "Done." },
      settle: 800,
      timeout: 30_000,
      checkpoint: "replayed",
      deviation: { file: "M06-mini-table-gap", lines: 4 },
    },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
