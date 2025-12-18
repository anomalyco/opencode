import z from "zod"

type Counts = {
  requests: number
  attempts: number
  rotations: number
  exhausted: number
  refreshAttempts: number
  refreshSuccess: number
  refreshFailure: number
  rateLimited: number
  authExpired: number
}

function emptyCounts(): Counts {
  return {
    requests: 0,
    attempts: 0,
    rotations: 0,
    exhausted: 0,
    refreshAttempts: 0,
    refreshSuccess: 0,
    refreshFailure: 0,
    rateLimited: 0,
    authExpired: 0,
  }
}

function cloneCounts(c: Counts): Counts {
  return { ...c }
}

export namespace RotationStats {
  export const Counts = z
    .object({
      requests: z.number().int(),
      attempts: z.number().int(),
      rotations: z.number().int(),
      exhausted: z.number().int(),
      refreshAttempts: z.number().int(),
      refreshSuccess: z.number().int(),
      refreshFailure: z.number().int(),
      rateLimited: z.number().int(),
      authExpired: z.number().int(),
    })
    .strict()
    .meta({ ref: "RotationStatsCounts" })

  export const Snapshot = z
    .object({
      since: z.number().int(),
      totals: Counts,
      byProvider: z.record(z.string(), Counts),
    })
    .strict()
    .meta({ ref: "RotationStatsSnapshot" })
  export type Snapshot = z.infer<typeof Snapshot>

  const since = Date.now()
  const totals: Counts = emptyCounts()
  const byProvider = new Map<string, Counts>()

  function getProvider(providerId: string): Counts {
    const existing = byProvider.get(providerId)
    if (existing) return existing
    const next = emptyCounts()
    byProvider.set(providerId, next)
    return next
  }

  export function recordRequest(providerId: string) {
    totals.requests++
    getProvider(providerId).requests++
  }

  export function recordAttempt(providerId: string) {
    totals.attempts++
    getProvider(providerId).attempts++
  }

  export function recordRotation(providerId: string, reason: string) {
    totals.rotations++
    const p = getProvider(providerId)
    p.rotations++

    if (reason.includes("rate")) {
      totals.rateLimited++
      p.rateLimited++
    }
    if (reason.includes("auth_expired")) {
      totals.authExpired++
      p.authExpired++
    }
  }

  export function recordExhausted(providerId: string) {
    totals.exhausted++
    getProvider(providerId).exhausted++
  }

  export function recordRefreshAttempt(providerId: string) {
    totals.refreshAttempts++
    getProvider(providerId).refreshAttempts++
  }

  export function recordRefreshSuccess(providerId: string) {
    totals.refreshSuccess++
    getProvider(providerId).refreshSuccess++
  }

  export function recordRefreshFailure(providerId: string) {
    totals.refreshFailure++
    getProvider(providerId).refreshFailure++
  }

  export function snapshot(): Snapshot {
    const out: Record<string, z.infer<typeof Counts>> = {}
    for (const [k, v] of byProvider.entries()) out[k] = cloneCounts(v)
    return {
      since,
      totals: cloneCounts(totals),
      byProvider: out,
    }
  }
}

