// Two forms wait when mini opens the session. The first takes Yes, then the second option, and its review submits
// the answers; Escape dismisses the second. Both answer 204, and the server's `form.replied` and `form.cancelled`
// take the forms away.
import { definePty } from "../../pty/run"
import { config, deployForm, leave, nameForm, opened, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 24,
  server: server({ forms: [deployForm, nameForm] }),
  setup: (root) => config(root),
  steps: [
    { ...opened, until: { screen: "Deploy the build" }, checkpoint: "asked" },
    { keys: "\x1b[B", settle: 300, checkpoint: "moved" },
    { keys: "\x1b[A", settle: 200 },
    { keys: "\r", settle: 300, checkpoint: "second" },
    { keys: "\x1b[B", settle: 200 },
    { keys: "\r", settle: 300, checkpoint: "review" },
    { keys: "\r", until: { screen: "Name the release" }, settle: 400, checkpoint: "next" },
    { keys: "v1", settle: 300, checkpoint: "typed" },
    { keys: "\x1b", until: { screen: "ctrl+p menu" }, settle: 600, checkpoint: "dismissed" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
