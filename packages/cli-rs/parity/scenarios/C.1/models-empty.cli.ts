// `models` with no models prints nothing, not an empty line.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["models"],
  server: { routes: [{ path: "/api/model", json: { location: { directory: "/work" }, data: [] } }] },
})
