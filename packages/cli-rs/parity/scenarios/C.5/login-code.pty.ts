// OAuth that needs a pasted code: the URL goes to the opener sink, then the code completes the attempt.
import { definePty } from "../../pty/run"
import { integrationRoutes, oauthRoutes, sink } from "./fixture"
import { enter, first, press } from "./keys"

export default definePty({
  args: ["auth", "login", "openai", "--method", "chatgpt"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...oauthRoutes("openai", "code")] },
  steps: [first("Paste the authorization code", "code"), press("abc-123" + enter, "done", "Done")],
  osc: [],
  exits: true,
  requests: true,
})
