export interface SessionBranch {
  branch_id: string
  parent_session_id: string
  session_id: string
  branch_name: string
  git_branch: string
  created_at: number
  status: "active" | "merged" | "abandoned"
  events_copied: number
}

export interface BranchDatabase {
  copyEventLog(sourceSessionId: string, targetSessionId: string): number
  copyLatestCheckpoint(sourceSessionId: string, targetSessionId: string): unknown
}

function generateUUID(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export class BranchManager {
  private branches = new Map<string, SessionBranch>()
  private db: BranchDatabase | null = null

  setDatabase(db: BranchDatabase): void {
    this.db = db
  }

  async fork(
    parentSessionId: string,
    branchName: string,
  ): Promise<SessionBranch> {
    const branchId = generateUUID()
    const newSessionId = generateUUID()

    // Copy event_log and checkpoint from parent via database
    let eventsCopied = 0
    if (this.db) {
      eventsCopied = this.db.copyEventLog(parentSessionId, newSessionId)
      this.db.copyLatestCheckpoint(parentSessionId, newSessionId)
    }

    const branch: SessionBranch = {
      branch_id: branchId,
      parent_session_id: parentSessionId,
      session_id: newSessionId,
      branch_name: branchName,
      git_branch: `agent-branch-${newSessionId.slice(0, 8)}`,
      created_at: Date.now(),
      status: "active",
      events_copied: eventsCopied,
    }

    this.branches.set(branchId, branch)
    return branch
  }

  getBranch(branchId: string): SessionBranch | undefined {
    return this.branches.get(branchId)
  }

  listBranches(parentSessionId?: string): SessionBranch[] {
    const all = Array.from(this.branches.values())
    if (parentSessionId) {
      return all.filter((b) => b.parent_session_id === parentSessionId)
    }
    return all
  }

  mergeBranch(branchId: string): boolean {
    const branch = this.branches.get(branchId)
    if (!branch) return false
    branch.status = "merged"
    return true
  }

  abandonBranch(branchId: string): boolean {
    const branch = this.branches.get(branchId)
    if (!branch) return false
    branch.status = "abandoned"
    return true
  }

  getActiveBranches(): SessionBranch[] {
    return Array.from(this.branches.values()).filter((b) => b.status === "active")
  }
}

export * as Branch from "./branch"
