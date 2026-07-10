// Real filesystem-backed GitTransactionManager
// Uses Bun's built-in fs and child_process for actual Git operations

import { join } from "node:path"
import { createHash } from "crypto"
import type {
  FileTransaction,
  ValidationResult,
  CommitResult,
} from "./transactional-fs"
import { threeWayMerge } from "./transactional-fs"

export { type FileTransaction, type ValidationResult, type CommitResult } from "./transactional-fs"

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class RealGitTransactionManager {
  private staging = new Map<string, string>()
  private activeTransaction: FileTransaction | null = null
  private workDir: string
  private useGit: boolean
  private onCommitCallback: ((tx: FileTransaction) => void | Promise<void>) | null = null
  private onRollbackCallback: ((tx: FileTransaction) => void | Promise<void>) | null = null

  constructor(workDir: string = process.cwd()) {
    this.workDir = workDir
    this.useGit = false
    this.detectGit()
  }

  /** Register event callbacks for EventBus integration */
  setEventCallbacks(callbacks: {
    onCommit?: (tx: FileTransaction) => void | Promise<void>
    onRollback?: (tx: FileTransaction) => void | Promise<void>
  }): void {
    this.onCommitCallback = callbacks.onCommit ?? null
    this.onRollbackCallback = callbacks.onRollback ?? null
  }

  private async detectGit(): Promise<void> {
    try {
      const proc = Bun.spawnSync(["git", "rev-parse", "--git-dir"], {
        cwd: this.workDir,
        stdout: "pipe",
        stderr: "pipe",
      })
      this.useGit = proc.exitCode === 0
    } catch {
      this.useGit = false
    }
  }

  private resolvePath(relPath: string): string {
    return join(this.workDir, relPath)
  }

  private async readFile(path: string): Promise<string> {
    const fullPath = this.resolvePath(path)
    const file = Bun.file(fullPath)
    if (await file.exists()) {
      return await file.text()
    }
    return ""
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(path)
    // Ensure parent directory exists
    const parent = fullPath.replace(/[/\\][^/\\]+$/, "")
    if (parent !== fullPath) {
      await Bun.write(parent + "/.keep", "").catch(() => {})
    }
    await Bun.write(fullPath, content)
  }

  private async getGitHead(): Promise<string> {
    if (!this.useGit) return ""
    try {
      const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
        cwd: this.workDir,
        stdout: "pipe",
      })
      return proc.stdout.toString().trim()
    } catch {
      return ""
    }
  }

  private async getGitBlob(commit: string, file: string): Promise<string> {
    if (!this.useGit || !commit) return ""
    try {
      const proc = Bun.spawnSync(["git", "show", `${commit}:${file}`], {
        cwd: this.workDir,
        stdout: "pipe",
        stderr: "pipe",
      })
      if (proc.exitCode !== 0) return ""
      return proc.stdout.toString()
    } catch {
      return ""
    }
  }

  async begin(sessionId: string, files: string[]): Promise<FileTransaction> {
    const baselineHash: Record<string, string> = {}

    for (const file of files) {
      const content = await this.readFile(file)
      baselineHash[file] = hashContent(content)
      this.staging.set(file, content)
    }

    this.activeTransaction = {
      id: generateUUID(),
      sessionId,
      baselineHash,
      baselineGitHead: await this.getGitHead(),
      affectedFiles: files,
      status: "active",
    }

    return this.activeTransaction
  }

  propose(file: string, content: string): void {
    this.staging.set(file, content)
  }

  async validate(tx: FileTransaction): Promise<ValidationResult> {
    for (const file of tx.affectedFiles) {
      const currentContent = await this.readFile(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return { valid: false, file, reason: "WORKSPACE_MODIFIED" }
      }
    }
    tx.status = "validated"
    return { valid: true }
  }

  async commit(tx: FileTransaction): Promise<CommitResult> {
    // Phase 1: Secondary validation (TOCTOU)
    for (const file of tx.affectedFiles) {
      const currentContent = await this.readFile(file)
      const currentHash = hashContent(currentContent)
      if (currentHash !== tx.baselineHash[file]) {
        return this.handleConflict(tx, file, currentHash)
      }
    }

    // Phase 2: Three-way merge per file
    for (const file of tx.affectedFiles) {
      const stagedContent = this.staging.get(file)
      if (!stagedContent) continue

      const currentContent = await this.readFile(file)
      const baseContent = await this.getGitBlob(tx.baselineGitHead, file)

      if (!baseContent || currentContent === baseContent) {
        await this.writeFile(file, stagedContent)
        tx.baselineHash[file] = hashContent(stagedContent)
      } else {
        const merged = this.threeWayMerge(baseContent, stagedContent, currentContent)
        if (merged.hasConflicts) {
          await this.rollback(tx)
          return {
            status: "MERGE_CONFLICT",
            file,
            conflictMarkers: merged.markers,
            suggestion: "Please resolve conflicts manually or rollback",
          }
        }
        await this.writeFile(file, merged.content)
        tx.baselineHash[file] = hashContent(merged.content)
      }
    }

    // Phase 3: Emit commit event to EventBus
    if (this.onCommitCallback) {
      await this.onCommitCallback(tx)
    }

    // Phase 4: Cleanup
    this.staging.clear()
    tx.status = "committed"
    return { status: "SUCCESS" }
  }

  async rollback(tx: FileTransaction): Promise<void> {
    if (this.useGit) {
      for (const file of tx.affectedFiles) {
        const baseContent = await this.getGitBlob(tx.baselineGitHead, file)
        if (baseContent) {
          await this.writeFile(file, baseContent)
        }
      }
    }

    // Emit rollback event to EventBus
    if (this.onRollbackCallback) {
      await this.onRollbackCallback(tx)
    }

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
      suggestion: `File was modified during transaction. Baseline: ${tx.baselineHash[file]}, Current: ${currentHash}`,
    }
  }

  threeWayMerge(
    base: string,
    ours: string,
    theirs: string,
  ) {
    return threeWayMerge(base, ours, theirs)
  }

  getActiveTransaction(): FileTransaction | null {
    return this.activeTransaction
  }
}
