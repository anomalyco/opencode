export * as Wildcard from "./wildcard.js"

/** Windows always matches without case; `ignoreCase` extends that to other callers, such as file rules on macOS. */
export function match(input: string, pattern: string, ignoreCase = false) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" || ignoreCase ? "si" : "s").test(normalized)
}
