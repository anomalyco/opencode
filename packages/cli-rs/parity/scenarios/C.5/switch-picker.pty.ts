// `auth switch` on a terminal: typing filters the integrations, then the only account is chosen.
import { definePty } from "../../pty/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"
import { enter, first, press } from "./keys"

export default definePty({
  args: ["auth", "switch"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
  steps: [
    first("Select integration", "integrations"),
    press("git", "filtered"),
    press(enter, "accounts", "Select github account to switch to"),
    press(enter, "done", "Done"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
