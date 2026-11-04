// The goal under the prompt (F02, DLG45): `◎ goal` from the goal plugin's RPC; a click opens the goal dialog
// with the objective, and `p` pauses it through `/goal pause`. The `changed` event then shows the paused goal in
// the footer and the dialog.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }
const goal = (status: string, reason?: string) => ({
  id: "goal_1",
  objective: "Ship the sidebar with every built-in section",
  status,
  ...(reason ? { reason } : {}),
  rounds: 1,
  maxRounds: 20,
  boot: "boot_1",
  updatedAt: 1,
})

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_g" },
  routes: [
    { path: "/api/session/ses_g", json: { data: session("ses_g", "Goal session", { updated: 2 }) } },
    {
      path: "/api/session/ses_g/message",
      json: { data: [assistant("msg_2", "Working on it."), user("msg_1", "/goal ship")], cursor: {} },
    },
    { path: "/api/session/ses_g/inbox", json: { data: [] } },
    { method: "POST", path: "/api/rpc/opencode.goal/get", json: { output: goal("active") } },
    { method: "POST", path: "/api/session/:sessionID/command" },
  ],
  steps: [
    { checkpoint: "status", until: "◎ goal" },
    { click: [75, 28] },
    { checkpoint: "dialog", until: "Ship the sidebar" },
    { keys: ["p"] },
    {
      event: {
        id: "evt_1",
        created: 3,
        type: "rpc.opencode.goal.changed",
        location: here,
        data: { sessionID: "ses_g", goal: goal("paused", "Paused by the user") },
      },
    },
    { checkpoint: "paused", until: "Paused by the user" },
    { keys: ["escape"] },
    { checkpoint: "footer", until: "goal paused" },
  ],
})
