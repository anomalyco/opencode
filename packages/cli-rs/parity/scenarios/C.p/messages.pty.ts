// intro, every log level, notes (one with a title longer than its body), outro, and cancel.
import { definePty } from "../../pty/run"
import { demo } from "./demo"

export default definePty({
  args: [],
  command: demo("messages"),
  cols: 60,
  rows: 40,
  steps: [{ until: { screen: "Cancelled" }, settle: 250, checkpoint: "messages" }],
  exits: true,
})
