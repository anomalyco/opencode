// CT-16: `@kud/opencode-shell-highlighting@0.1.0`, unmodified from npm. Its setup registers a bash grammar with
// OpenTUI's tree-sitter client, `getTreeSitterClient().initialize().then(…)`. The layer's inert client answered
// `initialize()` with no promise, so the setup threw and the plugin failed with a toast; now it loads and its grammar
// does nothing, as the host highlights with its own (F16). TS loads the package from node_modules; the Rust client runs
// the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_k"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@kud/opencode-shell-highlighting"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Highlight", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Highlight", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Highlighted.", 2000), user("msg_1", "Highlight it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "session", until: "Highlighted." },
    // `/plugins` lists it as active, where it failed.
    { type: "/plugins" },
    { keys: ["enter"] },
    { checkpoint: "plugins", until: "shell-highlighting" },
  ],
})
