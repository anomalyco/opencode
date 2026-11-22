import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` stops at the first unanswered field before it reaches an inactive one.
export default defineCli({
  args: ["auth", "login", "acme", "--answer", "region=us", "--answer", "eu-only=yes"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
