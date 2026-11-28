export * as Wildcard from "./wildcard.js"

const MAX_CACHE = 512
const cache = new Map<string, RegExp>()

/** Windows always matches without case; `ignoreCase` extends that to other callers, such as file rules on macOS. */
export function match(input: string, pattern: string, ignoreCase = false) {
  const flags = process.platform === "win32" || ignoreCase ? "si" : "s"
  return compile(pattern, flags).test(input.replaceAll("\\", "/"))
}

// Permission and Tool.snapshot scan the same config patterns on every step.
// Cache compiled regexes by pattern plus flags so win32 / ignoreCase stay distinct, and evict the oldest entry when full.
function compile(pattern: string, flags: string) {
  const key = flags + "\0" + pattern
  const hit = cache.get(key)
  if (hit) return hit
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  const regex = new RegExp("^" + escaped + "$", flags)
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, regex)
  return regex
}
