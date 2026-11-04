// The one-line tool rows (V05b, V23): webfetch, websearch, skill, question, todowrite, subagent, and execute,
// each running and finished, in their own rows (`session.grouping: none`). Then a click on the finished execute
// row opens its dialog (DLG36).
import { defineApp, session } from "../../lib/app"

const tool = (id: string, name: string, state: Record<string, unknown>) => ({
  type: "tool",
  id,
  name,
  state,
  time: { created: 1600, ran: 1600, completed: 2850 },
})

const running = (input: Record<string, unknown>, metadata: Record<string, unknown> = {}) => ({
  status: "running",
  input,
  metadata,
})

const completed = (input: Record<string, unknown>, text: string, metadata: Record<string, unknown> = {}) => ({
  status: "completed",
  input,
  content: [{ type: "text", text }],
  metadata,
})

const messages = [
  { id: "msg_1", type: "user", text: "Look around before the change", time: { created: 1000 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      tool("call_1", "webfetch", running({ url: "https://example.com/spec" })),
      tool("call_2", "webfetch", completed({ url: "https://opencode.ai/docs" }, "# Docs")),
      tool("call_3", "websearch", running({})),
      tool("call_4", "websearch", completed({ query: "opentui rust" }, "results", { provider: "exa" })),
      tool("call_5", "skill", running({})),
      tool("call_6", "skill", completed({ id: "writing" }, "loaded", { name: "writing-doc" })),
      tool("call_7", "question", running({ questions: [{ question: "Which design?" }] })),
      tool("call_8", "todowrite", running({ todos: [] })),
      tool("call_9", "todowrite", completed({ todos: [] }, "")),
      tool(
        "call_10",
        "task",
        running(
          { description: "Survey the views", subagent_type: "explore", model: "provider/unknown#high" },
          { sessionID: "ses_child" },
        ),
      ),
      tool(
        "call_11",
        "task",
        completed({ description: "Check the docs", agent: "general" }, "done", {
          sessionID: "ses_child",
          status: "running",
        }),
      ),
      tool(
        "call_12",
        "execute",
        running(
          { code: "await tools.read()" },
          {
            toolCalls: [
              { tool: "read", status: "completed", input: { path: "src/a.rs" } },
              { tool: "grep", status: "error", input: { pattern: "TODO" } },
              { tool: "glob", status: "running" },
            ],
          },
        ),
      ),
      tool(
        "call_13",
        "execute",
        completed({ code: "const files = await tools.glob()\nreturn files" }, '{"files":2}\n\nLogs:\nscanned', {
          toolCalls: [],
        }),
      ),
    ],
    finish: "tool-calls",
    time: { created: 1500, completed: 3000 },
  },
]

export default defineApp({
  height: 40,
  config: { session: { grouping: "none" } },
  args: { sessionID: "ses_tools" },
  routes: [
    { path: "/api/session/ses_tools", json: { data: session("ses_tools", "Look around", { updated: 2 }) } },
    { path: "/api/session/ses_tools/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_tools/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "glob" },
    { click: [6, 30] },
    { checkpoint: "dialog", until: "Completed" },
  ],
})
