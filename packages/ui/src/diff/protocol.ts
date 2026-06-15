import type { DiffSource, PreparedDiff } from "../components/session-diff"

export type DiffWorkerRequest = {
  id: number
  source: DiffSource
}

export type DiffWorkerResponse = { id: number; result: PreparedDiff } | { id: number; error: string }
