import type { ConsoleState } from "@/config/console-state"

type CodexQuotaSnapshot = NonNullable<ConsoleState["codexQuota"]>
type CodexQuotaWindow = NonNullable<CodexQuotaSnapshot["fiveHour"]>
type ProviderQuotaSnapshot = NonNullable<ConsoleState["providerQuota"]>[number]

type CodexQuotaLayout = {
  barWidth?: number
  timestamp?: boolean
}

export function formatCodexQuotaFetchedAt(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return

  const pad = (value: number) => value.toString().padStart(2, "0")
  const time = `${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const nowDate = new Date(now)
  const nowStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const daysAgo = Math.max(0, Math.floor((nowStart - dateStart) / 86_400_000))
  const day = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`

  return `${day}@${time}`
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
  if (width >= 200) return { barWidth: 10, timestamp: true }
  if (width >= 120) return { barWidth: 5, timestamp: true }
  if (width >= 90) return { timestamp: true }
  return {}
}

function formatProviderWindow(item: {
  label: string
  remainingPercent?: number
  confidence: "exact" | "reported" | "estimated"
}) {
  if (item.confidence !== "exact" && item.confidence !== "reported") return
  if (item.remainingPercent == null) return
  const percent = clampPercent(item.remainingPercent)
  return `${item.label} ${percent}%`
}

function hasPromptVisibleProviderQuota(item: ProviderQuotaSnapshot) {
  if (item.status === "unavailable") return false
  return item.windows.some((window) => window.confidence === "exact" || window.confidence === "reported")
}

function providerMatchesActive(item: ProviderQuotaSnapshot, activeProvider: string | undefined) {
  if (!activeProvider) return false
  const active = activeProvider.toLowerCase()
  return item.provider.toLowerCase() === active || item.label.toLowerCase() === active
}

function formatProviderWindows(item: ProviderQuotaSnapshot, width: number, now: number) {
  const layout = codexQuotaLayout(width)
  const parts = item.windows
    .map((window) => formatProviderWindow(window))
    .filter((part): part is string => Boolean(part))

  if (parts.length === 0) return

  const fetchedAt = layout.timestamp && item.fetchedAt ? formatCodexQuotaFetchedAt(item.fetchedAt, now) : undefined
  return `${item.label} ${parts.join(" · ")}${fetchedAt ? ` · ⟳ ${fetchedAt}` : ""}`.trim()
}

export function formatCodexQuotaMetrics(item: CodexQuotaSnapshot | undefined, terminalWidth: number, now = Date.now()) {
  if (!item?.fiveHour && !item?.weekly) return

  const layout = codexQuotaLayout(terminalWidth)
  const fetchedAt =
    item.fetchedAt !== undefined && layout.timestamp ? formatCodexQuotaFetchedAt(item.fetchedAt, now) : undefined
  const parts = [
    item.fiveHour ? formatQuotaWindow("5h", item.fiveHour, layout.barWidth) : undefined,
    item.weekly ? formatQuotaWindow("wk", item.weekly, layout.barWidth) : undefined,
    fetchedAt ? `⟳ ${fetchedAt}` : undefined,
  ].filter((part): part is string => Boolean(part))

  if (parts.length === 0) return
  return `codex ${parts.join(" · ")}`
}

export function formatProviderQuotaMetrics(
  item: ConsoleState["providerQuota"],
  terminalWidth: number,
  now = Date.now(),
  activeProvider?: string,
) {
  if (!item || item.length === 0) return
  const visible = item.filter(hasPromptVisibleProviderQuota)
  const quote = visible.find((entry) => providerMatchesActive(entry, activeProvider)) ?? visible[0]
  if (!quote) return
  return formatProviderWindows(quote, terminalWidth, now)
}
