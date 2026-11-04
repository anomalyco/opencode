import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` stops at the first unanswered field before it parses a later answer.
export default defineCli({
  args: ["auth", "login", "acme", "--answer", "region=us", "--answer", "seats=three"],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
