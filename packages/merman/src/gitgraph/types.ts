export type GitGraphDirection = "LR" | "TB" | "BT"
export type GitGraphCommitType = "NORMAL" | "REVERSE" | "HIGHLIGHT"

export interface GitGraphBranch {
  name: string
  order?: number
  head?: string
}

export interface GitGraphCommit {
  id: string
  message?: string
  tags: string[]
  type: GitGraphCommitType
  branch: string
  parents: string[]
}

export interface GitGraphDiagram {
  direction: GitGraphDirection
  branches: GitGraphBranch[]
  commits: GitGraphCommit[]
}

export interface GitGraphDiagramRenderOptions {
  /** Parsed for Mermaid compatibility. Git graphs always use a vertical terminal layout. */
  direction?: GitGraphDirection
}

export type GitGraphCellStyle =
  | `branch${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | "commit"
  | "merge"
  | "highlight"
  | "reverse"
  | "label"
