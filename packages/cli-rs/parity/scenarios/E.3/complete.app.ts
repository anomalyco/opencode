// Prompt autocomplete (P05, K04): `/rev` lists the server's command and Enter completes it; `@gen` lists the
// subagent and a file from /api/fs/find, and Enter turns the agent into a highlighted mention.
import { defineApp, session, user } from "../../lib/app"

const location = { directory: "/tmp/opencode/packages/tui" }
const deviation = ["V01-plain-transcript", "P01-read-only-prompt"]

export default defineApp({
  args: { sessionID: "ses_b" },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why does the parser fail?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    { path: "/api/command", json: { location, data: [{ name: "review", description: "Review the working tree" }] } },
    {
      path: "/api/agent",
      json: {
        location,
        data: [
          {
            id: "general",
            name: "general",
            mode: "subagent",
            hidden: false,
            permissions: [],
            request: { settings: {}, headers: {}, body: {} },
          },
        ],
      },
    },
    { path: "/api/fs/find", json: { location, data: [{ path: "src/general.ts", type: "file" }] } },
  ],
  steps: [
    { checkpoint: "open", until: "Why does the parser fail?", deviation },
    { type: "/rev" },
    {
      checkpoint: "slash",
      until: "Review the working tree",
      deviation: [...deviation, "K04-unported-slash-commands"],
    },
    { keys: ["enter"] },
    { checkpoint: "command", until: "/review", deviation },
    { keys: ["ctrl+c"] },
    { type: "ask @gen" },
    { checkpoint: "mention", until: "src/general.ts", deviation },
    { keys: ["enter"] },
    { checkpoint: "picked", until: "ask @general", deviation },
  ],
})
