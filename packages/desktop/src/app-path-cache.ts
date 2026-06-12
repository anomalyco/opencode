export const APP_PATH_CACHE_LIMIT = 32

// Keep storage flat under high churn; this cache is small enough that linear lookup is cheaper than Map retention.
type AppPathCache = {
  keys: string[]
  values: string[]
}

export function createAppPathCache(): AppPathCache {
  return { keys: [], values: [] }
}

export function getAppPath(cache: AppPathCache, key: string) {
  const index = indexOfAppPath(cache, key)
  return index >= 0 ? cache.values[index] : undefined
}

export function forgetAppPath(cache: AppPathCache, key: string) {
  const index = indexOfAppPath(cache, key)
  if (index < 0) return
  cache.keys.splice(index, 1)
  cache.values.splice(index, 1)
}

export function rememberAppPath(cache: AppPathCache, key: string, value: string) {
  const index = indexOfAppPath(cache, key)
  if (index >= 0) {
    cache.values[index] = value
    return value
  }

  if (cache.keys.length >= APP_PATH_CACHE_LIMIT) {
    cache.keys.shift()
    cache.values.shift()
  }
  cache.keys.push(key)
  cache.values.push(value)
  return value
}

function indexOfAppPath(cache: AppPathCache, key: string) {
  return cache.keys.indexOf(key)
}
