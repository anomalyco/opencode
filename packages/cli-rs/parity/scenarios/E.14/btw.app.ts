// `/btw` (F03): the side question goes to `session.generate` with the instructions, and the answer opens in a
// large dialog as Markdown. The answer is held until the pending checkpoint has seen the `/btw` spinner under the
// prompt; once the dialog closes, the spinner is gone.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_b" },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Side questions", { updated: 2 }) } },
    {
      path: "/api/session/ses_b/message",
      json: { data: [assistant("msg_2", "The parser is fixed."), user("msg_1", "Fix the parser")], cursor: {} },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    {
      method: "POST",
      path: "/api/session/:sessionID/generate",
      hold: true,
      json: {
        data: {
          text: "It was an **off-by-one** in the tokenizer.\n\n- one\n- two\n",
          tokens: { input: 120, output: 14, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.0004,
        },
      },
    },
  ],
  steps: [
    { checkpoint: "open", until: "The parser is fixed." },
    { type: "/btw what was the bug?" },
    { keys: ["enter"] },
    { checkpoint: "pending", until: "⋯ /btw" },
    { release: "/api/session/:sessionID/generate" },
    { checkpoint: "answer", until: "off-by-one" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "The parser is fixed." },
  ],
})
