// IDE editor context (P08) from a fake IDE MCP server: after the MCP handshake, `selection_changed` puts the file and
// lines in the prompt footer, highlighted until they are sent, and `at_mentioned` inserts a file mention with its
// lines at the cursor. The recording also keeps what the TUI sent the server.
import { defineApp, session, user } from "../../lib/app"

const deviation = ["V01-plain-transcript", "P01-read-only-prompt"]
const file = "/tmp/opencode/packages/tui/src/parser.ts"

export default defineApp({
  args: { sessionID: "ses_b" },
  ide: true,
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why does the parser fail?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "Why does the parser fail?", deviation },
    {
      ide: {
        method: "selection_changed",
        params: {
          text: "if (token) {\n  return\n}",
          filePath: file,
          selection: { start: { line: 3, character: 1 }, end: { line: 5, character: 2 } },
        },
      },
    },
    { checkpoint: "selected", until: "parser.ts#3-5", deviation },
    { type: "see " },
    { ide: { method: "at_mentioned", params: { filePath: file, lineStart: 3, lineEnd: 5 } } },
    { checkpoint: "mentioned", until: "see @src/parser.ts#3-5", deviation },
  ],
})
