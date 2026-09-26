import { onCleanup } from "solid-js"

export function createRefCountMap<T>(
  create: (key: string) => T,
  remove?: (key: string) => void,
  identity: (key: string) => string = (key) => key,
) {
  const items = new Map<string, T>()
  const refCounts = new Map<string, number>()

  return (key: string) => {
    const id = identity(key)
    onCleanup(() => {
      refCounts.set(id, (refCounts.get(id) ?? 0) - 1)
      if (refCounts.get(id) === 0) {
        remove?.(id)
        items.delete(id)
        refCounts.delete(id)
      }
    })

    const cached = items.get(id)
    if (cached) {
      refCounts.set(id, (refCounts.get(id) ?? 0) + 1)
      return cached
    }
    const item = create(key)
    items.set(id, item)
    refCounts.set(id, 1)
    return item
  }
}
