// Tiny content-addressed file cache for skills. The audit found "zero cache" across every skill;
// expensive *pure* computations (parsing, rendering) should memoize by input hash. Local fs only.

import path from "node:path"

export type Cache = {
  hash: (input: string) => string
  get: (key: string) => Promise<string | undefined>
  set: (key: string, value: string) => Promise<void>
}

export function fileCache(dir: string): Cache {
  return {
    hash: (input) => Bun.hash(input).toString(16),
    get: async (key) => {
      const file = Bun.file(path.join(dir, key))
      return (await file.exists()) ? file.text() : undefined
    },
    set: async (key, value) => {
      await Bun.write(path.join(dir, key), value)
    },
  }
}

// Memoize a pure async producer through the cache. Returns the cached value on a hit, otherwise runs
// `produce`, stores, and returns it.
export async function memoize(cache: Cache, input: string, produce: () => Promise<string>) {
  const key = cache.hash(input)
  const hit = await cache.get(key)
  if (hit !== undefined) return hit
  const value = await produce()
  await cache.set(key, value)
  return value
}
