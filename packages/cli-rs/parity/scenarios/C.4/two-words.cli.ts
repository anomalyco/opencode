// Two arguments that are not a method and a path. First stderr line only (C40-handler-errors).
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "fetch", "/api/session"],
  server: { routes: [] },
  stderrLines: 1,
})
