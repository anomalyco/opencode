// A failed execution of a session that is not open shows the error toast with an "Open" action (F09, the plugin
// toast's `sessionID`), here on home.
import { defineApp } from "../../lib/app"

// As in `E.1/mcp-toast.app.ts`: the home prompt and footer rows other steps own.
const masks = [
  {
    x: 16,
    y: 16,
    width: 84,
    height: 1,
    reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
  },
  { x: 50, y: 20, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
  { x: 0, y: 28, width: 30, height: 1, reason: "the home footer's MCP count is E.14's (F01-home-footer-counts)" },
]

export default defineApp({
  config: { experimental: { "new-designs": true } },
  steps: [
    { checkpoint: "home", until: "Ask anything", masks },
    {
      event: {
        id: "evt_failed",
        created: 1,
        type: "session.execution.failed",
        durable: { aggregateID: "ses_c", seq: 1, version: 1 },
        data: { sessionID: "ses_c", error: { type: "unknown", message: "Plugin failed during skill.transform." } },
      },
    },
    { checkpoint: "failed", until: "Session failed", masks },
  ],
})
