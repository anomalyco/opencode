// A shell call the user stopped (#62977): it fails with its output followed by the notice its metadata names. The
// output shows clipped like the finished call's above it, and only the notice shows as the error.
import { defineApp, session } from "../../lib/app"

const steps = Array.from({ length: 15 }, (_, index) => `step ${index + 1}`).join("\n")
const notice = "[full output saved to /tmp/sh_stopped.out]\n\nCommand interrupted by the user (shell ID: sh_stopped)."

const shell = (id: string, command: string, state: Record<string, unknown>) => ({
  type: "tool",
  id,
  name: "shell",
  time: { created: 1600, completed: 1700 },
  state: { input: { command }, ...state },
})

const messages = [
  { id: "msg_1", type: "user", text: "Run them", time: { created: 1000 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      shell("call_1", "seq-completed", {
        status: "completed",
        content: [{ type: "text", text: steps }],
        metadata: { exit: 0, truncated: false },
      }),
      shell("call_2", "seq-stopped", {
        status: "error",
        error: { type: "tool.execution", message: `${steps}\n\n${notice}` },
        metadata: { interrupted: true, truncated: false, shellID: "sh_stopped", notice },
      }),
      { type: "text", text: "Both ran" },
    ],
    finish: "stop",
    time: { created: 1500, completed: 1800 },
  },
]

export default defineApp({
  height: 50,
  config: { session: { grouping: "none", verbosity: "medium" } },
  args: { sessionID: "ses_stopped" },
  routes: [
    { path: "/api/session/ses_stopped", json: { data: session("ses_stopped", "Stopped shell", { updated: 2 }) } },
    { path: "/api/session/ses_stopped/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_stopped/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "open", until: "Both ran" }],
})
