// Ctrl+C while waiting for the browser: the attempt is cancelled on the server and the command ends.
import { definePty } from "../../pty/run"
import { integrationRoutes, location, oauthRoutes, sink } from "./fixture"
import { first, press } from "./keys"

const [connect, , , cancel] = oauthRoutes("openai")
const pending = {
  path: "/api/integration/openai/connect/oauth/att_test0001",
  json: { location, data: { status: "pending", time: { created: 0, expires: 0 } } },
}

export default definePty({
  args: ["auth", "login", "openai", "--method", "chatgpt"],
  env: sink,
  server: { routes: [...integrationRoutes(), connect, pending, cancel] },
  steps: [first("Waiting for authorization", "waiting"), press("\x03", "interrupted", "Cancelled")],
  osc: [],
  exits: true,
  requests: true,
})
