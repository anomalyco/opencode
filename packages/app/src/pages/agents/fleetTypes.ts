import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import type { WindowKey } from "./lib/bucket"
import type { CostBreakdown } from "./lib/cost"
import type { TreeNode } from "./lib/tree"

export type BucketWindow = WindowKey

export type FleetKind = "working" | "permission" | "error" | "unseen" | "idle"
export type FleetFilterKind = "all" | "working" | "input" | "idle" | "error"
export type FleetSeverity = "cyan" | "mid" | "green" | "amber" | "bright" | "dim" | "red"

export type FleetRowData = {
  sessionID: string
  directory: string
  title: string
  agent: string
  model: string
  provider: string
  role: "orchestrator" | "subagent"
  parentID: string | null
  stage: { state: string; severity: FleetSeverity }
  tin: number
  tout: number
  tps: number
  cachePct: number
  cost: number
  priced: boolean
  lat: number | null
  spark: number[]
  live: boolean
  kind: FleetKind
  sandbox: boolean
  forkChild: boolean
  updated: number
}

export type FleetFilter = { kind: FleetFilterKind; project: string | null }

export type AttentionItem =
  | { kind: "permission"; sessionID: string; directory: string; title: string; request: PermissionRequest }
  | { kind: "question"; sessionID: string; directory: string; title: string; request: QuestionRequest }

export type FleetData = {
  rows: () => FleetRowData[]
  nodes: () => TreeNode<FleetRowData>[]
  attention: () => AttentionItem[]
  cost: () => CostBreakdown
  totalCost: () => number
  projects: () => string[]
  toggleCollapsed: (sessionID: string) => void
  totalSpark: () => number[]
  out1mAll: () => number
  anyLive: () => boolean
  window: () => BucketWindow
  setWindow: (w: BucketWindow) => void
  filter: () => FleetFilter
  setFilterKind: (k: FleetFilterKind) => void
  setProject: (p: string | null) => void
}
