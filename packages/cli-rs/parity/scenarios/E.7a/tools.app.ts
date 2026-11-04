// Core tool rows (V05a): a finished shell with its output, an edit with a unified diff and an LSP error, and a
// read of a line range, each call in its own row (`session.grouping: none`).
import { defineApp, session } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const patch = [
  "Index: src/parser.rs",
  "===================================================================",
  "--- src/parser.rs",
  "+++ src/parser.rs",
  "@@ -1,4 +1,4 @@",
  " fn next(tokens: &[Token], index: usize) -> Option<&Token> {",
  "-    if index + 1 < tokens.len() {",
  "+    if index < tokens.len() {",
  "         return tokens.get(index);",
  "     }",
  "",
].join("\n")

const tool = (id: string, name: string, state: Record<string, unknown>) => ({
  type: "tool",
  id,
  name,
  state,
  time: { created: 1600, completed: 1700 },
})

const messages = [
  { id: "msg_1", type: "user", text: "Fix the off-by-one in the parser", time: { created: 1000 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      tool("call_1", "shell", {
        status: "completed",
        input: { command: "cargo test parser", workdir: directory },
        content: [{ type: "text", text: "running 2 tests\ntest next_stops_early ... FAILED\ntest next_reads ... ok" }],
        metadata: { exit: 101 },
      }),
      tool("call_2", "read", {
        status: "completed",
        input: { path: `${directory}/src/parser.rs`, offset: 1, limit: 40 },
        content: [{ type: "text", text: "fn next() {}" }],
        metadata: {},
      }),
      tool("call_3", "edit", {
        status: "completed",
        input: { path: `${directory}/src/parser.rs` },
        content: [{ type: "text", text: "Edited src/parser.rs" }],
        metadata: {
          files: [
            {
              file: "src/parser.rs",
              filePath: `${directory}/src/parser.rs`,
              type: "update",
              patch,
              additions: 1,
              deletions: 1,
            },
          ],
          diagnostics: {
            [`${directory}/src/parser.rs`]: [
              { severity: 1, message: "unused variable: `index`", range: { start: { line: 0, character: 26 } } },
            ],
          },
        },
      }),
    ],
    finish: "tool-calls",
    time: { created: 1500, completed: 1800 },
  },
]

export default defineApp({
  height: 40,
  config: { session: { grouping: "none" } },
  args: { sessionID: "ses_tools" },
  routes: [
    { path: "/api/session/ses_tools", json: { data: session("ses_tools", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_tools/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_tools/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "open", until: "unused variable", deviation: ["V01-plain-transcript"] }],
})
