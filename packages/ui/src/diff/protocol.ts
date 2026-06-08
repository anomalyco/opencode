type DiffSource = { file: string; patch?: string; before?: string; after?: string }
type PreparedDiff = { fileDiff: any; deletions: string; additions: string }

export type DiffWorkerRequest = {
  id: number
  source: DiffSource
}

export type DiffWorkerResponse = { id: number; result: PreparedDiff } | { id: number; error: string }
