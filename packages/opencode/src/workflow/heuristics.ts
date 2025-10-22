/**
 * Heuristics Engine
 *
 * Analyzes historical workflow data to identify patterns, bottlenecks,
 * and opportunities for optimization.
 */

import { Storage } from "../storage/storage.js"
import { ID } from "../id/index.js"
import { Metrics } from "./metrics.js"
import { Orchestrator } from "./orchestrator.js"
import type {
  FailurePattern,
  Bottleneck,
  Optimization,
  WorkflowStage,
  WorkflowMetrics,
  WorkflowInstance,
} from "./types.js"

export namespace Heuristics {
  /**
   * Analyze failure patterns across workflows
   */
  export async function analyzeFailurePatterns(): Promise<FailurePattern[]> {
    const allKeys = await Storage.list(["workflow_metrics"])
    const allMetrics = await Promise.all(
      allKeys.map((key) => Storage.read<WorkflowMetrics>(key))
    )

    // Group errors by similarity
    const errorGroups: Map<string, {
      errors: WorkflowMetrics["errors"]
      stages: Set<WorkflowStage>
      firstSeen: number
      lastSeen: number
    }> = new Map()

    for (const metrics of allMetrics) {
      for (const error of metrics.errors) {
        // Create signature from error type and message patterns
        const signature = createErrorSignature(error)

        if (!errorGroups.has(signature)) {
          errorGroups.set(signature, {
            errors: [],
            stages: new Set(),
            firstSeen: error.timestamp,
            lastSeen: error.timestamp,
          })
        }

        const group = errorGroups.get(signature)!
        group.errors.push(error)
        group.stages.add(error.stage)
        group.firstSeen = Math.min(group.firstSeen, error.timestamp)
        group.lastSeen = Math.max(group.lastSeen, error.timestamp)
      }
    }

    // Convert to failure patterns
    const patterns: FailurePattern[] = []

    for (const [signature, group] of errorGroups.entries()) {
      if (group.errors.length < 2) continue // Need at least 2 occurrences

      const firstError = group.errors[0]
      const suggestedFix = generateSuggestedFix(group.errors)
      const confidence = calculateConfidence(group.errors)

      patterns.push({
        id: ID.ascending(),
        type: firstError.type,
        description: generatePatternDescription(group.errors),
        occurrences: group.errors.length,
        stages: Array.from(group.stages),
        errorSignature: signature,
        suggestedFix,
        confidence,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
      })
    }

    // Sort by occurrences (most common first)
    return patterns.sort((a, b) => b.occurrences - a.occurrences)
  }

  /**
   * Identify bottlenecks in the workflow
   */
  export async function identifyBottlenecks(): Promise<Bottleneck[]> {
    const allKeys = await Storage.list(["workflow_metrics"])
    const allMetrics = await Promise.all(
      allKeys.map((key) => Storage.read<WorkflowMetrics>(key))
    )

    const bottlenecks: Bottleneck[] = []

    // Analyze stage durations
    const stageDurations: Record<WorkflowStage, number[]> = {
      planning: [],
      coding: [],
      testing: [],
      deployment: [],
    }

    for (const metrics of allMetrics) {
      for (const stage of ["planning", "coding", "testing", "deployment"] as WorkflowStage[]) {
        if (metrics.duration[stage] > 0) {
          stageDurations[stage].push(metrics.duration[stage])
        }
      }
    }

    // Identify stages that are significantly slower than average
    for (const [stage, durations] of Object.entries(stageDurations) as [WorkflowStage, number[]][]) {
      if (durations.length === 0) continue

      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      const median = calculateMedian(durations)

      // If average is significantly higher than median, it's a bottleneck
      if (avg > median * 1.5) {
        const causes = await identifyBottleneckCauses(stage, allMetrics)

        bottlenecks.push({
          stage,
          agentID: stage, // Agent ID matches stage name for workflow agents
          averageDelay: avg - median,
          frequency: durations.filter(d => d > median * 1.5).length,
          causes,
        })
      }
    }

    // Analyze agent performance
    const agentDurations: Record<string, number[]> = {}

    for (const metrics of allMetrics) {
      for (const [agentID, agentMetrics] of Object.entries(metrics.agents)) {
        if (!agentDurations[agentID]) {
          agentDurations[agentID] = []
        }
        agentDurations[agentID].push(agentMetrics.averageDuration)
      }
    }

    // Find agents that are consistently slow
    for (const [agentID, durations] of Object.entries(agentDurations)) {
      if (durations.length < 3) continue

      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      const median = calculateMedian(durations)

      if (avg > median * 1.3) {
        const stage = agentID as WorkflowStage
        const causes = await identifyAgentBottleneckCauses(agentID, allMetrics)

        bottlenecks.push({
          stage,
          agentID,
          averageDelay: avg - median,
          frequency: durations.length,
          causes,
        })
      }
    }

    return bottlenecks.sort((a, b) => b.averageDelay - a.averageDelay)
  }

  /**
   * Suggest optimizations based on analysis
   */
  export async function suggestOptimizations(): Promise<Optimization[]> {
    const patterns = await analyzeFailurePatterns()
    const bottlenecks = await identifyBottlenecks()

    const optimizations: Optimization[] = []

    // Generate optimizations from failure patterns
    for (const pattern of patterns) {
      if (pattern.confidence < 0.6) continue

      optimizations.push({
        id: ID.ascending(),
        target: "prompt",
        description: `Add context to ${pattern.stages.join(", ")} agent(s) about common failure: ${pattern.type}`,
        expectedImprovement: pattern.occurrences * 0.2, // Rough estimate
        riskLevel: "low",
        implementation: {
          type: "append_prompt",
          parameters: {
            agents: pattern.stages,
            text: `\n\nIMPORTANT: Common issue to avoid - ${pattern.suggestedFix}`,
          },
        },
      })
    }

    // Generate optimizations from bottlenecks
    for (const bottleneck of bottlenecks) {
      if (bottleneck.causes.length === 0) continue

      const primaryCause = bottleneck.causes[0]

      if (primaryCause.includes("timeout")) {
        optimizations.push({
          id: ID.ascending(),
          target: "agent_config",
          description: `Increase timeout for ${bottleneck.stage} stage`,
          expectedImprovement: bottleneck.frequency * 0.3,
          riskLevel: "low",
          implementation: {
            type: "update_timeout",
            parameters: {
              stage: bottleneck.stage,
              newTimeout: Math.ceil(bottleneck.averageDelay * 1.5),
            },
          },
        })
      }

      if (primaryCause.includes("dependency")) {
        optimizations.push({
          id: ID.ascending(),
          target: "workflow_structure",
          description: `Optimize task dependencies in ${bottleneck.stage} stage`,
          expectedImprovement: bottleneck.frequency * 0.25,
          riskLevel: "medium",
          implementation: {
            type: "reorder_tasks",
            parameters: {
              stage: bottleneck.stage,
            },
          },
        })
      }

      if (primaryCause.includes("resource")) {
        optimizations.push({
          id: ID.ascending(),
          target: "agent_config",
          description: `Optimize resource usage for ${bottleneck.agentID} agent`,
          expectedImprovement: bottleneck.frequency * 0.15,
          riskLevel: "medium",
          implementation: {
            type: "optimize_resources",
            parameters: {
              agentID: bottleneck.agentID,
            },
          },
        })
      }
    }

    return optimizations.sort((a, b) => b.expectedImprovement - a.expectedImprovement)
  }

  /**
   * Update prompt strategies based on analysis
   */
  export async function updatePromptStrategies(): Promise<void> {
    const patterns = await analyzeFailurePatterns()

    for (const pattern of patterns) {
      if (pattern.confidence < 0.7 || pattern.occurrences < 3) continue

      // Store prompt enhancement for later application
      await Storage.write(
        ["heuristics", "prompt_enhancement", pattern.id],
        {
          pattern,
          enhancement: pattern.suggestedFix,
          applied: false,
        }
      )
    }
  }

  /**
   * Create error signature for grouping similar errors
   */
  function createErrorSignature(error: WorkflowMetrics["errors"][0]): string {
    // Extract key parts of the error message
    const messageParts = error.message
      .toLowerCase()
      .replace(/\d+/g, "N") // Replace numbers with N
      .replace(/['"]/g, "") // Remove quotes
      .split(/[\s,.:;]+/)
      .filter(p => p.length > 3) // Keep significant words
      .slice(0, 5) // Take first 5 words

    return `${error.type}:${messageParts.join("_")}`
  }

  /**
   * Generate suggested fix from error patterns
   */
  function generateSuggestedFix(errors: WorkflowMetrics["errors"]): string {
    const firstError = errors[0]

    // Common error types and their fixes
    if (firstError.type.includes("timeout")) {
      return "Increase timeout duration or optimize operation performance"
    }

    if (firstError.type.includes("permission")) {
      return "Check and update permission configuration for the required operation"
    }

    if (firstError.type.includes("not found") || firstError.type.includes("missing")) {
      return "Ensure required files/dependencies exist before executing task"
    }

    if (firstError.type.includes("syntax") || firstError.type.includes("parse")) {
      return "Validate code syntax before attempting to execute"
    }

    if (firstError.type.includes("network") || firstError.type.includes("connection")) {
      return "Add retry logic with exponential backoff for network operations"
    }

    if (firstError.type.includes("dependency") || firstError.type.includes("module")) {
      return "Run dependency installation before executing tasks that require packages"
    }

    return `Common issue: ${firstError.message.slice(0, 100)}. Review and fix before proceeding.`
  }

  /**
   * Generate pattern description
   */
  function generatePatternDescription(errors: WorkflowMetrics["errors"]): string {
    const stages = new Set(errors.map(e => e.stage))
    const agents = new Set(errors.map(e => e.agentID))

    return `Recurring ${errors[0].type} error occurring ${errors.length} times across ${stages.size} stage(s) and ${agents.size} agent(s)`
  }

  /**
   * Calculate confidence score for a pattern
   */
  function calculateConfidence(errors: WorkflowMetrics["errors"]): number {
    // Factors: occurrences, consistency, recency

    // More occurrences = higher confidence
    const occurrenceScore = Math.min(errors.length / 10, 1) * 0.4

    // Check message consistency
    const messages = errors.map(e => e.message)
    const uniqueMessages = new Set(messages)
    const consistencyScore = (1 - (uniqueMessages.size / messages.length)) * 0.3

    // Recent errors are more relevant
    const now = Date.now()
    const avgAge = errors.reduce((sum, e) => sum + (now - e.timestamp), 0) / errors.length
    const recencyScore = Math.max(0, 1 - (avgAge / (30 * 24 * 60 * 60 * 1000))) * 0.3 // 30 days

    return Math.min(occurrenceScore + consistencyScore + recencyScore, 1)
  }

  /**
   * Calculate median of an array
   */
  function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0

    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2
    }

    return sorted[mid]
  }

  /**
   * Identify causes of stage bottlenecks
   */
  async function identifyBottleneckCauses(
    stage: WorkflowStage,
    allMetrics: WorkflowMetrics[]
  ): Promise<string[]> {
    const causes: string[] = []

    // Check for timeout errors in this stage
    const timeoutErrors = allMetrics.flatMap(m =>
      m.errors.filter(e => e.stage === stage && e.type.includes("timeout"))
    )

    if (timeoutErrors.length > 0) {
      causes.push("Frequent timeout errors")
    }

    // Check for high task counts
    const avgTasksInStage = allMetrics.reduce((sum, m) => {
      const tasks = Object.values(m.tasks).reduce((a, b) => a + b, 0)
      return sum + tasks
    }, 0) / allMetrics.length

    if (avgTasksInStage > 10) {
      causes.push("High number of tasks in stage")
    }

    // Check for dependency issues
    const depErrors = allMetrics.flatMap(m =>
      m.errors.filter(e => e.stage === stage && e.message.includes("dependency"))
    )

    if (depErrors.length > 0) {
      causes.push("Task dependency issues")
    }

    return causes
  }

  /**
   * Identify causes of agent bottlenecks
   */
  async function identifyAgentBottleneckCauses(
    agentID: string,
    allMetrics: WorkflowMetrics[]
  ): Promise<string[]> {
    const causes: string[] = []

    // Check for heavy tool usage
    const agentMetrics = allMetrics
      .map(m => m.agents[agentID])
      .filter(Boolean)

    if (agentMetrics.length === 0) return causes

    const avgToolUsage = agentMetrics.reduce((sum, am) =>
      sum + Object.values(am.toolsUsed).reduce((a, b) => a + b, 0),
      0
    ) / agentMetrics.length

    if (avgToolUsage > 20) {
      causes.push("Heavy tool usage")
    }

    // Check for high token usage
    const avgTokens = agentMetrics.reduce((sum, am) => sum + am.tokensUsed, 0) / agentMetrics.length

    if (avgTokens > 100000) {
      causes.push("High token consumption")
    }

    // Check for low success rate
    const avgSuccessRate = agentMetrics.reduce((sum, am) => sum + am.successRate, 0) / agentMetrics.length

    if (avgSuccessRate < 0.7) {
      causes.push("Low success rate requiring retries")
    }

    return causes
  }

  /**
   * Save failure pattern
   */
  export async function savePattern(pattern: FailurePattern): Promise<void> {
    await Storage.write(["heuristics", "pattern", pattern.id], pattern)
  }

  /**
   * Get all saved patterns
   */
  export async function getPatterns(): Promise<FailurePattern[]> {
    const keys = await Storage.list(["heuristics", "pattern"])
    return Promise.all(keys.map(key => Storage.read<FailurePattern>(key)))
  }

  /**
   * Save optimization
   */
  export async function saveOptimization(optimization: Optimization): Promise<void> {
    await Storage.write(["heuristics", "optimization", optimization.id], optimization)
  }

  /**
   * Get all saved optimizations
   */
  export async function getOptimizations(): Promise<Optimization[]> {
    const keys = await Storage.list(["heuristics", "optimization"])
    return Promise.all(keys.map(key => Storage.read<Optimization>(key)))
  }
}
