import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, oauthRoutes, sink } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp auth <name>` without a terminal: OAuth with the browser step skipped, then the old credentials go.
export default defineCli({
  args: ["mcp", "auth", "linear"],
  env: sink,
  server: { routes: [mcpRoute(), ...integrationRoutes(), ...oauthRoutes("mcp-linear"), ...credentialWrites] },
})
