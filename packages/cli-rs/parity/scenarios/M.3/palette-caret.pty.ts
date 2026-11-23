// Closing the command palette keeps the draft's caret where it was: a key typed after Escape lands mid-draft,
// not at the end.
import { definePty } from "../../pty/run"
import { config, leave, opened, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 30,
  server: server(),
  setup: (root) => config(root),
  steps: [
    { ...opened, until: { screen: "ctrl+p menu" } },
    { keys: "hello world", until: { screen: "hello world" }, settle: 200 },
    { keys: "\x1b[D\x1b[D\x1b[D\x1b[D\x1b[D", settle: 200 },
    { keys: "\x10", until: { screen: "Commands" }, settle: 400 },
    { keys: "\x1b", until: { screen: "ctrl+p menu" }, settle: 400 },
    { keys: "X", until: { screen: "hello Xworld" }, settle: 300, checkpoint: "typed" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
