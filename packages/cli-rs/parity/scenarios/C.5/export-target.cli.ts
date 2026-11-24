import { defineCli } from "../../cli/run"
import { credentialRoute, integrationRoutes, sink } from "./fixture"

// `auth export <integration>`: only that integration's credentials.
export default defineCli({
  args: ["auth", "export", "openai"],
  env: sink,
  server: { routes: [...integrationRoutes(), credentialRoute()] },
})
