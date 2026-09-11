import type { Renderable } from "@opentui/core"

type Anchor = {
  messageID: string
  target: Pick<Renderable, "y" | "isDestroyed">
  /** Logical leaf position, even when this target is a collapsed ancestor. */
  path: () => readonly number[]
  level: number
  /** Returns true when revealing the target requires another layout pass. */
  reveal?: () => boolean
}

/** Mounted renderables own geometry; the registry only locates message targets. */
export function createMessageAnchors() {
  const entries = new Map<string, Set<Anchor>>()
  const get = (messageID: string) => {
    const candidates = entries.get(messageID)
    if (!candidates) return
    return [...candidates]
      .filter((anchor) => !anchor.target.isDestroyed)
      .sort((a, b) => comparePaths(a.path(), b.path()) || b.level - a.level)[0]
  }
  return {
    register(anchor: Anchor) {
      const candidates = entries.get(anchor.messageID) ?? new Set<Anchor>()
      candidates.add(anchor)
      entries.set(anchor.messageID, candidates)
      return () => {
        candidates.delete(anchor)
        if (!candidates.size && entries.get(anchor.messageID) === candidates) entries.delete(anchor.messageID)
      }
    },
    get,
    list() {
      return [...entries.keys()]
        .flatMap((id) => {
          const anchor = get(id)
          return anchor ? [anchor] : []
        })
        .sort((a, b) => comparePaths(a.path(), b.path()))
    },
  }
}

function comparePaths(a: readonly number[], b: readonly number[]) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index] - b[index]
    if (difference) return difference
  }
  return a.length - b.length
}
