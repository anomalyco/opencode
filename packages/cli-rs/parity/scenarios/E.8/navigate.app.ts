// Scrolling and navigation over eight finished turns (V06, V15): a page up shows "Jump to latest",
// session.first goes to the first message, session.last back to the bottom, and session.messages_last_user
// aligns the last question with the top. Each reply groups its two reads under "Explored".
import { defineApp, session } from "../../lib/app"

const turns = Array.from({ length: 8 }, (_, index) => index + 1)

const messages = turns.flatMap((turn) => {
  const created = turn * 10_000
  const read = (id: string, path: string) => ({
    type: "tool",
    id,
    name: "read",
    state: { status: "completed", input: { filePath: path }, content: [] },
    time: { created: created + 1100, completed: created + 1200 },
  })
  return [
    { id: `msg_${turn}a`, type: "user", text: `Question ${turn}`, time: { created } },
    {
      id: `msg_${turn}b`,
      type: "assistant",
      agent: "build",
      model: { providerID: "provider", id: "model" },
      content: [
        read(`call_${turn}a`, "src/a.rs"),
        read(`call_${turn}b`, "src/b.rs"),
        { type: "text", text: `Answer ${turn} one.\n\nAnswer ${turn} two.\n\nAnswer ${turn} three.` },
      ],
      finish: "stop",
      time: { created: created + 1000, completed: created + 3000 },
    },
  ]
})

const deviation = ["V01-plain-transcript", "P01-read-only-prompt"]

export default defineApp({
  args: { sessionID: "ses_n" },
  routes: [
    { path: "/api/session/ses_n", json: { data: session("ses_n", "Navigate", { updated: 2 }) } },
    { path: "/api/session/ses_n/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_n/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "Answer 8 three.", deviation },
    { keys: ["pageup"] },
    { checkpoint: "page-up", until: "Jump to latest", deviation: [...deviation, "V15-navigation"] },
    { keys: ["ctrl+g"] },
    { checkpoint: "first", until: "Question 1", deviation },
    { keys: ["end"] },
    { checkpoint: "last", until: "Answer 8 three.", deviation },
    { keys: ["alt+end"] },
    { checkpoint: "last-user", until: "Jump to latest", deviation },
  ],
})
