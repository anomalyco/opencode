// Typing, line editing (Backspace, Left, Ctrl+A, Ctrl+K), and submit, between intro and outro.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("text"),
  cols: 60,
  rows: 16,
  steps: [
    { until: { screen: "Ada Lovelace" }, settle: 250, checkpoint: "placeholder" },
    press("Grace", "typed"),
    press("\x7f\x7fx", "backspace"),
    press("\x1b[D\x1b[Dz", "cursor in the middle"),
    press("\x01\x0bHopper", "ctrl-a ctrl-k"),
    press("\r", "submitted", "Done"),
  ],
  exits: true,
})
