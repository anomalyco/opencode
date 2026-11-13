// OT2079 (parity/deviations/OT2079-strikethrough.md): mini replays an answer and its reasoning that both contain
// `~~gone~~`. Both clients hide the tildes; Rust strikes the text through, TS draws it plain.
import { definePty } from "../../pty/run"
import { assistant, config, server, statusMask, user } from "../M.1/fixture"

const messages = [
  user("msg_u1", "strike it", 10),
  assistant(
    "msg_a1",
    [
      { type: "reasoning", text: "Thinking a ~~gone~~ thought." },
      { type: "text", text: "Answer a ~~gone~~ b." },
    ],
    11,
  ),
]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 16,
  server: server({ messages }),
  setup: (root) => config(root),
  steps: [
    {
      until: { screen: "Answer a" },
      settle: 800,
      timeout: 30_000,
      checkpoint: "replayed",
      attributes: true,
      deviation: { file: "OT2079-strikethrough", lines: 2 },
    },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
