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

/** Pinned tabs hold the top of the strip; each section keeps its own stored order. */
export function pinnedFirst<T>(tabs: T[], key: (tab: T) => string, pinned: (key: string) => boolean) {
  const head: T[] = []
  const tail: T[] = []

  for (const tab of tabs) {
    if (pinned(key(tab))) head.push(tab)
    else tail.push(tab)
  }

  return [...head, ...tail]
}
