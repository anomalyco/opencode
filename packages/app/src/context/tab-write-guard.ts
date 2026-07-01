// Controlled Kobalte <Tabs> re-emits onChange with a stale key during programmatic
// active-tab changes; guard so the Tabs onChange ignores that feedback. Reset on a
// microtask to cover the store write's reactive flush.
export function createTabWriteGuard() {
  let depth = 0
  const runTabWrite = <T>(fn: () => T): T => {
    depth++
    try {
      return fn()
    } finally {
      queueMicrotask(() => {
        depth--
      })
    }
  }
  return { runTabWrite, tabsWriting: () => depth > 0 }
}
