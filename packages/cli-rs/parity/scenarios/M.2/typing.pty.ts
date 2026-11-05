// Typing grows the footer one row per line (Shift+Enter), up to six; Enter sends the prompt with `steer` and the
// footer shrinks back.
import { definePty } from "../../pty/run"
import { answer, assistant, config, leave, opened, server, statusMask, user } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server({
    events: (id) => answer(id, "Three lines read."),
    after: (id) => [user(id, "one\ntwo\nthree", 100), assistant("msg_a4", [{ type: "text", text: "Three lines read." }], 101)],
  }),
  setup: (root) => config(root),
  steps: [
    { ...opened, checkpoint: "open" },
    { keys: "one\x1b[13;2utwo\x1b[13;2uthree", settle: 400, checkpoint: "grown" },
    { keys: "\x1b[13;2u4\x1b[13;2u5\x1b[13;2u6\x1b[13;2u7", settle: 400, checkpoint: "capped" },
    { keys: "\x03", settle: 300 },
    { keys: "one\x1b[13;2utwo\x1b[13;2uthree", settle: 300 },
    { keys: "\r", until: { screen: "Three lines read." }, settle: 800, checkpoint: "sent", scrollback: 8 },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
