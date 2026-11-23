import { defineCli } from "../../cli/run"
import { integrationRoutes, oauthRoutes, sink } from "./fixture"

// `auth login --method <label>`: an OAuth attempt that needs a pasted code fails without a terminal.
export default defineCli({
  args: ["auth", "login", "openai", "--method", "ChatGPT Pro/Plus"],
  env: sink,
  server: { routes: [...integrationRoutes(), ...oauthRoutes("openai", "code")] },
})
