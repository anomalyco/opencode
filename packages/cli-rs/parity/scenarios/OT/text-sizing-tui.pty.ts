// The TUI starts under a shell's output in a terminal that draws OSC 66 as kitty does. After exit the shell rows come
// back whole: no text sizing probe overwrites them (OpenTUI #2056, on both sides since 0.9.4).
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  preface: "$ ls\r\nalpha  beta  gamma\r\n$ opencode\r\n",
  terminal: "kitty",
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000, checkpoint: "home" },
    // One Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true }, settle: 800, checkpoint: "exit" },
  ],
  exits: true,
  masks: homeMasks,
})
