// CT-37: `@max10240/opencode-plugin-sensitive-encrypt@1.0.31`, unmodified from npm: `/encrypt-sensitive` asks its
// server part for the keys, then shows a panel of its own (`ui.dialog.show`) whose text field takes the focus, so what
// the user types is the field's. The field was in no mount, so it took no focus and the typing was lost; the dialog's
// body is now a mount (contract ergonomics 2.7). TS loads the package from node_modules; the Rust client runs the
// same files on the JS host through the V2 compatibility layer. Its server part is not running: the scenario answers
// its `keys`.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_e"
const colors = [{ file: "F16-v2-compat-layer", cells: 900, styleOnly: true }]

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@max10240/opencode-plugin-sensitive-encrypt"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Secrets", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Secrets", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Done.", 2000), user("msg_1", "Hide it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    {
      method: "POST",
      path: "/api/rpc/max10240.sensitive-encrypt/keys",
      json: { output: { keys: [{ role: "encrypt", keyID: "key-0001" }], defaultRole: "encrypt" } },
    },
  ],
  // The context's location sends its directory alone in the RPC's query (F16-v2-compat-layer).
  requests: { deviation: "F16-v2-compat-layer" },
  steps: [
    { checkpoint: "session", until: "Hide it" },
    { type: "/encrypt-sensitive" },
    // The completion lists the plugin's command before Enter (file-browser-flake).
    { checkpoint: "slash", until: "configured public key" },
    { keys: ["enter"] },
    // The plugin's text without a color, and its fields, draw in the host's colors (F16-v2-compat-layer).
    { checkpoint: "panel", until: "ctrl+t switch", deviation: colors },
    // The field takes the focus a moment after the panel mounts (the plugin's own 50 ms timer).
    { wait: 300 },
    { type: "hunter2" },
    { checkpoint: "typed", until: "hunter2", deviation: colors },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Hide it" },
  ],
})
