// `auth login` for a required form field of a type this client does not know: the text prompt refuses an
// empty answer, then Escape cancels.
import { definePty } from "../../pty/run"
import { futureRoutes, sink } from "./fixture"
import { enter, escape, first, press } from "./keys"

export default definePty({
  args: ["auth", "login", "future"],
  env: sink,
  server: { routes: futureRoutes({ title: "Region", required: true }) },
  steps: [first("Region", "prompt"), press(enter, "required", "Required"), press(escape, "cancelled", "Cancelled")],
  osc: [],
  exits: true,
  requests: true,
})
