// Esc twice while a turn runs interrupts it with `session.interrupt`, `resume` as a query value, so steered input
// parked behind the turn resumes; the server's 200 is the ack.
import { definePty } from "../../pty/run"
import { event, leave, opened, server } from "./fixture"

const base = server({
  wait: 6000,
  events: (id) => [event("session.inbox.delivered", { inboxID: id }), event("session.execution.started", {})],
})

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: {
    ...base,
    routes: [
      { method: "POST", path: "/api/session/ses_mini/interrupt", json: { interrupted: true } },
      ...(base.routes ?? []),
    ],
  },
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ animations: false, mini: { splash: "hide" } }),
    )
  },
  steps: [
    opened,
    { keys: "first", settle: 200 },
    { keys: "\r", settle: 600 },
    { keys: "\x1b", settle: 200 },
    { keys: "\x1b", settle: 600 },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
