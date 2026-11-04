// MCP servers and routes the C.6 (`mcp`) scenarios share; the integrations are C.5's.
import type { Route } from "../../lib/fake-server"
import { location } from "../C.5/fixture"

export const servers = [
  { name: "linear", status: { status: "needs_auth", error: "Unauthorized" }, integrationID: "mcp-linear" },
  { name: "github", status: { status: "connected" }, integrationID: "mcp-github" },
  { name: "filesystem", status: { status: "connected" } },
  { name: "broken", status: { status: "failed", error: "spawn ENOENT" } },
  { name: "Sentry", status: { status: "disabled" } },
  { name: "slow", status: { status: "pending" } },
]

export function mcpRoute(data: unknown[] = servers): Route {
  return { path: "/api/mcp", json: { location, data } }
}

// A project config with comments and a server already in place, as people write them.
export const commented = `{
  // Project config
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      /* keep me */
      "existing": { "type": "local", "command": ["node", "server.js"] }
    }
  },
  "theme": "dark", // trailing comment
}
`
