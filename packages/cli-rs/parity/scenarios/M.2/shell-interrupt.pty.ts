// A `!` shell turn holds no server drain, so Esc twice aborts its `session.shell` request instead of sending
// `session.interrupt`, and the composer is idle at once.
import { definePty } from "../../pty/run"
import { leave, opened, server } from "./fixture"

const base = server()

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: {
    ...base,
    routes: [
      { method: "POST", path: "/api/session/ses_mini/shell", status: 204, delay: 4000 },
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
    { keys: "!sleep 5", settle: 300 },
    { keys: "\r", settle: 500, checkpoint: "running" },
    { keys: "\x1b", settle: 200 },
    { keys: "\x1b", settle: 600, checkpoint: "interrupted" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
