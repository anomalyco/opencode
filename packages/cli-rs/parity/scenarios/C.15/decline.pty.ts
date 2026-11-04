// `mcp add --wizard`: optional flags left out, a repeatable key=value flag (a count below its minimum is an
// error), a boolean, the arguments, and No at the confirmation, so nothing is written.
import { definePty } from "../../pty/run"
import { enter, first, press, right } from "../C.5/keys"

export default definePty({
  args: ["mcp", "add", "--wizard"],
  steps: [
    first("(--url)?", "url"),
    press(enter, "header", "(--header)?"),
    press("n", "env", "(--env)?"),
    press("y", "env-count", "count"),
    press("j", "env-count-down"),
    press(enter, "env-count-error", "must be greater than or equal to 1"),
    press("kk", "env-count-up"),
    press(enter, "env-first", "(--env) ›"),
    press("A=1" + enter, "env-second"),
    press("B=two words" + enter, "global", "(--global)?"),
    press("y", "global-value", "(t/F)"),
    press("t", "name", "Name ›"),
    press("docs" + enter, "command-count", "Command count"),
    press(enter, "ready", "Run this command?"),
    press(right, "no"),
    press(enter, "declined"),
  ],
  exits: true,
})
