// A plugin's fences with no margin of their own (parity/plugins/fence-margin): after a paragraph, after another fence
// and after a list, TS draws them on the next row, with no blank row between; a paragraph after one gets its blank
// row. The Rust TUI puts one blank row before each, as between any two blocks
// (`parity/deviations/F16-plugin-fence-margin.md`): four rows, and what is below them moves down.
import { assistant, defineApp, session, user } from "../../lib/app"

const text = [
  "Before the fence.",
  "```parity\none\n```",
  "After it.",
  "```parity\ntwo\n```",
  "```parity\nthree\n```",
  "- a list",
  "```parity\nfour\n```",
].join("\n\n")

export default defineApp({
  height: 32,
  config: { plugins: ["./plugins/fence-margin"] },
  env: { OPENCODE_PARITY_PLUGIN: "fence-margin" },
  args: { sessionID: "ses_f" },
  routes: [
    { path: "/api/session/ses_f", json: { data: session("ses_f", "Show the fences", { updated: 2 }) } },
    {
      path: "/api/session/ses_f/message",
      json: { data: [assistant("msg_2", text, 2000), user("msg_1", "Draw the fences", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_f/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "fence: four",
      // Without the four rows, rows 0 to 17 are equal cell for cell.
      deviation: [{ file: "F16-plugin-fence-margin", cells: 138 }],
    },
  ],
})
