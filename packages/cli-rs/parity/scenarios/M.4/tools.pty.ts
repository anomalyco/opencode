// `mini.tools: show` with shell output: the replayed history draws its tool calls (read, glob, todos, a failed
// command), and a live turn streams a shell call's output and an edit's diff.
import { definePty } from "../../pty/run"
import { config, leave, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 30,
  server: server(),
  setup: (root) => config(root, { tools: "show", shell_output: "show" }),
  // The idle status row starts with the agent. The busy one starts with a static `▪`, and the turn ends after
  // the session wait answers, so the screen can rest on a busy row longer than a settle under load: wait for the
  // turn summary and the idle row.
  steps: [
    {
      until: { screen: /Looked around\.[\s\S]*^build · model · demo/m },
      settle: 800,
      timeout: 30_000,
      checkpoint: "history",
      scrollback: 10,
    },
    { keys: "bump a", settle: 300 },
    {
      keys: "\r",
      until: { screen: /Bumped a\.\s*build · model · \d[\s\S]*^build · model · demo/m },
      settle: 1_000,
      checkpoint: "turn",
      scrollback: 20,
    },
    ...leave,
  ],
  exits: true,
  masks: [
    {
      pattern: /^(ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
      reason: "the status row is not under test",
    },
  ],
})
