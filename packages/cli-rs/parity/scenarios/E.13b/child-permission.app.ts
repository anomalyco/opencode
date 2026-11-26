// A child session prompts for its own permission request, and the prompt hides the composer the child shows in place
// of a prompt (`composerVisible`, #64343). Enter allows it once; the composer comes back.
import { assistant, defineApp, session, user } from "../../lib/app"

const parent = session("ses_p", "Plan the release", { updated: 10 })
const child = { ...session("ses_c", "Find the parser (@explore subagent)", { updated: 9 }), parentID: "ses_p" }

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_c" },
  routes: [
    { path: "/api/session/ses_p", json: { data: parent } },
    { path: "/api/session/ses_c", json: { data: child } },
    { path: "/api/session", json: { data: [parent, child], cursor: {} } },
    {
      path: "/api/session/ses_c/message",
      json: { data: [assistant("msg_c_2", "Done.", 2000), user("msg_c_1", "Look for the parser", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_c/inbox", json: { data: [] } },
    {
      path: "/api/session/ses_c/permission",
      json: { data: [{ id: "per_1", sessionID: "ses_c", action: "shell", resources: ["rg parser"], save: [] }] },
    },
    { method: "POST", path: "/api/session/ses_c/permission/per_1/reply", status: 204 },
    // The Rust prompt under the child's composer mounts its footer, which reads the goal; TS mounts no prompt here.
    { method: "POST", path: "/api/rpc/opencode.goal/get", json: { output: null } },
  ],
  steps: [
    // Since `@opentui/core` 0.9.9, TS can draw the prompt while its tab is still the child's, before the tab moves to
    // the root session; the checkpoint waits for the root's tab, which shows the pending permission (`!`).
    { checkpoint: "prompted", until: "! Plan the release" },
    { keys: ["enter"] },
    { checkpoint: "composer", until: "Subagents" },
  ],
})
