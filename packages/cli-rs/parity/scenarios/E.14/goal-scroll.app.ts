// The goal dialog (DLG45) scrolls an objective taller than the screen leaves it (#65906): on 24 rows its body is
// at most 10 rows, `min(60%, rows - ceil(rows / 4) - 8)`. The arrows, `j`/`k`, page up and down, home and end
// scroll it; the status and its reason are at the bottom.
import { assistant, defineApp, session, user } from "../../lib/app"

const objective = Array.from({ length: 14 }, (_, index) => `Step ${index + 1}: ship part ${index + 1} of the sidebar`)

export default defineApp({
  height: 24,
  args: { sessionID: "ses_g" },
  routes: [
    { path: "/api/session/ses_g", json: { data: session("ses_g", "Goal", { updated: 2 }) } },
    {
      path: "/api/session/ses_g/message",
      json: { data: [assistant("msg_2", "Working on it."), user("msg_1", "Ship the sidebar")], cursor: {} },
    },
    { path: "/api/session/ses_g/inbox", json: { data: [] } },
    {
      method: "POST",
      path: "/api/rpc/opencode.goal/get",
      json: { output: { objective: objective.join("\n"), status: "paused", reason: "Paused by the user" } },
    },
  ],
  steps: [
    { checkpoint: "status", until: "◎ goal paused" },
    { click: [68, 22] },
    { checkpoint: "dialog", until: "Step 1:" },
    { keys: ["down"] },
    { checkpoint: "down", until: "Step 11:" },
    { keys: ["end"] },
    { checkpoint: "end", until: "Paused by the user" },
    { keys: ["k"] },
    { checkpoint: "up", until: "Step 7:" },
    { keys: ["pageup"] },
    { checkpoint: "pageup", until: "Step 1:" },
    { keys: ["pagedown"] },
    { checkpoint: "pagedown", until: "Paused by the user" },
    { keys: ["home"] },
    { checkpoint: "home", until: "Step 1:" },
  ],
})
