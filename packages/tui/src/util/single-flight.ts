export function createSingleFlight<Key>() {
  const pending = new Set<Key>()
  return async <Value>(key: Key, run: () => Promise<Value>) => {
    if (pending.has(key)) return
    pending.add(key)
    try {
      return await run()
    } finally {
      pending.delete(key)
    }
  }
}
