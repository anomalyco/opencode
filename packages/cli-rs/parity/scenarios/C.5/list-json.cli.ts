import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth list --format json`: the integrations that have connections.
export default defineCli({
  args: ["auth", "list", "--format", "json"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
