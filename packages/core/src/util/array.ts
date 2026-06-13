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
