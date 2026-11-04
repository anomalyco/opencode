import { defineCli } from "../../cli/run"
import { credentialRoute } from "./fixture"

// `auth import` without a file reads the export from stdin.
export default defineCli({
  args: ["auth", "import"],
  stdin: JSON.stringify([
    { id: "cred_ffffffff0006", integrationID: "acme", label: "Piped", active: false, value: { type: "key", key: "k" } },
  ]),
  server: { routes: [credentialRoute([]), { method: "POST", path: "/api/credential", json: { data: {} } }] },
})
