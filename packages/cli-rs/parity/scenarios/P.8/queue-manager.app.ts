// Ports trio (complex): `@bybrawe/opencode-queue-manager@0.3.5`, unmodified from npm: `/qm` opens its menu, a select
// that comes back after each task. It adds a draft through a prompt, stages ten copies of a preset message after a
// confirm, moves a draft to the top of the stored list, publishes the eleven drafts to the session's queue one by one,
// and cancels a pending item of the session's inbox. TS loads the package from node_modules; the Rust client runs the
// same files on the JS host through the V2 compatibility layer, and its native and Luau ports in its place
// (`app::ports_replay`).
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_q"
const pending = [
  {
    id: "msg_p1",
    sessionID: id,
    time: { created: 3000 },
    type: "user",
    payload: { text: "Write the tests" },
    delivery: "queue",
  },
  {
    id: "msg_p2",
    sessionID: id,
    time: { created: 3001 },
    type: "synthetic",
    payload: { text: "Continue if you have next steps" },
    delivery: "queue",
  },
]

export default defineApp({
  width: 120,
  height: 34,
  config: { plugins: ["./out/npm/node_modules/@bybrawe/opencode-queue-manager"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Queue the work", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Queue the work", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Ready.", 2000), user("msg_1", "Queue the work", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: pending } },
    { method: "POST", path: `/api/session/${id}/prompt`, json: { data: pending[0] } },
    { method: "DELETE", path: `/api/session/${id}/inbox/msg_p1`, status: 204 },
  ],
  steps: [
    { checkpoint: "session", until: "Ready." },
    { type: "/qm" },
    // The completion lists the plugin's command before Enter: the plugin loads after the screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    { checkpoint: "slash", until: "Queue Manager" },
    { keys: ["enter"] },
    { checkpoint: "menu", until: "native pending" },
    { keys: ["down", "enter"] },
    { checkpoint: "add", until: "Your prompt" },
    { type: "Review the diff" },
    { keys: ["enter"] },
    { checkpoint: "added", until: "1 drafts" },
    { keys: ["enter"] },
    { checkpoint: "count", until: "Custom (1-500)" },
    { keys: ["enter"] },
    { checkpoint: "message", until: "Custom message" },
    { keys: ["down", "enter"] },
    { checkpoint: "stage", until: "Stage 10 copies" },
    { keys: ["enter"] },
    { checkpoint: "staged", until: "11 drafts" },
    { keys: ["down", "down", "down", "enter"] },
    { checkpoint: "drafts", until: "choose one" },
    { keys: ["down", "enter"] },
    { checkpoint: "actions", until: "Move to bottom" },
    { keys: ["down", "down", "down", "enter"] },
    { checkpoint: "moved", until: "001. continue" },
    { keys: ["escape"] },
    { checkpoint: "back", until: "11 drafts" },
    { keys: ["down", "down", "down", "down", "down", "enter"] },
    { checkpoint: "publish", until: "Send 11 messages" },
    { keys: ["enter"] },
    { checkpoint: "published", until: "0 drafts" },
    { keys: ["down", "down", "down", "down", "down", "down", "enter"] },
    { checkpoint: "inbox", until: "native inbox (2)" },
    { keys: ["enter"] },
    { checkpoint: "item", until: "Cancel this pending item" },
    { keys: ["enter"] },
    { checkpoint: "cancel", until: "only still-pending" },
    { keys: ["enter"] },
    { checkpoint: "cancelled", until: "native inbox (2)" },
    { keys: ["escape"] },
    { checkpoint: "again", until: "0 drafts" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Ready." },
  ],
})
