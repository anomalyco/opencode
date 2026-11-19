// Mini starts under a shell's output in a terminal that draws OSC 66 as kitty does. The client takes kitty's text
// sizing from its XTVERSION reply and draws no probe over the shell rows (OpenTUI #2056, on both sides since 0.9.4).
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
    { until: { screen: "Ask anything" }, settle: 800, timeout: 30_000, checkpoint: "started" },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400, checkpoint: "exit" },
  ],
  exits: true,
  masks: [statusMask],
})
