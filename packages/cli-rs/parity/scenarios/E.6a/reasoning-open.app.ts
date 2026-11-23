// An opened reasoning block whose text is Markdown: TS draws it in rendered mode with Core's Markdown, as an answer is
// drawn, in the reasoning colors (#63989's `ReasoningBody`); Rust draws it with its Markdown widget (V04).
import { defineApp, session } from "../../lib/app"

const reasoning = [
  "**Reading the parser**",
  "The loop stops *one* token early, in `next()`:",
  "- the bound is `len - 1`\n- the last token is dropped",
  "| case | tokens |\n| --- | --- |\n| empty | 0 |\n| one | 1 |",
].join("\n\n")

export default defineApp({
  args: { sessionID: "ses_r" },
  routes: [
    { path: "/api/session/ses_r", json: { data: session("ses_r", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_r/message",
      json: {
        data: [
          {
            id: "msg_2",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [
              { type: "reasoning", text: reasoning, time: { created: 1500, completed: 3000 } },
              { type: "text", text: "The parser drops the last token." },
            ],
            finish: "stop",
            tokens: { input: 1200, output: 50, reasoning: 0, cache: { read: 3000, write: 0 } },
            time: { created: 1500, completed: 4000 },
          },
          { id: "msg_1", type: "user", text: "Why does the parser fail?", time: { created: 1000 } },
        ],
        cursor: {},
      },
    },
    { path: "/api/session/ses_r/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "collapsed", until: "drops the last token" },
    { click: [7, 6] },
    { checkpoint: "group", until: "Thought: Reading" },
    { click: [7, 8] },
    { checkpoint: "open", until: "empty" },
  ],
})
