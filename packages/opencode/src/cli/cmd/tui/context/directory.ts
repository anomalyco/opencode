import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

/**
 * Returns a memoized display string for the current directory.
 *
 * Combines the current working directory (with home directory replaced by ~)
 * and the VCS branch name (if available) for display in the TUI.
 *
 * @returns A SolidJS memo that returns the formatted directory string
 *
 * @example
 * ```typescript
 * const directory = useDirectory()
 * // Returns: "~/projects/myapp:main" (if in git repo on main branch)
 * // Returns: "~/projects/myapp" (if not in a git repo)
 * ```
 */
export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
