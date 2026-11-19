// Mini replays the packing list of `table-align.sim.ts`, alone, as borderless columns: `Qty` right-aligned, `Weight`
// and `Packed` centred (OpenTUI #2112, on both sides since 0.9.4). `M.1/table-gap` checks the rows around a table.
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
    { until: { screen: "Headlamp" }, settle: 800, timeout: 30_000, checkpoint: "replayed" },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
