import { defineCli } from "../../cli/run"
import { integrationRoutes } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp auth` of a server without OAuth.
export default defineCli({
  args: ["mcp", "auth", "filesystem"],
  server: { routes: [mcpRoute(), ...integrationRoutes()] },
})
