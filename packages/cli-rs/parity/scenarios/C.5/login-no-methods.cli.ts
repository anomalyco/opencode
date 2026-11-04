import { defineCli } from "../../cli/run"
import { integrationRoutes, integrations, sink } from "./fixture"

// `auth login` of an integration that only reads environment variables.
export default defineCli({
  args: ["auth", "login", "anthropic-env"],
  env: sink,
  server: {
    routes: [
      ...integrationRoutes([
        ...integrations,
        { id: "anthropic-env", name: "Env only", methods: [{ type: "env", names: ["X"] }], connections: [] },
      ]),
    ],
  },
})
