// OAuth that also takes the redirect URL (`paste`, #61706): while the browser flow waits, a prompt asks for the URL
// the browser was redirected to. The pasted URL completes the attempt, whose status then settles the login.
import { definePty } from "../../pty/run"
import { integrationRoutes, location, oauthRoutes, sink } from "./fixture"
import { enter, first, press } from "./keys"

const time = { created: 1_762_268_645_123, expires: 1_762_269_245_123 }
const status = "/api/integration/openai/connect/oauth/att_test0001"
const [connect, , complete, cancel] = oauthRoutes("openai")

export default definePty({
  args: ["auth", "login", "openai", "--method", "chatgpt"],
  env: sink,
  server: {
    routes: [
      ...integrationRoutes(),
      { ...connect, json: { location, data: { ...(connect.json as { data: object }).data, paste: true } } },
      {
        path: status,
        json: (_, requests) => ({
          location,
          data: {
            status: requests.some((request) => request.method === "POST" && request.path === `${status}/complete`)
              ? "complete"
              : "pending",
            time,
          },
        }),
      },
      complete,
      cancel,
    ],
  },
  steps: [
    first("paste the URL it was redirected to", "prompt"),
    press("http://localhost:1455/auth/callback?code=abc" + enter, "done", "Done"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
