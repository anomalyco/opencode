import type { LspStatus } from "@/runtime/server/types"
import type { McpServer } from "@opencode-ai/client/promise"

export function hasServiceNeedingAttention(input: { mcp: Array<McpServer["status"]["status"]> }) {
  return input.mcp.some((status) => status === "needs_auth")
}

export function hasNonBlockingServiceIssue(input: {
  mcp: Array<McpServer["status"]["status"]>
  lsp: Array<LspStatus["status"]>
}) {
  return (
    input.mcp.some((status) => status !== "connected" && status !== "pending" && status !== "disabled") ||
    input.lsp.some((status) => status === "error")
  )
}

export function serverStatusDotClass(input: {
  ready: boolean
  serverHealth: boolean | undefined
  attention?: boolean
  issue: boolean
  connecting?: boolean
}) {
  if (input.serverHealth === false) return "bg-icon-critical-base"
  // The event stream is (re)connecting: keep the neutral dot but let it breathe so a stale
  // session is visibly waiting on the server rather than silently frozen.
  if (input.connecting) return "bg-border-weak-base animate-pulse"
  if (!input.ready || input.serverHealth === undefined) return "bg-border-weak-base"
  if (input.attention) return "bg-v2-background-bg-accent"
  if (input.issue) return "bg-icon-warning-base"
  if (input.serverHealth === true) return "bg-icon-success-base"
  return "bg-border-weak-base"
}
