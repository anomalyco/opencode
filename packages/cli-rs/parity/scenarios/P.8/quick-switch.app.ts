// FT-6: `opencode-model-quick-switch@0.1.0`, unmodified from npm. Its setup calls `renderer.prependInputHandler`, which
// the layer does not implement: it warns in the client's log and does nothing, and the setup goes on to draw the sidebar's "Recent models"
// block, as TS draws it (here "Requires OpenCode 2.2.5", as the fixture's version is not the one it checks for). TS
// loads the package from node_modules; the Rust client runs the same files on the JS host.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_q"
// TS shows "Finishing startup…" for three seconds once loading a plugin took over half a second
// (`component/startup-loading.tsx`).
const startup = { x: 59, y: 32, width: 22, height: 1, reason: "TS plugin loading notice" }

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-model-quick-switch"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Switch models", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Switch models", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Switched.", 2000), user("msg_1", "Switch it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "sidebar",
      until: "Requires OpenCode 2.2.5",
      masks: [startup],
    },
  ],
})
