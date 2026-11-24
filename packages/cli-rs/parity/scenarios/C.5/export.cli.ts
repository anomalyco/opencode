import { defineCli } from "../../cli/run"
import { credentialRoute, sink } from "./fixture"

// `auth export`: every credential, as the server sent it. No warning without a terminal.
export default defineCli({
  args: ["auth", "export"],
  env: sink,
  server: { routes: [credentialRoute()] },
})
