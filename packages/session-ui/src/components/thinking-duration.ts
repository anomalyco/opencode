export const LIVE_CREATED_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function thinkingElapsedMs(input: {
  streaming: boolean
  createdAt?: number
  completedAt?: number
  now: number
  fallbackStart: number
}) {
  if (input.streaming) {
    const created = input.createdAt
    const start =
      created !== undefined && input.now - created <= LIVE_CREATED_MAX_AGE_MS ? created : input.fallbackStart
    return Math.max(0, input.now - start)
  }
  if (input.createdAt === undefined || input.completedAt === undefined) return undefined
  return Math.max(0, input.completedAt - input.createdAt)
}

export function formatThinkingDuration(ms: number, locale: string) {
  const total = Math.max(0, ms) / 1000
  const numfmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  if (total < 60) {
    const tenths = Math.round(total * 10) / 10
    const count = Number.isInteger(tenths)
      ? numfmt.format(tenths)
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(tenths)
    return { kind: "seconds" as const, count }
  }
  return {
    kind: "minutesSeconds" as const,
    minutes: numfmt.format(Math.floor(total / 60)),
    seconds: numfmt.format(Math.round(total % 60)),
  }
}
