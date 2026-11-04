import { defineCli } from "../../cli/run"
import { mcpRoute } from "./fixture"

// `mcp list`: servers by name with a status icon and description.
export default defineCli({
  args: ["mcp", "list"],
  server: { routes: [mcpRoute()] },
})
