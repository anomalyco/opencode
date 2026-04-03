import type { WorkerState } from "@/parallel/schema"

export function formatDuration(ms: number) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return `${min}m ${rest}s`
}

export function formatCost(cost: number) {
  if (cost === 0) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatTime(ts: number) {
  const date = new Date(ts)
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function waveLabel(index: number, type: "parallel" | "serial") {
  return `${type === "parallel" ? "P" : "S"}${index + 1}`
}

export function statusRank(status: WorkerState["status"]) {
  switch (status) {
    case "running":
      return 0
    case "spawning":
      return 1
    case "failed":
    case "conflict":
    case "blocked":
      return 2
    case "pending":
      return 3
    case "stopping":
      return 4
    case "done":
      return 5
    case "merged":
      return 6
  }
}

export function statusLabel(worker: Pick<WorkerState, "status" | "resolutionMode">) {
  if ((worker.status === "merged" || worker.status === "conflict") && worker.resolutionMode) {
    return `${worker.status} (${worker.resolutionMode})`
  }
  return worker.status
}

export function statusIcon(status: WorkerState["status"]) {
  switch (status) {
    case "pending":
      return "○"
    case "spawning":
      return "◐"
    case "running":
      return "●"
    case "done":
    case "merged":
      return "✓"
    case "failed":
    case "conflict":
      return "✗"
    case "blocked":
      return "⊘"
    default:
      return "○"
  }
}
