export function memo<T>(fn: () => T, cleanup?: (input: T) => Promise<void>) {
  let value: T | undefined
  let loaded = false

  const result = (): T => {
    if (loaded) return value as T
    loaded = true
    value = fn()
    return value as T
  }
  result.reset = async () => {
    if (cleanup && value) await cleanup(value)
    loaded = false
    value = undefined
  }

  return result
}
