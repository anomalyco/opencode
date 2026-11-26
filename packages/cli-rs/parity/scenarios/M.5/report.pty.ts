// Subagents always run in the background (#63382), and each time a child goes idle its report wakes the parent
// (#63209). With `mini.tools: show`, a prompt's turn launches a subagent: the launch completes while the child
// still runs, so the scrollback shows the subagent card, not the launch instructions (#63389). Then the child goes
// idle, its report is delivered to the parent, and the parent turn the report starts streams with no prompt from
// the user.
import { definePty } from "../../pty/run"
import { history } from "../M.1/fixture"
import { answer } from "../M.2/fixture"
import { config, event, leave, server } from "./fixture"

const launch = (id: string) => {
  const call = (type: string, data: Record<string, unknown>) =>
    event(type, { assistantMessageID: "msg_a5", id: "call_run", ...data }, 101)
  return [
    event("session.inbox.delivered", { inboxID: id }),
    event("session.execution.started", {}),
    event("session.step.started", {
      assistantMessageID: "msg_a5",
      agent: "build",
      model: { id: "model", providerID: "demo" },
      started: 101,
    }),
    call("session.tool.input.started", { name: "subagent" }),
    call("session.tool.called", { input: { agent: "explore", description: "Find the tests" }, executed: true }),
    call("session.tool.success", {
      content: [
        {
          type: "text",
          text: "The subagent is working in the background (sessionID: ses_run). You will receive a <subagent> message when it goes idle, and again after each later round of work.",
        },
      ],
      metadata: { sessionID: "ses_run", status: "running" },
      executed: true,
    }),
    event("session.text.delta", { assistantMessageID: "msg_a5", ordinal: 0, delta: "Launched a subagent." }),
    event("session.text.ended", { assistantMessageID: "msg_a5", ordinal: 0, text: "Launched a subagent." }),
    event("session.execution.succeeded", {}),
  ]
}

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 30,
  server: server({
    messages: history,
    events: (id) => [
      ...launch(id),
      event("session.execution.succeeded", { sessionID: "ses_run" }, 110),
      ...answer("msg_report", "The tests pass; the report is in.", "msg_a6"),
    ],
  }),
  setup: (root) => config(root, { tools: "show" }),
  steps: [
    { until: { screen: "Third answer" }, settle: 800, timeout: 30_000 },
    { keys: "check the tests", settle: 300 },
    { keys: "\r", until: { screen: "the report is in" }, settle: 800, checkpoint: "reaction", scrollback: 20 },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
