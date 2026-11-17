// Ports trio (complex): `@0xuwui/opencode-session-manager@0.1.2`, unmodified from npm: `/session-manager` opens its
// page (a route of its own) with the sessions grouped by directory, `j` moves the selection, Tab groups by project,
// `/` searches in a field that takes the focus, `r` asks for a new title in a prompt, `d` asks before it deletes. TS
// loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer, and its native and Luau ports in its place (`app::ports_replay`).
import { defineApp } from "../../lib/app"

const at = (id: string, title: string, directory: string, created: number, updated: number) => ({
  id,
  title,
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, updated },
  location: { directory },
})
const sessions = [
  at("ses_n", "Fix the theme picker", "/tmp/opencode/packages/app", 1700100000000, 1700200000000),
  at("ses_m", "Plan the release", "/tmp/opencode/packages/tui", 1700000000000, 1700150000000),
  at("ses_o", "Draft the notes", "/tmp/opencode/packages/tui", 1699000000000, 1699500000000),
]

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@0xuwui/opencode-session-manager"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: "ses_m" },
  routes: [
    { path: "/api/session/ses_m", json: { data: sessions[1] } },
    { path: "/api/session", json: { data: sessions, cursor: {} } },
    { path: "/api/session/ses_m/message", json: { data: [], cursor: {} } },
    { path: "/api/session/ses_m/inbox", json: { data: [] } },
    { method: "DELETE", path: "/api/session/ses_n", status: 204 },
  ],
  steps: [
    { checkpoint: "session", until: "Plan the release" },
    { type: "/session-manager" },
    { keys: ["enter"] },
    { checkpoint: "page", until: "Draft the notes" },
    { keys: ["k"] },
    { checkpoint: "moved", until: "Draft the notes" },
    { keys: ["tab"] },
    { checkpoint: "project", until: "[Project]" },
    { keys: ["shift+tab"] },
    { keys: ["/"] },
    { type: "theme" },
    // Contract 2.0 refuses the focus of a field, so the typing goes elsewhere (F16-plugin-contract-gaps).
    { checkpoint: "search", until: "1 match", deviation: [{ file: "F16-plugin-contract-gaps", cells: 400 }] },
    { keys: ["escape"] },
    { checkpoint: "cleared", until: "Draft the notes" },
    { keys: ["k"] },
    { keys: ["r"] },
    // A contract 2.0 prompt has no value or description (F16-plugin-contract-gaps).
    { checkpoint: "rename", until: "Rename session", deviation: [{ file: "F16-plugin-contract-gaps", cells: 300 }] },
    { keys: ["escape"] },
    { checkpoint: "renamed", until: "Esc back" },
    { keys: ["d"] },
    { checkpoint: "delete", until: "This cannot be undone." },
    { keys: ["enter"] },
    { checkpoint: "deleted", until: "Deleted 1 session" },
  ],
})
