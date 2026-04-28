import type { ConsoleState } from "@/config/console-state"

type CodexQuotaSnapshot = NonNullable<ConsoleState["codexQuota"]>
type CodexQuotaWindow = NonNullable<CodexQuotaSnapshot["fiveHour"]>

type CodexQuotaTimestampMode = "full" | "short"

type CodexQuotaLayout = {
  barWidth?: number
  timestamp?: CodexQuotaTimestampMode
}

export function formatCodexQuotaFetchedAt(timestamp: number, mode: CodexQuotaTimestampMode = "full") {
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return

  const pad = (value: number) => value.toString().padStart(2, "0")
  const time = `${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`
  if (mode === "short") return time

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function formatQuotaBar(percent: number, width: number) {
  const columns = Math.max(0, Math.floor(width))
  const filled = Math.round((clampPercent(percent) / 100) * columns)
  return `${"█".repeat(filled)}${"░".repeat(columns - filled)}`
}

function formatQuotaWindow(label: "5h" | "wk", item: CodexQuotaWindow, barWidth?: number) {
  const percent = clampPercent(item.remainingPercent)
  if (barWidth === undefined) return `${label} ${percent}%`
  return `${label} ${formatQuotaBar(percent, barWidth)} ${percent}%`
}

function codexQuotaLayout(width: number): CodexQuotaLayout {
  if (width >= 200) return { barWidth: 10, timestamp: "full" }
  if (width >= 120) return { barWidth: 5, timestamp: "short" }
  if (width >= 90) return { timestamp: "short" }
  return {}
}

export function formatCodexQuotaMetrics(item: CodexQuotaSnapshot | undefined, terminalWidth: number) {
  if (!item?.fiveHour && !item?.weekly) return

  const layout = codexQuotaLayout(terminalWidth)
  const parts = [
    item.fiveHour ? formatQuotaWindow("5h", item.fiveHour, layout.barWidth) : undefined,
    item.weekly ? formatQuotaWindow("wk", item.weekly, layout.barWidth) : undefined,
    item.fetchedAt && layout.timestamp ? `⟳${formatCodexQuotaFetchedAt(item.fetchedAt, layout.timestamp)}` : undefined,
  ].filter((part): part is string => Boolean(part))

  if (parts.length === 0) return
  return `codex ${parts.join(" · ")}`
}
