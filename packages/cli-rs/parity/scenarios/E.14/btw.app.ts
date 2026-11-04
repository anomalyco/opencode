// `/btw` (F03): the side question goes to `session.generate` with the instructions, and the answer opens in a
// large dialog as Markdown.
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
      json: { data: { text: "It was an **off-by-one** in the tokenizer.\n\n- one\n- two\n" } },
    },
  ],
  steps: [
    { checkpoint: "open", until: "The parser is fixed." },
    { type: "/btw what was the bug?" },
    { keys: ["enter"] },
    { checkpoint: "answer", until: "off-by-one" },
  ],
})
