// A plugin's program in the foreground gets the signals of the terminal's keys, and the TUI does not (reviews
// bigboi-1, carbon-1): Ctrl+C and Ctrl+\ end the program alone, Ctrl+Z neither stops the TUI nor strands it (the
// program is continued), and afterwards a key reaches the same TUI. The TUI works in the fake server's directory,
// which does not exist here, so the program runs in the TUI's own (carbon-1). The sample sets each reply as the
// title, so the title log has them. Rust only: the TS client shares the process group.
import { definePty } from "../../pty/run"
import { home, install, leave, run } from "./fixture"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  setup: (root) => install(root),
  steps: [
    ...home,
    ...run("sleep 30", 1),
    { keys: "\x03", until: { osc: '"signal":2' }, settle: 300 },
    ...run("sleep 30", 2),
    { keys: "\x1c", until: { osc: '"signal":3' }, settle: 300 },
    ...run("sleep 1; exit 4", 3),
    { keys: "\x1a", until: { osc: 'p0b exit {"code":4}' }, settle: 300, timeout: 15_000 },
    { keys: "still here", until: { screen: "still here" }, settle: 300 },
    { keys: "\x15", settle: 200 },
    ...leave,
  ],
  osc: ["title"],
  exits: true,
  rsOnly: true,
})
