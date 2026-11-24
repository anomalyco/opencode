import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login <url>` when discovery fails.
export default defineCli({
  args: ["auth", "login", "https://mcp.example.test"],
  env: sink,
  server: {
    routes: [
      ...integrationRoutes(),
      {
        method: "POST",
        path: "/api/experimental/integration/wellknown",
        status: 400,
        json: { _tag: "BadRequest", message: "No well-known metadata" },
      },
    ],
  },
})
