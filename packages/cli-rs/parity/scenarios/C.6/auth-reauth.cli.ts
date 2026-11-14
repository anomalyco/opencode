import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, oauthRoutes, sink } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp auth` of a connected server without a terminal re-authenticates without asking and keeps the label.
export default defineCli({
  args: ["mcp", "auth", "github"],
  env: sink,
  server: { routes: [mcpRoute(), ...integrationRoutes(), ...oauthRoutes("mcp-github"), ...credentialWrites] },
})
