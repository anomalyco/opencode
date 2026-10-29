/** The nearest other tab in the offset's direction, wrapping around, that `include` accepts. */
export function adjacentTabKey(
  order: string[],
  current: string | undefined,
  offset: -1 | 1,
  include: (key: string) => boolean = () => true,
) {
  if (!current) return
  const index = order.indexOf(current)

  if (index === -1) return

  return Array.from(
    { length: order.length - 1 },
    (_, step) => order[(index + offset * (step + 1) + order.length) % order.length],
  ).find(include)
}

export function mergeVisibleTabOrder(all: string[], current: string[], next: string[]) {
  const visible = new Set(current)
  const reordered = next.values()

  return all.map((key) => (visible.has(key) ? (reordered.next().value ?? key) : key))
}

/**
 * Newest activity first. Tabs without a known time fall after the ones that have one, and ties keep
 * their stored order so a strip that has no activity yet does not reshuffle.
 */
export function orderTabsByRecency<T>(tabs: readonly T[], time: (tab: T) => number | undefined): T[] {
  return tabs
    .map((tab, index) => ({ tab, index, time: time(tab) }))
    .toSorted((a, b) => (b.time ?? -1) - (a.time ?? -1) || a.index - b.index)
    .map((entry) => entry.tab)
}
