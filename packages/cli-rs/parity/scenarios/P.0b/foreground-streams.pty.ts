// A plugin's program in the foreground has the terminal on all three standard streams, so its stderr shows and a
// program that asks `isatty` takes the interactive path (reviews bigboi-5, carbon-1); input it leaves unread is
// dropped and does not reach the composer once the TUI is back (bigboi-5). Rust only.
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
    ...run("[ -t 0 ] && [ -t 1 ] && [ -t 2 ] && echo tty-$((3*3)) >&2; sleep 1", 1),
    { until: { screen: "tty-9" } },
    { until: { screen: 'p0b exit {"code":0}' }, settle: 300 },
    ...run("head -n 1 >/dev/null; exit 7", 2),
    { keys: "first line\rsecond line\r", until: { screen: 'p0b exit {"code":7}' }, settle: 800, absent: "second" },
    ...leave,
  ],
  osc: ["title"],
  exits: true,
  rsOnly: true,
})
