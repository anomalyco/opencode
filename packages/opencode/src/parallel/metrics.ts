import { Log } from "@/util/log"
import type { PlanID, SubtaskID } from "./schema"

export namespace Metrics {
  const log = Log.create({ service: "metrics" })

  interface CostEntry {
    inputTokens: number
    outputTokens: number
    calls: number
  }

  interface PlanCost {
    orchestrator: CostEntry
    workers: Map<string, CostEntry>
    merge: CostEntry
    totalInputTokens: number
    totalOutputTokens: number
  }

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
    planCosts: Map<string, PlanCost>
  }

  function emptyCostEntry(): CostEntry {
    return { inputTokens: 0, outputTokens: 0, calls: 0 }
  }

  function ensurePlanCost(planID: PlanID): PlanCost {
    const key = String(planID)
    let cost = state.planCosts.get(key)
    if (!cost) {
      cost = {
        orchestrator: emptyCostEntry(),
        workers: new Map(),
        merge: emptyCostEntry(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }
      state.planCosts.set(key, cost)
    }
    return cost
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
    planCosts: new Map(),
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

  export function recordTokenUsage(input: {
    planID: PlanID
    role: "orchestrator" | "worker" | "merge"
    subtaskID?: SubtaskID
    inputTokens: number
    outputTokens: number
  }): void {
    const cost = ensurePlanCost(input.planID)
    cost.totalInputTokens += input.inputTokens
    cost.totalOutputTokens += input.outputTokens

    if (input.role === "orchestrator") {
      cost.orchestrator.inputTokens += input.inputTokens
      cost.orchestrator.outputTokens += input.outputTokens
      cost.orchestrator.calls++
    } else if (input.role === "merge") {
      cost.merge.inputTokens += input.inputTokens
      cost.merge.outputTokens += input.outputTokens
      cost.merge.calls++
    } else if (input.role === "worker" && input.subtaskID) {
      const key = String(input.subtaskID)
      let entry = cost.workers.get(key)
      if (!entry) {
        entry = emptyCostEntry()
        cost.workers.set(key, entry)
      }
      entry.inputTokens += input.inputTokens
      entry.outputTokens += input.outputTokens
      entry.calls++
    }
  }

  export interface PlanCostSnapshot {
    totalInputTokens: number
    totalOutputTokens: number
    orchestratorCalls: number
    workerCount: number
    mergeCalls: number
  }

  export function getPlanCost(planID: PlanID): PlanCostSnapshot | undefined {
    const cost = state.planCosts.get(String(planID))
    if (!cost) return undefined
    return {
      totalInputTokens: cost.totalInputTokens,
      totalOutputTokens: cost.totalOutputTokens,
      orchestratorCalls: cost.orchestrator.calls,
      workerCount: cost.workers.size,
      mergeCalls: cost.merge.calls,
    }
  }

  /**
   * Estimate tokens for a plan before execution.
   * Returns a rough estimate based on subtask count and typical token usage.
   */
  export function estimatePlanCost(input: {
    subtaskCount: number
    avgWorkerInputTokens?: number
    avgWorkerOutputTokens?: number
    orchestratorInputTokens?: number
  }): { estimatedInputTokens: number; estimatedOutputTokens: number } {
    const orchestratorInput = input.orchestratorInputTokens ?? 8_000
    const orchestratorOutput = 2_000
    const workerInput = input.avgWorkerInputTokens ?? 30_000
    const workerOutput = input.avgWorkerOutputTokens ?? 15_000
    const mergeInput = 5_000
    const mergeOutput = 3_000

    return {
      estimatedInputTokens:
        orchestratorInput + input.subtaskCount * workerInput + Math.ceil(input.subtaskCount * 0.3) * mergeInput,
      estimatedOutputTokens:
        orchestratorOutput + input.subtaskCount * workerOutput + Math.ceil(input.subtaskCount * 0.3) * mergeOutput,
    }
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
    state.planCosts.clear()
  }
}
