import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth list`: one row per connection, stored credentials and environment variables.
export default defineCli({
  args: ["auth", "list"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
