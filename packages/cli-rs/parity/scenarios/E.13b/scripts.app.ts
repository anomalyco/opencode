// Running work (#64956, #64790): the prompt footer counts the session's background Code Mode scripts and the
// subagents that own running jobs ("2 scripts · 1 subagent"), and Down opens the picker on its first busy tab,
// Scripts. A script is named by the first line of its `execute` code, else its title. Down moves, Ctrl+D cancels a
// script, and a cancelled job leaves the tab. Left twice reaches Subagents, where an idle subagent with a running job
// is active, and Ctrl+D cancels its job.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }

const sessions = [
  session("ses_p", "Plan the release", { updated: 10 }),
  { ...session("ses_c", "Scan the logs (@explore subagent)", { updated: 9 }), parentID: "ses_p" },
]

// 2100-01-01: an elapsed time measured from the real clock would change the label's width over the hours.
const STARTED = 4_102_444_800_000

const script = (id: string, sessionID: string, title?: string) => ({
  kind: "codemode",
  id,
  sessionID,
  status: "running",
  ...(title ? { title } : {}),
  // In the future, so both clients clamp the elapsed time to "0s" whatever the clock says.
  time: { started: STARTED },
})

const jobs = [script("cm_1", "ses_p"), script("cm_2", "ses_p", "Watch the logs"), script("cm_3", "ses_c")]

const run = {
  type: "tool",
  id: "prt_execute",
  name: "execute",
  state: {
    status: "completed",
    input: { code: "\n  // Build both packages\nawait Promise.all([build('a'), build('b')])" },
    content: [{ type: "text", text: "Moved to the background as cm_1." }],
    metadata: { jobID: "cm_1" },
  },
  time: { created: 1500, completed: 1600 },
}


export default defineApp({
  height: 30,
  args: { sessionID: "ses_p" },
  routes: [
    { path: "/api/session/ses_p", json: { data: sessions[0] } },
    { path: "/api/session", json: { data: sessions, cursor: {} } },
    {
      path: "/api/session/ses_p/message",
      json: { data: [assistant("msg_2", [run], 2000), user("msg_1", "Build it", 1000)], cursor: {} },
    },
    { path: "/api/session/ses_p/inbox", json: { data: [] } },
    { path: "/api/experimental/job", json: { data: jobs } },
    { method: "POST", path: "/api/experimental/job/:id/cancel", status: 204 },
  ],
  steps: [
    { checkpoint: "session", until: "2 scripts · 1 subagent" },
    { keys: ["down"] },
    { checkpoint: "scripts", until: "Watch the logs" },
    { keys: ["down"] },
    { checkpoint: "moved" },
    { keys: ["ctrl+d"] },
    {
      event: {
        id: "evt_cancelled",
        created: 3,
        type: "experimental.job.updated",
        location: here,
        data: { info: { ...jobs[1], status: "cancelled", time: { started: STARTED, completed: STARTED + 2000 } } },
      },
    },
    { checkpoint: "cancelled", until: "Build both packages" },
    { keys: ["left", "left"] },
    { checkpoint: "subagents", until: "interrupt" },
    { keys: ["ctrl+d"] },
    { checkpoint: "interrupted" },
  ],
})
