import { cmd } from "./cmd"
import { UI } from "../ui"
import * as Credential from "../opviera/credential"

/**
 * `opviera login` / `opviera logout`.
 *
 * Login re-runs the SAME gate the TUI runs at startup rather than reimplementing the prompts, so
 * there is one sign-in flow and one place to change it.
 */
export const LoginCommand = cmd({
  command: "login",
  describe: "sign in to Opviera with an API key",
  async handler() {
    // Discard any stored key first, otherwise the gate would validate it and skip the prompts —
    // which is the opposite of what someone typing `login` wants.
    await Credential.clear()
    const { ensureAuthenticated } = await import("../opviera/gate")
    await ensureAuthenticated()
  },
})

export const LogoutCommand = cmd({
  command: "logout",
  describe: "remove the stored Opviera API key",
  async handler() {
    const existing = await Credential.read()
    await Credential.clear()
    UI.println(existing ? "Signed out of Opviera." : "You are not signed in.")
  },
})
