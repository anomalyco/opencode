// Interrupting a running session before the model answers with text or a tool call takes the prompt back (#65505):
// Esc arms the interrupt, the second Esc interrupts, waits, stages a files:false revert, commits it, and puts the
// prompt back in the composer.
import { defineApp, session, user } from "../../lib/app"

const id = "ses_interrupt"
let seq = 0
const event = (type: string, data: Record<string, unknown>) => ({
  event: {
    id: `evt_${++seq}`,
    created: 2000 + seq,
    type,
    durable: { aggregateID: id, seq, version: 1 },
    data: { sessionID: id, ...data },
  },
})

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true }, session: { verbosity: "medium" } },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Interrupt undo", { updated: 2 }) } },
    {
      path: `/api/session/${id}/message`,
      json: {
        data: [
          {
            id: "msg_2",
            type: "assistant",
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [{ type: "reasoning", text: "Thinking it over" }],
            time: { created: 1500 },
          },
          user("msg_1", "Reword this prompt", 1000),
        ],
        cursor: {},
      },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/session/active", json: { data: { [id]: { type: "running" } } } },
    { method: "POST", path: `/api/session/${id}/interrupt`, json: { interrupted: true } },
    { method: "POST", path: `/api/experimental/session/${id}/wait`, status: 204 },
    { method: "POST", path: `/api/session/${id}/revert/stage`, json: { data: { messageID: "msg_1" } } },
    { method: "POST", path: `/api/session/${id}/revert/commit`, status: 204 },
  ],
  steps: [
    { checkpoint: "running", until: "esc interrupt" },
    { keys: ["escape"] },
    { checkpoint: "confirm", until: "again to interrupt" },
    { keys: ["escape"] },
    { wait: 200 },
    event("session.execution.interrupted", { reason: "user" }),
    event("session.revert.committed", { to: "msg_1" }),
    { checkpoint: "undone", until: "Reword this prompt" },
  ],
})
