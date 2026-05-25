import { onCleanup } from "solid-js"

export function createRefCountMap<T>(create: (key: string) => T) {
  const items = new Map<string, T>()
  const refCounts = new Map<string, number>()

  return (key: string) => {
    onCleanup(() => {
      refCounts.set(key, (refCounts.get(key) ?? 0) - 1)
      if (refCounts.get(key) === 0) {
        items.delete(key)
        refCounts.delete(key)
      }
    })

    const cached = items.get(key)
    if (cached) {
      refCounts.set(key, (refCounts.get(key) ?? 0) + 1)
      return cached
    }
    const item = create(key)
    items.set(key, item)
    refCounts.set(key, 1)
    return item
  }
}
