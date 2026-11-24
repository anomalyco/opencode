export function filterVirtualIndexes(indexes: number[], count: number) {
  return indexes.filter((index) => index >= 0 && index < count)
}

/**
 * Whether a row's resize moves the scroll offset with it, so the rows the reader sees stay put: a row before the first
 * one TanStack counts as visible, or one that ends above `fold`, the lower edge of the sticky session header. TanStack
 * counts a row under the header as visible, but the reader cannot see it, and its growth would push a prompt that was
 * just revealed below the header down the screen.
 */
export function isAboveFold(item: { index: number; end: number }, first: number | undefined, fold: number) {
  if (first === undefined) return false

  return item.index < first || item.end <= fold
}
