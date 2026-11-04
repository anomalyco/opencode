import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"

// `auth logout <integration> <label>`: the label matches without regard to case.
export default defineCli({
  args: ["auth", "logout", "openai", "personal"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
})
