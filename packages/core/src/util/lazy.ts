export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    if (loaded) return value as T
    // Only memoize once fn() returns. Marking loaded up front caches `undefined`
    // forever when the initializer throws, so a transient failure is permanent.
    const next = fn()
    value = next
    loaded = true
    return next
  }
}
