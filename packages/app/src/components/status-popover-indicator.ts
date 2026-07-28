import type { McpServer } from "@opencode-ai/client/promise"

export function hasServiceNeedingAttention(input: { mcp: Array<McpServer["status"]["status"]> }) {
  return input.mcp.some((status) => status === "needs_auth" || status === "needs_client_registration")
}

export function serverStatusDotClass(input: { ready: boolean; serverHealth: boolean | undefined; issue: boolean }) {
  if (input.serverHealth === false) return "bg-icon-critical-base"
  if (!input.ready || input.serverHealth === undefined) return "bg-border-weak-base"
  if (input.issue) return "bg-v2-background-bg-accent"
  if (input.serverHealth === true) return "bg-icon-success-base"
  return "bg-border-weak-base"
}
