import type { DisposeCheck, EvictPlan } from "./types"

export function pickDirectoriesToEvict(input: EvictPlan) {
  const overflow = Math.max(0, input.stores.length - input.max)

  // A store is only evictable when the count is over the cap or it has been idle
  // past the TTL; otherwise the scan below cannot produce a candidate.
  if (
    overflow === 0 &&
    !input.stores.some((directory) => input.now - (input.state.get(directory)?.lastAccessAt ?? 0) >= input.ttl)
  )
    return []

  let pendingOverflow = overflow

  const sorted = input.stores
    .filter((dir) => !input.pins.has(dir))
    .slice()
    .sort((a, b) => (input.state.get(a)?.lastAccessAt ?? 0) - (input.state.get(b)?.lastAccessAt ?? 0))

  const output: string[] = []

  for (const dir of sorted) {
    const last = input.state.get(dir)?.lastAccessAt ?? 0
    const idle = input.now - last >= input.ttl

    if (!idle && pendingOverflow <= 0) continue
    output.push(dir)

    if (pendingOverflow > 0) pendingOverflow -= 1
  }

  return output
}

export function canDisposeDirectory(input: DisposeCheck) {
  if (!input.directory) return false

  if (!input.hasStore) return false

  if (input.pinned) return false

  if (input.booting) return false

  if (input.loadingSessions) return false

  return true
}
