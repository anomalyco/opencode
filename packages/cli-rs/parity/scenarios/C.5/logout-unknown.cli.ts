import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"

// `auth logout` of an unknown integration.
export default defineCli({
  args: ["auth", "logout", "nope", "x"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
})
