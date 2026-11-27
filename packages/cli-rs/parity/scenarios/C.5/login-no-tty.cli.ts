import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` without a target needs a terminal.
export default defineCli({
  args: ["auth", "login"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
