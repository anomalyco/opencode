import type { UsageEntry } from "./usage-data"

export const usageWarningThresholds = [80, 90, 95] as const
export const usageRefreshCooldownMs = 5 * 60 * 1000
export const usageFailureBackoffMs = 30 * 1000
export const usageShownMax = 256

export type UsageWarning = {
  id: string
  label: string
  threshold: number
  usedPercent: number
  resetsAt: number | null
  windowMinutes: number | null
}

export function usageWarning(entry: UsageEntry, previous: UsageEntry["snapshot"] | undefined): UsageWarning | null {
  const previousByID = new Map((previous?.windows ?? []).map((window) => [window.id, window.usedPercent]))
  return entry.snapshot.windows.reduce<UsageWarning | null>((best, current) => {
    const previousUsed = usagePercent(previousByID.get(current.id) ?? 0)
    const currentUsed = usagePercent(current.usedPercent)
    const threshold = usageWarningThresholds.reduce<number | null>((match, value) => {
      if (previousUsed >= value) return match
      if (currentUsed < value) return match
      return value
    }, null)
    if (!threshold) return best

    if (!best) {
      return {
        id: current.id,
        label: current.label,
        threshold,
        usedPercent: currentUsed,
        resetsAt: current.resetsAt,
        windowMinutes: current.windowMinutes,
      }
    }

    if (threshold > best.threshold) {
      return {
        id: current.id,
        label: current.label,
        threshold,
        usedPercent: currentUsed,
        resetsAt: current.resetsAt,
        windowMinutes: current.windowMinutes,
      }
    }

    if (threshold < best.threshold) return best
    if (currentUsed <= best.usedPercent) return best

    return {
      id: current.id,
      label: current.label,
      threshold,
      usedPercent: currentUsed,
      resetsAt: current.resetsAt,
      windowMinutes: current.windowMinutes,
    }
  }, null)
}

export function usageWarningKey(provider: string, warning: UsageWarning): string {
  return `${provider}:${warning.id}:${warning.threshold}:${warning.resetsAt ?? "none"}`
}

export function usageRemember(shown: Set<string>, key: string): boolean {
  if (shown.has(key)) return false
  if (shown.size >= usageShownMax) {
    const oldest = shown.values().next().value
    if (oldest) shown.delete(oldest)
  }
  shown.add(key)
  return true
}

export function usageShouldRefresh(input: {
  now: number
  successAt: number
  failureAt: number
  refreshing: boolean
}): boolean {
  if (input.refreshing) return false
  if (input.failureAt > 0 && input.now - input.failureAt < usageFailureBackoffMs) return false
  if (input.successAt > 0 && input.now - input.successAt < usageRefreshCooldownMs) return false
  return true
}

export function usageRefreshFailed(results: readonly { error?: { retryable: boolean } | null }[]): boolean {
  return results.some((result) => result.error?.retryable === true)
}

function usagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}
