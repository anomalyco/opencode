// OT2056 (parity/deviations/OT2056-text-sizing-probe.md): mini starts under a shell's output in a terminal that
// draws OSC 66 as kitty does. TS probes text sizing at the top of the main screen and overwrites the start of the
// first two rows; Rust takes kitty's text sizing from its XTVERSION reply and draws nothing there.
import { definePty } from "../../pty/run"
import { config, server, statusMask } from "../M.1/fixture"

export default definePty({
  args: ["mini"],
  cols: 60,
  rows: 16,
  server: server(),
  setup: (root) => config(root),
  preface: "$ ls\r\nalpha  beta  gamma\r\n$ opencode mini\r\n",
  terminal: "kitty",
  steps: [
    {
      until: { screen: "Ask anything" },
      settle: 800,
      timeout: 30_000,
      checkpoint: "started",
      deviation: { file: "OT2056-text-sizing-probe", lines: 2 },
    },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400, checkpoint: "exit", deviation: { file: "OT2056-text-sizing-probe", lines: 2 } },
  ],
  exits: true,
  masks: [statusMask],
})
