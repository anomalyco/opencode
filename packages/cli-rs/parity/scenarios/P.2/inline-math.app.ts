// Markdown math in an assistant message: inline `$…$` and `\(…\)`, display `$$…$$` and `\[…\]`, a `latex` fence,
// and dollars that are not math. TS draws only the fence as math and the rest as text; Rust draws the math too
// (`parity/deviations/P2-latex-inline.md`). The fence and the dollars that are not math are equal.
import { assistant, defineApp, session, user } from "../../lib/app"

const text = [
  "Energy is $E=mc^2$ and \\(\\alpha \\le \\frac{1}{2}\\) holds.",
  "$$\n\\frac{a+b}{2}\n$$",
  "\\[\nx_i^2\n\\]",
  "```latex\n\\sqrt{x}\n```",
  "It costs $5 and $10; run echo $HOME.",
].join("\n\n")

export default defineApp({
  args: { sessionID: "ses_im" },
  routes: [
    { path: "/api/session/ses_im", json: { data: session("ses_im", "Mixed math", { updated: 2 }) } },
    {
      path: "/api/session/ses_im/message",
      json: { data: [assistant("msg_2", text, 2000), user("msg_1", "Show the math", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_im/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "open",
      until: "run echo $HOME.",
      deviation: [{ file: "P2-latex-inline", cells: 191 }],
    },
  ],
})
