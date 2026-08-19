type Credits = {
  hasCredits: boolean
  unlimited: boolean
  balance: string | null
  label?: string
  overagePermitted?: boolean
  total?: number | null
  used?: number | null
  remaining?: number | null
}

export type UsageDisplayMode = "used" | "remaining"

export function formatUsageWindowLabel(label: string, windowMinutes: number | null): string {
  return formatWindowLabel(label, windowMinutes)
}

export function formatPlanType(planType: string | null): string | null {
  if (!planType) return null
  const normalized = planType.replace(/_/g, " ")
  const parts: string[] = []
  for (const part of normalized.split(" ")) {
    if (!part) continue
    parts.push(part.slice(0, 1).toUpperCase() + part.slice(1))
  }
  return parts.join(" ")
}

export function formatCreditsLabel(credits: Credits, options?: { mode?: UsageDisplayMode }): string {
  const mode = options?.mode ?? "used"
  const label = credits.label ?? "Credits Balance"
  const usedAmount = formatCreditAmount(credits.used)
  const quotaLike = label === "Premium Requests" || label === "GitHub AI Credits"
  const hasCounts =
    credits.total !== undefined ||
    credits.used !== undefined ||
    credits.remaining !== undefined ||
    credits.overagePermitted !== undefined ||
    quotaLike
  if (credits.unlimited) {
    if (mode === "used" && usedAmount !== null) return `${label} Used: ${usedAmount}`
    return `${label}: Unlimited`
  }

  if (hasCounts) {
    const remainingCount = creditCount(credits.remaining) ?? creditCount(parseBalance(credits.balance))

    if (mode === "remaining") {
      if (remainingCount !== null) return `${label} Remaining: ${remainingCount}`
      if (credits.overagePermitted) return `${label}: Overage enabled`
      if (!credits.hasCredits) return `${label}: Exhausted`
      return `${label}: Available`
    }

    if (usedAmount !== null) return `${label} Used: ${usedAmount}`
    if (!credits.hasCredits) return `${label} Used: All`
    return `${label} Used: Unknown`
  }

  return `${label}: ${formatCredits(credits)}`
}

type UsageTheme = {
  error: unknown
  warning: unknown
  success: unknown
}

export function formatUsageResetShort(resetAt: number | null): string {
  if (!resetAt) return ""
  const now = Math.floor(Date.now() / 1000)
  const diff = resetAt - now
  if (diff <= 0) return "refreshing"
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.round(diff / 60)}m`
  if (diff < 86400) return `${Math.round(diff / 3600)}h`
  return `${Math.round(diff / 86400)}d`
}

export function formatUsageResetLong(resetAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = resetAt - now
  if (diff <= 0) return "now"
  if (diff < 60) return `in ${diff} seconds`
  if (diff < 3600) return `in ${Math.round(diff / 60)} minutes`
  if (diff < 86400) return `in ${Math.round(diff / 3600)} hours`
  return `in ${Math.round(diff / 86400)} days`
}

export function formatUsageResetAbsolute(resetAt: number, nowMs: number = Date.now()): string {
  const resetMs = resetAt * 1000
  if (resetMs - nowMs <= 0) return "now"

  const nowDate = new Date(nowMs)
  const target = new Date(resetMs)
  const time = target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  const sameCalendarDay =
    nowDate.getFullYear() === target.getFullYear() &&
    nowDate.getMonth() === target.getMonth() &&
    nowDate.getDate() === target.getDate()
  if (sameCalendarDay) return `today at ${time}`

  const tomorrow = new Date(nowDate)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow =
    tomorrow.getFullYear() === target.getFullYear() &&
    tomorrow.getMonth() === target.getMonth() &&
    tomorrow.getDate() === target.getDate()
  if (isTomorrow) return `tomorrow at ${time}`

  const daysDiff = Math.floor((resetMs - nowMs) / 86_400_000)
  if (daysDiff < 7) {
    const weekday = target.toLocaleDateString([], { weekday: "short" })
    return `${weekday} at ${time}`
  }

  const date = target.toLocaleDateString([], { month: "short", day: "numeric" })
  return `${date} at ${time}`
}

export function usageDisplay(
  usedPercent: number,
  mode: UsageDisplayMode,
): { percent: number; label: UsageDisplayMode } {
  const used = clampPercent(usedPercent)
  if (mode === "remaining") {
    return {
      percent: 100 - used,
      label: "remaining",
    }
  }
  return {
    percent: used,
    label: "used",
  }
}

export function usageBarString(percent: number, width = 10): string {
  const clamped = clampPercent(percent)
  const filled = Math.round((clamped / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

export function usageBarColor<T extends UsageTheme>(
  percent: number,
  theme: T,
): T["error"] | T["warning"] | T["success"] {
  if (percent >= 90) return theme.error
  if (percent >= 70) return theme.warning
  return theme.success
}

function formatWindowLabel(base: string, windowMinutes: number | null): string {
  if (!windowMinutes) return base
  if (base !== "Hourly" && base !== "Weekly") return base
  const minutesPerHour = 60
  const minutesPerDay = 24 * minutesPerHour
  const minutesPerWeek = 7 * minutesPerDay
  if (windowMinutes >= minutesPerWeek) return "Weekly"

  if (windowMinutes % minutesPerHour === 0) {
    const hours = Math.max(1, Math.round(windowMinutes / minutesPerHour))
    if (hours === 1) return "Hourly"
    return `${hours}h`
  }

  if (windowMinutes < minutesPerHour) return `${windowMinutes}m`
  const hours = Math.max(1, Math.round(windowMinutes / minutesPerHour))
  return `${hours}h`
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

function formatCredits(credits: Credits): string {
  if (!credits.hasCredits) return "None"
  if (credits.unlimited) return "Unlimited"
  if (credits.balance) return credits.balance
  return "Available"
}

function parseBalance(value: string | null): number | null {
  if (!value) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric
}

function creditCount(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function formatCreditAmount(value: number | null | undefined): string | null {
  if (typeof value !== "number") return null
  if (!Number.isFinite(value)) return null
  return String(Math.max(0, value))
}
