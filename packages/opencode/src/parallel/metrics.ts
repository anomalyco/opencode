import type { PlanID, SubtaskID } from "./schema"

export namespace Metrics {
  interface State {
    spawnAttempts: number
    spawnSuccess: number
    spawnFailure: number
    timeoutCount: number
    planDone: number
    planPartial: number
    planFailed: number
    workerStartupDuration: {
      count: number
      sum: number
    }
  }

  const state: State = {
    spawnAttempts: 0,
    spawnSuccess: 0,
    spawnFailure: 0,
    timeoutCount: 0,
    planDone: 0,
    planPartial: 0,
    planFailed: 0,
    workerStartupDuration: {
      count: 0,
      sum: 0,
    },
  }

  export function recordSpawnAttempt(): void {
    state.spawnAttempts++
  }

  export function recordSpawnSuccess(): void {
    state.spawnSuccess++
  }

  export function recordSpawnFailure(): void {
    state.spawnFailure++
  }

  export function recordWorkerStartup(durationMs: number): void {
    state.workerStartupDuration.count++
    state.workerStartupDuration.sum += durationMs
  }

  export function recordTimeout(_planID: PlanID, _subtaskID: SubtaskID): void {
    state.timeoutCount++
  }

  export function recordPlanOutcome(status: "done" | "partial_success" | "failed"): void {
    if (status === "done") state.planDone++
    else if (status === "partial_success") state.planPartial++
    else state.planFailed++
  }

  export interface MetricsSnapshot {
    spawnAttempts: number
    spawnSuccess: number
    spawnFailure: number
    timeoutCount: number
    planDone: number
    planPartial: number
    planFailed: number
    workerStartupDuration: {
      count: number
      average: number
    }
  }

  export function getMetrics(): MetricsSnapshot {
    const duration = state.workerStartupDuration
    return {
      spawnAttempts: state.spawnAttempts,
      spawnSuccess: state.spawnSuccess,
      spawnFailure: state.spawnFailure,
      timeoutCount: state.timeoutCount,
      planDone: state.planDone,
      planPartial: state.planPartial,
      planFailed: state.planFailed,
      workerStartupDuration: {
        count: duration.count,
        average: duration.count > 0 ? duration.sum / duration.count : 0,
      },
    }
  }

  export function reset(): void {
    state.spawnAttempts = 0
    state.spawnSuccess = 0
    state.spawnFailure = 0
    state.timeoutCount = 0
    state.planDone = 0
    state.planPartial = 0
    state.planFailed = 0
    state.workerStartupDuration.count = 0
    state.workerStartupDuration.sum = 0
  }
}
