// The session list over the home (DLG16): opened with <leader>l, the first delete press marks the row, the
// second deletes the session. The whole screen is compared except the home placeholder row.
import { defineApp, session } from "../../lib/app"

const placeholder = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder example: random in TS and Rust",
}

export default defineApp({
  routes: [
    {
      path: "/api/session",
      json: {
        data: [session("ses_b", "Fix the parser", { updated: 2 }), session("ses_a", "Write docs", { updated: 1 })],
        cursor: {},
      },
    },
    { method: "DELETE", path: "/api/session/ses_b" },
  ],
  steps: [
    { checkpoint: "home", until: "Ask anything", masks: [placeholder] },
    { keys: ["ctrl+x", "l"] },
    { checkpoint: "list", until: "Write docs" },
    { keys: ["ctrl+d"] },
    { checkpoint: "marked", until: "again to confirm" },
    { keys: ["ctrl+d"] },
    { checkpoint: "deleted", until: "delete ctrl+d" },
  ],
})
