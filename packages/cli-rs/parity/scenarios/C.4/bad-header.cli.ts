// A header without `name:` fails before the request. First stderr line only (C40-handler-errors).
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "get", "/api/session", "-H", ":value"],
  server: { routes: [] },
  stderrLines: 1,
})
