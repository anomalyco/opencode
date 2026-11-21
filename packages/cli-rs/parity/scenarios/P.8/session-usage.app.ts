// P8: `opencode-session-usage@0.1.8`, unmodified from npm, in the session sidebar in place of the built-in Limit (it
// takes its ID): the session's reported cost and the Go meters, laid out as absolute labels over bars. Its async setup
// fetches the usage limits and the session's messages through `client`; the meters reset at the epoch, so their
// countdown reads the same whenever it runs. TS loads the package from node_modules; the Rust client runs the same files
// on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_u"
const meter = (percent: number) => ({ percent, limited: false, resetsAt: 0 })
const reply = { ...assistant("msg_2", "Done.", 2000), cost: 0.42 }

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-session-usage"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: { ...session(id, "Count the cost", { updated: 2 }), cost: 0.42 } } },
    { path: "/api/session", json: { data: [session(id, "Count the cost", { updated: 2 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: [reply, user("msg_1", "Count it", 1000)], cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    {
      path: "/api/experimental/usage/limits",
      json: { data: { go: { rolling: meter(12), weekly: meter(75), monthly: meter(95) } } },
    },
  ],
  steps: [{ checkpoint: "meters", until: "Monthly" }],
})
