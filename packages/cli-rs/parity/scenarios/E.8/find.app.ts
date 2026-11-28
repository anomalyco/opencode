// Find in session (#64870): opens with <leader>f, searches prompts, markdown (bold, fenced code,
// tables), and compaction summaries, moves across matches including wrapped navigation, handles
// streamed code blocks, ignores fence info strings, matches across concealed markup, and clears on Esc.
import { defineApp, session } from "../../lib/app"

const sessionID = "ses_find"
const model = { providerID: "provider", id: "model" }
const filler = Array.from({ length: 16 }, (_, index) => ({
  id: `message-${String(index + 2).padStart(2, "0")}`,
  type: "user",
  text: `Filler message ${index}`,
  time: { created: index + 10 },
}))
const messages = [
  { id: "message-00", type: "user", text: "Where is the needle?", time: { created: 1 } },
  {
    id: "message-01",
    type: "assistant",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 2, completed: 3 },
    content: [
      {
        type: "text",
        text: "The **Needle** is in the code:\n\n```ts\nconst needle = 1\n```\n\n| a | b |\n|---|---|\n| hay | needle |",
      },
    ],
  },
  {
    id: "message-01a",
    type: "assistant",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 4, completed: 5 },
    content: [{ type: "text", text: "```typescript\nconst x = 1\n```\n\nWe use typescript, **foo**bar." }],
  },
  {
    id: "message-01b",
    type: "compaction",
    status: "completed",
    reason: "manual",
    summary: "The haystack was summarized.",
    time: { created: 6 },
  },
  ...filler,
  { id: "message-99", type: "user", text: "Last needle here", time: { created: 99 } },
]

export default defineApp({
  width: 100,
  height: 30,
  args: { sessionID },
  config: { tabs: { mode: "off" }, experimental: { "session-find": true } },
  routes: [
    { path: `/api/session/${sessionID}`, json: { data: session(sessionID, "Find fixture", { updated: 2 }) } },
    { path: `/api/session/${sessionID}/message`, json: { data: messages.toReversed(), cursor: {} } },
    { path: `/api/session/${sessionID}/inbox`, json: { data: [] } },
    { method: "POST", path: "/api/session/:sessionID/view" },
  ],
  steps: [
    { checkpoint: "open", until: "Last needle here" },
    { keys: ["ctrl+x", "f"] },
    { checkpoint: "bar", until: "Find in session..." },
    { type: "needle" },
    { checkpoint: "first", until: "Find · 1 of 5" },
    { keys: ["enter"] },
    { checkpoint: "prose", until: "Find · 2 of 5" },
    { keys: ["enter"] },
    { checkpoint: "code", until: "Find · 3 of 5" },
    { keys: ["enter"] },
    { checkpoint: "table", until: "Find · 4 of 5" },
    { keys: ["up", "up", "up", "up"] },
    { checkpoint: "wrap", until: "Find · 5 of 5" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Last needle here" },
    { keys: ["ctrl+x", "f"] },
    { wait: 50 },
    { type: "typescript" },
    { checkpoint: "fence", until: "Find · 1 of 1" },
    {
      event: {
        id: "evt_find_stream",
        created: 100,
        type: "session.text.delta",
        data: { sessionID, assistantMessageID: "message-01a", ordinal: 0, delta: "\n\n```sh\necho typescript\n```" },
      },
    },
    { checkpoint: "streamed", until: "Find · 1 of 2" },
    { keys: ["escape"] },
    { wait: 50 },
    { keys: ["ctrl+x", "f"] },
    { wait: 50 },
    { type: "foobar" },
    { checkpoint: "concealed", until: "Find · 1 of 1" },
    { keys: ["escape"] },
    { wait: 50 },
    { keys: ["ctrl+x", "f"] },
    { wait: 50 },
    { type: "haystack" },
    { checkpoint: "compaction", until: "Find · 1 of 1" },
  ],
})
