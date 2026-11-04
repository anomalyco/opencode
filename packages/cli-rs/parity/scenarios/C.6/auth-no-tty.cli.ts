import { defineCli } from "../../cli/run"
import { integrationRoutes } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp auth` without a name needs a terminal.
export default defineCli({
  args: ["mcp", "auth"],
  server: { routes: [mcpRoute(), ...integrationRoutes()] },
})
