import { defineCli } from "../../cli/run"
import { futureRoutes, sink } from "./fixture"

// `auth login` without `--answer` for a field of a type this client does not know: it is prompted for like any
// field, which needs a terminal.
export default defineCli({
  args: ["auth", "login", "future"],
  env: sink,
  server: { routes: futureRoutes({ title: "Region" }) },
})
