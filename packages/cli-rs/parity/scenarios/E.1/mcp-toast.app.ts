// An MCP server of the default location that failed shows a toast once (T12).
import { defineApp } from "../../lib/app"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
const prompt = { x: 0, y: 9, width: 100, height: 12, reason: "the home prompt is T.1's stand-in (T17-home-prompt)" }
const counts = {
  x: 0,
  y: 28,
  width: 30,
  height: 1,
  reason: "the home footer's MCP count is E.14's (F01-home-footer-counts)",
}

export default defineApp({
  routes: [
    {
      path: "/api/mcp",
      json: { location, data: [{ name: "github", status: { status: "failed", error: "spawn ENOENT" } }] },
    },
  ],
  steps: [{ checkpoint: "failed", until: "MCP server failed: github", masks: [prompt, counts] }],
})
