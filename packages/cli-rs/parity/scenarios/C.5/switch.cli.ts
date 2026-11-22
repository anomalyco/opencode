import { defineCli } from "../../cli/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"

// `auth switch <name> <id>`: the integration matches by name, the credential by ID.
export default defineCli({
  args: ["auth", "switch", "OpenAI", "cred_bbbbbbbb0002"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
})
