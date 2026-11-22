import { defineCli } from "../../cli/run"
import { credentialWrites, integrations, location } from "../C.5/fixture"
import { mcpRoute } from "./fixture"

// `mcp logout` removes every stored credential of the server's integration.
export default defineCli({
  args: ["mcp", "logout", "github"],
  server: {
    routes: [
      mcpRoute(),
      { path: "/api/integration/mcp-github", json: { location, data: integrations[4] } },
      ...credentialWrites,
    ],
  },
})
