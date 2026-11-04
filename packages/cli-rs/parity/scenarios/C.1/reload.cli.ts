// `reload`: one POST without a location, then "Configuration reloaded". Only the fake server sees it.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["reload"],
  server: { routes: [{ method: "POST", path: "/api/location/reload", status: 204 }] },
})
