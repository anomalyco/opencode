import { $ } from "bun"
import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Session } from "."
import { Snapshot } from "@/snapshot"
import type { MessageV2 } from "./message-v2"

export namespace UserDiff {
  const log = Log.create({ service: "user-diff" })

  export const LIMITS = {
    maxFiles: 50,
    maxTotalSize: 10000,
    maxFileSize: 2000,
  } as const

  const IGNORE_PATTERNS = [
    "node_modules/",
    "dist/",
    "build/",
    ".next/",
    ".nuxt/",
    ".output/",
    "coverage/",
    ".git/",
    "bun.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "*.min.js",
    "*.min.css",
    "*.map",
  ]

  export interface FileChange {
    file: string
    status: "added" | "modified" | "deleted"
    additions: number
    deletions: number
  }

  export interface UserDiffResult {
    files: FileChange[]
    truncated: boolean
    summary?: {
      added: number
      modified: number
      deleted: number
      skipped: number
      totalAdditions: number
      totalDeletions: number
    }
    snapshot: string
  }

  function gitdir() {
    return path.join(Global.Path.data, "snapshot", Instance.project.id)
  }

  function shouldIgnore(file: string): boolean {
    return IGNORE_PATTERNS.some((pattern) => {
      if (pattern.endsWith("/")) {
        return file.includes(pattern) || file.startsWith(pattern.slice(0, -1))
      }
      if (pattern.startsWith("*")) {
        return file.endsWith(pattern.slice(1))
      }
      return file === pattern
    })
  }

  export async function compute(lastSnapshot: string): Promise<UserDiffResult | undefined> {
    if (Instance.project.vcs !== "git") return undefined

    const git = gitdir()

    // Stage current changes to compare
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()

    // Get list of changed files with stats
    const result =
      await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${lastSnapshot} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to compute user diff", { snapshot: lastSnapshot, exitCode: result.exitCode })
      return undefined
    }

    const text = result.text().trim()
    if (!text) {
      log.info("no user changes detected")
      return undefined
    }

    const lines = text.split("\n").filter(Boolean)
    const allFiles: FileChange[] = []
    let skipped = 0

    for (const line of lines) {
      const [addStr, delStr, file] = line.split("\t")
      if (!file) continue

      if (shouldIgnore(file)) {
        skipped++
        continue
      }

      const isBinary = addStr === "-" && delStr === "-"
      const additions = isBinary ? 0 : parseInt(addStr) || 0
      const deletions = isBinary ? 0 : parseInt(delStr) || 0

      // Determine status
      let status: "added" | "modified" | "deleted"
      if (deletions === 0 && additions > 0) {
        // Check if file existed in old snapshot
        const check = await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${lastSnapshot} -- ${file}`
          .quiet()
          .cwd(Instance.directory)
          .nothrow()
        status = check.text().trim() ? "modified" : "added"
      } else if (additions === 0 && deletions > 0) {
        // Check if file exists now
        const exists = await Bun.file(path.join(Instance.worktree, file)).exists()
        status = exists ? "modified" : "deleted"
      } else {
        status = "modified"
      }

      allFiles.push({ file, status, additions, deletions })
    }

    if (allFiles.length === 0) {
      log.info("no relevant user changes after filtering")
      return undefined
    }

    // Sort by total changes (additions + deletions) descending
    allFiles.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))

    // Apply limits
    const truncated = allFiles.length > LIMITS.maxFiles
    const files = allFiles.slice(0, LIMITS.maxFiles)

    // Calculate summary
    const summary = {
      added: allFiles.filter((f) => f.status === "added").length,
      modified: allFiles.filter((f) => f.status === "modified").length,
      deleted: allFiles.filter((f) => f.status === "deleted").length,
      skipped,
      totalAdditions: allFiles.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: allFiles.reduce((sum, f) => sum + f.deletions, 0),
    }

    log.info("computed user diff", {
      files: files.length,
      totalFiles: allFiles.length,
      truncated,
      summary,
    })

    return {
      files,
      truncated,
      summary: truncated || skipped > 0 ? summary : undefined,
      snapshot: lastSnapshot,
    }
  }

  export async function captureSnapshot(sessionID: string): Promise<string | undefined> {
    const snapshot = await Snapshot.track()
    if (!snapshot) return undefined

    await Session.update(sessionID, (draft) => {
      draft.lastGenerationSnapshot = snapshot
    })

    log.info("captured generation snapshot", { sessionID, snapshot })
    return snapshot
  }

  export function formatForContext(diff: UserDiffResult): string {
    const lines: string[] = []
    lines.push("External changes since last response:")
    lines.push("")

    for (const file of diff.files) {
      const prefix = file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"
      const stats = `(+${file.additions}, -${file.deletions})`
      lines.push(`${prefix} ${file.file} ${stats}`)
    }

    if (diff.summary) {
      lines.push("")
      if (diff.truncated) {
        lines.push(
          `(Showing ${diff.files.length} of ${diff.summary.added + diff.summary.modified + diff.summary.deleted} files)`,
        )
      }
      if (diff.summary.skipped > 0) {
        lines.push(`(${diff.summary.skipped} files skipped due to ignore patterns)`)
      }
      lines.push(`Total: +${diff.summary.totalAdditions}, -${diff.summary.totalDeletions}`)
    }

    return lines.join("\n")
  }

  export function toPart(
    diff: UserDiffResult,
    messageID: string,
    sessionID: string,
    partID: string,
  ): MessageV2.UserDiffPart {
    return {
      id: partID,
      messageID,
      sessionID,
      type: "user-diff",
      files: diff.files,
      truncated: diff.truncated,
      summary: diff.summary,
      snapshot: diff.snapshot,
    }
  }
}
