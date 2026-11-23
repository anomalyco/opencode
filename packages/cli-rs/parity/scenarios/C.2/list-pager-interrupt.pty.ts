// Ctrl+C in the `session list` pager stops `less` and waits for it before the CLI exits 130, so the
// terminal leaves the alternate screen and no `less` is left behind (TS: the scoped `AppProcess`).
// A non-interactive shell runs the CLI and keeps the terminal afterwards, as an interactive shell would,
// so the screen and the `less` processes of the session can be checked once the CLI is gone.
import { definePty } from "../../pty/run"
import { command, withServer } from "../../cli/client"
import { list, location, sessions } from "./fixture"

const script = [
  `"$@"`,
  `code=$?`,
  `sleep 0.5`,
  `if pgrep -s 0 -x less >/dev/null; then echo "less left"; else echo "no less"; fi`,
  `echo "exit $code"`,
].join("\n")

export default definePty({
  args: [],
  command: (side, server) => ["bash", "-c", script, "bash", ...command(side, withServer(["session", "list"], server))],
  cols: 60,
  rows: 10,
  server: { routes: [location, list(sessions)] },
  steps: [
    { until: { screen: "Fix the parser" }, settle: 300, timeout: 30_000 },
    { keys: "\x03", until: { screen: /exit \d+/ }, settle: 300, checkpoint: "after", timeout: 15_000 },
  ],
  osc: [],
  exits: true,
})
