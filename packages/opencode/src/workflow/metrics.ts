/**
 * Metrics Collection and Storage System
 *
 * Tracks detailed workflow metrics for analysis and improvement.
 */

import { Storage } from "../storage/storage.js"
import { ulid } from "ulid"
import type {
  WorkflowMetrics,
  AgentMetrics,
  WorkflowError,
  WorkflowStage,
  AggregateMetrics,
  MetricsFilter,
  TimeRange,
} from "./types.js"

export namespace Metrics {
  /**
   * Initialize metrics for a new workflow
   */
  export async function initialize(workflowID: string): Promise<WorkflowMetrics> {
    const metrics: WorkflowMetrics = {
      workflowID,
      duration: {
        total: 0,
        planning: 0,
        coding: 0,
        testing: 0,
        deployment: 0,
      },
      tasks: {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
      },
      agents: {},
      tests: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      },
      errors: [],
      retries: 0,
      costEstimate: 0,
    }

    await save(workflowID, metrics)
    return metrics
  }

  /**
   * Get metrics for a workflow
   */
  export async function get(workflowID: string): Promise<WorkflowMetrics | null> {
    try {
      return await Storage.read<WorkflowMetrics>(["workflow_metrics", workflowID])
    } catch {
      return null
    }
  }

  /**
   * Save metrics
   */
  export async function save(
    workflowID: string,
    metrics: WorkflowMetrics
  ): Promise<void> {
    await Storage.write<WorkflowMetrics>(["workflow_metrics", workflowID], metrics)
  }

  /**
   * Record task completion
   */
  export async function recordTaskCompletion(
    workflowID: string,
    params: {
      taskID: string
      agentID: string
      stage: WorkflowStage
      duration: number
      success: boolean
    }
  ): Promise<void> {
    const { taskID, agentID, stage, duration, success } = params

    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        // Update task counts
        draft.tasks.total++
        if (success) {
          draft.tasks.completed++
        } else {
          draft.tasks.failed++
        }

        // Update stage duration
        draft.duration[stage] += duration

        // Update agent metrics
        if (!draft.agents[agentID]) {
          draft.agents[agentID] = {
            agentID,
            invocations: 0,
            successRate: 0,
            averageDuration: 0,
            tokensUsed: 0,
            toolsUsed: {},
            errorsEncountered: [],
          }
        }

        const agentMetrics = draft.agents[agentID]
        agentMetrics.invocations++

        // Update average duration
        const totalDuration = agentMetrics.averageDuration * (agentMetrics.invocations - 1)
        agentMetrics.averageDuration = (totalDuration + duration) / agentMetrics.invocations

        // Update success rate
        const successCount = Math.round(agentMetrics.successRate * (agentMetrics.invocations - 1))
        agentMetrics.successRate =
          (successCount + (success ? 1 : 0)) / agentMetrics.invocations
      }
    )
  }

  /**
   * Record tool usage by an agent
   */
  export async function recordToolUsage(
    workflowID: string,
    agentID: string,
    toolID: string
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        if (!draft.agents[agentID]) {
          draft.agents[agentID] = {
            agentID,
            invocations: 0,
            successRate: 0,
            averageDuration: 0,
            tokensUsed: 0,
            toolsUsed: {},
            errorsEncountered: [],
          }
        }

        const agentMetrics = draft.agents[agentID]
        agentMetrics.toolsUsed[toolID] = (agentMetrics.toolsUsed[toolID] || 0) + 1
      }
    )
  }

  /**
   * Record token usage
   */
  export async function recordTokenUsage(
    workflowID: string,
    agentID: string,
    tokens: number
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        if (!draft.agents[agentID]) {
          draft.agents[agentID] = {
            agentID,
            invocations: 0,
            successRate: 0,
            averageDuration: 0,
            tokensUsed: 0,
            toolsUsed: {},
            errorsEncountered: [],
          }
        }

        draft.agents[agentID].tokensUsed += tokens
      }
    )
  }

  /**
   * Record test results
   */
  export async function recordTestResults(
    workflowID: string,
    results: {
      total: number
      passed: number
      failed: number
      skipped: number
    }
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        draft.tests.total += results.total
        draft.tests.passed += results.passed
        draft.tests.failed += results.failed
        draft.tests.skipped += results.skipped
      }
    )
  }

  /**
   * Record an error
   */
  export async function recordError(
    workflowID: string,
    error: WorkflowError
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        draft.errors.push(error)

        // Add to agent's error list
        if (draft.agents[error.agentID]) {
          if (!draft.agents[error.agentID].errorsEncountered.includes(error.type)) {
            draft.agents[error.agentID].errorsEncountered.push(error.type)
          }
        }
      }
    )
  }

  /**
   * Increment retry count
   */
  export async function incrementRetries(workflowID: string): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        draft.retries++
      }
    )
  }

  /**
   * Update total workflow duration
   */
  export async function updateTotalDuration(
    workflowID: string,
    duration: number
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        draft.duration.total = duration
      }
    )
  }

  /**
   * Update cost estimate
   */
  export async function updateCostEstimate(
    workflowID: string,
    cost: number
  ): Promise<void> {
    await Storage.update<WorkflowMetrics>(
      ["workflow_metrics", workflowID],
      (draft) => {
        draft.costEstimate = cost
      }
    )
  }

  /**
   * Query metrics with filters
   */
  export async function query(filter: MetricsFilter): Promise<WorkflowMetrics[]> {
    const allKeys = await Storage.list(["workflow_metrics"])
    const allMetrics = await Promise.all(
      allKeys.map((key) => Storage.read<WorkflowMetrics>(key))
    )

    return allMetrics.filter((m) => {
      // Filter by workspace ID if provided
      if (filter.workspaceID) {
        // Would need to load workflow to check workspace ID
        // Simplified for now
      }

      return true
    })
  }

  /**
   * Get aggregate metrics across workflows
   */
  export async function aggregate(timeRange: TimeRange): Promise<AggregateMetrics> {
    const allKeys = await Storage.list(["workflow_metrics"])
    const allMetrics = await Promise.all(
      allKeys.map((key) => Storage.read<WorkflowMetrics>(key))
    )

    const totalWorkflows = allMetrics.length
    let successfulWorkflows = 0
    let failedWorkflows = 0
    let totalDuration = 0

    const stageMetrics: Record<
      WorkflowStage,
      { totalDuration: number; successCount: number; totalCount: number }
    > = {
      planning: { totalDuration: 0, successCount: 0, totalCount: 0 },
      coding: { totalDuration: 0, successCount: 0, totalCount: 0 },
      testing: { totalDuration: 0, successCount: 0, totalCount: 0 },
      deployment: { totalDuration: 0, successCount: 0, totalCount: 0 },
    }

    const errorCounts: Record<string, { count: number; message: string }> = {}
    const agentPerformance: Record<
      string,
      { totalInvocations: number; successCount: number; totalDuration: number }
    > = {}

    for (const metrics of allMetrics) {
      // Count successful vs failed workflows
      if (metrics.errors.length === 0 || metrics.tasks.failed === 0) {
        successfulWorkflows++
      } else {
        failedWorkflows++
      }

      totalDuration += metrics.duration.total

      // Aggregate stage metrics
      for (const stage of ["planning", "coding", "testing", "deployment"] as WorkflowStage[]) {
        stageMetrics[stage].totalDuration += metrics.duration[stage]
        stageMetrics[stage].totalCount++
        if (metrics.errors.filter((e) => e.stage === stage).length === 0) {
          stageMetrics[stage].successCount++
        }
      }

      // Aggregate error counts
      for (const error of metrics.errors) {
        if (!errorCounts[error.type]) {
          errorCounts[error.type] = { count: 0, message: error.message }
        }
        errorCounts[error.type].count++
      }

      // Aggregate agent performance
      for (const [agentID, agentMetrics] of Object.entries(metrics.agents)) {
        if (!agentPerformance[agentID]) {
          agentPerformance[agentID] = {
            totalInvocations: 0,
            successCount: 0,
            totalDuration: 0,
          }
        }
        agentPerformance[agentID].totalInvocations += agentMetrics.invocations
        agentPerformance[agentID].successCount +=
          Math.round(agentMetrics.successRate * agentMetrics.invocations)
        agentPerformance[agentID].totalDuration +=
          agentMetrics.averageDuration * agentMetrics.invocations
      }
    }

    // Calculate averages
    const averageDuration = totalWorkflows > 0 ? totalDuration / totalWorkflows : 0

    const topErrors = Object.entries(errorCounts)
      .map(([type, data]) => ({
        type,
        count: data.count,
        message: data.message,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const processedStageMetrics: AggregateMetrics["stageMetrics"] = {
      planning: {
        averageDuration:
          stageMetrics.planning.totalCount > 0
            ? stageMetrics.planning.totalDuration / stageMetrics.planning.totalCount
            : 0,
        successRate:
          stageMetrics.planning.totalCount > 0
            ? stageMetrics.planning.successCount / stageMetrics.planning.totalCount
            : 0,
      },
      coding: {
        averageDuration:
          stageMetrics.coding.totalCount > 0
            ? stageMetrics.coding.totalDuration / stageMetrics.coding.totalCount
            : 0,
        successRate:
          stageMetrics.coding.totalCount > 0
            ? stageMetrics.coding.successCount / stageMetrics.coding.totalCount
            : 0,
      },
      testing: {
        averageDuration:
          stageMetrics.testing.totalCount > 0
            ? stageMetrics.testing.totalDuration / stageMetrics.testing.totalCount
            : 0,
        successRate:
          stageMetrics.testing.totalCount > 0
            ? stageMetrics.testing.successCount / stageMetrics.testing.totalCount
            : 0,
      },
      deployment: {
        averageDuration:
          stageMetrics.deployment.totalCount > 0
            ? stageMetrics.deployment.totalDuration / stageMetrics.deployment.totalCount
            : 0,
        successRate:
          stageMetrics.deployment.totalCount > 0
            ? stageMetrics.deployment.successCount / stageMetrics.deployment.totalCount
            : 0,
      },
    }

    const processedAgentPerformance: AggregateMetrics["agentPerformance"] = {}
    for (const [agentID, perf] of Object.entries(agentPerformance)) {
      processedAgentPerformance[agentID] = {
        totalInvocations: perf.totalInvocations,
        successRate:
          perf.totalInvocations > 0 ? perf.successCount / perf.totalInvocations : 0,
        averageDuration:
          perf.totalInvocations > 0 ? perf.totalDuration / perf.totalInvocations : 0,
      }
    }

    return {
      timeRange,
      totalWorkflows,
      successfulWorkflows,
      failedWorkflows,
      averageDuration,
      stageMetrics: processedStageMetrics,
      topErrors,
      agentPerformance: processedAgentPerformance,
    }
  }

  /**
   * Delete metrics for a workflow
   */
  export async function remove(workflowID: string): Promise<void> {
    await Storage.remove(["workflow_metrics", workflowID])
  }
}
