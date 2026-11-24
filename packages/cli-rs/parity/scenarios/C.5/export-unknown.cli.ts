import { defineCli } from "../../cli/run"
import { credentialRoute, integrationRoutes, sink } from "./fixture"

// `auth export` of an unknown integration.
export default defineCli({
  args: ["auth", "export", "nope"],
  env: sink,
  server: { routes: [...integrationRoutes(), credentialRoute()] },
})
