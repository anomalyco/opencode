// A subagent always runs in the background (#63382): its job holds the run open, and its report wakes the
// parent. The turn the report triggers streams, and its failure decides the exit code, even though the first
// turn succeeded (`noninteractive.test.ts`, "waits for a subagent's report and the parent turn it triggers").
import { defineCli } from "../../cli/run"
import { event, nowMask, server, textStep } from "./fixture"
import { jobs } from "./background.cli"

const child = {
  kind: "subagent",
  id: "ses_child",
  sessionID: "ses_run",
  status: "running",
  childSessionID: "ses_child",
  agent: "explore",
  description: "scan repo",
  time: { started: 3 },
}

export default defineCli({
  args: ["run", "--format", "json", "hello"],
  server: server({
    events: () => textStep("Started the subagent."),
    // The wait reads the child's inbox too.
    routes: [jobs((count) => (count === 1 ? [child] : [])), { path: "/api/session/ses_child/inbox", json: { data: [] } }],
    late: [
      event("session.text.started", { assistantMessageID: "msg_b", ordinal: 0 }, 30),
      event("session.text.ended", { assistantMessageID: "msg_b", ordinal: 0, text: "Report handled." }, 31),
      event("session.execution.failed", { error: { type: "unknown", message: "report turn failed" } }, 32),
    ],
  }),
  masks: [nowMask],
})
