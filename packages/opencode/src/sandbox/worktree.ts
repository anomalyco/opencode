import { execSync } from "child_process"
import path from "path"
import fs from "fs"

export interface ShadowWorktree {
  id: string
  branchName: string
  worktreePath: string
  cleanUp: () => void
  createDiff: () => string
  mergeToCurrent: () => boolean
}

export class WorktreeSandboxManager {
  public static create(repoRoot: string, taskId: string): ShadowWorktree | null {
    try {
      const branchName = `ziq-shadow/${taskId}-${Date.now()}`
      const worktreePath = path.join(repoRoot, ".git", "ziq-worktrees", taskId)

      fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

      // Create isolated git worktree branch
      execSync(`git worktree add -b ${branchName} "${worktreePath}" HEAD`, {
        cwd: repoRoot,
        stdio: "ignore",
      })

      const cleanUp = () => {
        try {
          execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoRoot, stdio: "ignore" })
          execSync(`git branch -D ${branchName}`, { cwd: repoRoot, stdio: "ignore" })
        } catch {}
      }

      const createDiff = (): string => {
        try {
          return execSync(`git diff HEAD`, { cwd: worktreePath, encoding: "utf8" })
        } catch {
          return ""
        }
      }

      const mergeToCurrent = (): boolean => {
        try {
          execSync(`git merge --no-ff ${branchName}`, { cwd: repoRoot, stdio: "ignore" })
          cleanUp()
          return true
        } catch {
          return false
        }
      }

      return {
        id: taskId,
        branchName,
        worktreePath,
        cleanUp,
        createDiff,
        mergeToCurrent,
      }
    } catch {
      return null
    }
  }
}
