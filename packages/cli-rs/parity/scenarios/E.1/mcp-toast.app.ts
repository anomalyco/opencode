// An MCP server of the default location that failed shows a toast once (T12).
import { defineApp, HOME_PLACEHOLDER, location } from "../../lib/app"

// The home prompt's placeholder row: its example is random.
const prompt = [HOME_PLACEHOLDER]

export default defineApp({
  routes: [
    {
      path: "/api/mcp",
      json: { location, data: [{ name: "github", status: { status: "failed", error: "spawn ENOENT" } }] },
    },
  ],
  steps: [{ checkpoint: "failed", until: "MCP server failed: github", masks: prompt }],
})
