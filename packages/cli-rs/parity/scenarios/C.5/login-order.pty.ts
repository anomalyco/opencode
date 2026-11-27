// `auth login` picker order: MCP first, then Popular (matching desktop and TUI priority), then Services.
import { definePty } from "../../pty/run"
import { integrationRoutes, sink } from "./fixture"
import { escape, first, press } from "./keys"

const provider = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  methods: [{ type: "key" }],
  connections: [],
  ...extra,
})

export default definePty({
  args: ["auth", "login"],
  cols: 100,
  rows: 40,
  env: sink,
  server: {
    routes: integrationRoutes([
      provider("mistral", "Mistral"),
      provider("google", "Google"),
      provider("github-copilot", "GitHub Copilot"),
      provider("claude-agent", "Claude Agent"),
      provider("anthropic", "Anthropic"),
      provider("openai", "OpenAI"),
      provider("linear", "Linear", { metadata: { source: "mcp" } }),
      provider("github", "GitHub", { metadata: { source: "mcp" } }),
      provider("opencode", "OpenCode Console"),
      provider("opencode-go", "OpenCode Go", {
        connections: [{ type: "credential", id: "cred_go00000001", label: "Go", method: "key" }],
      }),
    ]),
  },
  steps: [
    first("Select integration", "picker"),
    press(escape, "cancelled", "Cancelled"),
  ],
  osc: [],
  exits: true,
  requests: true,
})
