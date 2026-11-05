// `session export > out.json` and SIGTERM while the picker (on stderr) is open: the shutdown leaves the
// redirected stdout empty. The cursor the picker hid is shown again on stderr, the terminal it hid it on.
// A shell runs the CLI with stdout redirected and sends the signal once the picker has the terminal in
// raw mode, then prints what reached the file.
import { definePty } from "../../pty/run"
import { command, withServer } from "../../cli/client"
import { list, location, sessions } from "./fixture"

const script = [
  `(until stty -a </dev/tty | grep -q -- -icanon; do sleep 0.05; done; sleep 0.5; kill -TERM "$(cat pid)") &`,
  `sh -c 'echo $$ > pid; exec "$@"' sh "$@" > out.json`,
  `wait`,
  `echo "stdout bytes: $(wc -c < out.json)"`,
].join("\n")

export default definePty({
  args: [],
  command: (side, server) => [
    "bash",
    "-c",
    script,
    "bash",
    ...command(side, withServer(["session", "export"], server)),
  ],
  cols: 90,
  rows: 30,
  server: { routes: [location, list(sessions)] },
  steps: [{ until: { screen: "stdout bytes:" }, settle: 300, checkpoint: "after", timeout: 30_000 }],
  osc: [],
  exits: true,
})
