export * as Wildcard from "./wildcard.js"

/**
 * Whether `input` matches a permission pattern: `*` is any run of characters, `?` one character, a trailing ` *` also
 * matches nothing, and backslashes count as slashes. `ignoreCase` is for servers on Windows, whose paths ignore case.
 */
export function match(input: string, pattern: string, ignoreCase: boolean) {
  const escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  const source = escaped.endsWith(" .*") ? escaped.slice(0, -3) + "( .*)?" : escaped

  return new RegExp("^" + source + "$", ignoreCase ? "si" : "s").test(input.replaceAll("\\", "/"))
}
