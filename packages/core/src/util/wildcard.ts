export * as Wildcard from "./wildcard"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  // Handle **/ before escaping: replace with placeholder so it survives special-char escaping.
  // Standard glob: **/ means "zero or more directory segments (with trailing slash)".
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/\*\*\//g, "\x01")                 // 1. stash **/ as control char
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")       // 2. escape regex special chars
    .replace(/\*/g, ".*")                         // 3. single * → .*
    .replace(/\?/g, ".")                          // 4. ? → .
    .replace(/\x01/g, "(.*/)?")                  // 5. expand **/ → optional path prefix (must be last)

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}
