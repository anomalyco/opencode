import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth logout <integration>` without a credential needs a terminal.
export default defineCli({
  args: ["auth", "logout", "openai"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
