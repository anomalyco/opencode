export interface WorktreeCreateInput {
  readonly sourceDirectory: string
  readonly directory: string
  /** Starting ref, not the name of a new branch. Reject unsupported refs rather than ignoring them. */
  readonly branch?: string
}

export interface WorktreeRemoveInput {
  readonly directory: string
  readonly force: boolean
}

export interface WorktreeResult {
  readonly directory: string
}

export interface WorktreeEntry extends WorktreeResult {
  readonly type: "root" | "worktree"
}
