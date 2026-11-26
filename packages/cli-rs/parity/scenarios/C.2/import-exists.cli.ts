// A 409 from the import: "Session already exists" on stderr, exit 0.
import { defineCli } from "../../cli/run"
import { importFile, location } from "./fixture"

export default defineCli({
  args: ["session", "import", importFile],
  server: {
    routes: [
      location,
      { method: "POST", path: "/api/experimental/session/import", status: 409, json: { _tag: "Conflict" } },
    ],
  },
})
