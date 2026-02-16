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
