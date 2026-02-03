import { sortBy, pipe } from "remeda"

export namespace Wildcard {
  export function match(str: string, pattern: string) {
    let escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
      .replace(/\*/g, ".*") // * becomes .*
      .replace(/\?/g, ".") // ? becomes .

    // If pattern ends with " *" (space + wildcard), make the trailing part optional
    // This allows "ls *" to match both "ls" and "ls -la"
    if (escaped.endsWith(" .*")) {
      escaped = escaped.slice(0, -3) + "( .*)?"
    }

    return new RegExp("^" + escaped + "$", "s").test(str)
  }

  export function all(input: string, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      if (match(input, pattern)) {
        result = value
        continue
      }
    }
    return result
  }

  export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result = undefined
    for (const [pattern, value] of sorted) {
      const parts = pattern.split(/\s+/)
      if (!match(input.head, parts[0])) continue
      if (parts.length === 1 || matchSequence(input.tail, parts.slice(1))) {
        result = value
        continue
      }
    }
    return result
  }

  function matchSequence(items: string[], patterns: string[]): boolean {
    if (patterns.length === 0) return true
    const [pattern, ...rest] = patterns
    if (pattern === "*") return matchSequence(items, rest)
    for (let i = 0; i < items.length; i++) {
      if (match(items[i], pattern) && matchSequence(items.slice(i + 1), rest)) {
        return true
      }
    }
    return false
  }
}
