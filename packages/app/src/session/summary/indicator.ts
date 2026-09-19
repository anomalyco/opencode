import type { McpServer } from "@opencode/client/promise"

export function hasServiceNeedingAttention(statuses: Array<McpServer["status"]["status"]>) {
  return statuses.some((status) => status === "needs_auth")
}

export function hasNonBlockingServiceIssue(statuses: Array<McpServer["status"]["status"]>) {
  return statuses.some((status) => status !== "connected" && status !== "pending" && status !== "disabled")
}

export function serviceStatusDotClass(statuses: Array<McpServer["status"]["status"]>) {
  if (hasServiceNeedingAttention(statuses)) return "bg-v2-background-bg-accent"
  if (hasNonBlockingServiceIssue(statuses)) return "bg-icon-warning-base"
}

export function serverStatusDotClass(input: {
  ready: boolean
  serverHealth: boolean | undefined
  connecting: boolean
}) {
  if (input.serverHealth === false) return "bg-icon-critical-base"
  if (input.connecting) return "bg-border-weak-base animate-pulse"
  if (!input.ready || input.serverHealth === undefined) return "bg-border-weak-base"
  return "bg-icon-success-base"
}

export function summaryStatus(input: {
  ready: boolean
  serverHealth: boolean | undefined
  mcp: Array<McpServer["status"]["status"]>
  connecting: boolean
}) {
  const mcp = serviceStatusDotClass(input.mcp)
  const server = serverStatusDotClass({
    ready: input.ready,
    serverHealth: input.serverHealth,
    connecting: input.connecting,
  })
  return {
    server,
    mcp,
    trigger: input.serverHealth === false ? server : mcp,
  }
}
