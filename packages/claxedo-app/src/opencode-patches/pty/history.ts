export function createHistory(limit: number) {
  const chunks: string[] = []
  let total = 0

  const clamp = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(value))
  }

  const trim = () => {
    let excess = total - limit
    if (excess <= 0) return
    while (excess > 0 && chunks.length > 0) {
      const head = chunks[0]
      if (!head) break
      if (head.length <= excess) {
        chunks.shift()
        total -= head.length
        excess -= head.length
        continue
      }
      chunks[0] = head.slice(excess)
      total -= excess
      excess = 0
    }
  }

  return {
    append(data: string) {
      if (!data) return
      if (limit <= 0) return
      chunks.push(data)
      total += data.length
      trim()
    },
    snapshot(max?: number) {
      if (!chunks.length) return ""
      const cap = clamp(max ?? limit)
      if (cap <= 0) return ""
      const joined = chunks.join("")
      if (joined.length <= cap) return joined
      return joined.slice(-cap)
    },
    clear() {
      chunks.length = 0
      total = 0
    },
    size() {
      return total
    },
  }
}
