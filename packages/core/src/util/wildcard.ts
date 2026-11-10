export * as Wildcard from "./wildcard.js"

// Tool.snapshot matches tools x rules on every provider step, so reuse compiled patterns.
const CACHE_LIMIT = 1024
const cache = new Map<string, RegExp>()

export function match(input: string, pattern: string) {
  let regex = cache.get(pattern)
  if (regex === undefined) {
    let escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")

    if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

    regex = new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s")
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(pattern, regex)
  }
  return regex.test(input.replaceAll("\\", "/"))
}
