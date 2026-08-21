export function formatTaskbarAttentionCount(count: number) {
  if (count <= 0) return undefined
  return count > 99 ? "99+" : String(count)
}
