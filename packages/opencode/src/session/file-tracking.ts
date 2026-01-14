import { Log } from "@/util/log"

export namespace FileTracking {
  const log = Log.create({ service: "file-tracking" })

  // Session-scoped tracking of files modified by git operations
  // These files should be excluded from the session diff
  const gitModifiedFiles = new Map<string, Set<string>>()

  /**
   * Register files that were modified by a git operation (pull, merge, checkout, etc.)
   * These files will be excluded from the session diff calculation
   */
  export function addGitModified(sessionID: string, files: string[]) {
    if (!files.length) return
    let set = gitModifiedFiles.get(sessionID)
    if (!set) {
      set = new Set()
      gitModifiedFiles.set(sessionID, set)
    }
    for (const file of files) {
      set.add(file)
    }
    log.info("git modified files added", { sessionID, count: files.length, files: files.slice(0, 5) })
  }

  /**
   * Get all files modified by git operations in a session
   */
  export function getGitModified(sessionID: string): Set<string> {
    return gitModifiedFiles.get(sessionID) ?? new Set()
  }

  /**
   * Clear git-modified files for a session (called when session is cleaned up)
   */
  export function clear(sessionID: string) {
    gitModifiedFiles.delete(sessionID)
    log.info("cleared file tracking", { sessionID })
  }

  /**
   * Check if a file was modified by a git operation
   */
  export function isGitModified(sessionID: string, file: string): boolean {
    return gitModifiedFiles.get(sessionID)?.has(file) ?? false
  }
}
