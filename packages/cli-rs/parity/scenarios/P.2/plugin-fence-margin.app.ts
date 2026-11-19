// A plugin's fences with no margin of their own (parity/plugins/fence-margin): after a paragraph, after another fence
// and after a list. Both clients put one blank row before each, as between any two blocks (Core 0.9.4's Markdown gap;
// `parity/deviations/F16-plugin-fence-margin.md` has the history).
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
    { checkpoint: "open", until: "fence: four" },
  ],
})
