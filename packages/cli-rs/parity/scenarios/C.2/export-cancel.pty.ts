// Escape in the export picker: "Cancelled", exit 130, and no export request.
import { definePty } from "../../pty/run"
import { exportRoute, list, location, sessions } from "./fixture"

export default definePty({
  args: ["session", "export"],
  cols: 90,
  rows: 20,
  server: { routes: [location, list(sessions), exportRoute()] },
  steps: [
    { until: { screen: "Select session to export" }, settle: 300, timeout: 30_000 },
    { keys: "\x1b", until: { screen: "Cancelled" }, settle: 300, checkpoint: "cancelled" },
  ],
  osc: [],
  exits: true,
  requests: true,
})
