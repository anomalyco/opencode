// A listed prompt with a pasted image prints its caption under the prompt; the same image named twice prints once.
// `session.image_preview` is off, so no picture draws.
import { definePty } from "../../pty/run"
import { config, leave } from "./fixture"
import { assistant, server, user } from "../M.2/fixture"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const image = (text: string) => ({
  data: png,
  mime: "image/png",
  source: { type: "inline" },
  mention: { start: 8, end: 8 + text.length, text },
})

const history = [
  { ...user("msg_u1", "look at [Image 1] and [Image 1]", 10), files: [image("[Image 1]"), image("[Image 1]")] },
  assistant("msg_a1", [{ type: "text", text: "A single pixel." }], 11),
]

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 16,
  server: server({ messages: history }),
  setup: (root) => config(root),
  steps: [{ until: { screen: "A single pixel." }, settle: 800, timeout: 30_000, checkpoint: "caption" }, ...leave],
  exits: true,
  masks: [
    {
      pattern: /^(ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
      reason: "the status row is not under test",
    },
  ],
})
