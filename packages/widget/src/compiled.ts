import { Runtime } from "psychoscript"
import { TYPED_ARRAYS } from "./host.js"

// Programs compiled once and run many times: a step or a live run of the same program text skips parsing and compiling
// it again. A compiled program runs in any runtime, so one serves every widget of a widget template version.
const LIMIT = 32
const cache = new Map<string, Runtime.Compiled>()
const compiler = Runtime.make({ typedArrays: TYPED_ARRAYS })

/**
 * `code` compiled, from the cache when it was compiled before. Code that doesn't compile is given back as it is: running
 * it fails as it always did.
 */
export function compiled(code: string): Runtime.Compiled | string {
  const found = cache.get(code)
  if (found !== undefined) {
    // Least recently used first: the oldest entry goes when the cache is full.
    cache.delete(code)
    cache.set(code, found)
    return found
  }
  const result = compiler.compile(code)
  if (!result.ok) return code
  if (cache.size >= LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(code, result.compiled)
  return result.compiled
}
