export * as Wildcard from "./wildcard"

/**
 * Glob-style matcher used for permission rules and path matching.
 *
 * Semantics (intentional):
 * - `*` matches any run of characters, `?` matches a single character.
 * - Backslashes are normalized to `/` on both sides so Windows and POSIX paths
 *   compare equally.
 * - A trailing ` *` (space + star) is made optional, so a rule like `git push *`
 *   also matches the bare command `git push`.
 * - Case sensitivity is platform-dependent: case-INsensitive on Windows (`si`)
 *   and case-SENSITIVE elsewhere (`s`). This mirrors real OS behavior — Windows
 *   paths and commands are case-insensitive, POSIX ones are not — so a deny rule
 *   such as `RM *` intentionally does NOT match `rm` on Linux/macOS. Author rules
 *   in the casing that matches the target platform.
 */
export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}
