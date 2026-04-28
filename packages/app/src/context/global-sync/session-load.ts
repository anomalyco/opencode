import { SESSION_ROOT_PAGE_SIZE, type RootLoadArgs } from "./types"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}

export function nextRootSessionLimit(limit: number | undefined) {
  return (limit ?? 0) + SESSION_ROOT_PAGE_SIZE
}

export function canReuseRootSessionCache(input: {
  cachedRootCount: number
  fetchedLimit: number
  requestedLimit: number
  total: number
}) {
  if (input.fetchedLimit < input.requestedLimit) return false
  if (input.cachedRootCount >= input.requestedLimit) return true
  return input.total <= input.cachedRootCount
}
