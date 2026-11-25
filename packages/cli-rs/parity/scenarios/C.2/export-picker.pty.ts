// `session export` without an ID on a terminal: the picker (on stderr) lists the sessions with their
// time and short ID, typing filters, Enter exports the focused one.
import { definePty } from "../../pty/run"
import { exportRoute, list, location, sessions } from "./fixture"

export default definePty({
  args: ["session", "export"],
  cols: 90,
  rows: 30,
  server: { routes: [location, list(sessions), exportRoute()] },
  steps: [
    { until: { screen: "Select session to export" }, settle: 300, checkpoint: "picker", timeout: 30_000 },
    { keys: "\x1b[B", settle: 250, checkpoint: "moved" },
    { keys: "parser", settle: 250, checkpoint: "filtered" },
    { keys: "\r", until: { screen: "messages" }, settle: 300, checkpoint: "exported" },
  ],
  osc: [],
  exits: true,
  requests: true,
})
