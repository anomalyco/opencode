// `api session.get` without `sessionID`: no request beyond the document. The message differs on purpose
// (C40-handler-errors); only the exit and the requests are compared.
import { defineCli } from "../../cli/run"
import { openapi } from "./fixture"

export default defineCli({
  args: ["api", "session.get"],
  server: { routes: [openapi] },
  stderrLines: 0,
})
