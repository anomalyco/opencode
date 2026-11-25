// A formula that opens the text: TS keeps its renderer's row of top margin above it, the Rust Markdown puts no row
// before the first block (`parity/deviations/F13-latex-leading-row.md`).
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_l" },
  routes: [
    { path: "/api/session/ses_l", json: { data: session("ses_l", "Draw the math", { updated: 2 }) } },
    {
      path: "/api/session/ses_l/message",
      json: {
        data: [assistant("msg_2", "```latex\nx^2\n```\n\nThat is the area.", 2000), user("msg_1", "Area?", 1000)],
        cursor: {},
      },
    },
    { path: "/api/session/ses_l/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "That is the area.",
      // Without TS's row above the formula, rows 0 to 10 are equal cell for cell.
      deviation: [{ file: "F13-latex-leading-row", cells: 96 }],
    },
  ],
})
