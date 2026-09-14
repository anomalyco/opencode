import type { WindowKey } from "./lib/bucket"

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
}

export type FleetFilter = { kind: FleetFilterKind; project: string | null }

export type FleetData = {
  rows: () => FleetRowData[]
  totalSpark: () => number[]
  out1mAll: () => number
  anyLive: () => boolean
  window: () => BucketWindow
  setWindow: (w: BucketWindow) => void
  filter: () => FleetFilter
  setFilterKind: (k: FleetFilterKind) => void
  setProject: (p: string | null) => void
}
