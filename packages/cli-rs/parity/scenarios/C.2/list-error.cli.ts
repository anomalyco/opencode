// A declared error from the list: its bare message on stderr, exit 1.
import { defineCli } from "../../cli/run"
import { location } from "./fixture"

export default defineCli({
  args: ["session", "list"],
  server: {
    routes: [location, { path: "/api/session", status: 400, json: { _tag: "BadRequest", message: "Invalid cursor" } }],
  },
})
