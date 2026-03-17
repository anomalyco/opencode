import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

/**
 * Returns a memoized directory string for display in the TUI.
 *
 * Combines the current working directory (with home path replaced by ~)
 * with the current VCS branch name if available. The result is reactive
 * and updates when the sync data changes.
 *
 * @returns A SolidJS memo containing the formatted directory string
 * @example
 * ```typescript
 * const directory = useDirectory()
 * console.log(directory()) // "~/projects/myproject:main"
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
