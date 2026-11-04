// An MCP server of the default location that failed shows a toast once (T12).
import { defineApp } from "../../lib/app"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
// The home prompt's placeholder row (T17-home-prompt) and the prompt footer hints (P01-read-only-prompt).
const prompt = [
  { x: 16, y: 16, width: 84, height: 1, reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)" },
  { x: 50, y: 20, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
]
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
  steps: [{ checkpoint: "failed", until: "MCP server failed: github", masks: [...prompt, counts] }],
})
