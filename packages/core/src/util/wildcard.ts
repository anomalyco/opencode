export * as Wildcard from "./wildcard"

// Permission checks run match() per rule per command (findLast over the
// ruleset), so compiling the pattern regex on every call showed up as pure
// overhead in that hot path. Cache the compiled regex per pattern instead;
// patterns come from config, so the working set is small, but bound the cache
// anyway so pathological pattern churn cannot grow it without limit.
const MAX_CACHE = 512
const cache = new Map<string, RegExp>()

function compile(pattern: string) {
  const flags = process.platform === "win32" ? "si" : "s"
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

export function match(input: string, pattern: string) {
  return compile(pattern).test(input.replaceAll("\\", "/"))
}
