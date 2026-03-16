import type { Session } from "@opencode-ai/sdk/v2/client"
import type { RootLoadArgs } from "./types"

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

export async function loadChildSessions(input: {
  directory: string
  root: Session[]
  children: (query: { directory: string; sessionID: string }) => Promise<{ data?: Session[] }>
}) {
  const seen = new Set(input.root.map((item) => item.id))
  const result: Session[] = []
  let ids = input.root.map((item) => item.id)

  while (ids.length > 0) {
    const rows = await Promise.all(ids.map((sessionID) => input.children({ directory: input.directory, sessionID })))
    const next = [] as string[]

    for (const row of rows) {
      for (const item of row.data ?? []) {
        if (!item?.id || item.time?.archived || seen.has(item.id)) continue
        seen.add(item.id)
        result.push(item)
        next.push(item.id)
      }
    }

    ids = next
  }

  return result
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
