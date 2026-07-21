// Most-recently-used (MRU) ordering for top-level tabs. The order is a list of
// tab keys, most-recent first. Ctrl+Tab walks it like a browser: repeated
// presses step further back through visit history and the order only commits
// once the modifier is released, so a burst walks the full history instead of
// bouncing between the two most recent tabs.

export function promoteOrder(order: string[], key: string): string[] {
  const next = order.filter((item) => item !== key)
  next.unshift(key)
  return next
}

// Keeps only keys for still-open tabs, preserving MRU order and appending
// newly-seen keys at the back so they can still be cycled to.
export function reconcileOrder(order: string[], keys: string[]): string[] {
  const open = new Set(keys)
  const seen = new Set<string>()
  const next: string[] = []
  for (const key of order) {
    if (!open.has(key) || seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  return next
}

// Steps `offset` positions through the MRU list from `active` (positive walks
// toward older tabs, negative toward newer), wrapping around. Anchoring on
// `active` lets a fresh cycle start from the current tab even before the order
// has committed it to the front.
export function stepOrder(order: string[], active: string | undefined, offset: number): string | undefined {
  if (order.length === 0) return undefined
  const anchor = active !== undefined && order.includes(active) ? active : order[0]
  const start = anchor !== undefined ? order.indexOf(anchor) : 0
  const index = (((start + offset) % order.length) + order.length) % order.length
  return order[index]
}
