import type { LspStatus, McpStatus } from "@opencode-ai/sdk/v2/client"

export function hasNonBlockingServiceIssue(input: {
  mcp: Array<McpStatus["status"]>
  lsp: Array<LspStatus["status"]>
}) {
  return (
    input.mcp.some((status) => status !== "connected" && status !== "disabled") ||
    input.lsp.some((status) => status === "error")
  )
}

export function serverStatusDotClass(input: { ready: boolean; serverHealth: boolean | undefined; issue: boolean }) {
  if (input.serverHealth === false) return "bg-icon-critical-base"
  if (!input.ready || input.serverHealth === undefined) return "bg-border-weak-base"
  if (input.issue) return "bg-icon-warning-base"
  if (input.serverHealth === true) return "bg-icon-success-base"
  return "bg-border-weak-base"
}
