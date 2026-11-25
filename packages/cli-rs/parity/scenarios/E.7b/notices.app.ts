// The completion notices of background work: a shell, a subagent, and Code Mode scripts (#64741) drawn like
// background shells, "↳ Script finished · <job id>", with "failed" and "cancelled" in their feedback colors.
import { defineApp, session } from "../../lib/app"

const notice = (id: string, created: number, description: string, metadata: Record<string, unknown>) => ({
  id,
  type: "synthetic",
  text: "",
  description,
  metadata,
  time: { created },
})

const messages = [
  { id: "msg_1", type: "user", text: "Run the checks in the background", time: { created: 1000 } },
  notice("msg_2", 1100, "bun   test\n--watch", { source: "shell", state: "completed" }),
  notice("msg_3", 1200, "Survey the views", {
    source: "subagent",
    state: "completed",
    agent: "explore",
    childID: "ses_child",
  }),
  notice("msg_4", 1300, "Script", { source: "codemode", jobID: "job_done", state: "completed" }),
  notice("msg_5", 1400, "Script", { source: "codemode", jobID: "job_failed", state: "error" }),
  notice("msg_6", 1500, "Script", { source: "codemode", jobID: "job_stopped", state: "cancelled" }),
]

export default defineApp({
  args: { sessionID: "ses_notices" },
  routes: [
    { path: "/api/session/ses_notices", json: { data: session("ses_notices", "Background work", { updated: 2 }) } },
    { path: "/api/session/ses_notices/message", json: { data: messages.toReversed(), cursor: {} } },
    { path: "/api/session/ses_notices/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "open", until: "job_stopped" }],
})
