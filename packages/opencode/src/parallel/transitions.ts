import type { PlanStatus, WorkerStatus } from "./schema"

export const VALID_PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["proposed", "failed"],
  proposed: ["draft", "approved", "failed"],
  approved: ["spawning", "failed"],
  spawning: ["running", "failed"],
  running: ["merging", "failed"],
  merging: ["done", "failed"],
  done: [],
  failed: ["draft"],
}

export const VALID_WORKER_TRANSITIONS: Record<WorkerStatus, WorkerStatus[]> = {
  pending: ["spawning", "failed"],
  spawning: ["running", "failed"],
  running: ["done", "failed"],
  done: ["merged", "conflict"],
  failed: [],
  merged: [],
  conflict: [],
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return VALID_PLAN_TRANSITIONS[from]?.includes(to) ?? false
}

export function canTransitionWorker(from: WorkerStatus, to: WorkerStatus): boolean {
  return VALID_WORKER_TRANSITIONS[from]?.includes(to) ?? false
}

export function validateTransition(from: PlanStatus, to: PlanStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} -> ${to}`)
  }
}

export function validateWorkerTransition(from: WorkerStatus, to: WorkerStatus): void {
  if (!canTransitionWorker(from, to)) {
    throw new Error(`Invalid worker transition: ${from} -> ${to}`)
  }
}
