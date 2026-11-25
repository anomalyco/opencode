// `auth login` for a form field of a type this client does not know: a text prompt with its title and
// description; an empty answer to an optional one skips it, and the OAuth start goes out without it.
import { definePty } from "../../pty/run"
import { futureRoutes, sink } from "./fixture"
import { enter, first, press } from "./keys"

export default definePty({
  args: ["auth", "login", "future"],
  env: sink,
  server: { routes: futureRoutes({ title: "Region", description: "Where the data lives" }) },
  steps: [first("Region", "prompt"), press(enter, "done", "Done")],
  osc: [],
  exits: true,
  requests: true,
})
