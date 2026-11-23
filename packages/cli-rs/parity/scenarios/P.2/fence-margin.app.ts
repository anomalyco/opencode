// The rows around the built-in LaTeX and Mermaid fences in the transcript: a paragraph then a formula, a formula then
// a paragraph, two formulas in a row, a list then a diagram, and a diagram that ends the text. TS's renderers set one
// row of top margin on top of Core 0.9.4's row between blocks, so TS has two blank rows above each fence that follows
// a block and Rust one (`parity/deviations/F16-plugin-fence-margin.md`). A fence that opens a message differs (`parity/deviations/F13-latex-leading-row.md`), so none does here.
import { assistant, defineApp, session, user } from "../../lib/app"

const text = [
  "The area is:",
  "```latex\nx^2\n```",
  "and the root:",
  "```latex\n\\sqrt{x}\n```",
  "```latex\na+b\n```",
  "- parse\n- render",
  "```mermaid\nflowchart LR\n  A --> B\n```",
].join("\n\n")

export default defineApp({
  height: 40,
  args: { sessionID: "ses_m" },
  routes: [
    { path: "/api/session/ses_m", json: { data: session("ses_m", "Draw the math", { updated: 2 }) } },
    {
      path: "/api/session/ses_m/message",
      json: { data: [assistant("msg_2", text, 2000), user("msg_1", "Show the formulas", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_m/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "render",
      // opentui-tex's radical: `√ x` where TS draws `╰╯x`. TS's second blank row above each of the five fences.
      deviation: [
        { file: "P2-latex-opentui-tex", cells: 2 },
        { file: "F16-plugin-fence-margin", cells: 175 },
      ],
    },
  ],
})
