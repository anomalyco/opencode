// CT-26: `@juliuskb/opencode-voice@0.0.9`, unmodified from npm: its sidebar panel's border title spreads "Voice v0.0.9"
// and "Menu:<key>" across the panel's width, which it reads as `r.width` in an `onSizeChange` it sets on the box by its
// ref. The layer called only an `onSizeChange` prop, so the width stayed unknown and the two parts ran together. TS
// loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_v"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@juliuskb/opencode-voice"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Speak", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Speak", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Spoken.", 2000), user("msg_1", "Speak it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    // Its server part, as the fake server answers it: no model installed, and default settings.
    {
      method: "POST",
      path: "/api/rpc/voice/status",
      json: { output: { recording: false, engineLoaded: false, modelInstalled: false, rssMb: 0, cpuPct: 0 } },
    },
    { method: "POST", path: "/api/rpc/voice/settingsGet", json: { output: { json: "{}" } } },
    { method: "POST", path: "/api/rpc/voice/:method", status: 404, json: { _tag: "NotFound", message: "no such RPC" } },
  ],
  steps: [
    {
      checkpoint: "panel",
      until: "Menu:",
      // Its bottom title (CPU and memory), which the contract's border does not carry.
      deviation: [{ file: "F16-v2-compat-layer", cells: 14 }],
    },
  ],
  // It polls its status on a timer, which runs in real time on the JS host: the replay sends more polls, in another
  // order with its settings read.
  requests: { deviation: "F16-v2-compat-layer" },
})
