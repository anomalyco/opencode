// `mcp auth` on a terminal: the MCP server picker with status hints, then OAuth with the browser sink.
import { definePty } from "../../pty/run"
import { credentialWrites, integrationRoutes, oauthRoutes, sink } from "../C.5/fixture"
import { down, enter, first, press } from "../C.5/keys"
import { mcpRoute } from "./fixture"

export default definePty({
  args: ["mcp", "auth"],
  env: sink,
  server: { routes: [mcpRoute(), ...integrationRoutes(), ...oauthRoutes("mcp-linear"), ...credentialWrites] },
  steps: [first("Select MCP server", "picker"), press(down, "moved"), press(enter, "done", "Done")],
  osc: [],
  exits: true,
  requests: true,
})
