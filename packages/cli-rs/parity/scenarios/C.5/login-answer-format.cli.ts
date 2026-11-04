import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login --answer` without a key.
export default defineCli({
  args: ["auth", "login", "acme", "--answer", "=1"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
