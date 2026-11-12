export * as Wildcard from "./wildcard.js"

// Compiling the pattern dominates match cost and callers reuse a small set of
// patterns, so compiled expressions are cached per pattern. The platform is
// fixed for the process lifetime, so the pattern alone keys the cache.
const flags = process.platform === "win32" ? "si" : "s"
const MAX_CACHED_PATTERNS = 1_000
const compiled = new Map<string, RegExp>()

function compile(pattern: string) {
  const cached = compiled.get(pattern)
  if (cached) return cached
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  const expression = new RegExp("^" + escaped + "$", flags)
  if (compiled.size >= MAX_CACHED_PATTERNS) {
    const oldest = compiled.keys().next()
    if (!oldest.done) compiled.delete(oldest.value)
  }
  compiled.set(pattern, expression)
  return expression
}

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  return compile(pattern).test(normalized)
}
