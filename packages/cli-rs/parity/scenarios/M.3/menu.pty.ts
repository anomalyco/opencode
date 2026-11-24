// `command.palette.show` (Ctrl+P) opens the command menu. A search narrows it to "Switch agent", which opens the
// agent panel; picking plan switches the agent the next prompt uses. "Show status" puts the footer's status in
// the status row, and Escape closes a panel.
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
    { keys: "\x10", until: { screen: "Commands" }, settle: 400, checkpoint: "menu" },
    { keys: "\x1b[B", settle: 200 },
    { keys: "\x1b[B", settle: 300, checkpoint: "moved" },
    { keys: "switch agent", settle: 400, checkpoint: "search" },
    { keys: "\r", until: { screen: "Select agent" }, settle: 400, checkpoint: "agents" },
    { keys: "\x1b[B", settle: 200 },
    { keys: "\r", until: { screen: "ctrl+p menu" }, settle: 400, checkpoint: "switched" },
    // The next prompt goes out with the new agent.
    { keys: "hello", settle: 200 },
    { keys: "\r", settle: 800 },
    { keys: "\x10", until: { screen: "Commands" }, settle: 300 },
    { keys: "status", settle: 300 },
    { keys: "\r", until: { screen: "idle" }, settle: 400, checkpoint: "status" },
    { keys: "\x10", until: { screen: "Commands" }, settle: 300 },
    { keys: "\x1b", until: { screen: "ctrl+p menu" }, settle: 400, checkpoint: "closed" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
