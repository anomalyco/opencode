// Two child sessions from the history's subagent calls: the status row counts the running one; subagents always
// run in the background, so it offers no `session.background` key. The command menu lists them; Down on the empty
// prompt opens the subagent panel with the running child, Tab shows the finished one, and Enter inspects its
// transcript. Escape goes back, and the running child's inspector's Ctrl+D interrupts it.
import { definePty } from "../../pty/run"
import { config, leave, opened, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 30,
  server: server(),
  setup: (root) => config(root),
  steps: [
    { ...opened, checkpoint: "hints" },
    { keys: "\x10", until: { screen: "View subagents" }, settle: 400, checkpoint: "menu" },
    { keys: "\x1b", settle: 300 },
    { keys: "\x1b[B", until: { screen: "Select subagent" }, settle: 400, checkpoint: "panel" },
    { keys: "\t", settle: 300, checkpoint: "inactive" },
    { keys: "\r", until: { screen: "The docs cover" }, settle: 500, checkpoint: "inspector" },
    { keys: "\x1b", until: { screen: "1 sub" }, settle: 400 },
    { keys: "\x1b[B", until: { screen: "Select subagent" }, settle: 300 },
    // The running child's spinner turns, so the screen never settles.
    { keys: "\r", until: { screen: "ctrl+d interrupt" } },
    { keys: "\x04", until: { screen: "ctrl+d interrupt" } },
    { keys: "\x1b", until: { screen: "1 sub" }, settle: 400, checkpoint: "back" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
