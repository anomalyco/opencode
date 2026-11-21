import type { FileContent } from "@opencode/plugin/gui"

const MAX_FILE_CONTENT_ENTRIES = 40

const MAX_FILE_CONTENT_BYTES = 20 * 1024 * 1024

export function approxBytes(content: FileContent) {
  const patchBytes =
    content.patch?.hunks.reduce((sum, hunk) => {
      return sum + hunk.lines.reduce((lineSum, line) => lineSum + line.length, 0)
    }, 0) ?? 0

  // V8 keeps an ASCII string such as base64 at one byte per character; other text may take two.
  const body = content.bytes?.byteLength ?? content.content.length * (content.encoding === "base64" ? 1 : 2)

  return body + ((content.diff?.length ?? 0) + patchBytes) * 2
}

// One file provider's content budget, in recency order. Each provider owns one, so a provider that resets or evicts
// never touches another provider's accounting.
export function createFileContentCache() {
  const lru = new Map<string, number>()
  let total = 0

  const touch = (path: string, bytes?: number) => {
    const prev = lru.get(path)

    if (prev === undefined && bytes === undefined) return
    const next = bytes ?? prev ?? 0
    lru.delete(path)
    lru.set(path, next)
    total += next - (prev ?? 0)
  }

  const remove = (path: string) => {
    const prev = lru.get(path)

    if (prev === undefined) return
    lru.delete(path)
    total -= prev
  }

  return {
    touch,
    remove,
    reset: () => {
      lru.clear()
      total = 0
    },
    // Drops the oldest entries until the cache fits, rotating protected ones to the newest end, and returns what it
    // dropped. One pass over the entries bounds the loop, so protected entries alone over budget cannot spin it.
    evict: (keep?: ReadonlySet<string>) => {
      const evicted: string[] = []
      let remaining = lru.size

      while (remaining > 0 && (lru.size > MAX_FILE_CONTENT_ENTRIES || total > MAX_FILE_CONTENT_BYTES)) {
        remaining -= 1
        const path = lru.keys().next().value

        if (path === undefined) break

        if (keep?.has(path)) {
          touch(path)
          continue
        }

        remove(path)
        evicted.push(path)
      }

      return evicted
    },
  }
}
