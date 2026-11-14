// `session list --wizard` with `--max-count 0`: the value fails the flag's schema after its prompt, and the
// wizard fails with exit 1 before anything runs. TS prints the error with a JavaScript stack trace, Rust
// prints `Error: Invalid value for flag --max-count: "0". ...` (deviation C40-handler-errors), so the screen
// after the error is not compared.
import { definePty } from "../../pty/run"
import { list, location, sessions } from "../C.2/fixture"
import { enter, first, press } from "../C.5/keys"

export default definePty({
  args: ["session", "list", "--wizard"],
  server: { routes: [location, list(sessions)] },
  steps: [
    first("(--max-count)?", "max-count"),
    press("y", "max-count-empty", "(--max-count) ›"),
    press("0", "max-count-typed"),
    { keys: enter, until: { screen: 'Invalid value for flag --max-count: "0"' }, settle: 300 },
  ],
  exits: true,
  requests: true,
})
