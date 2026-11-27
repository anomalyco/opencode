export * as Wildcard from "./wildcard.js"

/**
 * Whether `input` matches a permission pattern, as core matches the rules of a permission check. This is a private
 * copy of `match` in `packages/core/src/util/wildcard.ts`: this package cannot import core, and the rule it picks for
 * a browser call must be the rule core would pick. Port a change to that file here; `test/wildcard.test.ts` pins
 * the cases.
 *
 * Core ignores case on Windows by reading the platform itself. Here the caller says so: pass `ignoreCase` as true
 * when the server runs on Windows.
 */
export function match(input: string, pattern: string, ignoreCase: boolean) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", ignoreCase ? "si" : "s").test(normalized)
}
