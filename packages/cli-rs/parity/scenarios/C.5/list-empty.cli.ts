import { defineCli } from "../../cli/run"
import { integrationRoutes, integrations, sink } from "./fixture"

// `auth list` when nothing is connected.
export default defineCli({
  args: ["auth", "list"],
  env: sink,
  server: { routes: [...integrationRoutes(integrations.map((item) => ({ ...item, connections: [] })))] },
})
