// The block tool rows (V05b, V23): a todo list, answered questions, an apply_patch with an updated and a deleted
// file, one with only applied resources, one still patching and one that failed, and an execute run that failed
// with its error output, each call in its own row (`session.grouping: none`).
import { defineApp, session } from "../../lib/app"

const directory = "/tmp/opencode/packages/tui"
const patch = [
  "Index: src/lexer.rs",
  "===================================================================",
  "--- src/lexer.rs",
  "+++ src/lexer.rs",
  "@@ -1,3 +1,3 @@",
  " fn peek(&self) -> Option<char> {",
  "-    self.chars.get(self.pos + 1)",
  "+    self.chars.get(self.pos)",
  " }",
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
  { id: "msg_1", type: "user", text: "Fix the lexer and track it", time: { created: 1000 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      tool("call_1", "todowrite", {
        status: "completed",
        input: {
          todos: [
            { content: "Read the lexer", status: "completed" },
            { content: "Fix peek", status: "in_progress" },
            { content: "Rewrite the parser", status: "cancelled" },
            { content: "Run the tests", status: "pending" },
          ],
        },
        content: [{ type: "text", text: "4 todos" }],
        metadata: {},
      }),
      tool("call_2", "question", {
        status: "completed",
        input: { questions: [{ question: "Keep the old API?" }, { question: "Add a test?" }] },
        content: [{ type: "text", text: "answered" }],
        metadata: { answers: [["Yes", "for now"], []] },
      }),
      tool("call_3", "apply_patch", {
        status: "completed",
        input: { patchText: "*** Begin Patch" },
        content: [{ type: "text", text: "Applied" }],
        metadata: {
          files: [
            {
              file: "src/lexer.rs",
              filePath: `${directory}/src/lexer.rs`,
              type: "update",
              patch,
              additions: 1,
              deletions: 1,
            },
            {
              file: "src/old.rs",
              filePath: `${directory}/src/old.rs`,
              type: "delete",
              patch: "",
              additions: 0,
              deletions: 12,
            },
          ],
        },
      }),
      tool("call_4", "apply_patch", {
        status: "completed",
        input: { patchText: "*** Begin Patch" },
        content: [{ type: "text", text: "Applied" }],
        metadata: { applied: [{ type: "add", resource: "docs/lexer.md" }] },
      }),
      tool("call_5", "apply_patch", {
        status: "running",
        input: { patchText: "*** Begin Patch\n*** Add File: src/token.rs\n+pub struct Token;" },
        metadata: {},
      }),
      tool("call_6", "apply_patch", {
        status: "error",
        input: { patchText: "*** Update File: src/a.rs\n*** Update File: src/b.rs" },
        error: { type: "unknown", message: "context mismatch in src/a.rs" },
      }),
      tool("call_7", "execute", {
        status: "completed",
        input: { code: "throw new Error('boom')" },
        content: [{ type: "text", text: "Error: boom\n    at main (code.ts:1:7)" }],
        metadata: { error: true, toolCalls: [] },
      }),
    ],
    finish: "tool-calls",
    time: { created: 1500, completed: 1800 },
  },
]

export default defineApp({
  height: 70,
  config: { session: { grouping: "none" } },
  args: { sessionID: "ses_blocks" },
  routes: [
    { path: "/api/session/ses_blocks", json: { data: session("ses_blocks", "Fix the lexer", { updated: 2 }) } },
    { path: "/api/session/ses_blocks/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_blocks/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "open", until: "at main" }],
})
