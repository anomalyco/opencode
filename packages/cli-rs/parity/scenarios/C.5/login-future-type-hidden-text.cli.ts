import { defineCli } from "../../cli/run"
import { futureRoutes, sink } from "./fixture"

// A hidden field of a type this client does not know whose default is not a selection: rejected before any
// write.
export default defineCli({
  args: ["auth", "login", "future"],
  env: sink,
  server: { routes: futureRoutes({ hidden: true, default: "west" }) },
})
