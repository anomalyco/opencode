// Prose in the default `opencode` theme (#64988), whose `markdown.text` (#eeeeee) is not its `text.base` (#ffffff):
// TS's Markdown takes its `fg` before the syntax theme's `default` scope, OpenTUI's Rust Markdown the other way round,
// so Rust draws the answer's prose in `text.base` (OT-markdown-default-scope). Code in a fence takes `default` in both.
// The rest of P-APP runs in `opencode-classic`, where the two colors are one.
import { assistant, defineApp, session, user } from "../../lib/app"

const answer = "The parser drops the last token.\n\n```ts\nconst end = tokens.length - 1\n```\n\nUse the full length."

export default defineApp({
  config: { theme: { name: "opencode" } },
  args: { sessionID: "ses_m" },
  routes: [
    { path: "/api/session/ses_m", json: { data: session("ses_m", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_m/message",
      json: { data: [assistant("msg_2", answer, 2000), user("msg_1", "Why does the parser fail?", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_m/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "answer",
      until: "Use the full length.",
      deviation: [{ file: "OT-markdown-default-scope", cells: 52, styleOnly: true }],
    },
  ],
})
