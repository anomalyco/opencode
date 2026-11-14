import { defineCli } from "../../cli/run"
import { credentialRoute, exportFile, sink } from "./fixture"

// `auth import` when the server already has every credential (409).
export default defineCli({
  args: ["auth", "import", exportFile],
  env: sink,
  server: {
    routes: [
      credentialRoute([]),
      {
        method: "POST",
        path: "/api/credential",
        status: 409,
        json: { _tag: "ConflictError", message: "Credential already exists" },
      },
    ],
  },
})
