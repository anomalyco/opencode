// The integration picker once a Go key is saved: OpenCode Go joins the popular integrations (without one, as in
// `login-picker`, it stays hidden because OpenCode Go connects through OpenCode), then Escape.
import { definePty } from "../../pty/run"
import { integrationRoutes, integrations, sink } from "./fixture"
import { escape, first, press } from "./keys"

const go = { type: "credential", id: "cred_dddddddd0004", label: "Go", method: "key" }

export default definePty({
  args: ["auth", "login"],
  cols: 100,
  rows: 40,
  env: sink,
  server: {
    routes: integrationRoutes(
      integrations.map((item) => (item.id === "opencode-go" ? { ...item, connections: [go] } : item)),
    ),
  },
  steps: [first("Select integration", "picker"), press(escape, "cancelled", "Cancelled")],
  osc: [],
  exits: true,
  requests: true,
})
