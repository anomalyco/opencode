// CT-24: `@jasonencode/opencode-context@1.0.0`, unmodified from npm: its SessionWatch panel in the sidebar sizes its
// dividers and gauges by its box's `width`, which it reads in `onSizeChange`. The layer's `width` was the prop, and no
// size change came, so the panel kept its default width and drew one cell wider. Now `width` is the host's layout of
// the box (`Read::rect`) and `onSizeChange` runs as it comes. TS loads the package from node_modules; the Rust client
// runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_w"
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
  ...assistant("msg_2", "Watched.", 2000),
  cost: 0.02,
  tokens: { input: 6900, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
}

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@jasonencode/opencode-context"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: { ...session(id, "Watch the session", { updated: 2 }), cost: 0.02 } } },
    { path: "/api/session", json: { data: [session(id, "Watch the session", { updated: 2 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: [reply, user("msg_1", "Watch it", 1000)], cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/model", json: { location, data: [model] } },
  ],
  steps: [
    {
      checkpoint: "panel",
      until: "SessionWatch",
      // Its counts: TS's panel counts the session's requests as their events come, none here, where the layer renders
      // again once the session's messages came (F16's snapshot reads) and counts the one reply. The dividers and the
      // context gauge, which its width sizes, are compared.
      masks: [
        { x: 100, y: 5, width: 37, height: 1, reason: "the hit rate: counted from events in TS, none here" },
        { x: 100, y: 11, width: 37, height: 1, reason: "the request counts: counted from events in TS, none here" },
        { x: 0, y: 14, width: 140, height: 20, reason: "what follows the counts, and the footer's context use" },
      ],
      // TS's sidebar draws its scrollbar beside the panel, where the host's draws none.
      deviation: [{ file: "F16-v2-compat-layer", cells: 10 }],
    },
  ],
})
