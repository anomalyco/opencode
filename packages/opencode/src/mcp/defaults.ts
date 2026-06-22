import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export const DEFAULT_MCPS: Record<string, ConfigMCPV1.Info | { enabled: boolean }> = {
  context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
  grep_app: { type: "remote", url: "https://mcp.grep.app" },
  composio: { type: "local", command: ["npx", "-y", "@composio/mcp@latest"], environment: {} },
}
