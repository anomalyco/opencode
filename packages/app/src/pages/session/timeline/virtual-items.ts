export function filterVirtualIndexes(indexes: number[], count: number) {
  return indexes.filter((index) => index >= 0 && index < count)
}
