/**
 * Creates a lazy-initialized value that is computed on first access.
 *
 * The initialization function is called only once when the value is first needed.
 * Supports resetting the cached value to force re-computation.
 *
 * @param fn - The function that computes the value
 * @returns A function that returns the cached value, with a reset method
 *
 * @example
 * ```typescript
 * const getData = lazy(() => loadFromDisk())
 * const data1 = getData() // First call computes value
 * const data2 = getData() // Returns cached value
 * getData.reset()         // Clear cache
 * const data3 = getData() // Re-computes value
 * ```
 */
export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  const result = (): T => {
    if (loaded) return value as T
    try {
      value = fn()
      loaded = true
      return value as T
    } catch (e) {
      // Don't mark as loaded if initialization failed
      throw e
    }
  }

  result.reset = () => {
    loaded = false
    value = undefined
  }

  return result
}
