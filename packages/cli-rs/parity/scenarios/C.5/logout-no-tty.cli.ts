import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth logout` without a target needs a terminal.
export default defineCli({
  args: ["auth", "logout"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
