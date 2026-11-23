import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login --method` with an unknown method lists the available ones.
export default defineCli({
  args: ["auth", "login", "openai", "--method", "nope"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
