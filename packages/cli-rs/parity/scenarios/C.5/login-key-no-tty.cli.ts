import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` with an API key needs a terminal for the key.
export default defineCli({
  args: ["auth", "login", "opencode-go"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
