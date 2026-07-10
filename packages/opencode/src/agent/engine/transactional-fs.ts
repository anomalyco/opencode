import { createHash } from "crypto"
import { diffArrays } from "diff"

export interface FileTransaction {
  id: string
  sessionId: string
  baselineHash: Record<string, string>
  baselineGitHead: string
  affectedFiles: string[]
  status: "active" | "validated" | "committed" | "rolled_back" | "conflict"
}

export interface ValidationResult {
  valid: boolean
  file?: string
  reason?: string
}

export interface CommitResult {
  status: "SUCCESS" | "CONFLICT" | "MERGE_CONFLICT"
  file?: string
  reason?: string
  conflictMarkers?: string[]
  suggestion?: string
}

export interface MergeResult {
  content: string
  hasConflicts: boolean
  markers: string[]
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Shared three-way merge using diff-based approach.
 * Used by both GitTransactionManager (in-memory) and RealGitTransactionManager (real FS).
 */
export function threeWayMerge(
  base: string,
  ours: string,
  theirs: string,
): MergeResult {
  if (ours === theirs) return { content: ours, hasConflicts: false, markers: [] }
  if (theirs === base) return { content: ours, hasConflicts: false, markers: [] }
  if (ours === base) return { content: theirs, hasConflicts: false, markers: [] }

  const baseLines = base.split("\n")
  const oursLines = ours.split("\n")
  const theirsLines = theirs.split("\n")

  // Compute two diffs from base: base→ours and base→theirs
  const diffOurs = diffArrays(baseLines, oursLines)
  const diffTheirs = diffArrays(baseLines, theirsLines)

  // Walk both diffs, detecting conflicts where both sides modify the same region
  const resultLines: string[] = []
  const markers: string[] = []
  let oi = 0
  let ti = 0
  let hasConflicts = false

  while (oi < diffOurs.length && ti < diffTheirs.length) {
    const o = diffOurs[oi]
    const t = diffTheirs[ti]

    if (!o.added && !o.removed && !t.added && !t.removed) {
      const commonCount = Math.min(o.count, t.count)
      for (let c = 0; c < commonCount; c++) {
        resultLines.push(o.value[c])
      }
      o.count -= commonCount
      t.count -= commonCount
      if (o.count === 0) oi++
      if (t.count === 0) ti++
      continue
    }

    if (o.removed && t.removed) {
      const skipCount = Math.min(o.count, t.count)
      o.count -= skipCount
      t.count -= skipCount
      if (o.count === 0) oi++
      if (t.count === 0) ti++
      continue
    }

    if (o.added && !t.added && !t.removed) {
      for (let c = 0; c < o.count; c++) {
        resultLines.push(o.value[c])
      }
      oi++
      continue
    }

    if (t.added && !o.added && !o.removed) {
      for (let c = 0; c < t.count; c++) {
        resultLines.push(t.value[c])
      }
      ti++
      continue
    }

    if (o.removed && !t.removed && !t.added) {
      oi++
      continue
    }

    if (t.removed && !o.removed && !o.added) {
      ti++
      continue
    }

    // Conflict: both sides modified the same region
    hasConflicts = true
    const ourBlock: string[] = []
    while (oi < diffOurs.length && (diffOurs[oi].added || diffOurs[oi].removed)) {
      const ho = diffOurs[oi]
      for (let c = 0; c < ho.count; c++) {
        ourBlock.push(ho.value[c])
      }
      oi++
    }
    const theirBlock: string[] = []
    while (ti < diffTheirs.length && (diffTheirs[ti].added || diffTheirs[ti].removed)) {
      const ht = diffTheirs[ti]
      for (let c = 0; c < ht.count; c++) {
        theirBlock.push(ht.value[c])
      }
      ti++
    }

    const marker = `<<<<<<< OUR\n${ourBlock.join("\n")}\n=======\n${theirBlock.join("\n")}\n>>>>>>> THEIR`
    markers.push(marker)
    resultLines.push(marker)
  }

  while (oi < diffOurs.length) {
    const o = diffOurs[oi]
    for (let c = 0; c < o.count; c++) {
      if (o.added) resultLines.push(o.value[c])
    }
    oi++
  }
  while (ti < diffTheirs.length) {
    const t = diffTheirs[ti]
    for (let c = 0; c < t.count; c++) {
      if (t.added) resultLines.push(t.value[c])
    }
    ti++
  }

  return {
    content: resultLines.join("\n"),
    hasConflicts,
    markers,
  }
}

export class GitTransactionManager {
  private staging: Map<string, string> = new Map()
  private activeTransaction: FileTransaction | null = null

  begin(sessionId: string, files: Array<{ path: string; content: string }>): FileTransaction {
    const baselineHash: Record<string, string> = {}

    for (const file of files) {
      baselineHash[file.path] = hashContent(file.content)
      this.staging.set(file.path, file.content)
    }

    this.activeTransaction = {
      id: generateUUID(),
      sessionId,
      baselineHash,
      baselineGitHead: "",
      affectedFiles: files.map((f) => f.path),
      status: "active",
    }

    return this.activeTransaction
  }

  propose(file: string, content: string): void {
    this.staging.set(file, content)
  }

  validate(tx: FileTransaction): ValidationResult {
    for (const file of tx.affectedFiles) {
      const currentContent = this.staging.get(file)
      if (currentContent) {
        const currentHash = hashContent(currentContent)
        if (currentHash !== tx.baselineHash[file]) {
          return { valid: false, file, reason: "WORKSPACE_MODIFIED" }
        }
      }
    }
    tx.status = "validated"
    return { valid: true }
  }

  commit(tx: FileTransaction, getCurrentContent: (file: string) => string, getBaseContent?: (file: string) => string): CommitResult {
    for (const file of tx.affectedFiles) {
      const currentContent = getCurrentContent(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return this.handleConflict(tx, file, currentHash)
      }
    }

    for (const file of tx.affectedFiles) {
      const stagedContent = this.staging.get(file)
      if (!stagedContent) continue

      const currentContent = getCurrentContent(file)
      const baseContent = getBaseContent ? getBaseContent(file) : currentContent

      if (currentContent === baseContent) {
        tx.baselineHash[file] = hashContent(stagedContent)
      } else {
        const merged = this.threeWayMerge(baseContent, stagedContent, currentContent)
        if (merged.hasConflicts) {
          this.rollback(tx)
          return {
            status: "MERGE_CONFLICT",
            file,
            conflictMarkers: merged.markers,
            suggestion: "Please resolve conflicts manually or rollback",
          }
        }
        tx.baselineHash[file] = hashContent(merged.content)
      }
    }

    this.staging.clear()
    tx.status = "committed"
    return { status: "SUCCESS" }
  }

  rollback(tx: FileTransaction): void {
    this.staging.clear()
    tx.status = "rolled_back"
    this.activeTransaction = null
  }

  private handleConflict(tx: FileTransaction, file: string, currentHash: string): CommitResult {
    tx.status = "conflict"
    return {
      status: "CONFLICT",
      file,
      reason: "TOCTOU_RACE_DETECTED",
      suggestion: "Workspace file was modified during transaction. Please resolve conflicts manually.",
    }
  }

  threeWayMerge(
    base: string,
    ours: string,
    theirs: string,
  ): MergeResult {
    return threeWayMerge(base, ours, theirs)
  }

  getActiveTransaction(): FileTransaction | null {
    return this.activeTransaction
  }
}

export * as TransactionalFS from "./transactional-fs"
