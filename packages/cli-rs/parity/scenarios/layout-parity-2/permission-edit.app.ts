// An edit permission (V11, E.9a) whose diff has a line that wraps: the diff's scroll box is as tall as the wrapped
// rows inline, and fills the prompt in full screen.
import { defineApp, session, user } from "../../lib/app"

const id = "ses_edit"
// Plain text, so neither client highlights it (TS downloads grammars at runtime, H06). The added line wraps.
const long = "The parser keeps every value, trims the spaces around it, and skips the empty values and the lines that start with #."
const diff = [
  "--- a/notes.txt",
  "+++ b/notes.txt",
  "@@ -1,3 +1,3 @@",
  " Parser notes",
  "-The parser keeps every value.",
  `+${long}`,
  " See the tests.",
].join("\n")

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true } },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Fix the parser", { updated: 2 }) } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [user("msg_1", "Fix the parser", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    {
      path: `/api/session/${id}/permission`,
      json: {
        data: [
          {
            id: "per_1",
            sessionID: id,
            action: "edit",
            resources: ["notes.txt"],
            save: [],
            metadata: { diff },
          },
        ],
      },
    },
  ],
  steps: [
    {
      checkpoint: "inline",
      until: "Permission required",
      masks: [{ x: 3, y: 28, width: 95, height: 1, reason: "TS startup status, gone or not by the time the frame settles" }],
    },
    { keys: ["ctrl+f"] },
    { checkpoint: "fullscreen", until: "ctrl+f minimize" },
  ],
})
