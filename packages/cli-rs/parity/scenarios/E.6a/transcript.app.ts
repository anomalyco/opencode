// A finished turn: a user message with chips, collapsed reasoning, Markdown text, the footer with tokens per
// second, and the turn's token usage (V01 to V04, V12).
import { defineApp, session } from "../../lib/app"

export default defineApp({
  config: { debug: { turn_tokens: true } },
  args: { sessionID: "ses_e" },
  routes: [
    { path: "/api/session/ses_e", json: { data: session("ses_e", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_e/message",
      json: {
        data: [
          {
            id: "msg_2",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [
              {
                type: "reasoning",
                text: "**Reading the parser**\n\nThe loop stops one token early.",
                time: { created: 1500, completed: 3000 },
              },
              {
                type: "text",
                text: "The parser drops the **last** token in `next()`.\n\n- check the bound\n- add a test",
              },
            ],
            finish: "stop",
            tokens: { input: 1200, output: 50, reasoning: 0, cache: { read: 3000, write: 0 } },
            time: { created: 1500, streamed: 3000, completed: 4000 },
          },
          {
            id: "msg_1",
            type: "user",
            text: "Why does the parser fail?",
            time: { created: 1000 },
            files: [{ data: "", mime: "text/plain", name: "parser.rs", source: { type: "inline" } }],
            skills: [{ id: "skl_1", name: "rust" }],
          },
        ],
        cursor: {},
      },
    },
    { path: "/api/session/ses_e/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "Tokens",
      deviation: ["V01-plain-transcript", "P01-read-only-prompt", "T04-connection-footer"],
    },
  ],
})
