// FT-7: `opencode-sidebar-tokens@0.1.3`, unmodified from npm: the session's token totals in the sidebar, from
// `data.session.get(id).tokens`, which follow a `session.usage.updated` without any other change on screen. TS loads
// the package from node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_t"
const tokens = { input: 22870, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-sidebar-tokens"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Count the tokens", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Count the tokens", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Counted.", 2000), user("msg_1", "Count them", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "empty", until: "Cache write" },
    {
      event: {
        id: "evt_usage",
        created: 3,
        type: "session.usage.updated",
        location: { directory: "/tmp/opencode/packages/tui" },
        data: { sessionID: id, cost: 0.08, tokens },
      },
    },
    { checkpoint: "totals", until: "22,870" },
  ],
})
