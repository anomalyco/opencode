// P8: `opencode-sidebar-prompt@0.1.6`, unmodified from npm: the session's last prompt in the sidebar, and its
// `/lastprompt`, which shows the whole prompt in a dialog of its own (`ui.dialog.show`, large and centered) with a
// header, a scroll and a hint. TS loads the package from node_modules; the Rust client runs the same files on the JS
// host through the V2 compatibility layer, the dialog in the host's panel dialog.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_l"
const prompt =
  "Write the release notes for 2.3: the new sidebar, the plugin host, and the fixes to the theme picker. Keep each " +
  "line short, link every pull request, and leave the upgrade steps for last."

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-sidebar-prompt"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Release notes", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Release notes", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Drafted.", 2000), user("msg_1", prompt, 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "sidebar", until: "Open full prompt" },
    { type: "/lastprompt" },
    { keys: ["enter"] },
    { checkpoint: "dialog", until: "Esc · Close" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Open full prompt" },
  ],
})
