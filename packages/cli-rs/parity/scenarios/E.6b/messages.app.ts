// A compaction, a failed step, a step waiting to retry, and the revert banner after an undo (V08, V10, V11).
import { defineApp, session, user } from "../../lib/app"

const model = { providerID: "provider", id: "model" }

export default defineApp({
  height: 40,
  args: { sessionID: "ses_b" },
  routes: [
    {
      path: "/api/session/ses_b",
      json: {
        data: {
          ...session("ses_b", "Fix the parser", { updated: 2 }),
          revert: {
            messageID: "msg_6",
            files: [{ file: "src/parser.rs", patch: "", additions: 4, deletions: 2, status: "modified" }],
          },
        },
      },
    },
    {
      path: "/api/session/ses_b/message",
      json: {
        data: [
          user("msg_6", "Rewrite the lexer", 9000),
          {
            id: "msg_5",
            type: "assistant",
            agent: "build",
            model,
            content: [],
            retry: { attempt: 2, at: 1000, error: { type: "provider", message: "Provider is overloaded" } },
            time: { created: 8000 },
          },
          user("msg_4", "Try again", 7000),
          {
            id: "msg_3",
            type: "assistant",
            agent: "build",
            model,
            content: [{ type: "text", text: "Reading the parser." }],
            error: { type: "provider", message: "Request too large" },
            time: { created: 5000, completed: 6000 },
          },
          {
            id: "msg_2",
            type: "compaction",
            status: "completed",
            reason: "manual",
            summary: "The user is fixing the **parser**.",
            tokens: { input: 1200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 3000 },
          },
          user("msg_1", "Why does the parser fail?", 1000),
        ],
        cursor: {},
      },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "message reverted",
    },
  ],
})
