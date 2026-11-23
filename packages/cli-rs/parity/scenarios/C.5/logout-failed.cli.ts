import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth logout` when the server refuses: the spinner fails, then the message.
export default defineCli({
  args: ["auth", "logout", "openai", "cred_aaaaaaaa0001"],
  env: sink,
  server: {
    routes: [
      ...integrationRoutes(),
      {
        method: "DELETE",
        path: "/api/credential/:id",
        status: 400,
        json: { _tag: "BadRequest", message: "Credential is locked" },
      },
    ],
  },
})
