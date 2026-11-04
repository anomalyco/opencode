import { defineCli } from "../../cli/run"
import { integrationRoutes, oauthRoutes, sink } from "./fixture"

// `auth login --method <id>`: OAuth without a terminal, so no browser; the attempt completes, then is released.
export default defineCli({
  args: ["auth", "login", "openai", "--method", "chatgpt"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...oauthRoutes("openai")] },
})
