// Layout reads (contract proposal, addition 1): `opencode-tokscope@0.4.0`, unmodified from npm. Its sidebar takes a ref
// to its root box (`width: "100%"`) and reads `getLayout().width` in a zero-delay timer, at most 10 times, and draws
// nothing until a width came; it measures again only when the terminal's size changes. The host's layout reaches the
// JS host a frame late, so the sidebar stayed empty. Now a mount's root answers its room's width from the mount's first
// input, which carries the size the host laid the mount out at. TS loads the package from node_modules; the Rust
// client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_s"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-tokscope"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Scope the tokens", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Scope the tokens", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Scoped.", 2000), user("msg_1", "Scope it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [{ checkpoint: "sidebar", until: "TokScope" }],
})
