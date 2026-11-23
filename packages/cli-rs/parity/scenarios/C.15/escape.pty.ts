// `--wizard` at the root: the subcommand list pages ten at a time and wraps around; Escape cancels.
import { definePty } from "../../pty/run"
import { down, escape, first, press } from "../C.5/keys"

export default definePty({
  args: ["--wizard"],
  steps: [
    first("Command", "root"),
    press("k", "wrapped", "serve"),
    press("j", "back"),
    press(down.repeat(6), "middle"),
    press(escape, "cancelled", "Wizard cancelled."),
  ],
  exits: true,
})
