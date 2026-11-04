// Ctrl+C in a text prompt of `session import --wizard`: "Wizard cancelled.", exit 0, nothing imported.
import { definePty } from "../../pty/run"
import { enter, first, press } from "../C.5/keys"

export default definePty({
  args: ["session", "import", "--wizard"],
  server: { routes: [] },
  steps: [
    first("(--directory)?", "directory"),
    press(enter, "file", "File ›"),
    press("notes.json", "file-typed"),
    press("\x03", "cancelled", "Wizard cancelled."),
  ],
  exits: true,
  requests: true,
})
