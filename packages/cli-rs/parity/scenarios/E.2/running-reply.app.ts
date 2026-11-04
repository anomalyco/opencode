// A reply while it runs (rs-ms1-accept problems 4 and 5): the step has started and nothing streamed yet, then
// reasoning streams in, then the reasoning ends and a shell call runs. The session is running throughout.
import { defineApp, session, user } from "../../lib/app"

const id = "ses_run"
const message = { sessionID: id, assistantMessageID: "msg_2" }
let seq = 0
const event = (type: string, data: Record<string, unknown>, durable = true) => ({
  event: {
    id: `evt_${++seq}`,
    created: 2000 + seq,
    type,
    ...(durable ? { durable: { aggregateID: id, seq, version: 1 } } : {}),
    data: { ...message, ...data },
  },
})

// The prompt footer hints are E.14's (P01-read-only-prompt).
const masks = [
  { x: 50, y: 28, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
]

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Run echo", { updated: 2 }) } },
    {
      path: `/api/session/${id}/message`,
      json: {
        data: [
          {
            id: "msg_2",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [],
            time: { created: 1500 },
          },
          user("msg_1", "Run the shell command `echo hello` and then reply done", 1000),
        ],
        cursor: {},
      },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/session/active", json: { data: { [id]: { type: "running" } } } },
  ],
  steps: [
    { checkpoint: "waiting", until: "echo hello", masks },
    event("session.reasoning.started", { ordinal: 0 }),
    event("session.reasoning.delta", { ordinal: 0, delta: "**Planning the command**\n\nI will run echo." }, false),
    { checkpoint: "thinking", until: "Thinking: Planning the command", masks },
    event("session.reasoning.ended", {
      ordinal: 0,
      text: "**Planning the command**\n\nI will run echo.",
    }),
    event("session.tool.input.started", { id: "call_1", name: "shell" }),
    event("session.tool.input.ended", { id: "call_1", text: '{"command":"echo hello"}' }),
    event("session.tool.called", { id: "call_1", input: { command: "echo hello" }, executed: true }),
    { checkpoint: "shell", until: "⋯ echo hello", masks },
  ],
})
