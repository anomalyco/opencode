// The export picker with no sessions: "No sessions found", "Done", exit 0.
import { definePty } from "../../pty/run"
import { exportRoute, list, location } from "./fixture"

export default definePty({
  args: ["session", "export"],
  cols: 90,
  rows: 20,
  server: { routes: [location, list([]), exportRoute()] },
  steps: [{ until: { screen: "Done" }, settle: 300, checkpoint: "empty", timeout: 30_000 }],
  osc: [],
  exits: true,
  requests: true,
})
