export type MissionControlStatus = "attention" | "working" | "ready" | "idle"

export function deriveMissionControlStatus(input: {
  requests?: { permission?: unknown; question?: unknown }
  status?: "idle" | "busy" | "retry"
  unseen: number
  failed: boolean
  changes: number
}): MissionControlStatus {
  if (input.requests?.permission || input.requests?.question) return "attention"
  if (input.status === "retry" || input.failed) return "attention"
  if (input.status === "busy") return "working"
  if (input.unseen > 0 || input.changes > 0) return "ready"
  return "idle"
}

export function formatAgentAge(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function formatUsage(cost: number, tokens: number) {
  const price = cost > 0 ? `$${cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)}` : undefined
  const tokenCount = tokens > 0 ? `${tokens < 1_000 ? tokens : `${Math.round(tokens / 100) / 10}k`} tok` : undefined
  return [price, tokenCount].filter(Boolean).join(" · ")
}
