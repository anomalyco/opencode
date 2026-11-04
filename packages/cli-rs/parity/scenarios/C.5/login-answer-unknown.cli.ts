import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login --answer` for a field the form does not have.
export default defineCli({
  args: ["auth", "login", "acme", "--answer", "nope=1"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
