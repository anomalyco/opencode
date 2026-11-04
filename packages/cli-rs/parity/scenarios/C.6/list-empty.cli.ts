import { defineCli } from "../../cli/run"
import { mcpRoute } from "./fixture"

// `mcp list` without servers.
export default defineCli({
  args: ["mcp", "list"],
  server: { routes: [mcpRoute([])] },
})
