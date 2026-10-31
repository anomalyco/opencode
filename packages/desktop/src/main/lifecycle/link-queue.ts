const MAX_PENDING = 16

// Links wait per page until that page asks for them, so each link reaches one page once: a new
// window or a reload never replays links an earlier page already received.
export function createLinkQueue<Key>() {
  const pending = new Map<Key, string[]>()
  const listening = new Set<Key>()

  return {
    /** Queues a link for a page; true when the page is listening and the link should be sent now. */
    push(key: Key, url: string) {
      if (listening.has(key)) return true
      pending.set(key, [...(pending.get(key) ?? []), url].slice(-MAX_PENDING))

      return false
    },
    /** The page asked for its links: hand over what waited and send the rest live. */
    take(key: Key) {
      listening.add(key)
      const urls = pending.get(key) ?? []
      pending.delete(key)

      return urls
    },
    /** The page is navigating away; links wait for the next one to ask. */
    unload(key: Key) {
      listening.delete(key)
    },
    close(key: Key) {
      listening.delete(key)
      pending.delete(key)
    },
  }
}
