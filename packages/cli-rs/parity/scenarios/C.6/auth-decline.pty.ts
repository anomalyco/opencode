// `mcp auth <connected server>` on a terminal asks before re-authenticating; No ends with "Cancelled".
import { definePty } from "../../pty/run"
import { integrationRoutes, sink } from "../C.5/fixture"
import { enter, first, press, right } from "../C.5/keys"
import { mcpRoute } from "./fixture"

export default definePty({
  args: ["mcp", "auth", "github"],
  env: sink,
  server: { routes: [mcpRoute(), ...integrationRoutes()] },
  steps: [first("Re-authenticate?", "confirm"), press(right, "no"), press(enter, "cancelled", "Cancelled")],
  osc: [],
  exits: true,
  requests: true,
})
