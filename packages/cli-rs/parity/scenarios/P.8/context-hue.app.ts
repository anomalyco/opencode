// CT-9: `opencode-plugin-context@2.0.2`, unmodified from npm: the session's context use as a segmented bar in the
// sidebar, its prompt and tool segments in `theme.hue.accent[500]`. The JS host's theme had no `hue`, so the slot
// crashed ("undefined is not an object (evaluating 'theme.hue.accent')") and drew nothing. TS loads the package from
// node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, location, model, session, user } from "../../lib/app"

const id = "ses_h"
const reply = {
  ...assistant("msg_2", "Measured.", 2000),
  cost: 0.42,
  tokens: { input: 120000, output: 500, reasoning: 2000, cache: { read: 30000, write: 0 } },
}

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-plugin-context"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    {
      path: `/api/session/${id}`,
      json: { data: { ...session(id, "Measure the context", { updated: 2 }), cost: 0.42 } },
    },
    { path: "/api/session", json: { data: [session(id, "Measure the context", { updated: 2 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: [reply, user("msg_1", "Measure it", 1000)], cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/model", json: { location, data: [model] } },
  ],
  steps: [{ checkpoint: "bar", until: "200,000 tokens" }],
})
