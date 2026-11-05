// M.2's `ses_mini` server with tool calls: a history whose assistant messages call tools, and the events of a live
// turn that runs a shell command and edits a file.
import { assistant, event, server as base, user } from "../M.2/fixture"

export { config, event, leave } from "../M.2/fixture"

const tool = (id: string, name: string, state: Record<string, unknown>) => ({
  type: "tool",
  id,
  name,
  state,
  time: { created: 10, ran: 10, completed: 1_210 },
})

const done = (input: Record<string, unknown>, text = "", metadata: Record<string, unknown> = {}) => ({
  status: "completed",
  input,
  content: text ? [{ type: "text", text }] : [],
  metadata,
})

export const patch = "@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n const b = 3\n"

// Read, glob, a todo list, and a failed command, then the answer.
export const history = [
  user("msg_u1", "look around", 10),
  assistant(
    "msg_a1",
    [
      tool("call_read", "read", done({ filePath: "/tmp/mini/src/main.ts" }, "one\ntwo")),
      tool("call_glob", "glob", done({ pattern: "**/*.ts", path: "/tmp/mini/src" }, "src/main.ts", { count: 1 })),
      tool(
        "call_todo",
        "todowrite",
        done({
          todos: [
            { content: "Read the code", status: "completed" },
            { content: "Fix the bug", status: "in_progress" },
            { content: "Skip this", status: "cancelled" },
          ],
        }),
      ),
      tool("call_fail", "bash", {
        status: "error",
        input: { command: "false" },
        metadata: {},
        error: { type: "tool", message: "exit 1" },
      }),
      { type: "text", text: "Looked around." },
    ],
    11,
  ),
]

// A live turn: a shell call with output, an edit with a diff, then the answer.
export const turn = (id: string) => {
  const call = (type: string, callID: string, data: Record<string, unknown>, created = 101) =>
    event(type, { assistantMessageID: "msg_a2", id: callID, ...data }, created)
  return [
    event("session.inbox.delivered", { inboxID: id }),
    event("session.execution.started", {}),
    event("session.step.started", {
      assistantMessageID: "msg_a2",
      agent: "build",
      model: { id: "model", providerID: "demo" },
      started: 101,
    }),
    call("session.tool.input.started", "call_sh", { name: "bash" }),
    call("session.tool.called", "call_sh", { input: { command: "ls src" }, executed: true }),
    call(
      "session.tool.success",
      "call_sh",
      { content: [{ type: "text", text: "main.ts\nutil.ts\n" }], metadata: { exit: 0 }, executed: true },
      2_101,
    ),
    call("session.tool.input.started", "call_edit", { name: "edit" }),
    call("session.tool.called", "call_edit", { input: { filePath: "/tmp/mini/src/main.ts" }, executed: true }),
    call(
      "session.tool.success",
      "call_edit",
      {
        content: [{ type: "text", text: "Edited." }],
        metadata: { files: [{ relativePath: "src/main.ts", type: "update", patch }] },
        executed: true,
      },
      2_301,
    ),
    event("session.text.delta", { assistantMessageID: "msg_a2", ordinal: 0, delta: "Bumped a." }),
    event("session.text.ended", { assistantMessageID: "msg_a2", ordinal: 0, text: "Bumped a." }),
    event("session.execution.succeeded", {}),
  ]
}

export const server = () =>
  base({
    messages: history,
    events: (id) => turn(id),
    after: (id) => [user(id, "bump a", 100)],
  })
