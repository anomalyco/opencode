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
}
