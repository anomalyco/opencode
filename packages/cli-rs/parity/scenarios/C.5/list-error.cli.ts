import { defineCli } from "../../cli/run"
import { sink } from "./fixture"

// `auth list` when the server fails: the bare message, exit 1.
export default defineCli({
  args: ["auth", "list"],
  env: sink,
  server: {
    routes: [
      {
        path: "/api/model/default",
        status: 503,
        json: { _tag: "ServiceUnavailableError", message: "The location is restarting" },
      },
    ],
  },
})
