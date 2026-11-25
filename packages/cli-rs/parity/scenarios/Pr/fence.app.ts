// A fence drawn by a plugin (Pr): the test plugin draws the `parity` fence of an answer in the transcript. TS loads
// it from parity/plugins/fence as a local plugin, a Markdown code-block renderer; Rust registers its twin, a renderer
// claim of the fence, when OPENCODE_PARITY_PLUGIN is `fence`. The fence opens the answer: after a paragraph, Rust's
// Markdown puts a blank row before any plugin's fence and TS puts none, for a 1.x fence renderer as for a claim.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_a"
// TS shows "Finishing startup…" for three seconds once loading the local TSX plugin took over half a second
// (`component/startup-loading.tsx`); Rust loads no TS plugin (F16).
const startup = { x: 39, y: 28, width: 22, height: 1, reason: "TS plugin loading notice (F16)" }
const answer = "```parity\nalpha\nbeta\n```\n\nDone."

export default defineApp({
  config: { plugins: ["./plugins/fence"] },
  env: { OPENCODE_PARITY_PLUGIN: "fence" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Fence plugin", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Fence plugin", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", answer, 2000), user("msg_1", "Show the fence", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [{ checkpoint: "session", until: "fence plugin: beta", masks: [startup] }],
})
