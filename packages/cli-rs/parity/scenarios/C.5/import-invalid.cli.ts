import { defineCli } from "../../cli/run"
import { credentialRoute } from "./fixture"

// An export that does not decode fails before the command connects.
export default defineCli({
  args: ["auth", "import"],
  stdin: JSON.stringify([
    { id: "cred_ffffffff0006", integrationID: "acme", label: "Bad", active: "yes", value: { type: "key" } },
  ]),
  server: { routes: [credentialRoute([])] },
})
