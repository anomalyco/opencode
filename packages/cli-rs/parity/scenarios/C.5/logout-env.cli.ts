import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"

// `auth logout` of an integration connected through an environment variable.
export default defineCli({
  args: ["auth", "logout", "anthropic", "x"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
})
