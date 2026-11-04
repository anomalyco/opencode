import { defineCli } from "../../cli/run"
import { credentialRoute, credentials, exportFile, sink } from "./fixture"

// `auth import <file>`: skips known IDs, merges a legacy key's `configuration`, activates only new integrations.
export default defineCli({
  args: ["auth", "import", exportFile],
  env: sink,
  server: {
    routes: [
      credentialRoute(credentials.slice(0, 1)),
      { method: "POST", path: "/api/credential", json: { data: credentials[1] } },
    ],
  },
})
