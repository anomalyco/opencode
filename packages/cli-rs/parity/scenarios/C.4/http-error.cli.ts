// `api get /api/missing`: the error body on stdout, `HTTP 404 Not Found` on stderr, exit 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["api", "get", "/api/missing"],
  server: { routes: [] },
})
