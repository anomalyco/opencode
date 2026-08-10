export * as StorageMaintenanceProgress from "./progress"

export type Operation = "analyze" | "backup" | "compact" | "checkpoint" | "vacuum"
export type Phase =
  | "idle"
  | "snapshot"
  | "verify"
  | "index"
  | "analyze"
  | "backup"
  | "drain"
  | "compact"
  | "checkpoint"
  | "vacuum"

export type State = {
  readonly operation: Operation | null
  readonly phase: Phase
  readonly completed: number
  readonly total: number
  readonly workers: number
  readonly startedAt: number
  readonly updatedAt: number
}

let active: { id: string; state: State } = {
  id: "",
  state: {
    operation: null,
    phase: "idle",
    completed: 0,
    total: 0,
    workers: 0,
    startedAt: 0,
    updatedAt: 0,
  },
}

export function begin(operation: Operation, phase: Phase) {
  const id = crypto.randomUUID()
  const now = Date.now()
  active = {
    id,
    state: { operation, phase, completed: 0, total: 0, workers: 1, startedAt: now, updatedAt: now },
  }
  return id
}

export function update(
  id: string,
  progress: { readonly phase: Phase; readonly completed: number; readonly total: number; readonly workers?: number },
) {
  if (active.id !== id) return
  active = {
    id,
    state: {
      ...active.state,
      ...progress,
      workers: progress.workers ?? active.state.workers,
      updatedAt: Date.now(),
    },
  }
}

export function finish(id: string) {
  if (active.id !== id) return
  active = {
    id: "",
    state: {
      operation: null,
      phase: "idle",
      completed: 0,
      total: 0,
      workers: 0,
      startedAt: 0,
      updatedAt: Date.now(),
    },
  }
}

export function current() {
  return active.state
}
