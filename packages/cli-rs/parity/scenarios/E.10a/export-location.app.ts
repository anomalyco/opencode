// The export options' Location row (DLG31, #62490): under Format, `project` by default; Down selects it and Space
// switches it to `temp`, which stays when Right turns the format to JSON. Escape closes without saving: the saved
// path depends on the machine's temporary directory and wraps in the result dialog, so
// crates/tui/tests/all/actions.rs checks where the file goes.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_x"

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
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "session", until: "Fixed it." },
    { keys: ["ctrl+x", "x"] },
    { checkpoint: "options", until: "Export session" },
    { keys: ["down"] },
    { checkpoint: "location", until: "‹ project ›" },
    { keys: ["space"] },
    { checkpoint: "temp", until: "‹ temp ›" },
    { keys: ["up", "right"] },
    { checkpoint: "json", until: "Sanitize" },
    { keys: ["escape"] },
    { checkpoint: "closed" },
  ],
})
