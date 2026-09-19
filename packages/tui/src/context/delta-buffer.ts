export type PendingDelta = {
  kind: string
  sessionID: string
  messageID: string
  partID: string
  delta: string
}

/**
 * Coalesces per-part stream deltas so a fast token stream rewrites shared store
 * state at most once per scheduled flush instead of once per event. Reasoning
 * blocks can stream thousands of deltas; applying each one immediately keeps
 * re-rendering the accumulating text, which stalls the UI while expanded.
 */
export function createDeltaBuffer(schedule: (flush: () => void) => void, apply: (item: PendingDelta) => void) {
  let pending = new Map<string, PendingDelta>()
  let scheduled = false

  const flush = () => {
    scheduled = false
    if (pending.size === 0) return
    const items = [...pending.values()]
    pending = new Map()
    for (const item of items) apply(item)
  }

  return {
    push(input: PendingDelta) {
      const key = `${input.kind}:${input.sessionID}:${input.messageID}:${input.partID}`
      const existing = pending.get(key)
      if (existing) existing.delta += input.delta
      else pending.set(key, { ...input })
      if (!scheduled) {
        scheduled = true
        schedule(flush)
      }
    },
    // Apply anything pending immediately so terminating events that replace the
    // full text (text/reasoning/tool-input ended) observe the final deltas.
    drain() {
      flush()
    },
    // Discard pending deltas matched by `predicate` without applying them. Used
    // when an authoritative full-part event (message.part.updated/removed,
    // message.removed) supersedes streamed deltas so they are never applied to
    // the already-replaced text.
    drop(predicate: (item: PendingDelta) => boolean) {
      for (const [key, item] of pending) {
        if (predicate(item)) pending.delete(key)
      }
    },
  }
}
