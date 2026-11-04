import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` with a form field left unanswered needs a terminal.
export default defineCli({
  args: ["auth", "login", "acme", "--answer", "region=us"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
