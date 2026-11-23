import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` of an integration with several methods needs `--method` without a terminal.
export default defineCli({
  args: ["auth", "login", "openai"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
