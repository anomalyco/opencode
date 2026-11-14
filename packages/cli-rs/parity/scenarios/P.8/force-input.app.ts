// P8: `@mynameistito/opencode-force-input@1.1.20`, unmodified from npm: its hint, an absolute box claimed in
// `prompt.footer.status` and lifted two rows into the composer's info row, and its `ctrl+enter`, which dispatches
// `session.interrupt` three times and then `prompt.submit`. TS loads the package from node_modules; the Rust client runs
// the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_f"

export default defineApp({
  config: { plugins: ["./out/npm/node_modules/@mynameistito/opencode-force-input"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Ship it", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Ship it", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Done.", 2000), user("msg_1", "Ship it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: `/api/session/${id}/prompt`, json: { data: { id: "inb_1" } } },
  ],
  steps: [
    { checkpoint: "hint", until: "send" },
    { type: "now" },
    { keys: ["ctrl+enter"] },
    { checkpoint: "forced" },
  ],
})
