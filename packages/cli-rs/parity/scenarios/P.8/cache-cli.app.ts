// js-npm: `opencode-sidebar-tokens@0.1.3` named in `cli.json` by its spec, as `opencode plugin add` leaves it, and
// installed in the npm cache (`cache`): both clients resolve it there (`Npm.resolve`, TS `Npm.add` of an installed
// package) and load its TUI entry, the same files as sidebar-tokens; the Rust client installs nothing.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_t"
const tokens = { input: 22870, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["opencode-sidebar-tokens@0.1.3"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  cache: { "opencode-sidebar-tokens@0.1.3": "opencode-sidebar-tokens" },
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
