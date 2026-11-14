import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"

// `auth switch` to an unknown credential.
export default defineCli({
  args: ["auth", "switch", "openai", "nobody"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
})
