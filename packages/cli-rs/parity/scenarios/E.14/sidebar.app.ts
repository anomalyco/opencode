// The session sidebar (V19, F04, F06 to F08) at 140 columns, docked on the right: the title, the context use
// and cost (Context), the MCP servers folded above two with their statuses, the todo list, the getting started
// card (no provider connected), and the location. `<leader>b` hides it and writes `session.sidebar: "hide"`,
// and shows it again; a click on the MCP header folds the list.
import { assistant, defineApp, location, model, session, user } from "../../lib/app"

const todos = [
  { content: "Write the changelog", status: "completed" },
  { content: "Tag the release", status: "in_progress" },
  { content: "Announce it", status: "pending" },
]
const reply = {
  ...assistant("msg_2", [
    { type: "text", text: "The release plan is ready." },
    {
      type: "tool",
      id: "call_1",
      name: "todowrite",
      state: { status: "completed", input: { todos }, content: [] },
      time: { created: 2, ran: 2, completed: 3 },
    },
  ]),
  cost: 0.42,
  tokens: { input: 20000, output: 500, reasoning: 0, cache: { read: 4500, write: 0 } },
}

export default defineApp({
  width: 140,
  height: 34,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_s" },
  routes: [
    {
      path: "/api/session/ses_s",
      json: { data: { ...session("ses_s", "Plan the release", { updated: 2 }), cost: 0.42 } },
    },
    { path: "/api/session/ses_s/message", json: { data: [reply, user("msg_1", "Plan it")], cursor: {} } },
    { path: "/api/session/ses_s/inbox", json: { data: [] } },
    { path: "/api/model", json: { location, data: [model] } },
    {
      path: "/api/integration",
      json: { location, data: [{ id: "anthropic", name: "Anthropic", methods: [], connections: [] }] },
    },
    {
      path: "/api/mcp",
      json: {
        location,
        data: [
          { name: "github", status: { status: "connected" } },
          { name: "linear", status: { status: "failed", error: "spawn ENOENT" } },
          { name: "figma", status: { status: "needs_auth", error: "sign in" } },
        ],
      },
    },
  ],
  steps: [
    { checkpoint: "docked", until: "Getting started" },
    { click: [100, 9] },
    { checkpoint: "folded", until: "(1 active, 2 errors)" },
    { keys: ["ctrl+x", "b"] },
    { checkpoint: "hidden" },
    { keys: ["ctrl+x", "b"] },
    { checkpoint: "shown", until: "Getting started" },
  ],
})
