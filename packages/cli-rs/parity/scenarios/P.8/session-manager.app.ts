// Ports trio (complex): `@0xuwui/opencode-session-manager@0.1.2`, unmodified from npm: `/session-manager` opens its
// page (a route of its own) with the sessions grouped by directory, `j` moves the selection and PageUp and PageDown a
// page of it, Tab groups by project,
// `/` searches in a field that takes the focus, `r` asks for a new title in a prompt, `d` asks before it deletes. TS
// loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer, and its Luau port in its place (`app::ports_replay`).
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
    // The completion lists the plugin's command before Enter: the plugin loads after the screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    { checkpoint: "slash", until: "Browse, rename and delete" },
    { keys: ["enter"] },
    { checkpoint: "page", until: "Draft the notes" },
    { keys: ["k"] },
    { checkpoint: "moved", until: "Draft the notes" },
    { keys: ["tab"] },
    { checkpoint: "project", until: "[Project]" },
    { keys: ["shift+tab"] },
    { keys: ["/"] },
    // The user types once the field shows, and a moment after: on the JS host the view that shows it comes after the
    // frame, and its keybinds reload the plugin's registrations, which mount the page again; keys typed before the
    // field has the focus again go to the page.
    // Its placeholder is in the host's field color, TS's in OpenTUI's input's (F16-plugin-contract-gaps).
    {
      checkpoint: "searching",
      until: "Search titles",
      deviation: [{ file: "F16-plugin-contract-gaps", cells: 29, styleOnly: true }],
    },
    { wait: 300 },
    { type: "theme" },
    // The field the same key shows takes the focus once its view is adopted, so the typing is its search. Its text is
    // in the host's field color, TS's in OpenTUI's input's (F16-plugin-contract-gaps).
    {
      checkpoint: "search",
      until: "1 match",
      deviation: [{ file: "F16-plugin-contract-gaps", cells: 5, styleOnly: true }],
    },
    { keys: ["escape"] },
    { checkpoint: "cleared", until: "Draft the notes" },
    { keys: ["k"] },
    { keys: ["r"] },
    // The prompt is filled with the title, under the session's directory (contract ergonomics 2.6), which is in the
    // host's description color, TS's in OpenTUI's default text color (CF3-plugin-prompt).
    {
      checkpoint: "rename",
      until: "Rename session",
      deviation: [{ file: "CF3-plugin-prompt", cells: 26, styleOnly: true }],
    },
    { keys: ["escape"] },
    { checkpoint: "renamed", until: "Esc back" },
    { keys: ["d"] },
    { checkpoint: "delete", until: "This cannot be undone." },
    { keys: ["enter"] },
    { checkpoint: "deleted", until: "Deleted 1 session" },
    // Its listing layer and its searching layer each bind `pageup` and `pagedown`, the same commands, one enabled while
    // the other is not: listing, they move the selection a page (carbon ce-1: the searching layer's disabled state
    // disabled them).
    { keys: ["pagedown"] },
    { checkpoint: "paged-down", until: "Plan the release" },
    { keys: ["pageup"] },
    { checkpoint: "paged-up", until: "Plan the release" },
  ],
})
