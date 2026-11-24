// The document fails to load. The message differs on purpose (C40-handler-errors); only the exit and the
// requests are compared.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "session.list"],
  server: { routes: [{ path: "/openapi.json", status: 500, json: { message: "no" } }] },
  stderrLines: 0,
})
