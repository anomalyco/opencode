// A tab keeps its scroll anchor (V15, `sessionTabs.setScrollAnchor`): a page up in the first session, a second
// session opened as a tab, and `<leader>1` back to the first, which shows the rows the reader left.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }
const turns = Array.from({ length: 8 }, (_, index) => index + 1)

const messages = turns.flatMap((turn) => {
  const created = turn * 10_000
  return [
    { id: `msg_${turn}a`, type: "user", text: `Question ${turn}`, time: { created } },
    {
      id: `msg_${turn}b`,
      type: "assistant",
      agent: "build",
      model: { providerID: "provider", id: "model" },
      content: [{ type: "text", text: `Answer ${turn} one.\n\nAnswer ${turn} two.\n\nAnswer ${turn} three.` }],
      finish: "stop",
      time: { created: created + 1000, completed: created + 3000 },
    },
  ]
})

export default defineApp({
  args: { sessionID: "ses_n" },
  routes: [
    { path: "/api/session/ses_n", json: { data: session("ses_n", "Navigate", { updated: 2 }) } },
    { path: "/api/session/ses_n/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_n/inbox", json: { data: [] } },
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Write the docs", { updated: 2 }) } },
    {
      path: "/api/session/ses_b/message",
      json: { data: [assistant("msg_2", "The docs are written."), user("msg_1", "Why?")], cursor: {} },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    { method: "POST", path: "/api/session/:sessionID/view" },
  ],
  steps: [
    { checkpoint: "open", until: "Answer 8 three." },
    { keys: ["pageup"] },
    { checkpoint: "away", until: "Jump to latest" },
    { event: { id: "evt_1", created: 3, type: "tui.session.select", location: here, data: { sessionID: "ses_b" } } },
    { checkpoint: "other", until: "The docs are written." },
    { keys: ["ctrl+x", "1"] },
    { checkpoint: "back", until: "Jump to latest" },
  ],
})
