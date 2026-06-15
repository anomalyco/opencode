import type { McpStatus } from "@opencode-ai/sdk/v2/client"

export function mcpStatusIssue(mcp: Record<string, McpStatus> | undefined) {
  const status = Object.values(mcp ?? {})
  if (status.some((item) => item.status === "failed" || item.status === "needs_client_registration")) {
    return "critical" as const
  }
  if (status.some((item) => item.status === "needs_auth")) return "warning" as const
}

export function mcpStatusDetail(status: McpStatus | undefined, needsAuth: string) {
  if (status?.status === "needs_auth") return needsAuth
  if (status?.status === "failed" || status?.status === "needs_client_registration") return status.error
}
