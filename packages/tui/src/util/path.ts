import { realpathSync } from "node:fs"
import { win32 } from "node:path"

export function normalizePath(input: string, platform: string) {
  if (platform !== "win32") return input
  const resolved = win32.normalize(win32.resolve(input.replaceAll("/", "\\")))
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}
