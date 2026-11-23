import { defineCli } from "../../cli/run"
import { integrations, location } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp logout` of an integration without stored credentials.
export default defineCli({
  args: ["mcp", "logout", "linear"],
  server: { routes: [mcpRoute(), { path: "/api/integration/mcp-linear", json: { location, data: integrations[5] } }] },
})
