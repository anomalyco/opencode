// Ports trio: `@khaosoigai/oc-context-grid@0.3.2`, unmodified from npm: the session's context window as a grid of
// squares in the sidebar, and its `/contextgrid` page (a route of the plugin's own, with its keyboard mode), which
// escape leaves for the session. TS loads the package from node_modules; the Rust client runs the same files on the JS
// host through the V2 compatibility layer, and its Luau port in its place (`app::ports_replay`).
import { assistant, defineApp, location, model, session, user } from "../../lib/app"

const id = "ses_g"
const reply = {
  ...assistant("msg_2", [
    { type: "text", text: "The file says what the release holds; the notes follow it." },
    {
      type: "tool",
      id: "call_1",
      name: "read",
      state: {
        status: "completed",
        input: { path: "CHANGELOG.md" },
        content: [{ type: "text", text: "x".repeat(40000) }],
      },
      time: { created: 2, ran: 2, completed: 3 },
    },
  ]),
  cost: 0.08,
  tokens: { input: 30000, output: 500, reasoning: 0, cache: { read: 5000, write: 0 } },
}

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@khaosoigai/oc-context-grid"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: { ...session(id, "Draft the notes", { updated: 2 }), cost: 0.08 } } },
    { path: "/api/session", json: { data: [session(id, "Draft the notes", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [reply, user("msg_1", "Read the changelog and draft the notes for 2.3.")], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { path: "/api/model", json: { location, data: [model] } },
  ],
  steps: [
    { checkpoint: "sidebar", until: "tokens (18%)" },
    { type: "/contextgrid" },
    // The completion lists the plugin's command before Enter: the plugin loads after the screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    {
      checkpoint: "slash",
      until: "Show context usage as a grid",
      // The list shows the plugin's slash alias `/ctx` too, on each carrier, as TS's does (contract ergonomics 2.6).
    },
    { keys: ["enter"] },
    { checkpoint: "page", until: "Estimated usage by category" },
    { keys: ["escape"] },
    { checkpoint: "back", until: "tokens (18%)" },
  ],
})
