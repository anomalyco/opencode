import os from "os"
import path from "path"

/**
 * FFF refuses to index the user's home directory or filesystem roots.
 * Skip the FFF init attempt entirely in those cases instead of logging a
 * warning on every opencode boot from $HOME (or a small project dir whose
 * parent is $HOME). Falls back to the ripgrep layer, which works fine.
 */
export function isUnsupportedByFff(directory: string): boolean {
  const resolved = path.resolve(directory)
  const home = os.homedir()
  if (resolved === home || resolved === path.dirname(home)) return true
  if (process.platform !== "win32" && resolved === "/") return true
  return false
}
