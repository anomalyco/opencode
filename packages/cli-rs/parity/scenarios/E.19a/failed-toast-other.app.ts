// A failed execution of a session that is not open shows the error toast with an "Open" action (F09, the plugin
// toast's `sessionID`), here on home.
import { defineApp, HOME_PLACEHOLDER } from "../../lib/app"

// As in `E.1/mcp-toast.app.ts`: the home prompt and footer rows other steps own.
const masks = [HOME_PLACEHOLDER]

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
