import { defineCli } from "../../cli/run"
import { futureRoutes, sink } from "./fixture"

// A hidden field of a type this client does not know sends its default, a selection, with the OAuth start.
export default defineCli({
  args: ["auth", "login", "future"],
  env: sink,
  server: { routes: futureRoutes({ hidden: true, custom: true, default: ["west"] }) },
})
