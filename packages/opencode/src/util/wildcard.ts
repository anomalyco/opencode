import { sortBy, pipe } from "remeda"

export namespace Wildcard {
  export function match(str: string, pattern: string) {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
          .replace(/\*/g, ".*") // * becomes .*
          .replace(/\?/g, ".") + // ? becomes .
        "$",
      "s", // s flag enables multiline matching
    )
    return regex.test(str)
  }

  /**
   * Match a file path against a glob pattern with proper path semantics.
   * - `*` matches any characters except path separators (/ or \)
   * - `**` matches any characters including path separators (recursive)
   * - `?` matches a single character except path separators
   */
  export function pathMatch(filepath: string, pattern: string): boolean {
    // Normalize separators to forward slash for matching
    const normalizedPath = filepath.replace(/\\/g, "/")
    const normalizedPattern = pattern.replace(/\\/g, "/")

    // Build regex from pattern
    let regex = "^"
    let i = 0
    while (i < normalizedPattern.length) {
      const char = normalizedPattern[i]
      const next = normalizedPattern[i + 1]

      if (char === "*" && next === "*") {
        // ** matches zero or more path segments
        i += 2
        if (normalizedPattern[i] === "/") {
          // **/ means "zero or more directories followed by /"
          regex += "(?:.*/)?"
          i++
        } else {
          // ** at end or before non-slash matches anything
          regex += ".*"
        }
      } else if (char === "*") {
        // * matches anything except slashes
        regex += "[^/]*"
        i++
      } else if (char === "?") {
        // ? matches single char except slash
        regex += "[^/]"
        i++
      } else if (".+^${}()|[]\\".includes(char)) {
        // Escape regex special chars
        regex += "\\" + char
        i++
      } else {
        regex += char
        i++
      }
    }
    regex += "$"

    return new RegExp(regex).test(normalizedPath)
  }

  /**
   * Find the best matching pattern for a file path.
   * Uses pathMatch() for proper glob semantics. Longer patterns take precedence.
   */
  export function pathAll<T>(filepath: string, patterns: Record<string, T>): T | undefined {
    const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
    let result: T | undefined = undefined
    for (const [pattern, value] of sorted) {
      if (pathMatch(filepath, pattern)) {
        result = value
      }
    }
    return result
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
