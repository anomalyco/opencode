// CT-22: `@joe-broadhead/opencode-tavily@0.0.7`, unmodified from npm: `/tavily` opens its status dialog, colored from
// `theme.surface("dialog")`. The layer answered the page theme with a warning toast, which covered the dialog; now it
// answers the dialog surface's colors, as the host resolves them. Its server part is not running here, so its status
// RPC fails and the dialog shows that, in both clients. TS loads the package from node_modules; the Rust client runs the
// same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_t"

export default defineApp({
  width: 140,
  height: 34,
  config: { plugins: ["./out/npm/node_modules/@joe-broadhead/opencode-tavily"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Search the web", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Search the web", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Searched.", 2000), user("msg_1", "Search it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: "/api/rpc/tavily.web/status", status: 404, json: { _tag: "NotFound", message: "no such RPC" } },
    // A location without a project: TS's `context.location` is the whole location read, which its RPC call sends,
    // and the host's is the directory alone (F16).
    { path: "/api/location", json: { directory: "/tmp/opencode/packages/tui" } },
  ],
  steps: [
    { checkpoint: "session", until: "Searched." },
    { type: "/tavily" },
    // The completion lists the plugin's command before Enter: the plugin loads after the home screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    { checkpoint: "slash", until: "Show Tavily" },
    { keys: ["enter"] },
    { checkpoint: "status", until: "no such RPC" },
  ],
})
