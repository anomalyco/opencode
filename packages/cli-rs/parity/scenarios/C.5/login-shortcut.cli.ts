import { defineCli } from "../../cli/run"
import { commandRoutes, integrationRoutes, sink } from "./fixture"

// The hidden `login` shortcut runs `auth login`: the same command method as login-command, by the short name.
export default defineCli({
  args: ["login", "zed"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...commandRoutes("zed")] },
})
