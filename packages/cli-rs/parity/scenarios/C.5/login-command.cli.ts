import { defineCli } from "../../cli/run"
import { commandRoutes, integrationRoutes, sink } from "./fixture"

// `auth login` with a command method: the command completes, then the attempt is released.
export default defineCli({
  args: ["auth", "login", "zed"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...commandRoutes("zed")] },
})
