import { defineCli } from "../../cli/run"
import { mcpRoute } from "./fixture"

// `mcp logout` of a server without an integration.
export default defineCli({
  args: ["mcp", "logout", "filesystem"],
  server: { routes: [mcpRoute()] },
})
