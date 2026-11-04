// `session import <file> --directory sub/..`: the file's `location` is replaced in place by the
// resolved location, and the server's session ID is printed.
import { defineCli } from "../../cli/run"
import { importFile, location, session } from "./fixture"

export default defineCli({
  args: ["session", "import", importFile, "--directory", "sub/.."],
  server: {
    routes: [
      location,
      {
        method: "POST",
        path: "/api/experimental/session/import",
        json: { data: session("ses_eeeeeeee0005", "Imported", 2) },
      },
    ],
  },
})
