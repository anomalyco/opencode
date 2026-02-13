import { existsSync } from "fs"
import { resolve } from "path"
import { homedir } from "os"

export function resolveCwd(
  cwdOverride: string | undefined,
  workspacePath: string | undefined,
): string {
  // If no override, use workspace or homedir
  if (!cwdOverride) {
    if (workspacePath && existsSync(workspacePath)) return workspacePath
    return homedir()
  }

  // Absolute path
  if (cwdOverride.startsWith("/") || /^[a-zA-Z]:\\/.test(cwdOverride)) {
    if (existsSync(cwdOverride)) return cwdOverride
    if (workspacePath && existsSync(workspacePath)) return workspacePath
    return homedir()
  }

  // Relative path - resolve against workspace
  if (workspacePath) {
    const resolved = resolve(workspacePath, cwdOverride)
    if (existsSync(resolved)) return resolved
    if (existsSync(workspacePath)) return workspacePath
  }

  return homedir()
}
