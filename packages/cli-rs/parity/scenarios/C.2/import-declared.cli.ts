// A declared error from the import (400 with a message): TS reads the raw response, so it fails with the status
// text, not the message. Only the first stderr line is compared; the rest is a JavaScript stack trace.
import { defineCli } from "../../cli/run"
import { importFile, location } from "./fixture"

export default defineCli({
  args: ["session", "import", importFile],
  server: {
    routes: [
      location,
      {
        method: "POST",
        path: "/api/experimental/session/import",
        status: 400,
        json: { _tag: "BadRequest", message: "Invalid session data" },
      },
    ],
  },
  stderrLines: 1,
})
