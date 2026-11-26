// An operation the document does not have. TS hides the message in the cause of an `UnknownError` and a
// stack trace; Rust prints it (C40-handler-errors). Only the exit and the requests are compared.
import { defineCli } from "../../cli/run"
import { openapi } from "./fixture"

export default defineCli({
  args: ["api", "session.nope"],
  server: { routes: [openapi] },
  stderrLines: 0,
})
