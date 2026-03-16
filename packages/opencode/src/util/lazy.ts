/**
 * Creates a lazy-initialized value wrapper.
 *
 * Delays execution of the initializer function until the value is first accessed.
 * Caches the result and returns it on subsequent calls. Includes reset capability.
 *
 * @param fn The initializer function that produces the value
 * @returns A function that returns the cached value, with a reset method
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
