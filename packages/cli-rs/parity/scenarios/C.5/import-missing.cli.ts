import { defineCli } from "../../cli/run"
import { credentialRoute, sink } from "./fixture"

// `auth import` of a missing file.
export default defineCli({
  args: ["auth", "import", "missing.json"],
  env: sink,
  server: { routes: [credentialRoute()] },
})
