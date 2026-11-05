// Two permissions wait when mini opens the session. The shell call's footer moves to "Always allow" and back,
// then allows once; the next request, which saves nothing, is rejected with a message. Each reply answers 204
// and the server's `permission.replied` takes the request away.
import { definePty } from "../../pty/run"
import { config, fetchPermission, leave, opened, server, shellPermission } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 24,
  server: server({ permissions: [shellPermission, fetchPermission] }),
  setup: (root) => config(root),
  steps: [
    { ...opened, until: { screen: "Permission required" }, checkpoint: "asked" },
    { keys: "\x1b[C", settle: 300, checkpoint: "moved" },
    { keys: "\r", settle: 300, checkpoint: "always" },
    { keys: "\x1b", settle: 300 },
    { keys: "\x1b[D", settle: 300 },
    { keys: "\r", until: { screen: "WebFetch" }, settle: 400, checkpoint: "next" },
    { keys: "\x1b", settle: 300, checkpoint: "reject" },
    { keys: "use the cache", settle: 300 },
    { keys: "\r", until: { screen: "ctrl+p menu" }, settle: 600, checkpoint: "replied" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
