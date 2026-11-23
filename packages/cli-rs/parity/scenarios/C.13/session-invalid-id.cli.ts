// `-s bad_id`: the session lookup gets a declared error (400); the command fails with its message
// without the tag, as `errorMessage` prints it.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["-s", "bad_id"],
  server: {
    routes: [
      {
        path: "/api/session/bad_id",
        status: 400,
        json: { _tag: "InvalidRequestError", message: "Invalid session ID: bad_id" },
      },
    ],
  },
})
