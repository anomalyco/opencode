// `auth logout` on a terminal: the integrations with stored credentials, then the account picker.
import { definePty } from "../../pty/run"
import { credentialWrites, integrationRoutes, sink } from "./fixture"
import { down, enter, first, press } from "./keys"

export default definePty({
  args: ["auth", "logout"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...credentialWrites] },
  steps: [
    first("Select integration", "integrations"),
    press(enter, "accounts", "Select OpenAI account to log out"),
    press(down, "moved"),
    press(enter, "done", "Done"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
