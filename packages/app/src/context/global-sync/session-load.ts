import type { RootLoadArgs } from "./types"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    // Load root sessions (no parent)
    const rootResult = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    // Also load child sessions (workers with parentID) so they survive cold start
    const allResult = await input.list({ directory: input.directory, limit: input.limit })
    const rootIds = new Set((rootResult.data ?? []).map((s) => s.id))
    const children = (allResult.data ?? []).filter((s) => !rootIds.has(s.id) && !!s.parentID)
    return {
      data: [...(rootResult.data ?? []), ...children],
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
