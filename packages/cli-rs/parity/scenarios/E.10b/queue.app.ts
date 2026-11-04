// Queued prompts and pending prompt actions (V14, DLG38, DLG40, DLG41): the dock above the prompt with two queued
// prompts, `<leader>q` and its dialog, Enter steering the second prompt, a click on a pending steer and "Move to
// queue", and a click on a delivered prompt opening the message actions. The inbox writes answer 204 and no event
// follows, so the inbox stays as it was.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_q"
const pending = (inbox: string, text: string, delivery: "queue" | "steer", created: number) => ({
  id: inbox,
  sessionID: id,
  type: "user",
  payload: { text },
  delivery,
  time: { created },
})

// The prompt footer hints are E.14's (P01-read-only-prompt).
const masks = [
  { x: 50, y: 28, width: 50, height: 1, reason: "the prompt footer hints are E.14's (P01-read-only-prompt)" },
]

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Fix the parser", { updated: 2 }) } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Fixed it.", 2000), user("msg_1", "Read the parser", 1000)], cursor: {} },
    },
    {
      path: `/api/session/${id}/inbox`,
      json: {
        data: [
          pending("msg_5", "Steer this", "steer", 3000),
          pending("msg_6", "First queued\nquestion", "queue", 3100),
          pending("msg_7", "Second queued", "queue", 3200),
        ],
      },
    },
    { method: "PATCH", path: `/api/session/${id}/inbox/:inbox`, status: 204 },
  ],
  steps: [
    { checkpoint: "dock", until: "2 queued", masks },
    { keys: ["ctrl+x", "q"] },
    { checkpoint: "queued", until: "Search queued prompts", masks },
    { keys: ["down"] },
    { checkpoint: "second", until: "2 of 2", masks },
    { keys: ["enter"] },
    { checkpoint: "steered", masks },
    { click: [5, 20] },
    { checkpoint: "dock-click", until: "Search queued prompts", masks },
    { keys: ["escape"] },
    { checkpoint: "dock-closed", masks },
    { click: [5, 11] },
    { checkpoint: "pending-steer", until: "Pending steer", masks },
    { keys: ["enter"] },
    { checkpoint: "moved", masks },
    { click: [5, 3] },
    { checkpoint: "message", until: "Message Actions", masks },
    { keys: ["escape"] },
    { checkpoint: "closed", masks },
  ],
})
