import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import type { PlanStatus, WorkerStatus, WorkerState } from "./schema"

export const InvalidTransitionError = NamedError.create(
  "InvalidTransitionError",
  z.object({
    from: z.string(),
    to: z.string(),
    message: z.string(),
  }),
)

export const VALID_PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["proposed", "failed"],
  proposed: ["draft", "approved", "cancelled", "failed"],
  approved: ["spawning", "cancelled", "failed"],
  spawning: ["running", "cancelled", "failed"],
  running: ["merging", "cancelled", "failed"],
  merging: ["done", "failed"],
  cancelled: [],
  done: [],
  failed: ["draft"],
}

export const VALID_WORKER_TRANSITIONS: Record<WorkerStatus, WorkerStatus[]> = {
  pending: ["spawning", "failed"],
  spawning: ["running", "failed"],
  running: ["stopping", "done", "failed"],
  stopping: ["done", "failed"],
  done: ["merged", "conflict"],
  failed: ["pending"], // Allow retry
  merged: [],
  conflict: [],
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return VALID_PLAN_TRANSITIONS[from].includes(to)
}

export function canTransitionWorker(from: WorkerStatus, to: WorkerStatus): boolean {
  return VALID_WORKER_TRANSITIONS[from].includes(to)
}

export function validateTransition(from: PlanStatus, to: PlanStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError({
      from,
      to,
      message: `Invalid plan transition: ${from} -> ${to}`,
    })
  }
}

export function validateWorkerTransition(from: WorkerStatus, to: WorkerStatus): void {
  if (!canTransitionWorker(from, to)) {
    throw new InvalidTransitionError({
      from,
      to,
      message: `Invalid worker transition: ${from} -> ${to}`,
    })
  }
}

export function isPlanTerminal(status: PlanStatus): boolean {
  return status === "done" || status === "failed"
}

export function isWorkerTerminal(status: WorkerStatus): boolean {
  return status === "merged" || status === "failed" || status === "conflict"
}

export function allWorkersTerminal(workers: WorkerState[]): boolean {
  return workers.every((w) => isWorkerTerminal(w.status))
}
