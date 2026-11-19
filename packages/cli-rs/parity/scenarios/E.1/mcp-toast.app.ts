// An MCP server of the default location that failed shows a toast once (T12).
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
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
