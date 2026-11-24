// Deleting an unknown session: the declared error's message, exit 1.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["session", "delete", "ses_zzzzzzzz9999"],
  server: {
    routes: [
      {
        method: "DELETE",
        path: "/api/session/:id",
        status: 404,
        json: { _tag: "SessionNotFoundError", message: "Session not found: ses_zzzzzzzz9999" },
      },
    ],
  },
})
