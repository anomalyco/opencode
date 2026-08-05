import { getTreeSitterClient, type TreeSitterClient } from "@opentui/core"

const CACHE_SIZE = 500
const installed = new WeakSet<TreeSitterClient>()

export function installSyntaxHighlightCache() {
  const client = getTreeSitterClient()
  if (installed.has(client)) return
  installed.add(client)
  client.highlightOnce = cacheHighlights(client.highlightOnce.bind(client))
}

export function cacheHighlights(highlight: TreeSitterClient["highlightOnce"], capacity = CACHE_SIZE) {
  const cache = new Map<string, ReturnType<TreeSitterClient["highlightOnce"]>>()

  return (content: string, filetype: string) => {
    const key = `${filetype}\0${content}`
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }

    const result = highlight(content, filetype)
    cache.set(key, result)
    if (cache.size > capacity) cache.delete(cache.keys().next().value!)

    void result
      .then((value) => {
        if (value.error && cache.get(key) === result) cache.delete(key)
      })
      .catch(() => {
        if (cache.get(key) === result) cache.delete(key)
      })
    return result
  }
}
