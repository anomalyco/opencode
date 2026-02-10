import type { RootLoadArgs } from "@/context/global-sync/types"

export const SESSION_CACHE_FRESH_MS = 2 * 60 * 1000

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    input.onFallback()
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function shouldUseSessionCache(input: {
  at: number
  now: number
  cachedLimit: number
  requestedLimit: number
  sessionCount: number
  freshMs?: number
}) {
  if (input.sessionCount <= 0) return false
  if (!Number.isFinite(input.at) || input.at <= 0) return false
  if (input.cachedLimit < input.requestedLimit) return false
  const freshMs = input.freshMs ?? SESSION_CACHE_FRESH_MS
  if (!Number.isFinite(freshMs) || freshMs <= 0) return false
  return input.now - input.at <= freshMs
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
