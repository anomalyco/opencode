import { defineCli } from "../../cli/run"
import { integrationRoutes } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp auth` of an unknown server.
export default defineCli({
  args: ["mcp", "auth", "nope"],
  server: { routes: [mcpRoute(), ...integrationRoutes()] },
})
