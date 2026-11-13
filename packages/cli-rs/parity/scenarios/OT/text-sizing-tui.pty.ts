// OT2056 (parity/deviations/OT2056-text-sizing-probe.md): the TUI starts under a shell's output in a terminal that
// draws OSC 66 as kitty does. TS probes text sizing at the top of the main screen before it enters the alternate
// screen, so after exit the start of the first two shell rows is overwritten. Rust probes on the alternate screen,
// whose first frame repaints the probe's cells, and the shell rows come back whole.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

const deviation = { file: "OT2056-text-sizing-probe", lines: 2 }

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  preface: "$ ls\r\nalpha  beta  gamma\r\n$ opencode\r\n",
  terminal: "kitty",
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000, checkpoint: "home" },
    { keys: "\x03", settle: 300 },
    { keys: "\x03", settle: 800, checkpoint: "exit", deviation },
  ],
  exits: true,
  masks: homeMasks,
})
