// The home footer (F01): the connected MCP servers of the default location with `/mcps`, then the version.
import { defineApp, HOME_PLACEHOLDER, location } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true } },
  routes: [
    {
      path: "/api/mcp",
      json: {
        location,
        data: [
          { name: "github", status: { status: "connected" } },
          { name: "linear", status: { status: "connected" } },
          { name: "figma", status: { status: "disabled" } },
        ],
      },
    },
  ],
  steps: [{ checkpoint: "counts", until: "2 MCP", masks: [HOME_PLACEHOLDER] }],
})
