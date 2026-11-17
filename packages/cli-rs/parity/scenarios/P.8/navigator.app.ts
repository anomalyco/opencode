// CT-21: `opencode-navigator@0.27.7`, unmodified from npm, in a session: its LIMITS and TODO sidebar and its footer.
// Its keymap layers name each binding by a count that grows with every registration (`v2-binding.<n>.<i>`). A change
// of a plugin's registrations reloads them, and the reload mounted its components again, which registered new names:
// it reloaded without end and failed at the 64-changes bound. Now a mount the reload begins again adopts the one it
// ended, as TS takes a registration without a remount, and the registrations settle. TS loads the package from
// node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_n"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-navigator"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Navigate", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Navigate", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Navigated.", 2000), user("msg_1", "Navigate", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    // Its project settings, empty.
    { path: "/api/fs/read/.opencode/:file", base64: Buffer.from("{}").toString("base64") },
  ],
  steps: [
    {
      checkpoint: "session",
      until: "Navigator 0.27.7",
      // TS's `<scrollbox>` draws its scrollbar beside the LIMITS section, where the contract's scroll draws none.
      deviation: [{ file: "F16-v2-compat-layer", cells: 5 }],
    },
  ],
})
