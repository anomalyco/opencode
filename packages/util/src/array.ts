export function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

export function findLast<T>(
  items: readonly T[],
  predicate: (item: T, index: number, items: readonly T[]) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (predicate(item, i, items)) return item
  }
  return undefined
}
