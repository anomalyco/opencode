// CT-28: `opencode-tui-context@2.1.1`, unmodified from npm: its sidebar panel sizes its context gauges and picks its
// legend's layout by the panel's width, which it reads in `onSizeChange`. The layer gave no width, so the gauges drew
// narrower and the legend's values wrapped under their labels. TS loads the package from node_modules; the Rust client
// runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_c"
const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}
const model = {
  id: "model",
  modelID: "model",
  providerID: "provider",
  name: "Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
  status: "active",
  enabled: true,
  limit: { context: 200000, output: 32000 },
}
const reply = {
  ...assistant("msg_2", "Measured.", 2000),
  cost: 0.04,
  tokens: { input: 13060, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
}

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-tui-context"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: { ...session(id, "Measure it", { updated: 2 }), cost: 0.04 } } },
    { path: "/api/session", json: { data: [session(id, "Measure it", { updated: 2 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: [reply, user("msg_1", "Measure", 1000)], cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/model", json: { location, data: [model] } },
  ],
  steps: [
    {
      checkpoint: "panel",
      until: "used",
      // TS's sidebar draws its scrollbar beside the panel, where the host's draws none.
      deviation: [{ file: "F16-v2-compat-layer", cells: 13 }],
    },
  ],
})
