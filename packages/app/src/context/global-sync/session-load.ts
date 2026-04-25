import type { RootLoadArgs } from "./types"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  const query = (limit?: number) => ({
    ...(input.filterDirectory === false ? {} : { directory: input.directory }),
    roots: true as const,
    ...(limit ? { limit } : {}),
  })

  try {
    const result = await input.list(query(input.limit))
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list(query())
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
