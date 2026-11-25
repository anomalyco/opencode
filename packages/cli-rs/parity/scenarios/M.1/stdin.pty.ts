// `printf 'piped text' | mini -s ses_mini --prompt 'from flag'`: the pipe and the flag become the first prompt, and
// keys still come from the terminal (Ctrl+C twice leaves).
import { definePty } from "../../pty/run"
import { command, withServer } from "../../cli/client"
import { config, event, server, statusMask, user, assistant } from "./fixture"

const state = { server: "" }
const args = ["mini", "-s", "ses_mini", "--prompt", "from flag"]

export default definePty({
  args,
  command: (side) => {
    const argv = command(side, withServer(args, state.server)).map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
    return ["sh", "-c", `printf 'piped text' | ${argv.join(" ")}`]
  },
  cols: 60,
  rows: 20,
  server: server({
    events: (id) => [
      event("session.inbox.delivered", { inboxID: id }),
      event("session.execution.started", {}),
      event("session.step.started", {
        assistantMessageID: "msg_a4",
        agent: "build",
        model: { id: "model", providerID: "demo" },
        snapshot: "snap_1",
        started: 101,
      }),
      event("session.text.delta", { assistantMessageID: "msg_a4", ordinal: 0, delta: "Got the " }),
      event("session.text.delta", { assistantMessageID: "msg_a4", ordinal: 0, delta: "pipe." }),
      event("session.text.ended", { assistantMessageID: "msg_a4", ordinal: 0, text: "Got the pipe." }),
      event("session.execution.succeeded", {}),
    ],
    after: (id) => [
      user(id, "piped text\nfrom flag", 100),
      assistant("msg_a4", [{ type: "text", text: "Got the pipe." }], 101),
    ],
  }),
  setup: async (root, url) => {
    state.server = url ?? ""
    await config(root)
  },
  steps: [
    { until: { screen: "Got the pipe." }, settle: 800, timeout: 30_000, checkpoint: "answered", scrollback: 6 },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
