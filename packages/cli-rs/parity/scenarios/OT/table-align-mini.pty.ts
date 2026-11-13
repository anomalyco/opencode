// OT2112 (parity/deviations/OT2112-table-alignment.md): mini replays the packing list of `table-align.sim.ts`, alone,
// as borderless columns. TS left-aligns every column; Rust right-aligns `Qty` and centres `Weight` and `Packed`, on the
// body rows (each header is its column's widest cell, so that row is equal). The table is the whole reply, so the
// blank rows of `M06-mini-table-gap` do not occur.
import { definePty } from "../../pty/run"
import { assistant, config, server, statusMask, user } from "../M.1/fixture"

const reply = [
  "| Item | Qty | Weight | Packed |",
  "| :--- | ---: | :---: | :---: |",
  "| Tent | 1 | 2.4 kg | yes |",
  "| Sleeping bag | 2 | 1.1 kg | no |",
  "| Headlamp | 12 | 90 g | yes |",
].join("\n")

const messages = [user("msg_u1", "pack", 10), assistant("msg_a1", [{ type: "text", text: reply }], 11)]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server({ messages }),
  setup: (root) => config(root),
  steps: [
    {
      until: { screen: "Headlamp" },
      settle: 800,
      timeout: 30_000,
      checkpoint: "replayed",
      deviation: { file: "OT2112-table-alignment", lines: 3 },
    },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
